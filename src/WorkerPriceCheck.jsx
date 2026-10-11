import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { getInventoryItemByBarcode } from './services/db';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { calculateMSP } from './utils';
import { STORE_LOW_STOCK_THRESHOLD, WAREHOUSE_LOW_STOCK_THRESHOLD } from './constants';
import { AlertTriangle, Camera, RefreshCw } from 'lucide-react';

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

  const displayUnit = (scannedItem?.unit || '').toUpperCase();
  const activeBatch = scannedItem?.activeBatch;
  const price = activeBatch?.selling_price ?? (scannedItem?.price || 0);
  const msp = calculateMSP(activeBatch, scannedItem);

  const storeStock = activeBatch ? activeBatch.stock_store : (scannedItem?.stock_store ?? 0);
  const whseStock = activeBatch ? activeBatch.stock_warehouse : (scannedItem?.stock_warehouse ?? 0);
  const totalStock = Number(storeStock || 0) + Number(whseStock || 0);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] overflow-y-auto p-4 md:p-6 animate-fade-in">
      <div className="max-w-2xl w-full mx-auto flex flex-col gap-5">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
              <span className="p-2 rounded-lg bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
                <Camera className="w-5 h-5" />
              </span>
              Item & Stock Lookup
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-1">Live camera scanner for Store stock, Warehouse stock, MRP & MSP details</p>
          </div>
          {isScanning && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Camera Active
            </span>
          )}
        </div>

        {/* Direct Camera Interface */}
        {isScanning ? (
          <div className="w-full rounded-2xl overflow-hidden border-2 border-[var(--color-accent)] bg-black p-2.5 shadow-lg relative animate-fade-in">
            <style>{`
              #price-check-reader { width: 100% !important; border: none !important; }
              #price-check-reader video { width: 100% !important; max-height: 280px !important; object-fit: cover !important; border-radius: 12px; }
              #price-check-reader canvas { display: none !important; }
            `}</style>
            <div id="price-check-reader" className="w-full flex justify-center"></div>
            <div className="mt-2 py-1 text-center text-xs text-white/80 font-medium flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Point camera at barcode to look up stock & price
            </div>
          </div>
        ) : (
          <div className="w-full rounded-2xl p-6 bg-[var(--bg-secondary)] border border-[var(--border-light)] text-center flex flex-col items-center justify-center gap-3 animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[var(--text-secondary)]">
              <Camera className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold text-sm text-[var(--text-primary)]">Camera Scanner Inactive</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Camera access may have been paused or blocked.</p>
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
              Restart Camera Scanner
            </button>
          </div>
        )}

        {/* Result Card */}
        {scannedItem ? (
          <div className="flex flex-col rounded-xl overflow-hidden bg-[var(--bg-secondary)] border border-[var(--border-light)] shadow-md animate-fade-in">
            {/* Top Product Header */}
            <div className="p-5 border-b border-[var(--border-light)] bg-[var(--bg-tertiary)] flex justify-between items-start gap-4">
              <div className="flex flex-col">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-accent)]">
                  Barcode: {scannedItem.barcode} {scannedItem.scannedCode !== scannedItem.barcode && `(${scannedItem.scannedCode})`}
                </span>
                <h2 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] mt-0.5 leading-snug">
                  {scannedItem.name}
                </h2>
                <div className="flex gap-2 mt-2">
                  {scannedItem.category && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-light)]">
                      {scannedItem.category}
                    </span>
                  )}
                  {scannedItem.is_cuttable && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[var(--color-accent-bg)] text-[var(--color-accent)] border border-blue-500/20">
                      Cuttable
                    </span>
                  )}
                  {scannedItem.is_loose_item && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20">
                      Loose
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  setScannedItem(null);
                }}
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--color-error)] border border-[var(--border-medium)] hover:border-[var(--color-error)] transition-colors"
              >
                Clear
              </button>
            </div>

            {/* LIVE STOCK BREAKDOWN (Store & WHSE Prominently) */}
            <div className="p-5 border-b border-[var(--border-light)] bg-[var(--bg-primary)]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  Current Stock Levels
                </span>
                <span className="text-xs font-bold text-[var(--text-primary)]">
                  Total: <strong className="text-sm font-extrabold text-[var(--color-accent)]">{totalStock}</strong> {displayUnit || 'units'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 md:gap-4">
                {/* Store Floor Stock */}
                <div className="p-4 rounded-xl flex flex-col justify-center bg-[var(--bg-secondary)] border-2 border-[var(--color-success)] shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-[var(--color-success)]">
                      Store Floor
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[rgba(16,185,129,0.1)] text-[var(--color-success)]">
                      Shop Stock
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-2">
                    <span className={`text-3xl md:text-4xl font-extrabold ${Number(storeStock) < STORE_LOW_STOCK_THRESHOLD ? 'text-[var(--color-error)]' : 'text-[var(--text-primary)]'}`}>
                      {storeStock}
                    </span>
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">{displayUnit || 'units'}</span>
                  </div>
                  {Number(storeStock) < STORE_LOW_STOCK_THRESHOLD && (
                    <span className="text-[10px] font-bold text-[var(--color-error)] mt-1 flex items-center gap-1">
                      <AlertTriangle size={12} /> Low Store Stock
                    </span>
                  )}
                </div>

                {/* Warehouse (WHSE) Stock */}
                <div className="p-4 rounded-xl flex flex-col justify-center bg-[var(--bg-secondary)] border-2 border-[var(--color-accent)] shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-[var(--color-accent)]">
                      Warehouse (WHSE)
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
                      Storage
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-2">
                    <span className={`text-3xl md:text-4xl font-extrabold ${Number(whseStock) < WAREHOUSE_LOW_STOCK_THRESHOLD ? 'text-[var(--color-error)]' : 'text-[var(--text-primary)]'}`}>
                      {whseStock}
                    </span>
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">{displayUnit || 'units'}</span>
                  </div>
                  {Number(whseStock) < WAREHOUSE_LOW_STOCK_THRESHOLD && (
                    <span className="text-[10px] font-bold text-[var(--color-error)] mt-1 flex items-center gap-1">
                      <AlertTriangle size={12} /> Low Warehouse Stock
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Price Cards (MRP & MSP) */}
            <div className="p-5 grid grid-cols-2 gap-4">
              {/* MRP Box */}
              <div className="p-4 rounded-xl flex flex-col justify-center items-center text-center bg-[rgba(16,185,129,0.06)] border border-[rgba(16,185,129,0.25)]">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-success)] mb-1">
                  Retail MRP
                </span>
                <span className="text-3xl md:text-4xl font-extrabold text-[var(--color-success)] tracking-tight">
                  ₹{Number(price).toFixed(2)}
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)] mt-1">
                  {displayUnit ? `per ${displayUnit}` : 'standard price'}
                </span>
              </div>

              {/* MSP Box */}
              <div 
                onClick={() => setRevealedMsp(!revealedMsp)}
                className="p-4 rounded-xl flex flex-col justify-center items-center text-center bg-[var(--bg-tertiary)] border border-[var(--border-medium)] cursor-pointer group transition-all hover:border-[var(--color-accent)]"
                title="Tap to reveal minimum selling price"
              >
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1 flex items-center gap-1">
                  Min Price (MSP)
                  <svg className="w-3.5 h-3.5 text-[var(--text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </span>
                <span className="text-2xl md:text-3xl font-extrabold text-[var(--text-primary)] tracking-tight">
                  {(revealedMsp || userRole === 'owner') ? `₹${Number(msp).toFixed(2)}` : '••••••'}
                </span>
                <span className="text-[10px] text-[var(--text-tertiary)] mt-1">
                  {(revealedMsp || userRole === 'owner') ? 'Floor limit' : 'Tap to reveal'}
                </span>
              </div>
            </div>

            {/* Batches Table if multiple */}
            {scannedItem.batches && scannedItem.batches.length > 0 && (
              <div className="px-5 pb-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2.5">
                  Batch Breakdown ({scannedItem.batches.length} Batches)
                </h3>
                <div className="flex flex-col gap-2">
                  {scannedItem.batches.map(b => (
                    <div 
                      key={b.batch_id} 
                      className={`p-3 rounded-lg border flex justify-between items-center text-xs ${
                        scannedItem.activeBatch?.batch_id === b.batch_id 
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)]' 
                          : 'border-[var(--border-light)] bg-[var(--bg-primary)]'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-[var(--text-primary)]">
                          Batch #{String(b.batch_number).padStart(2, '0')}
                        </span>
                        <div className="flex items-center gap-3 mt-0.5 text-[11px]">
                          <span className="text-[var(--color-success)] font-semibold">Store: {b.stock_store || 0}</span>
                          <span className="text-[var(--text-tertiary)]">•</span>
                          <span className="text-[var(--color-accent)] font-semibold">WHSE: {b.stock_warehouse || 0}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="font-bold text-[var(--color-success)] text-sm">
                          ₹{Number(b.selling_price || scannedItem.price || 0).toFixed(2)}
                        </span>
                        <span className="text-[10px] text-[var(--text-tertiary)]">
                          MSP: ₹{Number(b.msp || scannedItem.msp || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cuttable Pieces List if Cuttable */}
            {scannedItem.is_cuttable && (
              <div className="px-5 pb-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2.5">
                  Cuttable Rolls / Pieces ({availableInstances.length})
                </h3>
                {isLoadingInstances ? (
                  <p className="text-xs text-[var(--text-tertiary)]">Loading piece lengths...</p>
                ) : availableInstances.length === 0 ? (
                  <p className="text-xs text-[var(--text-tertiary)]">No active piece records found.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {availableInstances.map(inst => (
                      <div key={inst.id} className="p-2.5 rounded-lg border border-[var(--border-light)] bg-[var(--bg-primary)] text-xs flex flex-col">
                        <span className="font-bold text-[var(--color-accent)] truncate">
                          #{inst.instance_barcode}
                        </span>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-[var(--text-primary)] font-semibold">
                            {inst.current_length} {scannedItem.unit === 'SQFT' ? 'ft' : (scannedItem.unit || 'm')}
                          </span>
                          <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">
                            {inst.location || 'Store'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-light)] text-center flex flex-col items-center justify-center">
            <Camera className="w-12 h-12 mb-3 opacity-30 text-[var(--text-secondary)]" />
            <p className="font-bold text-base text-[var(--text-secondary)]">Ready to Scan</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1 max-w-xs">
              Hold any item barcode in front of the camera above to instantly look up live Store stock, Warehouse stock, MRP, and MSP details.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
