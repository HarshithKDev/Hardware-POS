import { createPortal } from 'react-dom';

export default function ReceiptTemplate({ lastReceipt, shopSettings, formatDateTime, isPreview = false }) {
  if (!lastReceipt || lastReceipt.type !== 'checkout') return null;
  const totalSavings = lastReceipt.items?.reduce((acc, item) => acc + (Math.max(0, item.mrp - item.finalRate) * item.quantity), 0) || 0;

  const content = (
    <div 
      id={isPreview ? undefined : "printable-receipt"} 
      className={`${isPreview ? 'mx-auto shadow-md border border-gray-300 w-full p-4 md:p-6 bg-white box-border' : 'hidden print:block'} thermal-receipt`} 
      style={{ fontFamily: "'Courier New', Courier, monospace", color: '#000000', backgroundColor: '#ffffff', ...(isPreview ? { minHeight: '100mm' } : {}) }}
    >
      <div className="text-center mb-3">
        <h1 className="text-xl font-bold uppercase text-black" style={{ color: '#000' }}>
          {shopSettings?.shop_name || 'STORE RECEIPT'}
        </h1>
      </div>
      
      <div className="mb-3 text-[12px] flex justify-between border-b border-black border-dashed pb-2 text-black" style={{ color: '#000' }}>
        <div>
          <p>Txn ID: {lastReceipt.id}</p>
          <p>Date: {formatDateTime(lastReceipt.date).datePart}</p>
        </div>
        <div className="text-right">
          <p>Type: POS SALE</p>
          <p>Time: {formatDateTime(lastReceipt.date).timePart}</p>
        </div>
      </div>
      
      <table className="w-full mb-3 text-[12px] text-black" style={{ color: '#000' }}>
        <thead>
          <tr className="border-b border-black border-dashed">
            <th className="text-left font-semibold pb-1 w-1/2 text-black" style={{ color: '#000' }}>Item</th>
            <th className="text-center font-semibold pb-1 w-1/6 text-black" style={{ color: '#000' }}>Qty</th>
            <th className="text-right font-semibold pb-1 w-1/6 text-black" style={{ color: '#000' }}>Rate</th>
            <th className="text-right font-semibold pb-1 w-1/6 text-black" style={{ color: '#000' }}>Amt</th>
          </tr>
        </thead>
        <tbody className="align-top">
          {lastReceipt.items.map((item, i) => (
            <tr key={i} className="hover:!bg-transparent">
              <td className="py-1 pr-1 text-wrap text-black" style={{ color: '#000' }}>{item.name}</td>
              <td className="py-1 text-center text-black" style={{ color: '#000' }}>{item.quantity} {item.unit}</td>
              <td className="py-1 text-right text-black" style={{ color: '#000' }}>{item.finalRate.toFixed(2)}</td>
              <td className="py-1 text-right text-black" style={{ color: '#000' }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      
      <div className="border-t border-black pt-2 flex justify-between items-center mb-2 text-black" style={{ color: '#000' }}>
        <span className="font-bold text-sm">NET DUE</span>
        <span className="font-bold text-lg">₹{lastReceipt.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
      </div>
      
      {totalSavings > 0 && (
        <div className="text-center mt-2 pb-2 border-b border-black border-dashed text-black" style={{ color: '#000' }}>
          <p className="font-bold text-sm">You saved ₹{totalSavings.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}!</p>
        </div>
      )}
      
      <div className="text-center text-[11px] pt-2 mt-2 text-black" style={{ color: '#000' }}>
        <p>Thank You For Your Business!</p>
        <p>Goods once sold will not be taken back.</p>
      </div>
    </div>
  );

  // Portal the receipt directly to document.body so it lives OUTSIDE #root.
  // During print, #root is hidden via CSS, and only this portaled receipt shows.
  if (!isPreview) {
    return createPortal(content, document.body);
  }

  return content;
}