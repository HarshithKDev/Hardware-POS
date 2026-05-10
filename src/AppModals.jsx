import { useEffect } from 'react';
import { Html5QrcodeScanner } from "html5-qrcode";
import { supabase } from './supabaseClient';

export function LogoutModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[500] px-4 print:hidden">
      <div className="bg-white border border-gray-400 w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
        <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
          <span className="text-xs font-semibold text-black">Sign Out</span>
          <button onClick={onCancel} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
        </div>
        <div className="p-6 bg-white"><p className="text-sm text-black">You will be logged out of the current session. Any unsaved data will be lost. Continue?</p></div>
        <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end gap-2">
          <button onClick={onConfirm} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none">Sign Out</button>
          <button onClick={onCancel} className="px-6 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm focus:outline-none focus:border-[#0078D7] rounded-none">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function MobileScannerModal({ onClose, setScannedProduct }) {
  useEffect(() => {
    let isVerifying = false;
    const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 }, rememberLastUsedCamera: true, aspectRatio: 1.0 });
    
    scanner.render(async (decodedText) => {
      if (isVerifying) return;
      isVerifying = true;
      const { data } = await supabase.from('inventory').select('*').eq('barcode', decodedText).eq('is_active', true).single();
      if (data) {
        setScannedProduct(data);
        scanner.clear().catch(err => console.error(err));
        onClose();
      } else {
        alert("Product not found in active catalog.");
        isVerifying = false;
      }
    }, () => {});

    return () => { scanner.clear().catch(err => console.error(err)); };
  }, [onClose, setScannedProduct]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[500] px-4 print:hidden">
      <div className="bg-white w-full max-w-[450px] border border-gray-400 shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
        <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
          <span className="text-xs font-semibold text-black">Mobile Scanner</span>
          <button onClick={onClose} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
        </div>
        <div className="p-6 flex flex-col items-center bg-white">
          <div id="reader" className="w-full bg-white border border-gray-300 rounded-none"></div>
          <p className="mt-4 text-xs text-gray-500">Position the barcode within the frame.</p>
        </div>
        <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end">
          <button onClick={onClose} className="px-6 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm w-full md:w-auto focus:outline-none focus:border-[#0078D7] rounded-none">Close</button>
        </div>
      </div>
    </div>
  );
}

export function ProductInfoModal({ product, onClose }) {
  if (!product) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[500] px-4 print:hidden">
      <div className="bg-white border border-gray-400 w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
        <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
          <span className="text-xs font-semibold text-black">Product Information</span>
          <button onClick={onClose} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
        </div>
        <div className="p-6 bg-white">
          <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Nomenclature</p>
          <p className="text-xl font-light text-black mb-6">{product.name}</p>
          <div className="flex gap-4">
            <div className="flex-1 bg-[#f3f3f3] p-4 border border-gray-300 text-center rounded-none">
              <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Warehouse</p>
              <p className="text-3xl font-light text-black">{product.stock_warehouse || 0}</p>
            </div>
            <div className="flex-1 bg-white p-4 border-2 border-[#0078D7] text-center rounded-none">
              <p className="text-xs font-semibold text-[#0078D7] uppercase mb-1">Store Floor</p>
              <p className="text-3xl font-light text-[#0078D7]">{product.stock_store || 0}</p>
            </div>
          </div>
        </div>
        <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end">
          <button onClick={onClose} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none">OK</button>
        </div>
      </div>
    </div>
  );
}