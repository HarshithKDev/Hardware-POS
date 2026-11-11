import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { formatDateTime as defaultFormatDateTime, formatINR } from './utils';

const formatGramRate = (ratePerKg) => {
  const perGram = Number(ratePerKg || 0) / 1000;
  const threeDec = perGram.toFixed(3);
  return threeDec.endsWith('0') ? perGram.toFixed(2) : threeDec;
};

/** Rupee amount without needless zeros: 1300 → "1,300", 33.33 → "33.33", 12.5 → "12.50". */
export const receiptAmount = (n) => {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return Number.isInteger(v) ? formatINR(v, 0) : formatINR(v, 2);
};

/** Quantity without needless zeros: 2.50 → "2.5", 3 → "3". */
const receiptQty = (q) => {
  const v = Math.round(Number(q || 0) * 1000) / 1000;
  return String(v);
};

const LOOSE_KG_UNITS = ['KG', 'KGS', 'GRAMS', 'GRAM', 'G', 'GM'];

export default function ReceiptTemplate({ lastReceipt, shopSettings, formatDateTime, isPreview = false }) {
  if (!lastReceipt || lastReceipt.type !== 'checkout') return null;
  const totalSavings = lastReceipt.items?.reduce((acc, item) => {
    if (item.is_screw || item.barcode === 'SCREWS') return acc;
    return acc + (Math.max(0, ((Math.round(item.mrp * 100) - Math.round(item.finalRate * 100)) * item.quantity) / 100));
  }, 0) || 0;
  const fnFormat = typeof formatDateTime === 'function' ? formatDateTime : defaultFormatDateTime;
  const { datePart = '', timePart = '' } = fnFormat(lastReceipt.date) || {};

  const content = (
    <div 
      id={isPreview ? undefined : "printable-receipt"} 
      className={`${isPreview ? 'mx-auto shadow-md border border-gray-300 w-full p-4 md:p-6 bg-white box-border' : 'hidden print:block'} thermal-receipt font-bold`} 
      style={{ fontFamily: "'Courier New', Courier, monospace", color: '#000000', backgroundColor: '#ffffff', lineHeight: 1.2, fontWeight: 'bold', containerType: 'inline-size' }}
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
        {shopSettings?.gstin && (
          <p className="mt-0.5 text-black" style={{ color: '#000', fontSize: '10px' }}>
            GSTIN: {shopSettings.gstin}
          </p>
        )}
      </div>
      
      <div className="mb-2 flex justify-between gap-3 border-b border-black border-dashed pb-2 text-black" style={{ color: '#000', fontSize: 'min(11px, 4.9cqw)' }}>
        <div>
          {lastReceipt.id && <p>Bill No: {lastReceipt.id}</p>}
          <p className="whitespace-nowrap">Date: {datePart}</p>
          {lastReceipt.customerName && <p>Customer: {lastReceipt.customerName}</p>}
        </div>
        <div className="text-right">
          {lastReceipt.id && <p>&nbsp;</p>}
          <p className="whitespace-nowrap">Time: {timePart}</p>
          {lastReceipt.customerPhone && <p>Phone: {lastReceipt.customerPhone}</p>}
        </div>
      </div>

      {/* Items: the name gets its own line, the numbers go in spaced columns below it */}
      <table className="w-full table-fixed mb-1 text-black" style={{ color: '#000', fontSize: 'min(11px, 4.9cqw)', backgroundColor: 'transparent', borderCollapse: 'collapse' }}>
        <colgroup>
          <col style={{ width: '22%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '30%' }} />
        </colgroup>
        <thead style={{ backgroundColor: 'transparent', position: 'static' }}>
          <tr className="border-b border-black border-dashed" style={{ backgroundColor: 'transparent' }}>
            <th className="text-left pb-1 text-black" style={{ color: '#000' }}>Qty</th>
            <th className="text-right pb-1 pl-2 text-black" style={{ color: '#000' }}>MRP</th>
            <th className="text-right pb-1 pl-2 text-black" style={{ color: '#000' }}>Rate</th>
            <th className="text-right pb-1 pl-2 text-black" style={{ color: '#000' }}>Amount</th>
          </tr>
        </thead>
        <tbody style={{ backgroundColor: 'transparent' }}>
          {(lastReceipt.items || []).map((item, i) => {
            const isLooseKg = Boolean(item.is_loose_item && LOOSE_KG_UNITS.includes(String(item.unit || '').toUpperCase()));
            const displayQty = isLooseKg
              ? `${item.grams !== undefined ? item.grams : Math.round(Number(item.quantity) * 1000)} g`
              : `${receiptQty(item.quantity)} ${String(item.unit || '').toLowerCase()}`.trim();
            const isScrew = Boolean(item.is_screw || item.barcode === 'SCREWS');
            const displayMrp = isScrew ? '-' : (isLooseKg ? `${formatGramRate(item.mrp)}/g` : receiptAmount(item.mrp));
            const displayRate = isScrew ? '-' : (isLooseKg ? `${formatGramRate(item.finalRate)}/g` : receiptAmount(item.finalRate));
            const last = i === (lastReceipt.items || []).length - 1;
            return [
              <tr key={`${i}-name`} style={{ backgroundColor: 'transparent' }}>
                <td colSpan={4} className="pt-1.5 text-left text-black break-words" style={{ color: '#000' }}>
                  {i + 1}. {item.name}
                </td>
              </tr>,
              <tr key={`${i}-nums`} className={last ? '' : 'border-b border-black border-dotted'} style={{ backgroundColor: 'transparent' }}>
                <td className="pb-1.5 pl-2 text-left text-black whitespace-nowrap" style={{ color: '#000' }}>{displayQty}</td>
                <td className="pb-1.5 pl-2 text-right text-black whitespace-nowrap" style={{ color: '#000' }}>{displayMrp}</td>
                <td className="pb-1.5 pl-2 text-right text-black whitespace-nowrap" style={{ color: '#000' }}>{displayRate}</td>
                <td className="pb-1.5 pl-2 text-right text-black whitespace-nowrap" style={{ color: '#000' }}>{receiptAmount(item.lineTotal)}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>

      <div className="border-t border-black border-dashed pt-1 mb-1 flex justify-between text-black" style={{ color: '#000', fontSize: '11px' }}>
        <span>Items: {(lastReceipt.items || []).length}</span>
      </div>

      {Number(lastReceipt.roundOff || 0) !== 0 && (
        <div className="flex justify-between items-center text-black" style={{ color: '#000', fontSize: '12px' }}>
          <span>Round Off</span>
          <span>{lastReceipt.roundOff > 0 ? '+' : '-'}₹{formatINR(Math.abs(lastReceipt.roundOff), 2)}</span>
        </div>
      )}
      <div className="border-t border-black pt-2 flex justify-between items-center gap-3 mb-2 text-black" style={{ color: '#000' }}>
        <span className={`font-bold ${lastReceipt.paymentMethod === 'SHOWROOM' ? '' : 'whitespace-nowrap'}`} style={{ fontSize: 'min(14px, 6.2cqw)' }}>{lastReceipt.paymentMethod === 'SHOWROOM' ? 'SHOWROOM DISPATCH (NOT A SALE)' : 'NET DUE'}</span>
        <span className="font-bold whitespace-nowrap" style={{ fontSize: 'min(16px, 7cqw)' }}>₹{receiptAmount(lastReceipt.total)}</span>
      </div>

      {lastReceipt.paymentMethod && (
        <div className="flex justify-between items-start gap-3 mb-2 text-black" style={{ color: '#000', fontSize: 'min(12px, 5.3cqw)' }}>
          <span className="font-semibold whitespace-nowrap">PAID VIA</span>
          <span className="font-bold text-right">
            {lastReceipt.paymentMethod === 'SPLIT'
              ? `Cash ₹${receiptAmount(lastReceipt.cashAmount)} + UPI ₹${receiptAmount(lastReceipt.upiAmount)}`
              : lastReceipt.paymentMethod}
          </span>
        </div>
      )}

      {totalSavings > 0 && (
        <div className="text-center mt-2 pb-2 border-b border-black border-dashed text-black" style={{ color: '#000' }}>
          <p className="font-bold" style={{ fontSize: 'min(12px, 5.3cqw)' }}>You saved ₹{receiptAmount(totalSavings)} on MRP</p>
        </div>
      )}

      {shopSettings?.upi_id && !shopSettings.upi_id.startsWith('HIDDEN::') && lastReceipt.paymentMethod !== 'CASH' && lastReceipt.paymentMethod !== 'SHOWROOM' && (
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
        <p className="whitespace-pre-line">{shopSettings?.bill_footer || 'Thank You For Your Business!'}</p>
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