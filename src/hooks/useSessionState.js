import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * A custom React hook that mirrors useState, but synchronizes with window.sessionStorage.
 * When navigating between pages or tabs within the same browser session, state is preserved.
 *
 * @param {string} key - Unique key for sessionStorage (e.g. `pos_filter_${shopId}_inventory_search`)
 * @param {any|Function} defaultValue - Initial default value if no saved session state exists
 * @returns {[any, Function, Function]} [state, setState, clearState]
 */
export function useSessionState(key, defaultValue) {
  const getStoredValue = useCallback(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage && key) {
        const saved = window.sessionStorage.getItem(key);
        if (saved !== null && saved !== 'undefined') {
          return JSON.parse(saved);
        }
      }
    } catch (e) {
      console.warn(`useSessionState: error reading ${key}`, e);
    }
    return typeof defaultValue === 'function' ? defaultValue() : defaultValue;
  }, [key, defaultValue]);

  const [state, setState] = useState(getStoredValue);
  const prevKeyRef = useRef(key);

  // If key changes dynamically, synchronize state with the new key's stored value
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      setState(getStoredValue());
    }
  }, [key, getStoredValue]);

  const isClearingRef = useRef(false);

  // Sync state to sessionStorage whenever it changes
  useEffect(() => {
    if (isClearingRef.current) {
      isClearingRef.current = false;
      return;
    }
    try {
      if (typeof window !== 'undefined' && window.sessionStorage && key) {
        if (state === undefined) {
          window.sessionStorage.removeItem(key);
        } else {
          window.sessionStorage.setItem(key, JSON.stringify(state));
        }
      }
    } catch (e) {
      console.warn(`useSessionState: error writing ${key}`, e);
    }
  }, [key, state]);

  const clearState = useCallback(() => {
    isClearingRef.current = true;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage && key) {
        window.sessionStorage.removeItem(key);
      }
    } catch (e) {
      console.warn(`useSessionState: error removing ${key}`, e);
    }
    const fallback = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
    setState(fallback);
  }, [key, defaultValue]);

  return [state, setState, clearState];
}

export default useSessionState;
