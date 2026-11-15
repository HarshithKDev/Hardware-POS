import { legacyScrewAmount, withLegacyScrews } from '../services/legacyScrews';
import { offlineReceiptNo, offlineReceiptRef } from '../utils';
import { authStorage, setAuthPersistence, readStoredSession } from '../services/authSession';

describe('rebuilt "Screws" line on old bills', () => {
  it('a negotiated total a few paise above the rounded lines is rounding, not screws', () => {
    // 3 x ₹100 negotiated to ₹250: each unit becomes ₹83.33, lines = ₹249.99
    const bill = { id: 'b1', total_amount: 250 };
    const lines = [{ barcode: '1', price_at_sale: 83.33, billable_quantity: 3, quantity: 3 }];
    expect(legacyScrewAmount(bill, lines)).toBe(0);
    expect(withLegacyScrews(bill, lines)).toHaveLength(1);
  });

  it('many units can round by more than a paisa in total: still not screws', () => {
    // 40 m negotiated to ₹999.99: ₹24.99975/m is stored as ₹25.00, or as ₹24.99 when rounded
    // down; each metre can be off by up to half a paisa, so up to 20 paise over 40 m is rounding
    const lines = [{ barcode: '2', price_at_sale: 24.9950, billable_quantity: 40, quantity: 40 }];
    expect(legacyScrewAmount({ id: 'b2', total_amount: 999.99 }, lines)).toBe(0); // lines ₹999.80
  });

  it('a gap bigger than rounding can explain is an old screws charge', () => {
    const lines = [{ barcode: '2', price_at_sale: 24.99, billable_quantity: 40, quantity: 40 }];
    expect(legacyScrewAmount({ id: 'b3', total_amount: 1019.6 }, lines)).toBe(20); // lines ₹999.60
  });

  it('an old bill whose screws are only in the total still gets its Screws line', () => {
    const bill = { id: 'b4', total_amount: 520 };
    const lines = [{ barcode: '1', price_at_sale: 250, billable_quantity: 2, quantity: 2 }];
    const out = withLegacyScrews(bill, lines);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: 'screw-legacy-b4', barcode: 'SCREWS', price_at_sale: 20 });
  });

  it('a bill that already has a screws line is left alone', () => {
    const bill = { id: 'b5', total_amount: 520 };
    const lines = [{ barcode: '1', price_at_sale: 250, quantity: 2 }, { barcode: 'SCREWS', price_at_sale: 10, quantity: 1 }];
    expect(withLegacyScrews(bill, lines)).toHaveLength(2);
  });
});

describe('offline receipt numbers', () => {
  it('come from the sale reference stored with the bill, and can be searched', () => {
    const ref = '7f3a2b1c-0000-4000-8000-000000000000';
    expect(offlineReceiptNo(ref)).toBe('OFFL-7F3A2B');
    expect(offlineReceiptRef('OFFL-7F3A2B')).toBe('7f3a2b');
    expect(offlineReceiptRef('#offl-7f3a2b')).toBe('7f3a2b');
    expect(offlineReceiptRef('Ramesh')).toBeNull();
    expect(ref.startsWith(offlineReceiptRef(offlineReceiptNo(ref)))).toBe(true);
  });
});

describe('"Remember me"', () => {
  const KEY = 'sb-test-auth-token';
  const session = JSON.stringify({ access_token: 'a', refresh_token: 'r' });
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('not ticked: the sign-in is kept for this browser session only', () => {
    setAuthPersistence(false);
    authStorage.setItem(KEY, session);
    expect(sessionStorage.getItem(KEY)).toBe(session);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readStoredSession(KEY)).toMatchObject({ refresh_token: 'r' });
    sessionStorage.clear(); // browser closed
    expect(readStoredSession(KEY)).toBeNull();
  });

  it('ticked: kept on the device, and no stale copy is left in the other place', () => {
    setAuthPersistence(false);
    authStorage.setItem(KEY, session);
    setAuthPersistence(true);
    authStorage.setItem(KEY, session);
    expect(localStorage.getItem(KEY)).toBe(session);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('devices signed in before this change keep their sign-in', () => {
    localStorage.setItem(KEY, session);
    expect(readStoredSession(KEY)).toMatchObject({ refresh_token: 'r' });
  });

  it('signing out removes it from both places', () => {
    localStorage.setItem(KEY, session);
    sessionStorage.setItem(KEY, session);
    authStorage.removeItem(KEY);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
