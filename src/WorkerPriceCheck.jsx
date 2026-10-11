import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { getInventoryItemByBarcode } from './services/db';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { calculateMSP } from './utils';
import { STORE_LOW_STOCK_THRESHOLD, WAREHOUSE_LOW_STOCK_THRESHOLD } from './constants';
import { AlertTriangle, Camera, RefreshCw, Eye } from 'lucide-react';

export default function WorkerPriceCheck() {
  const { showAlert, userRole } = useApp();
  const [isScanning, setIsScanning] = useState(true);
  const [scannedItem, setScannedItem] = useState(null);
  const [availableInstances, setAvailableInstances] = useState([]);
  const [isLoadingInstances, setIsLoadingInstances] = useState(false);
  const [revealedMsp, setRevealedMsp] = useState(false);
  
  const scannerRef = useRef(null);
  const audioCtxRef = useRef(null);

  const unlockAudio = () => {
    try {
      if (!audioCtxRef.current) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          audioCtxRef.current = new AudioContext();
        }
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    } catch (e) {
      console.log('Audio unlock failed', e);
    }
  };

  useEffect(() => {
    const handleFirstInteraction = () => {
      unlockAudio();
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };
    window.addEventListener('click', handleFirstInteraction, { passive: true });
    window.addEventListener('touchstart', handleFirstInteraction, { passive: true });
    return () => {
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, []);

  const playBeep = () => {
    try {
      if (!audioCtxRef.current) return;
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.1);
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
      console.log('Audio error', e);
    }
  };

  useEffect(() => {
    let active = true;
    let html5QrCode = null;

    const startCamera = async () => {
      if (window._globalScannerCleanupPromise) {
        await window._globalScannerCleanupPromise;
      }
      if (!active || !isScanning) return;

      try {
        html5QrCode = new Html5Qrcode("price-check-reader");
        scannerRef.current = html5QrCode;

        const scanConfig = {
          fps: 10,
          qrbox: { width: 280, height: 160 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.UPC_A
          ]
        };

        let isProcessing = false;
        const onDecoded = async (decodedText) => {
          if (!isProcessing && active) {
            isProcessing = true;
            await handleLookup(decodedText);
            setTimeout(() => {
              isProcessing = false;
            }, 500);
          }
        };

        try {
          await html5QrCode.start(
            { facingMode: "environment" },
            scanConfig,
            onDecoded,
            () => {}
          );
        } catch (envErr) {
          console.warn("Back camera unavailable in lookup, attempting fallback:", envErr);
          const devices = await Html5Qrcode.getCameras();
          if (devices && devices.length > 0) {
            const backCam = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[0];
            await html5QrCode.start(
              backCam.id,
              scanConfig,
              onDecoded,
              () => {}
            );
          } else {
            throw new Error("No camera found on this device.");
          }
        }
      } catch (err) {
        console.error("Lookup camera startup error:", err);
        if (active) {
          showAlert(err.message || "Failed to access camera. Please check camera permissions.", "Camera Error");
          setIsScanning(false);
        }
      }
    };

    if (isScanning) {
      startCamera();
    }

    return () => {
      active = false;
      if (scannerRef.current) {
        const scannerInstance = scannerRef.current;
        scannerRef.current = null;
        const cleanupPromise = (async () => {
          try {
            if (scannerInstance.getState && scannerInstance.getState() === 2) {
              await scannerInstance.stop();
            }
            scannerInstance.clear();
          } catch (e) {
            console.warn("Lookup camera cleanup error:", e);
          }
        })();
        window._globalScannerCleanupPromise = cleanupPromise.finally(() => {
          if (window._globalScannerCleanupPromise === cleanupPromise) {
            window._globalScannerCleanupPromise = null;
          }
        });
      }
    };
  }, [isScanning]);

  const handleLookup = async (barcode) => {
    const rawBarcode = (barcode || '').trim();
    if (!rawBarcode) return;

    try {
      let matchedItem = await getInventoryItemByBarcode(rawBarcode);
      let matchedBatch = null;
      let matchedInstance = null;

      // Check if it's formatted as [Barcode]-[BatchNumber] or [Barcode]-[BatchNumber][Sequence]
      if (!matchedItem && rawBarcode.includes('-')) {
        const parts = rawBarcode.split('-');
        const baseBarcode = parts[0];
        const parentItem = await getInventoryItemByBarcode(baseBarcode);
        
        if (parentItem) {
          matchedItem = parentItem;
          const batchNum = parseInt(parts[1], 10);
          if (!isNaN(batchNum) && parentItem.batches) {
            matchedBatch = parentItem.batches.find(b => Number(b.batch_number) === batchNum);
          }

          if (parentItem.is_cuttable) {
            const { data: inst } = await supabase
              .from('stock_instances')
              .select('*')
              .eq('instance_barcode', rawBarcode)
              .maybeSingle();
            if (inst) matchedInstance = inst;
          }
        }
      }

      // Fallback search in product_master_public
      if (!matchedItem) {
        const { data: remoteData } = await supabase
          .from('product_master_public')
          .select('*, inventory_batches_public(*)')
          .or(`barcode.eq.${rawBarcode},name.ilike.%${rawBarcode}%`)
          .eq('is_active', true)
          .limit(1);

        if (remoteData && remoteData.length > 0) {
          matchedItem = {
            ...remoteData[0],
            batches: remoteData[0].inventory_batches_public || []
          };
        }
      }

      if (!matchedItem) {
        showAlert(`Item not found for: "${rawBarcode}"`, "Not Found");
        return;
      }

      playBeep();
      setScannedItem({
        ...matchedItem,
        activeBatch: matchedBatch,
        activeInstance: matchedInstance,
        scannedCode: rawBarcode
      });
      setRevealedMsp(false);
      setIsScanning(false);

      if (matchedItem.is_cuttable) {
        setIsLoadingInstances(true);
        const { data: instances } = await supabase
          .from('stock_instances')
          .select('*')
          .eq('parent_barcode', String(matchedItem.barcode))
          .eq('is_active', true)
          .gt('current_length', 0);
        setAvailableInstances(instances || []);
        setIsLoadingInstances(false);
      } else {
        setAvailableInstances([]);
      }
    } catch (err) {
      console.error("Item lookup error:", err);
      showAlert("Failed to retrieve item information.", "Error");
    }
  };

  const handleScanAnother = () => {
    setScannedItem(null);
    setRevealedMsp(false);
    setIsScanning(true);
  };

  const displayUnit = (scannedItem?.unit || '').toUpperCase();
  const activeBatch = scannedItem?.activeBatch;
  const price = activeBatch?.selling_price ?? (scannedItem?.price || 0);
  const msp = calculateMSP(activeBatch, scannedItem);

  const storeStock = activeBatch ? activeBatch.stock_store : (scannedItem?.stock_store ?? 0);
  const whseStock = activeBatch ? activeBatch.stock_warehouse : (scannedItem?.stock_warehouse ?? 0);
  const totalStock = Number(storeStock || 0) + Number(whseStock || 0);

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] overflow-y-auto px-4 pb-6 pt-1 md:px-6 md:pb-6 md:pt-2 animate-fade-in">
      <div className="max-w-2xl w-full mx-auto flex-1 flex flex-col gap-4">
        
        {scannedItem ? (
          /* Scanned Item Details View (Full Page, Prominent, Phone-Optimized) */
          <div className="flex-1 flex flex-col justify-between gap-4 animate-fade-in">
            {/* Header: Product Details Title & Barcode Badge */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Product Details
              </span>
              <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-[var(--bg-secondary)] text-[var(--color-accent)] border border-[var(--border-light)]">
                #{scannedItem.scannedCode || scannedItem.barcode}
              </span>
            </div>

            {/* Main Product Card - Simple, Clean, Full Page */}
            <div className="flex-1 flex flex-col justify-between bg-[var(--bg-secondary)] border border-[var(--border-light)] rounded-2xl p-6 md:p-8 shadow-sm gap-6">
              <div className="flex flex-col gap-6">
                {/* Product Name ON TOP */}
                <div className="flex flex-col gap-2">
                  <h2 className="text-2xl md:text-3xl font-extrabold text-[var(--text-primary)] leading-tight capitalize">
                    {scannedItem.name}
                  </h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    {scannedItem.category && (
                      <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-light)]">
                        {scannedItem.category}
                      </span>
                    )}
                    {scannedItem.activeBatch && (
                      <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        Batch #{String(scannedItem.activeBatch.batch_number).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Selling Price Card */}
                <div className="p-5 md:p-6 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-light)] flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                      Selling Price
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl md:text-5xl font-black text-[var(--color-success)] tracking-tight">
                        ₹{Number(price).toFixed(2)}
                      </span>
                      <span className="text-sm text-[var(--text-tertiary)] font-semibold">
                        {displayUnit ? `/ ${displayUnit}` : ''}
                      </span>
                    </div>
                  </div>

                  {/* Min Price (MSP) */}
                  <div 
                    onClick={() => setRevealedMsp(!revealedMsp)}
                    className="cursor-pointer text-right px-3.5 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)] hover:border-[var(--color-accent)] transition-all select-none"
                    title="Tap to reveal minimum price"
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center justify-end gap-1">
                      Min Price
                      <Eye className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                    </span>
                    <span className="text-base font-bold text-[var(--text-primary)] font-mono mt-0.5 block">
                      {(revealedMsp || userRole === 'owner') ? `₹${Number(msp).toFixed(2)}` : '••••••'}
                    </span>
                  </div>
                </div>

                {/* Stock in ST & WH */}
                <div className="p-5 md:p-6 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-light)] flex flex-col gap-4">
                  <div className="flex items-center justify-between text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                    <span>Stock Availability</span>
                    <span>Total: <strong className="text-[var(--text-primary)] font-extrabold text-sm">{totalStock}</strong> {displayUnit || 'pcs'}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* ST (Store) */}
                    <div className="p-4 md:p-5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-light)] flex flex-col justify-between">
                      <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                        ST (Store)
                      </span>
                      <div className="flex items-baseline gap-1.5 my-2">
                        <span className={`text-3xl md:text-5xl font-black ${Number(storeStock) < STORE_LOW_STOCK_THRESHOLD ? 'text-amber-500' : 'text-[var(--text-primary)]'}`}>
                          {storeStock}
                        </span>
                        <span className="text-xs font-semibold text-[var(--text-tertiary)]">{displayUnit || 'pcs'}</span>
                      </div>
                      {Number(storeStock) < STORE_LOW_STOCK_THRESHOLD ? (
                        <span className="text-[10px] font-bold text-amber-500 flex items-center gap-1">
                          <AlertTriangle size={11} /> Low stock
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-[var(--color-success)]">In Stock</span>
                      )}
                    </div>

                    {/* WH (Warehouse) */}
                    <div className="p-4 md:p-5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-light)] flex flex-col justify-between">
                      <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                        WH (Warehouse)
                      </span>
                      <div className="flex items-baseline gap-1.5 my-2">
                        <span className={`text-3xl md:text-5xl font-black ${Number(whseStock) < WAREHOUSE_LOW_STOCK_THRESHOLD ? 'text-amber-500' : 'text-[var(--text-primary)]'}`}>
                          {whseStock}
                        </span>
                        <span className="text-xs font-semibold text-[var(--text-tertiary)]">{displayUnit || 'pcs'}</span>
                      </div>
                      {Number(whseStock) < WAREHOUSE_LOW_STOCK_THRESHOLD ? (
                        <span className="text-[10px] font-bold text-amber-500 flex items-center gap-1">
                          <AlertTriangle size={11} /> Low stock
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-[var(--color-success)]">In Stock</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Big Bottom Action Button */}
              <button
                type="button"
                onClick={handleScanAnother}
                className="w-full py-4 md:py-5 rounded-xl font-bold text-base uppercase tracking-wider text-white bg-[var(--color-accent)] hover:opacity-90 active:scale-98 transition-all shadow-md flex items-center justify-center gap-2 mt-2"
              >
                <Camera className="w-5 h-5" />
                Scan Another Item
              </button>
            </div>
          </div>
        ) : (
          /* Camera View Mode (Shown when scanning) */
          <div className="flex flex-col gap-4 animate-fade-in">
            {/* Header Bar */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
                  <span className="p-2 rounded-lg bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
                    <Camera className="w-5 h-5" />
                  </span>
                  Item & Stock Lookup
                </h1>
                <p className="text-xs text-[var(--text-secondary)] mt-1">Point camera at barcode to look up stock & price</p>
              </div>
              {isScanning && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Scanning
                </span>
              )}
            </div>

            {isScanning ? (
              <div className="w-full rounded-2xl overflow-hidden border-2 border-[var(--color-accent)] bg-black p-2.5 shadow-lg relative">
                <style>{`
                  #price-check-reader { width: 100% !important; border: none !important; }
                  #price-check-reader video { width: 100% !important; max-height: 340px !important; object-fit: cover !important; border-radius: 12px; }
                  #price-check-reader canvas { display: none !important; }
                `}</style>
                <div id="price-check-reader" className="w-full flex justify-center"></div>
                <div className="mt-2.5 py-1 text-center text-xs text-white/80 font-medium flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Align barcode within camera view
                </div>
              </div>
            ) : (
              <div className="w-full rounded-2xl p-8 bg-[var(--bg-secondary)] border border-[var(--border-light)] text-center flex flex-col items-center justify-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[var(--text-secondary)]">
                  <Camera className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-[var(--text-primary)]">Camera is inactive</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Camera access was paused or stopped.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    unlockAudio();
                    setIsScanning(true);
                  }}
                  className="px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider text-white bg-[var(--color-accent)] hover:opacity-90 active:scale-95 transition-all shadow-sm flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Start Camera Scanner
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
