import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AppProvider, useApp } from '../AppContext';

function TestConsumer() {
  const { isWarehouseDisabled, setWarehouseDisabled } = useApp();
  return (
    <div>
      <span data-testid="status">{isWarehouseDisabled ? 'DISABLED' : 'ENABLED'}</span>
      <button data-testid="toggle-btn" onClick={() => setWarehouseDisabled(!isWarehouseDisabled)}>
        Toggle
      </button>
    </div>
  );
}

describe('Warehouse Bypass Feature Integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults isWarehouseDisabled to false when not configured', () => {
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('status').textContent).toBe('ENABLED');
  });

  it('respects disable_warehouse stored in localStorage', () => {
    localStorage.setItem('disable_warehouse', 'true');

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('status').textContent).toBe('DISABLED');
  });

  it('allows toggling warehouse bypass dynamically', () => {
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('status').textContent).toBe('ENABLED');

    fireEvent.click(screen.getByTestId('toggle-btn'));
    expect(screen.getByTestId('status').textContent).toBe('DISABLED');
    expect(localStorage.getItem('disable_warehouse')).toBe('true');

    fireEvent.click(screen.getByTestId('toggle-btn'));
    expect(localStorage.getItem('disable_warehouse')).toBe('false');
  });
});
