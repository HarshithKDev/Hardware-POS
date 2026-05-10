export default function ReceiptTemplate({ lastReceipt, shopSettings, formatDateTime }) {
  if (!lastReceipt || lastReceipt.type !== 'checkout') return null;
  const totalSavings = lastReceipt.items?.reduce((acc, item) => acc + (Math.max(0, item.mrp - item.finalRate) * item.quantity), 0) || 0;

  return (
    <div id="printable-receipt" className="hidden print:block text-black font-mono text-xs w-[80mm] mx-auto bg-white p-4" style={{ fontFamily: "'Roboto', sans-serif" }}>
      <div className="text-center mb-3"><h1 className="text-xl font-bold uppercase">{shopSettings?.shop_name || 'STORE RECEIPT'}</h1></div>
      <div className="mb-3 text-[10px] flex justify-between border-b border-black border-dashed pb-2">
        <div><p>Txn ID: {lastReceipt.id}</p><p>Date: {formatDateTime(lastReceipt.date).datePart}</p></div>
        <div className="text-right"><p>Type: POS SALE</p><p>Time: {formatDateTime(lastReceipt.date).timePart}</p></div>
      </div>
      <table className="w-full mb-3 text-[10px]">
        <thead>
          <tr className="border-b border-black border-dashed">
            <th className="text-left font-semibold pb-1 w-1/2">SKU/Item</th>
            <th className="text-center font-semibold pb-1 w-1/6">Qty</th>
            <th className="text-right font-semibold pb-1 w-1/6">Rate</th>
            <th className="text-right font-semibold pb-1 w-1/6">Amt</th>
          </tr>
        </thead>
        <tbody className="align-top">
          {lastReceipt.items.map((item, i) => (
            <tr key={i}>
              <td className="py-1 pr-1 text-wrap">{item.name}</td>
              <td className="py-1 text-center">{item.quantity} {item.unit}</td>
              <td className="py-1 text-right">{item.finalRate.toFixed(2)}</td>
              <td className="py-1 text-right">{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-black pt-2 flex justify-between items-center mb-2">
        <span className="font-bold text-sm">NET DUE</span>
        <span className="font-bold text-lg">₹{lastReceipt.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
      </div>
      {totalSavings > 0 && <div className="text-center mt-2 pb-2 border-b border-black border-dashed"><p className="font-bold text-sm">You saved ₹{totalSavings.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}!</p></div>}
      <div className="text-center text-[10px] pt-2 mt-2"><p>Thank You For Your Business!</p><p>Goods once sold will not be taken back.</p></div>
    </div>
  );
}