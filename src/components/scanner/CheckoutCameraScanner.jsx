import { useState } from 'react';
import { X, CameraOff, RotateCcw, Pause } from 'lucide-react';
import InlineContinuousScanner from './InlineContinuousScanner';

const READER_ID = 'checkout-camera-reader';

const friendlyError = (err) => {
  const name = err?.name || '';
  const msg = String(err?.message || err || '');
  if (name === 'NotAllowedError' || /permission|denied|not allowed/i.test(msg)) {
    return 'Camera access is blocked. Allow the camera for this site in your browser settings, then tap Try again.';
  }
  if (name === 'NotFoundError' || /not found|no camera|requested device/i.test(msg)) {
    return 'No camera was found on this device.';
  }
  if (name === 'NotReadableError' || /in use|could not start|readable/i.test(msg)) {
    return 'The camera is being used by another app. Close it and tap Try again.';
  }
  return 'The camera could not start. Tap Try again.';
};

/**
 * Phone checkout: live camera panel that adds the scanned item to the cart.
 * The parent closes it once the item has been added; it pauses while a popup is open.
 */
export default function CheckoutCameraScanner({ onScan, onClose, paused }) {
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="md:hidden px-3 pt-3 shrink-0 border-b border-[var(--border-medium)]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
      <div className="relative rounded-xl overflow-hidden border border-[var(--border-medium)] bg-black" style={{ height: 210 }}>
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5 text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <CameraOff className="w-8 h-8 text-[var(--text-tertiary)]" aria-hidden="true" />
            <p className="text-sm text-[var(--text-secondary)]">{friendlyError(error)}</p>
            <button
              type="button"
              onClick={() => { setError(null); setAttempt(a => a + 1); }}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md text-sm font-semibold text-white bg-[var(--color-accent-solid)]"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Try again
            </button>
          </div>
        ) : (
          <>
            <style>{`
              #${READER_ID} #qr-shaded-region { display: none !important; }
              #${READER_ID} video { height: 210px !important; }
              @keyframes checkout-scan-line { 0%, 100% { top: 22%; } 50% { top: 76%; } }
            `}</style>
            <InlineContinuousScanner
              key={attempt}
              readerId={READER_ID}
              onScan={onScan}
              paused={paused}
              playSound={false}
              sameCodeCooldownMs={1200}
              videoMaxHeight="210px"
              onError={setError}
            />
            {/* Scan frame */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <div className="relative" style={{ width: '78%', height: '58%' }}>
                {[
                  'top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg',
                  'top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg',
                  'bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg',
                  'bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-lg',
                ].map((c) => <span key={c} className={`absolute w-7 h-7 ${c}`} style={{ borderColor: paused ? 'rgba(255,255,255,0.5)' : 'var(--color-accent)' }} />)}
              </div>
              {!paused && (
                <span
                  className="absolute h-0.5 rounded-full"
                  style={{ left: '14%', right: '14%', backgroundColor: 'var(--color-accent)', boxShadow: '0 0 12px var(--color-accent)', animation: 'checkout-scan-line 2.2s ease-in-out infinite' }}
                />
              )}
            </div>
            {paused && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white bg-black/60">
                  <Pause className="w-3.5 h-3.5" aria-hidden="true" /> Paused while a popup is open
                </span>
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/70 to-transparent" aria-hidden="true" />
            <p className="pointer-events-none absolute top-2.5 left-3 text-xs font-semibold text-white">Point the camera at a barcode</p>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close camera"
          title="Close camera"
          className="tap-area absolute top-1.5 right-1.5 w-9 h-9 flex items-center justify-center rounded-full text-white bg-black/55 hover:bg-black/70"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <p className="text-xs text-[var(--text-tertiary)] pt-2 pb-2">
        The camera closes once the item is added. Tap the camera button to scan the next one.
      </p>
    </div>
  );
}
