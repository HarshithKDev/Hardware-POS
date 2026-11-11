import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useScanFlash, { scanFlashClass } from '../components/cart/useScanFlash';

const item = (id, quantity) => ({ id, quantity });

describe('scan flash on the counter cart', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  const run = (initialCart, key = 'local') => renderHook(({ cart, k }) => useScanFlash(cart, k), { initialProps: { cart: initialCart, k: key } });
  const tick = (ms = 0) => act(() => { vi.advanceTimersByTime(ms); });

  it('does not flash on first load', () => {
    const { result } = run([item('a', 1)]);
    tick();
    expect(result.current.id).toBeNull();
  });

  it('flashes a newly scanned item, then clears after about a second', () => {
    const { result, rerender } = run([item('a', 1)]);
    rerender({ cart: [item('a', 1), item('b', 1)], k: 'local' });
    tick();
    expect(result.current.id).toBe('b');
    expect(scanFlashClass(result.current, 'b')).toMatch(/^scan-flash-/);
    expect(scanFlashClass(result.current, 'a')).toBe('');
    tick(1000);
    expect(result.current.id).toBeNull();
  });

  it('flashes again when the same item is scanned twice (class alternates)', () => {
    const { result, rerender } = run([item('a', 1)]);
    rerender({ cart: [item('a', 2)], k: 'local' });
    tick();
    const first = scanFlashClass(result.current, 'a');
    rerender({ cart: [item('a', 3)], k: 'local' });
    tick();
    const second = scanFlashClass(result.current, 'a');
    expect(first).toMatch(/^scan-flash-/);
    expect(second).toMatch(/^scan-flash-/);
    expect(second).not.toBe(first);
  });

  it('does not flash when switching to a held cart', () => {
    const { result, rerender } = run([item('a', 1)], 'local');
    rerender({ cart: [item('x', 1), item('y', 2)], k: 'held_1' });
    tick();
    expect(result.current.id).toBeNull();
  });

  it('does not flash while the cashier is typing a quantity', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const { result, rerender } = run([item('a', 1)]);
    input.focus();
    rerender({ cart: [item('a', 5)], k: 'local' });
    tick();
    expect(result.current.id).toBeNull();
  });

  it('still flashes when the barcode box is focused (scanner input)', () => {
    const input = document.createElement('input');
    input.id = 'manual-barcode';
    document.body.appendChild(input);
    const { result, rerender } = run([item('a', 1)]);
    input.focus();
    rerender({ cart: [item('a', 1), item('b', 1)], k: 'local' });
    tick();
    expect(result.current.id).toBe('b');
  });

  it('does not flash when a quantity goes down or an item is removed', () => {
    const { result, rerender } = run([item('a', 3), item('b', 1)]);
    rerender({ cart: [item('a', 2)], k: 'local' });
    tick();
    expect(result.current.id).toBeNull();
  });
});
