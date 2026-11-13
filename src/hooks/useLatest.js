import { useEffect, useRef } from 'react';

/**
 * Ref that always holds the latest value. For event listeners and long-lived callbacks
 * (keyboard shortcuts, camera scans, window events) that are set up once but must call
 * the current version of a function, without re-subscribing or restarting anything.
 */
export function useLatest(value) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; });
  return ref;
}
