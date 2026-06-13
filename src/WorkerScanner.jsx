import React, { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { getInventoryItemByBarcode } from './services/db';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { generateId } from './utils';

export default function WorkerScanner({ cashierName }) {
  const { showAlert } = useApp();
  const [cart, setCart] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isSending, setIsSending] = useState(false);
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
    if (isScanning) {
      const scanner = new Html5QrcodeScanner(
        "reader", 
        { 
          fps: 10, 
          qrbox: { width: 300, height: 150 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.UPC_A
          ],
          videoConstraints: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
          }
        }, 
        false
      );
      
      scannerRef.current = scanner;

      scanner.render(
        async (decodedText) => {
          if (scanner.getState() === 2) {
            scanner.pause(true); 
            await handleScan(decodedText);
            setTimeout(() => {
              if (scannerRef.current && scannerRef.current.getState() === 3) {
                scannerRef.current.resume();
              }
            }, 1000);
          }
        },
        (errorMessage) => {
          // ignore background scan errors
        }
      );

      return () => {
        if (scannerRef.current) {
          scannerRef.current.clear().catch(console.error);
        }
      };
    }
  }, [isScanning]);

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
      console.log('Audio not supported or blocked', e);
    }
  };

  const handleScan = async (barcode) => {
    try {
      const isInstance = barcode.includes('-');
      let searchBarcode = isInstance ? barcode.split('-')[0] : barcode;
      
      let item = await getInventoryItemByBarcode(searchBarcode);
      
      if (!item) {
        // Fallback for UPC/EAN format differences
        try {
          const { initDB } = await import('./services/db');
          const db = await initDB();
          const allItems = await db.getAll('inventory');
          
          const cleanSearch = searchBarcode.replace(/^0+/, '');
          item = allItems.find(i => i.barcode.replace(/^0+/, '') === cleanSearch);
        } catch (dbErr) {
          console.error("Fallback search failed:", dbErr);
        }
      }

      if (!item) {
        showAlert(`Item not found for barcode: ${barcode}`, "Error");
        return;
      }

      // Check Stock Limits
      let maxStock = 0;
      if (item.is_cuttable) {
        if (!isInstance) {
          showAlert(`Please scan the specific piece sticker for ${item.name}, not the generic barcode.`, "Error");
          return;
        }
        try {
          const { data, error } = await supabase.from('stock_instances').select('current_length').eq('instance_barcode', barcode).single();
          if (error || !data) throw new Error("Piece not found");
          maxStock = Number(data.current_length);
        } catch (err) {
          console.error(err);
          showAlert(`Could not verify stock for piece #${barcode.split('-')[1]}`, "Error");
          return;
        }
      } else {
        maxStock = Number(item.stock_store || 0);
      }

      if (maxStock <= 0) {
        showAlert(`${item.name} is currently out of stock!`, "Out of Stock");
        return;
      }

      setCart(prev => {
        const instanceBarcode = isInstance ? barcode : null;
        
        const existingIdx = prev.findIndex(i => 
          i.barcode === searchBarcode && i.instance_barcode === instanceBarcode
        );

        if (existingIdx >= 0) {
          const currentQty = Number(prev[existingIdx].quantity) || 0;
          if (currentQty + 1 > maxStock) {
            showAlert(`You only have ${maxStock} in stock for ${item.name}!`, "Stock Limit");
            return prev;
          }
          playBeep();
          const newCart = [...prev];
          newCart[existingIdx] = { ...newCart[existingIdx], quantity: currentQty + 1 };
          return newCart;
        } else {
          playBeep();
          return [{ 
            ...item, 
            id: generateId(), 
            quantity: 1,
            maxStock: maxStock,
            instance_barcode: instanceBarcode,
            name: isInstance ? `${item.name} (Piece #${barcode.split('-')[1]})` : item.name
          }, ...prev];
        }
      });
    } catch (e) {
      console.error(e);
      showAlert("Error processing scan", "Error");
    }
  };

  const updateQuantity = (id, val) => {
    let newQty = val === '' ? '' : Math.max(0, Number(val));
    const itemToUpdate = cart.find(i => i.id === id);
    
    if (itemToUpdate && newQty !== '' && newQty > (itemToUpdate.maxStock || 0)) {
      showAlert(`You only have ${itemToUpdate.maxStock} in stock for ${itemToUpdate.name}!`, "Stock Limit");
      newQty = itemToUpdate.maxStock;
    }

    setCart(prev => {
      return prev.map(i => i.id === id ? { ...i, quantity: newQty } : i).filter(i => i.quantity !== 0);
    });
  };

  const handleSend = async () => {
    if (cart.length === 0) return;
    setIsSending(true);
    try {
      const { error } = await supabase.from('pending_carts').insert([{
        worker_name: cashierName,
        items: cart
      }]);
      
      if (error) throw error;
      
      showAlert("List sent to checkout counter successfully!", "Success");
      setCart([]);
      setIsScanning(false);
    } catch (err) {
      showAlert(err.message, "Error");
    } finally {
      setIsSending(false);
    }
  };

  // Force dark mode for scanner view
  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
    localStorage.setItem('theme', 'dark');
  }, []);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden">
      {/* Header / Send Button */}
      {cart.length > 0 && (
        <div className="p-4 flex-shrink-0" style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
          <button
            onClick={handleSend}
            disabled={isSending}
            className="w-full py-6 text-white font-black uppercase tracking-widest text-xl shadow-lg rounded-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {isSending ? 'SENDING...' : (
              <>
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                SEND {cart.length} ITEMS
              </>
            )}
          </button>
        </div>
      )}

      {/* Camera Area */}
      {isScanning && (
        <div className="p-4 w-full flex justify-center bg-[var(--bg-primary)] flex-shrink-0" style={{ borderBottom: '1px solid var(--border-medium)' }}>
          <div className="w-full max-w-md rounded-xl overflow-hidden border-4 flex flex-col justify-center relative" style={{ minHeight: '200px', maxHeight: '300px', borderColor: 'var(--color-success)', backgroundColor: 'var(--bg-secondary)' }}>
            <style>{`
              #reader { 
                width: 100% !important; 
                border: none !important; 
                text-align: center !important; 
                background: transparent url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke="%23333333" stroke-width="4"/><circle cx="25" cy="25" r="20" fill="none" stroke="%233b82f6" stroke-width="4" stroke-dasharray="31.4 100"><animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/></circle></svg>') no-repeat center center !important;
                background-size: 50px 50px !important;
              }

              /* Hide all text and internal borders generated by the camera library */
              #reader div {
                color: transparent !important;
                border: none !important;
                box-shadow: none !important;
                outline: none !important;
              }
              
              #reader video { 
                max-height: 300px !important; 
                object-fit: cover !important; 
                background-color: var(--bg-secondary) !important; /* Covers the background spinner once loaded */
                position: relative;
                z-index: 10;
              }
              
              /* Aggressively hide "Scan an Image File" and "Select Camera" text/dropdowns */
              #reader a, #reader [id*="swaplink"], #reader [id*="file_scan"] { 
                display: none !important; 
              }
              
              /* This completely hides the "Select Camera" text and any other helper text */
              #reader span { 
                display: none !important; 
              }
              
              /* This completely hides the dropdown */
              #reader select { 
                display: none !important; 
                visibility: hidden !important;
                opacity: 0 !important;
                height: 0 !important;
              }
              
              /* Style permission button to match dark theme natively */
              #reader button { 
                background-color: var(--bg-tertiary) !important; 
                color: var(--text-primary) !important; /* Override the transparent color from parent */
                padding: 8px 16px !important; 
                border-radius: 0 !important; 
                font-weight: bold !important; 
                font-size: 12px !important; 
                text-transform: uppercase !important;
                border: 2px solid var(--border-medium) !important;
                margin-top: 15px !important;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1) !important;
                cursor: pointer !important;
                position: relative;
                z-index: 20; /* Keep above spinner */
              }
              
              /* Hide the info icon in the top right */
              #reader img { display: none !important; }
            `}</style>
            <div id="reader" className="w-full h-full flex flex-col justify-center"></div>
          </div>
        </div>
      )}

      {/* Cart List */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <svg className="w-20 h-20 mb-6 opacity-30" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'var(--text-secondary)' }}><path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" /></svg>
            <p className="text-xl font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>List is Empty</p>
            <p className="text-base mt-2 font-medium" style={{ color: 'var(--text-tertiary)' }}>Tap the green button below to start.</p>
          </div>
        ) : (
          cart.map((item) => (
            <div key={item.id} className="p-5 flex flex-col shadow-md rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '2px solid var(--border-medium)' }}>
              <div className="flex justify-between items-start mb-4 gap-4">
                <div className="flex flex-col flex-1">
                  <span className="font-bold text-xl leading-tight" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                  {item.instance_barcode && <span className="font-mono text-sm mt-1" style={{ color: 'var(--color-accent)' }}>Piece #{item.instance_barcode.split('-')[1]}</span>}
                </div>
                <button 
                  onClick={() => updateQuantity(item.id, 0)} 
                  className="w-12 h-12 flex items-center justify-center rounded-md font-bold text-2xl flex-shrink-0" 
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
              
              <div className="flex justify-between items-center mt-2 pt-4" style={{ borderTop: '2px dashed var(--border-light)' }}>
                <span className="text-base font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Quantity</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateQuantity(item.id, Number(item.quantity) - 1)} className="w-14 h-14 flex items-center justify-center rounded-md bg-[var(--bg-tertiary)] active:bg-[var(--bg-hover)] text-[var(--text-primary)] border-2 border-[var(--border-medium)] font-bold text-3xl leading-none">-</button>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity}
                    onChange={(e) => updateQuantity(item.id, e.target.value)}
                    className="w-20 h-14 text-center text-2xl font-bold rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border-2 border-[var(--border-medium)] focus:outline-none focus:border-[var(--color-accent)] appearance-none m-0"
                  />
                  <button onClick={() => updateQuantity(item.id, Number(item.quantity) + 1)} className="w-14 h-14 flex items-center justify-center rounded-md bg-[var(--bg-tertiary)] active:bg-[var(--bg-hover)] text-[var(--text-primary)] border-2 border-[var(--border-medium)] font-bold text-3xl leading-none">+</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer / Camera Button */}
      <div className="p-4 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.1)] flex-shrink-0" style={{ backgroundColor: 'var(--bg-secondary)', borderTop: '2px solid var(--border-medium)' }}>
        <div className="flex flex-col gap-4">
          <button 
            onClick={() => {
              unlockAudio();
              setIsScanning(!isScanning);
            }}
            className="w-full py-5 font-bold uppercase text-lg text-white shadow-md rounded-md transition-all active:scale-95 flex items-center justify-center gap-2"
            style={{ backgroundColor: isScanning ? 'var(--color-error)' : 'var(--color-success)' }}
          >
            {isScanning ? (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                STOP CAMERA
              </>
            ) : (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                START SCANNING
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
