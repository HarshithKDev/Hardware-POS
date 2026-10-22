import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { formatDateTime as defaultFormatDateTime } from './utils';

const formatGramRate = (ratePerKg) => {
  const perGram = Number(ratePerKg || 0) / 1000;
  const threeDec = perGram.toFixed(3);
  return threeDec.endsWith('0') ? perGram.toFixed(2) : threeDec;
};

export default function ReceiptTemplate({ lastReceipt, shopSettings, formatDateTime, isPreview = false }) {
  if (!lastReceipt || lastReceipt.type !== 'checkout') return null;
  const totalSavings = lastReceipt.items?.reduce((acc, item) => acc + (Math.max(0, ((Math.round(item.mrp * 100) - Math.round(item.finalRate * 100)) * item.quantity) / 100)), 0) || 0;
  const fnFormat = typeof formatDateTime === 'function' ? formatDateTime : defaultFormatDateTime;
  const { datePart = '', timePart = '' } = fnFormat(lastReceipt.date) || {};

  const content = (
    <div 
      id={isPreview ? undefined : "printable-receipt"} 
      className={`${isPreview ? 'mx-auto shadow-md border border-gray-300 w-full p-4 md:p-6 bg-white box-border' : 'hidden print:block'} thermal-receipt font-bold`} 
      style={{ fontFamily: "'Courier New', Courier, monospace", color: '#000000', backgroundColor: '#ffffff', lineHeight: 1.2, fontWeight: 'bold' }}
    >
      <style>{`
        .thermal-receipt, .thermal-receipt * {
          color: #000000 !important;
          -webkit-text-fill-color: #000000 !important;
        }
        .thermal-receipt table,
        .thermal-receipt table thead,
        .thermal-receipt thead,
        .thermal-receipt thead tr,
        .thermal-receipt thead th,
        .thermal-receipt thead tr th,
        .thermal-receipt table thead th,
        .thermal-receipt table thead tr th,
        .thermal-receipt th,
        .thermal-receipt td,
        .thermal-receipt tr,
        .thermal-receipt tbody,
        #printable-receipt table,
        #printable-receipt table thead,
        #printable-receipt thead,
        #printable-receipt thead tr,
        #printable-receipt thead th,
        #printable-receipt thead tr th,
        #printable-receipt table thead th,
        #printable-receipt table thead tr th,
        #printable-receipt th,
        #printable-receipt td,
        #printable-receipt tr,
        #printable-receipt tbody {
          background-color: transparent !important;
          background: transparent !important;
          position: static !important;
          box-shadow: none !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          color: #000000 !important;
          -webkit-text-fill-color: #000000 !important;
        }
        @media print { 
          @page { margin: 0; } 
          body { min-width: 100% !important; font-weight: bold !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } 
          * { font-weight: bold !important; } 
        }
      `}</style>
      <div className="text-center mb-3">
        <h1 className="font-bold uppercase text-black whitespace-pre-line mx-auto break-words" style={{ color: '#000', fontSize: '16px' }}>
          {shopSettings?.shop_name || 'STORE RECEIPT'}
        </h1>
        {shopSettings?.shop_address && !shopSettings.shop_address.startsWith('HIDDEN::') && (
          <p className="mt-1 text-black whitespace-pre-line" style={{ color: '#000', fontSize: '10px' }}>
            {shopSettings.shop_address}
          </p>
        )}
      </div>
      
      <div className="mb-3 flex justify-between border-b border-black border-dashed pb-2 text-black" style={{ color: '#000', fontSize: '12px' }}>
        <div>
          <p>Txn ID: {lastReceipt.id}</p>
          <p>Date: {datePart}</p>
          {lastReceipt.customerName && <p>Customer: {lastReceipt.customerName}</p>}
        </div>
        <div className="text-right">
          <p>Type: POS SALE</p>
          <p>Time: {timePart}</p>
          {lastReceipt.customerPhone && <p>Phone: {lastReceipt.customerPhone}</p>}
        </div>
      </div>
      
      <table className="w-full table-fixed mb-3 text-black" style={{ color: '#000', fontSize: '10px', backgroundColor: 'transparent' }}>
        <thead style={{ backgroundColor: 'transparent', position: 'static' }}>
          <tr className="border-b border-black border-dashed" style={{ backgroundColor: 'transparent' }}>
            <th className="text-left font-semibold pb-1 w-4/12 text-black" style={{ color: '#000', backgroundColor: 'transparent', boxShadow: 'none', position: 'static' }}>Item</th>
            <th className="text-center font-semibold pb-1 w-2/12 text-black" style={{ color: '#000', backgroundColor: 'transparent', boxShadow: 'none', position: 'static' }}>Qty</th>
            <th className="text-right font-semibold pb-1 w-2/12 pr-1 text-black" style={{ color: '#000', backgroundColor: 'transparent', boxShadow: 'none', position: 'static' }}>MRP</th>
            <th className="text-right font-semibold pb-1 w-2/12 pr-1 text-black" style={{ color: '#000', backgroundColor: 'transparent', boxShadow: 'none', position: 'static' }}>Rate</th>
            <th className="text-right font-semibold pb-1 w-2/12 text-black" style={{ color: '#000', backgroundColor: 'transparent', boxShadow: 'none', position: 'static' }}>Amt</th>
          </tr>
        </thead>
        <tbody className="align-top" style={{ backgroundColor: 'transparent' }}>
          {(lastReceipt.items || []).map((item, i) => {
            const isLooseKg = Boolean(
              item.is_loose_item && (
                item.unit?.toUpperCase() === 'KG' || 
                item.unit?.toUpperCase() === 'KGS' || 
                item.unit?.toUpperCase() === 'GRAMS' || 
                item.unit?.toUpperCase() === 'GRAM' || 
                item.unit?.toUpperCase() === 'G' || 
                item.unit?.toUpperCase() === 'GM'
              )
            );
            const displayQty = isLooseKg 
              ? `${item.grams !== undefined ? item.grams : Math.round(Number(item.quantity) * 1000)} g` 
              : `${item.quantity} ${item.unit}`;
            const displayMrp = isLooseKg ? formatGramRate(item.mrp) : item.mrp.toFixed(2);
            const displayRate = isLooseKg ? formatGramRate(item.finalRate) : item.finalRate.toFixed(2);

            return (
              <tr key={i} className="hover:!bg-transparent" style={{ backgroundColor: 'transparent' }}>
                <td className="py-1 pr-1 text-black break-words" style={{ color: '#000', backgroundColor: 'transparent' }}>
                  {item.name}
                </td>
                <td className="py-1 text-center text-black" style={{ color: '#000', backgroundColor: 'transparent' }}>{displayQty}</td>
                <td className="py-1 text-right pr-1 text-black" style={{ color: '#000', backgroundColor: 'transparent' }}>{displayMrp}</td>
                <td className="py-1 text-right pr-1 text-black" style={{ color: '#000', backgroundColor: 'transparent' }}>{displayRate}</td>
                <td className="py-1 text-right text-black" style={{ color: '#000', backgroundColor: 'transparent' }}>{item.lineTotal.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      
      <div className="border-t border-black pt-2 flex justify-between items-center mb-2 text-black" style={{ color: '#000' }}>
        <span className="font-bold" style={{ fontSize: '14px' }}>NET DUE</span>
        <span className="font-bold" style={{ fontSize: '16px' }}>₹{lastReceipt.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
      </div>

      {lastReceipt.paymentMethod && (
        <div className="flex justify-between items-center mb-2 text-black" style={{ color: '#000', fontSize: '12px' }}>
          <span className="font-semibold">PAID VIA</span>
          <span className="font-bold">
            {lastReceipt.paymentMethod === 'SPLIT' 
              ? `Cash: ₹${Number(lastReceipt.cashAmount || 0).toFixed(2)} + UPI: ₹${Number(lastReceipt.upiAmount || 0).toFixed(2)}`
              : lastReceipt.paymentMethod}
          </span>
        </div>
      )}
      
      {totalSavings > 0 && (
        <div className="text-center mt-2 pb-2 border-b border-black border-dashed text-black" style={{ color: '#000' }}>
          <p className="font-bold" style={{ fontSize: '12px' }}>You saved {totalSavings.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} Rs</p>
        </div>
      )}
      
      {shopSettings?.upi_id && !shopSettings.upi_id.startsWith('HIDDEN::') && lastReceipt.paymentMethod !== 'CASH' && (
        <div className="flex flex-col items-center justify-center mt-3 pb-3 border-b border-black border-dashed text-black" style={{ color: '#000' }}>
          <p className="font-bold mb-1" style={{ fontSize: '10px' }}>Scan to Pay via UPI</p>
          <QRCodeSVG 
            value={`upi://pay?pa=${shopSettings.upi_id}&pn=${encodeURIComponent(shopSettings.shop_name || 'Store')}&am=${lastReceipt.paymentMethod === 'SPLIT' ? Number(lastReceipt.upiAmount || 0).toFixed(2) : lastReceipt.total.toFixed(2)}&cu=INR`} 
            size={100}
            level="L"
            includeMargin={false}
          />
        </div>
      )}
      
      <div className="text-center pt-2 mt-2 text-black" style={{ color: '#000', fontSize: '10px' }}>
        <p>Thank You For Your Business!</p>
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