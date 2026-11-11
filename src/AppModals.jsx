import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { getThermalPrinterStatus, printDirectEscPos, isDirectEscPosSupported } from './services/escpos';
import { buttonClass, Modal } from './components/ui';



export function MobileScannerModal({ onClose, setScannedProduct, onScan }) {
  const scannerRef = useRef(null);
  const callbacksRef = useRef({ onClose, setScannedProduct, onScan });

  // Always keep callbacks fresh without triggering a re-render of the scanner hardware
  useEffect(() => {
    callbacksRef.current = { onClose, setScannedProduct, onScan };
  }, [onClose, setScannedProduct, onScan]);

  useEffect(() => {
    let isVerifying = false;
    let isMounted = true;

    import('html5-qrcode').then(({ Html5QrcodeScanner }) => {
      if (!isMounted) return;

      scannerRef.current = new Html5QrcodeScanner(
        'reader',
        { fps: 10, qrbox: { width: 250, height: 250 }, rememberLastUsedCamera: true, aspectRatio: 1.0 },
        /* verbose= */ false
      );

      scannerRef.current.render(async (decodedText) => {
        if (isVerifying) return;
        isVerifying = true;

        const { onClose: latestOnClose, setScannedProduct: latestSetScannedProduct, onScan: latestOnScan } = callbacksRef.current;

        if (latestOnScan) {
          latestOnScan(decodedText);
          scannerRef.current?.clear().catch(() => { });
          latestOnClose();
          return;
        }

        const shopId = localStorage.getItem('shop_id');
        // cost-free view: this popup only shows the name and stock
        let query = supabase
          .from('product_master_public')
          .select('*')
          .eq('barcode', decodedText)
          .eq('is_active', true);
        if (shopId) {
          query = query.eq('shop_id', shopId);
        }
        const { data } = await query.maybeSingle();

        if (data) {
          if (latestSetScannedProduct) latestSetScannedProduct(data);
          scannerRef.current?.clear().catch(() => { });
          latestOnClose();
        } else {
          console.warn('Product not found:', decodedText);
          isVerifying = false;
        }
      }, () => { });
    }).catch(err => {
      console.error('Failed to load scanner module:', err);
    });

    return () => {
      isMounted = false;
      scannerRef.current?.clear().catch(() => { });
    };
  }, []);

  return (
    <Modal
      onClose={onClose}
      title="Mobile Scanner"
      titleId="mobile-scanner-title"
      size="md"
      zIndex={500}
      focusFirst={false}
      restoreFocus={false}
      bodyClassName="p-5 flex flex-col items-center"
      footer={<button onClick={onClose} className={buttonClass({ variant: 'secondary', size: 'md', className: 'w-full md:w-auto' })}>Close</button>}
    >
      <div id="reader" className="w-full rounded-md overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }} />
      <p className="mt-4 text-xs" style={{ color: 'var(--text-secondary)' }}>Position the barcode within the frame.</p>
    </Modal>
  );
}

export function ProductInfoModal({ product, onClose }) {
  const { isWarehouseDisabled } = useApp();
  if (!product) return null;

  return (
    <Modal
      onClose={onClose}
      title="Product Information"
      titleId="product-info-title"
      size="sm"
      zIndex={500}
      focusFirst={false}
      restoreFocus={false}
      footer={<button onClick={onClose} className={buttonClass({ variant: 'secondary', size: 'md' })}>Close</button>}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Item Name</p>
      <p className="text-xl font-semibold mb-5" style={{ color: 'var(--text-primary)' }}>{product.name}</p>
      <div className="flex gap-3">
        {!isWarehouseDisabled && (
          <div className="flex-1 p-4 text-center rounded-[10px]" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Warehouse</p>
            <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{product.stock_warehouse || 0}</p>
          </div>
        )}
        <div className="flex-1 p-4 text-center rounded-[10px]" style={{ backgroundColor: 'var(--color-accent-bg)', border: '1px solid var(--color-accent)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-accent)' }}>{isWarehouseDisabled ? 'Current Stock' : 'Store'}</p>
          <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-accent)' }}>{product.stock_store || 0}</p>
        </div>
      </div>
    </Modal>
  );
}

