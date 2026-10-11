import React, { useRef, useEffect } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

export default function InlineContinuousScanner({ onScan }) {
  const scannerRef = useRef(null);
  const audioCtxRef = useRef(null);

  const playBeep = () => {
    try {
      if (!audioCtxRef.current) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) audioCtxRef.current = new AudioContext();
      }
      const audioCtx = audioCtxRef.current;
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      if (audioCtx) {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.1);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.1);
      }
    } catch (e) {
      console.log('Audio not supported', e);
    }
  };

  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const isUnmountingRef = useRef(false);

  useEffect(() => {
    isUnmountingRef.current = false;
    let active = true;
    let html5QrCode = null;

    const startScanner = async () => {
      try {
        html5QrCode = new Html5Qrcode("receive-reader");
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
          if (!isProcessing && !isUnmountingRef.current && active) {
            isProcessing = true;
            playBeep();
            await onScanRef.current(decodedText);
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
          }
        }
      } catch (err) {
        console.error("Inline scanner error:", err);
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
  }, []);

  return (
    <>
      <style>{`
        #receive-reader { width: 100% !important; border: none !important; }
        #receive-reader video { width: 100% !important; max-height: 280px !important; object-fit: cover !important; }
        #receive-reader canvas { display: none !important; }
      `}</style>
      <div id="receive-reader" className="w-full h-full flex flex-col justify-center"></div>
    </>
  );
}
