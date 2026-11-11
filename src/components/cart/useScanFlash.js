import { useEffect, useRef, useState } from 'react';

const qtyOf = (item) => {
  const raw = item?.actual_quantity !== undefined && item?.actual_quantity !== '' ? item.actual_quantity : item?.quantity;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Tracks the cart row that was just added or whose quantity just went up (a scan), for
 * about a second, so that row can flash briefly. Returns { id, n }; use
 * scanFlashClass(flash, row.id) for the row's class. Changes made by typing in a field are
 * ignored, so editing a quantity doesn't make the row flash. Purely visual: it never
 * changes the cart.
 */
export default function useScanFlash(cart, cartKey = '', durationMs = 900) {
  const prevRef = useRef(null);
  const prevKeyRef = useRef(cartKey);
  const [flash, setFlash] = useState({ id: null, n: 0 });

  useEffect(() => {
    const list = Array.isArray(cart) ? cart : [];
    const prev = prevRef.current;
    prevRef.current = new Map(list.map((item) => [item.id, qtyOf(item)]));
    const switchedCart = prevKeyRef.current !== cartKey;
    prevKeyRef.current = cartKey;
    // first render, or switched to another (held/worker) cart: nothing was scanned
    if (!prev || switchedCart) return undefined;

    const typing = typeof document !== 'undefined'
      && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      && document.activeElement?.id !== 'manual-barcode';
    if (typing) return undefined;

    const changed = list.find((item) => !prev.has(item.id) || qtyOf(item) > prev.get(item.id));
    if (!changed) return undefined;

    // Timers are left to finish on their own (other cart updates must not cancel them).
    setTimeout(() => setFlash((f) => ({ id: changed.id, n: f.n + 1 })), 0);
    setTimeout(() => setFlash((f) => (f.id === changed.id ? { ...f, id: null } : f)), durationMs);
    return undefined;
  }, [cart, cartKey, durationMs]);

  return flash;
}

/** Class for a row: alternates between two identical animations so a repeat scan restarts it. */
export const scanFlashClass = (flash, id) => (flash.id === id ? (flash.n % 2 ? 'scan-flash-a' : 'scan-flash-b') : '');
