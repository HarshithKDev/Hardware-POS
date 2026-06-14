import { useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { supabase } from './supabaseClient';

export function LogoutModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[500] px-4 print:hidden animate-fade-in">
      <div className="w-[85%] max-w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none animate-scale-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
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

export function MobileScannerModal({ onClose, setScannedProduct, onScan }) {
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

      if (onScan) {
        onScan(decodedText);
        scannerRef.current?.clear().catch(() => { });
        onClose();
        return;
      }

      const { data } = await supabase
        .from('inventory')
        .select('*')
        .eq('barcode', decodedText)
        .eq('is_active', true)
        .single();

      if (data) {
        setScannedProduct(data);
        scannerRef.current?.clear().catch(() => { });
        onClose();
      } else {
        console.warn('Product not found:', decodedText);
        isVerifying = false;
      }
    }, () => { });

    return () => {
      scannerRef.current?.clear().catch(() => { });
    };
  }, [onClose, setScannedProduct, onScan]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[500] px-4 print:hidden animate-fade-in">
      <div className="w-[85%] max-w-[450px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none animate-scale-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[500] px-4 print:hidden animate-fade-in">
      <div className="w-[85%] max-w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none animate-scale-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <div className="flex justify-between items-center pr-1 pl-4 py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Product Information</span>
          <button onClick={onClose} className="px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none" style={{ color: 'var(--text-secondary)' }}>✕</button>
        </div>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text-secondary)' }}>Item Name</p>
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

export function PrintPreviewModal({ isOpen, onClose, title = "Print Preview", type = "receipt", children, iframeHtml, printHtml }) {
  const visibleIframeRef = useRef(null);
  const printIframeRef = useRef(null);

  if (!isOpen) return null;

  const handlePrint = () => {
    if (type === 'barcode' && printIframeRef.current) {
      printIframeRef.current.contentWindow.print();
    } else {
      window.print();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[600] px-4 print:hidden animate-fade-in">
      <div className="w-[85%] max-w-[500px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none animate-scale-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <div className="flex justify-between items-center pr-1 pl-4 py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>{title}</span>
          <button onClick={onClose} className="px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none" style={{ color: 'var(--text-secondary)' }}>✕</button>
        </div>

        <div className="p-4 md:p-6 flex justify-center items-center overflow-auto" style={{ backgroundColor: 'var(--bg-primary)', minHeight: '300px', maxHeight: '60vh' }}>
          {type === 'receipt' ? (
            <div className="w-full max-w-[350px] min-h-[100mm] text-black">
              {children}
            </div>
          ) : (
            <>
              {/* Visible Preview Iframe */}
              <iframe
                ref={visibleIframeRef}
                srcDoc={iframeHtml}
                className="bg-white shadow-sm"
                style={{ width: '100%', minHeight: type === 'barcode' ? '200px' : '400px', border: 'none' }}
                title="Barcode Print Preview"
              />
              {/* Hidden Print Iframe */}
              {printHtml && (
                <iframe
                  ref={printIframeRef}
                  srcDoc={printHtml}
                  style={{ display: 'none' }}
                  title="Hidden Barcode Print"
                />
              )}
            </>
          )}
        </div>

        <div className="p-4 flex flex-col md:flex-row justify-between items-center gap-4" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Note: The system print dialog will open next.
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-6 py-1.5 text-sm focus:outline-none rounded-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>Close</button>
            <button onClick={handlePrint} className="px-6 py-1.5 text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none flex items-center gap-2" style={{ backgroundColor: 'var(--color-accent)' }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0v2.796c0 1.171.95 2.122 2.122 2.122h6.256a2.122 2.122 0 002.122-2.122V8.571zM10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125h4.875" />
              </svg>
              Print
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}