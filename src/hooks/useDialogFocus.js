import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard focus for a pop-up window that is not built on the shared Modal:
 *  - on open, focus moves into the window (first control, or the window itself);
 *  - Tab / Shift+Tab stay inside the window;
 *  - on close, focus goes back to whatever opened it (e.g. the card that was clicked).
 * Attach the returned ref to the window panel and give the panel tabIndex={-1}.
 */
export function useDialogFocus(isOpen) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const opener = document.activeElement;
    const panel = panelRef.current;
    const controls = () => [...(panel?.querySelectorAll(FOCUSABLE) || [])].filter(el => el.getClientRects().length > 0);

    if (panel && !panel.contains(document.activeElement)) (controls()[0] || panel).focus();

    const onKeyDown = (e) => {
      if (e.key !== 'Tab' || !panel) return;
      const list = controls();
      if (list.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    };
  }, [isOpen]);

  return panelRef;
}
