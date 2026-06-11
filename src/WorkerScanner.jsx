import React, { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
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

  useEffect(() => {
    if (isScanning) {
      const scanner = new Html5QrcodeScanner(
        "reader", 
        { 
          fps: 10, 
          qrbox: { width: 300, height: 150 },
          aspectRatio: 1.0,
          videoConstraints: {
            facingMode: "environment",
            width: { min: 1280, ideal: 1920, max: 3840 },
            height: { min: 720, ideal: 1080, max: 2160 },
            advanced: [{ zoom: 2.0 }]
          }
        }, 
        false
      );
      
      scannerRef.current = scanner;

      scanner.render(
        async (decodedText) => {
          // Prevent multiple rapid scans of the same barcode
          if (scanner.getState() === 2) { // 2 is SCANNING
            scanner.pause(true); 
            await handleScan(decodedText);
            setTimeout(() => {
              if (scannerRef.current && scannerRef.current.getState() === 3) { // 3 is PAUSED
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

  const handleScan = async (barcode) => {
    try {
      const isInstance = barcode.includes('-');
      let searchBarcode = isInstance ? barcode.split('-')[0] : barcode;
      
      let item = await getInventoryItemByBarcode(searchBarcode);
      
      if (!item) {
        showAlert(`Item not found for barcode: ${barcode}`, "Error");
        return;
      }

      setCart(prev => {
        // If it's a cuttable item, we must track instance barcode
        const instanceBarcode = isInstance ? barcode : null;
        
        const existingIdx = prev.findIndex(i => 
          i.barcode === searchBarcode && i.instance_barcode === instanceBarcode
        );

        if (existingIdx >= 0) {
          const newCart = [...prev];
          newCart[existingIdx] = { ...newCart[existingIdx], quantity: newCart[existingIdx].quantity + 1 };
          return newCart;
        } else {
          return [{ 
            ...item, 
            id: generateId(), 
            quantity: 1,
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
    setCart(prev => {
      const newQty = val === '' ? '' : Math.max(0, Number(val));
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

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden">
      {/* Header */}
      <div className="p-4" style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>Mobile Scanner</h2>
          <button 
            onClick={() => setIsScanning(!isScanning)}
            className="px-4 py-2 font-bold uppercase text-xs text-white shadow-sm"
            style={{ backgroundColor: isScanning ? 'var(--color-error)' : 'var(--color-accent)' }}
          >
            {isScanning ? 'Close Scanner' : 'Open Camera'}
          </button>
        </div>
      </div>

      {/* Camera Area */}
      {isScanning && (
        <div className="w-full bg-black p-2 flex justify-center">
          <div id="reader" className="w-full max-w-sm rounded overflow-hidden shadow-lg bg-white"></div>
        </div>
      )}

      {/* Cart List */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <svg className="w-16 h-16 mb-4 opacity-20" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2V5h1v1H5zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zm2 2v-1h1v1H5zM13 3a1 1 0 00-1 1v3a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3zm1 2v1h1V5h-1z" clipRule="evenodd" /></svg>
            <p className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>No items scanned</p>
            <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>Tap "Open Camera" to start scanning barcodes.</p>
          </div>
        ) : (
          cart.map((item, index) => (
            <div key={item.id} className="p-4 flex flex-col shadow-sm rounded-sm" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
              <div className="flex justify-between items-start mb-3">
                <div className="flex flex-col">
                  <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                  <span className="font-mono text-xs mt-1" style={{ color: 'var(--color-accent)' }}>#{item.instance_barcode || item.barcode}</span>
                </div>
                <button onClick={() => updateQuantity(item.id, 0)} className="text-xl px-2 leading-none" style={{ color: 'var(--color-error)' }}>×</button>
              </div>
              
              <div className="flex justify-between items-center mt-2 pt-3" style={{ borderTop: '1px solid var(--border-light)' }}>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Quantity</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQuantity(item.id, Number(item.quantity) - 1)} className="w-8 h-8 flex items-center justify-center bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-medium)] focus:outline-none focus:border-[var(--color-accent)] font-bold text-lg leading-none">-</button>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity}
                    onChange={(e) => updateQuantity(item.id, e.target.value)}
                    className="w-16 h-8 text-center text-sm font-bold bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-medium)] focus:outline-none focus:border-[var(--color-accent)] appearance-none m-0"
                  />
                  <button onClick={() => updateQuantity(item.id, Number(item.quantity) + 1)} className="w-8 h-8 flex items-center justify-center bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-medium)] focus:outline-none focus:border-[var(--color-accent)] font-bold text-lg leading-none">+</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer / Send Button */}
      {cart.length > 0 && (
        <div className="p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]" style={{ backgroundColor: 'var(--bg-secondary)', borderTop: '1px solid var(--color-accent)' }}>
          <button
            onClick={handleSend}
            disabled={isSending}
            className="w-full py-4 text-white font-bold uppercase tracking-widest text-sm shadow-md transition-all hover:brightness-110 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {isSending ? 'Sending...' : `Send ${cart.length} Items to Counter`}
          </button>
        </div>
      )}
    </div>
  );
}
