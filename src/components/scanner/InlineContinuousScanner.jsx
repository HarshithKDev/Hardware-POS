import React, { useRef, useEffect } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';

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

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      "receive-reader", 
      { 
        fps: 10, 
        qrbox: { width: 300, height: 150 },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.UPC_A
        ],
        videoConstraints: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      }, 
      false
    );
    
    scannerRef.current = scanner;

    let isProcessing = false;
    scanner.render(
      async (decodedText) => {
        if (scanner.getState() === 2 && !isProcessing) {
          isProcessing = true;
          playBeep();
          await onScanRef.current(decodedText);
          setTimeout(() => {
            isProcessing = false;
          }, 1000);
        }
      },
      () => {}
    );

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
      }
    };
  }, []);

  return (
    <>
      <style>{`
        #receive-reader { 
          width: 100% !important; 
          border: none !important; 
          text-align: center !important; 
          background: transparent url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke="%23333333" stroke-width="4"/><circle cx="25" cy="25" r="20" fill="none" stroke="%233b82f6" stroke-width="4" stroke-dasharray="31.4 100"><animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/></circle></svg>') no-repeat center center !important;
          background-size: 50px 50px !important;
        }

        #receive-reader div {
          color: transparent !important;
          border: none !important;
          box-shadow: none !important;
          outline: none !important;
        }
        
        #receive-reader video { 
          max-height: 300px !important; 
          object-fit: cover !important; 
          background-color: var(--bg-secondary) !important;
          position: relative;
          z-index: 10;
        }
        
        #receive-reader a, #receive-reader [id*="swaplink"], #receive-reader [id*="file_scan"] { 
          display: none !important; 
        }
        
        #receive-reader span { 
          display: none !important; 
        }
        
        #receive-reader select { 
          display: none !important; 
          visibility: hidden !important;
          opacity: 0 !important;
          height: 0 !important;
        }
        
        #receive-reader button { 
          background-color: var(--bg-tertiary) !important; 
          color: var(--text-primary) !important;
          padding: 8px 16px !important; 
          border-radius: 0 !important; 
          font-weight: bold !important; 
          font-size: 12px !important; 
          text-transform: uppercase !important;
          border: 2px solid var(--border-medium) !important;
          margin-top: 15px !important;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1) !important;
          cursor: pointer !important;
          position: relative;
          z-index: 20;
        }
        
        #receive-reader img { display: none !important; }
      `}</style>
      <div id="receive-reader" className="w-full h-full flex flex-col justify-center"></div>
    </>
  );
}
