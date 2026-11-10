import { createPortal } from 'react-dom';
import Barcode from 'react-barcode';

// One print job is capped so a typo (e.g. 1000 instead of 10) can't freeze the counter
// browser or waste a whole roll. Print again for more.
export const MAX_LABELS_PER_PRINT = 300;

export function clampLabelQty(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_LABELS_PER_PRINT);
}

/**
 * The 50mm x 25mm thermal label sheet used everywhere labels are printed
 * (Print Barcodes screen and the batch "Print Labels" dialog), so labels look the same.
 */
export default function BarcodeLabelSheet({ name, barcodeValue, mrp, count }) {
  const total = clampLabelQty(count);
  return createPortal(
    <div
      id="printable-barcodes"
      className="absolute -top-[9999px] left-0 opacity-0 pointer-events-none print:static print:opacity-100 print:pointer-events-auto"
      style={{ backgroundColor: '#ffffff', margin: 0, padding: 0 }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: 50mm 25mm; margin: 0 !important; }
          body { margin: 0 !important; padding: 0 !important; }
          #printable-barcodes { display: block !important; margin: 0 !important; padding: 0 !important; }
        }
      `}} />
      {Array.from({ length: total }).map((_, index) => (
        <div
          key={`${barcodeValue}-${index}`}
          className="thermal-barcode"
          style={{
            backgroundColor: '#ffffff',
            width: '50mm',
            height: '25mm',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            pageBreakAfter: 'always'
          }}
        >
          <div
            style={{
              fontSize: '9px',
              fontWeight: 'bold',
              color: '#000000',
              marginBottom: '1px',
              textAlign: 'center',
              width: '100%',
              padding: '0 4px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {name}
          </div>
          <Barcode
            value={barcodeValue}
            width={1.3}
            height={26}
            fontSize={10}
            margin={0}
            displayValue={true}
            lineColor="#000000"
            background="#ffffff"
          />
          <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#000000', marginTop: '1px' }}>
            MRP: ₹{Number(mrp || 0).toFixed(2)}
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
}
