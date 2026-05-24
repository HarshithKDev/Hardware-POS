import { useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { supabase } from './supabaseClient';

export function LogoutModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[500] px-4 print:hidden">
      <div className="w-[95%] max-w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <div className="flex justify-between items-center pr-1 pl-4 py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Sign Out</span>
          <button onClick={onCancel} className="px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none" style={{ color: 'var(--text-secondary)' }}>✕</button>
        </div>
        <div className="p-6">
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>You will be logged out of the current session. Any unsaved data will be lost. Continue?</p>
        </div>
        <div className="p-4 flex justify-end gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
          <button onClick={onConfirm} className="px-6 py-1.5 text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none" style={{ backgroundColor: 'var(--color-accent)' }}>Sign Out</button>
          <button onClick={onCancel} className="px-6 py-1.5 text-sm focus:outline-none rounded-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function MobileScannerModal({ onClose, setScannedProduct }) {
  const scannerRef = useRef(null);

  useEffect(() => {
    let isVerifying = false;

    scannerRef.current = new Html5QrcodeScanner(
      'reader',
      { fps: 10, qrbox: { width: 250, height: 250 }, rememberLastUsedCamera: true, aspectRatio: 1.0 },
      /* verbose= */ false
    );

    scannerRef.current.render(async (decodedText) => {
      if (isVerifying) return;
      isVerifying = true;

      const { data } = await supabase
        .from('inventory')
        .select('*')
        .eq('barcode', decodedText)
        .eq('is_active', true)
        .single();

      if (data) {
        setScannedProduct(data);
        scannerRef.current?.clear().catch(() => {});
        onClose();
      } else {
        console.warn('Product not found:', decodedText);
        isVerifying = false;
      }
    }, () => {});

    return () => {
      scannerRef.current?.clear().catch(() => {});
    };
  }, [onClose, setScannedProduct]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[500] px-4 print:hidden">
      <div className="w-[95%] max-w-[450px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <div className="flex justify-between items-center pr-1 pl-4 py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Mobile Scanner</span>
          <button onClick={onClose} className="px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none" style={{ color: 'var(--text-secondary)' }}>✕</button>
        </div>
        <div className="p-6 flex flex-col items-center">
          <div id="reader" className="w-full rounded-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }} />
          <p className="mt-4 text-xs" style={{ color: 'var(--text-secondary)' }}>Position the barcode within the frame.</p>
        </div>
        <div className="p-4 flex justify-end" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
          <button onClick={onClose} className="px-6 py-1.5 text-sm w-full md:w-auto focus:outline-none rounded-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function ProductInfoModal({ product, onClose }) {
  if (!product) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[500] px-4 print:hidden">
      <div className="w-[95%] max-w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <div className="flex justify-between items-center pr-1 pl-4 py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Product Information</span>
          <button onClick={onClose} className="px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none" style={{ color: 'var(--text-secondary)' }}>✕</button>
        </div>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text-secondary)' }}>Nomenclature</p>
          <p className="text-xl font-light mb-6" style={{ color: 'var(--text-primary)' }}>{product.name}</p>
          <div className="flex gap-4">
            <div className="flex-1 p-4 text-center rounded-none" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
              <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text-secondary)' }}>Warehouse</p>
              <p className="text-3xl font-light" style={{ color: 'var(--text-primary)' }}>{product.stock_warehouse || 0}</p>
            </div>
            <div className="flex-1 p-4 text-center rounded-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '2px solid var(--color-accent)' }}>
              <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--color-accent)' }}>Store Floor</p>
              <p className="text-3xl font-light" style={{ color: 'var(--color-accent)' }}>{product.stock_store || 0}</p>
            </div>
          </div>
        </div>
        <div className="p-4 flex justify-end" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
          <button onClick={onClose} className="px-6 py-1.5 text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none" style={{ backgroundColor: 'var(--color-accent)' }}>OK</button>
        </div>
      </div>
    </div>
  );
}