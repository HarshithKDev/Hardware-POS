import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import React, { useState } from 'react';
import { useSessionState } from '../hooks/useSessionState';

describe('useSessionState Hook', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('initializes with defaultValue when sessionStorage is empty', () => {
    const { result } = renderHook(() => useSessionState('test_key', 'initial'));
    expect(result.current[0]).toBe('initial');
  });

  it('updates state and persists to sessionStorage', () => {
    const { result } = renderHook(() => useSessionState('test_key', 'initial'));

    act(() => {
      result.current[1]('updated_value');
    });

    expect(result.current[0]).toBe('updated_value');
    expect(JSON.parse(window.sessionStorage.getItem('test_key'))).toBe('updated_value');
  });

  it('initializes from existing sessionStorage value on mount', () => {
    window.sessionStorage.setItem('test_key', JSON.stringify('saved_from_session'));

    const { result } = renderHook(() => useSessionState('test_key', 'fallback_default'));
    expect(result.current[0]).toBe('saved_from_session');
  });

  it('supports functional state updaters', () => {
    const { result } = renderHook(() => useSessionState('counter_key', 10));

    act(() => {
      result.current[1](prev => prev + 5);
    });

    expect(result.current[0]).toBe(15);
    expect(JSON.parse(window.sessionStorage.getItem('counter_key'))).toBe(15);
  });

  it('supports clearState to reset back to default', () => {
    const { result } = renderHook(() => useSessionState('filter_key', 'all'));

    act(() => {
      result.current[1]('plumbing');
    });
    expect(result.current[0]).toBe('plumbing');

    act(() => {
      result.current[2](); // clearState
    });

    expect(result.current[0]).toBe('all');
    expect(window.sessionStorage.getItem('filter_key')).toBeNull();
  });

  it('preserves filters across component unmount and remount (simulating page navigation)', () => {
    function FilterComponent({ id }) {
      const [search, setSearch] = useSessionState('shop_123_inv_search', '');
      const [category, setCategory] = useSessionState('shop_123_inv_cat', 'ALL');

      return (
        <div>
          <input
            data-testid="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            data-testid="cat-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="ALL">ALL</option>
            <option value="Electrical">Electrical</option>
            <option value="Hardware">Hardware</option>
          </select>
        </div>
      );
    }

    // 1. User visits page and sets filters
    const { unmount } = render(<FilterComponent id="view1" />);
    const input = screen.getByTestId('search-input');
    const select = screen.getByTestId('cat-select');

    act(() => {
      fireEvent.change(input, { target: { value: 'copper wire' } });
      fireEvent.change(select, { target: { value: 'Electrical' } });
    });

    expect(screen.getByTestId('search-input').value).toBe('copper wire');
    expect(screen.getByTestId('cat-select').value).toBe('Electrical');

    // 2. User navigates to another page (Component unmounts)
    unmount();

    // 3. User navigates back to the page (Component remounts)
    render(<FilterComponent id="view2" />);

    // Filters are preserved exactly as left!
    expect(screen.getByTestId('search-input').value).toBe('copper wire');
    expect(screen.getByTestId('cat-select').value).toBe('Electrical');
  });
});