export function PrintPreviewModal({ 
  isOpen, 
  onClose, 
  title = "Print Preview", 
  type = "receipt", 
  children, 
  iframeHtml, 
  printHtml,
  lastReceipt = null,
  shopSettings = null
}) {
  const visibleIframeRef = useRef(null);
  const printIframeRef = useRef(null);
  const [thermalStatus, setThermalStatus] = useState(() => getThermalPrinterStatus());
  const [isThermalPrinting, setIsThermalPrinting] = useState(false);
  const [thermalMessage, setThermalMessage] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setThermalStatus(getThermalPrinterStatus());
      setThermalMessage(null);
    }
  }, [isOpen]);

  const handlePrint = () => {
    if (type === 'barcode' && printIframeRef.current) {
      printIframeRef.current.contentWindow.print();
    } else {
      window.print();
    }
  };

  const handleUnifiedPrint = async () => {
    if (type !== 'receipt' || !isDirectEscPosSupported() || !lastReceipt) {
      handlePrint();
      return;
    }

    setIsThermalPrinting(true);
    setThermalMessage(null);
    try {
      const openDrawer = lastReceipt.paymentMethod === 'CASH';
      const result = await printDirectEscPos(lastReceipt, shopSettings, { openDrawer, cutPaper: true });
      if (result && result.success) {
        setThermalStatus(getThermalPrinterStatus());
        setThermalMessage({ type: 'success', text: 'Printed to thermal printer!' });
        setTimeout(() => {
          onClose();
        }, 700);
        return;
      }
    } catch (err) {
      console.warn("Direct thermal print error, falling back to browser print:", err);
    } finally {
      setIsThermalPrinting(false);
    }

    // Seamless fallback to standard print if direct thermal printing is cancelled or unavailable
    handlePrint();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleUnifiedPrint();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, type, lastReceipt]);

  if (!isOpen) return null;

  return (
    <Modal
      onClose={onClose}
      title={(
        <span className="flex items-center gap-2 flex-wrap">
          <span>{title}</span>
          {type === 'receipt' && isDirectEscPosSupported() && (
            <span className={`px-2 py-0.5 text-[11px] font-bold rounded-md border ${thermalStatus.isConnected ? 'text-[var(--color-success)] bg-[var(--color-success-bg)] border-[var(--color-success)]/30' : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border-[var(--border-medium)]'}`}>
              {thermalStatus.isConnected ? '● ESC/POS Thermal' : 'ESC/POS Ready'}
            </span>
          )}
        </span>
      )}
      titleId="print-preview-title"
      size="md"
      zIndex={600}
      closeOnEsc={false}
      focusFirst={false}
      restoreFocus={false}
      bodyClassName="p-0"
      footer={(
        <div className="w-full flex flex-col md:flex-row justify-between items-center gap-3">
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {type === 'receipt'
              ? 'Press Enter or click Print to print receipt.'
              : 'Press Enter or click Print to print barcode labels.'}
          </p>
          <div className="flex gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={onClose}
              className={buttonClass({ variant: 'secondary', size: 'md' })}
              title="Close (Esc)"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleUnifiedPrint}
              disabled={isThermalPrinting}
              className={buttonClass({ variant: 'primary', size: 'md' })}
              title={type === 'receipt' ? 'Print receipt directly to thermal printer (with browser print fallback)' : 'Print labels'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0v2.796c0 1.171.95 2.122 2.122 2.122h6.256a2.122 2.122 0 002.122-2.122V8.571zM10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125h4.875" />
              </svg>
              <span>{isThermalPrinting ? 'Printing...' : (type === 'receipt' ? 'Print Receipt' : 'Print Labels')}</span>
              <kbd className="px-1 text-[11px] bg-[var(--kbd-bg)] rounded font-mono" aria-hidden="true">↵</kbd>
            </button>
          </div>
        </div>
      )}
    >
        <div className="p-4 md:p-6 flex justify-center items-center overflow-auto" style={{ backgroundColor: 'var(--bg-primary)', minHeight: '300px', maxHeight: '60vh' }}>
          {type === 'receipt' ? (
            <div className="w-full max-w-[350px] text-black">
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

        {thermalMessage && (
          <div className={`px-4 py-1.5 text-xs text-center font-semibold animate-fade-in ${thermalMessage.type === 'error' ? 'bg-[var(--color-error-bg)] text-[var(--color-error)]' : 'bg-[var(--color-success-bg)] text-[var(--color-success)]'}`}>
            {thermalMessage.text}
          </div>
        )}

    </Modal>
  );
}
