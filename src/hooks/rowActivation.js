/**
 * Props that let a clickable table row (or card) be opened from the keyboard too:
 * it can be reached with Tab and opened with Enter or Space, like a button.
 * Keys pressed on buttons/inputs inside the row are left alone.
 */
export function activatableRow(onActivate, label) {
  return {
    tabIndex: 0,
    'aria-label': label,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
