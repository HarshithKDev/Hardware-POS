import { useRef, useEffect } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { playScanSuccessSound } from '../../services/audio';

/**
 * Live camera barcode scanner that keeps scanning until it is unmounted.
 *
 * Defaults match the Receive screen. Extra options (used by the phone checkout):
 *  - readerId:          DOM id for the camera view (must be unique on the page)
 *  - paused:            ignore scans while true (e.g. a popup is open)
 *  - playSound:         beep on every decode (off when the caller plays its own sounds)
 *  - sameCodeCooldownMs: the same barcode counts again only after it has been out of
 *                        view for this long, so holding the camera on one label adds it
 *                        once (move away and back to add another)
 *  - onError(err):      camera could not start (permission denied, no camera…)
 *  - videoMaxHeight:    CSS max-height of the video
 */
export default function InlineContinuousScanner({
  onScan,
  readerId = 'receive-reader',
  paused = false,
  playSound = true,
  sameCodeCooldownMs = 0,
  onError,
  videoMaxHeight = '280px',
}) {
  const scannerRef = useRef(null);

  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const isUnmountingRef = useRef(false);

  useEffect(() => {
    isUnmountingRef.current = false;
    let active = true;
    let html5QrCode = null;
    let lastCode = '';
    let lastSeenAt = 0;

    const startScanner = async () => {
      try {
        html5QrCode = new Html5Qrcode(readerId);
        scannerRef.current = html5QrCode;

        const scanConfig = {
          fps: 10,
          qrbox: { width: 280, height: 160 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.UPC_A
          ]
        };

        let isProcessing = false;
        const onDecoded = async (decodedText) => {
          const now = Date.now();
          if (sameCodeCooldownMs > 0 && decodedText === lastCode && now - lastSeenAt < sameCodeCooldownMs) {
            lastSeenAt = now; // still in view: keep waiting until it has been away for a while
            return;
          }
          if (isProcessing || isUnmountingRef.current || !active || pausedRef.current) return;
          isProcessing = true;
          lastCode = decodedText;
          lastSeenAt = now;
          if (playSound) playScanSuccessSound();
          try {
            await onScanRef.current(decodedText);
          } finally {
            setTimeout(() => {
              isProcessing = false;
            }, 800);
          }
        };

        try {
          await html5QrCode.start(
            { facingMode: "environment" },
            scanConfig,
            onDecoded,
            () => {}
          );
        } catch (envErr) {
          console.warn("Back camera unavailable in inline scanner, attempting fallback:", envErr);
          const devices = await Html5Qrcode.getCameras();
          if (devices && devices.length > 0) {
            const backCam = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[0];
            await html5QrCode.start(
              backCam.id,
              scanConfig,
              onDecoded,
              () => {}
            );
          } else {
            throw envErr;
          }
        }
      } catch (err) {
        console.error("Inline scanner error:", err);
        if (active && onErrorRef.current) onErrorRef.current(err);
      }
    };

    startScanner();

    return () => {
      active = false;
      isUnmountingRef.current = true;
      if (scannerRef.current) {
        const scannerInstance = scannerRef.current;
        scannerRef.current = null;
        (async () => {
          try {
            if (scannerInstance.getState && scannerInstance.getState() === 2) {
              await scannerInstance.stop();
            }
            scannerInstance.clear();
          } catch (e) {
            console.warn("Inline scanner cleanup error:", e);
          }
        })();
      }
    };
  }, [readerId, playSound, sameCodeCooldownMs]);

  return (
    <>
      <style>{`
        #${readerId} { width: 100% !important; border: none !important; }
        #${readerId} video { width: 100% !important; max-height: ${videoMaxHeight} !important; object-fit: cover !important; }
        #${readerId} canvas { display: none !important; }
      `}</style>
      <div id={readerId} className="w-full h-full flex flex-col justify-center"></div>
    </>
  );
}
