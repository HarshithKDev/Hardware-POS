// Keyboard and screen-reader fixes: rows open with Enter/Space, pop-ups keep and return focus.
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { activatableRow } from '../hooks/rowActivation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { Modal } from '../components/ui';

describe('rows that open something', () => {
  it('open with Enter or Space, but not when a button inside the row is used', () => {
    const open = vi.fn(); const inner = vi.fn();
    render(<table><tbody><tr {...activatableRow(open, 'Open bill 12')}><td><button type="button" onClick={inner}>Return</button></td></tr></tbody></table>);
    const row = screen.getByRole('row', { name: 'Open bill 12' });
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(open).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Return' }), { key: 'Enter' });
    expect(open).toHaveBeenCalledTimes(2);
  });
});

function StatsLike() {
  const [open, setOpen] = useState(false);
  const ref = useDialogFocus(open);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Profit card</button>
      <button type="button">Elsewhere</button>
      {open && (
        <div ref={ref} tabIndex={-1} role="dialog" aria-label="Breakdown">
          <button type="button" onClick={() => setOpen(false)}>Close</button>
          <button type="button">Sort</button>
        </div>
      )}
    </>
  );
}

describe('window opened from an Overview card', () => {
  it('takes focus, keeps Tab inside, and gives focus back to the card when closed', () => {
    render(<StatsLike />);
    const card = screen.getByRole('button', { name: 'Profit card' });
    card.focus();
    fireEvent.click(card);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    screen.getByRole('button', { name: 'Sort' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(card);
  });
});

function ModalHost({ redraw }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  return (
    <>
      {/* key changes = the list redraws and the opener button is replaced */}
      <button key={version} type="button" aria-label="Add batch for Hinge" onClick={() => setOpen(true)}>+ Batch</button>
      {open && (
        <Modal onClose={() => { if (redraw) setVersion(v => v + 1); setOpen(false); }} title="Create batch">
          <input aria-label="Cost price" autoFocus />
        </Modal>
      )}
    </>
  );
}

describe('shared pop-up', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([[false, 'the same button'], [true, 'a redrawn copy of the button']])('returns focus to the opener (redraw=%s: %s), even with an autofocused field', (redraw) => {
    render(<ModalHost redraw={redraw} />);
    const opener = screen.getByRole('button', { name: 'Add batch for Hinge' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Cost price' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => { vi.runAllTimers(); });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add batch for Hinge' }));
  });
});
