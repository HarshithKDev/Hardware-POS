import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeSearchText,
  tokenizeQuery,
  getStem,
  scoreProductSearch,
  getInventoryByQuery,
  saveInventoryBatch,
} from '../services/db';

describe('Custom Multi-Token Ranked Search Scorer', () => {
  describe('normalizeSearchText & tokenizeQuery', () => {
    it('normalizes fractional inch dimensions with double quotes', () => {
      expect(normalizeSearchText('1/2" PVC Elbow')).toContain('1/2 inch');
      expect(normalizeSearchText('3/4" GI Nipple')).toContain('3/4 inch');
      expect(normalizeSearchText('1" Ball Valve')).toContain('1 inch');
    });

    it('normalizes metric and imperial units from attached digits', () => {
      expect(normalizeSearchText('2.5mm wire')).toBe('2.5 mm wire');
      expect(normalizeSearchText('100mtr roll')).toBe('100 mtr roll');
      expect(normalizeSearchText('50kg cement')).toBe('50 kg cement');
      expect(normalizeSearchText('10ft pipe')).toBe('10 ft pipe');
    });

    it('normalizes acronyms with periods to standard abbreviations', () => {
      expect(normalizeSearchText('G.I. Pipe 1"')).toBe('gi pipe 1 inch');
      expect(normalizeSearchText('M.S. Flange 2"')).toBe('ms flange 2 inch');
      expect(normalizeSearchText('S.S. 304 Bolt')).toBe('ss 304 bolt');
    });

    it('preserves decimals and fractions while stripping punctuation and brackets', () => {
      const normalized = normalizeSearchText('Finolex 2.5 sq.mm Cable (Red) - 90m.');
      expect(normalized).toBe('finolex 2.5 sq mm cable red 90 m');
    });

    it('tokenizes multi-word query into clean tokens', () => {
      const tokens = tokenizeQuery('  PVC   Elbow   1/2"   ');
      expect(tokens).toEqual(['pvc', 'elbow', '1/2', 'inch']);
    });
  });

  describe('getStem', () => {
    it('stems common hardware plurals to singular', () => {
      expect(getStem('screws')).toBe('screw');
      expect(getStem('elbows')).toBe('elbow');
      expect(getStem('pipes')).toBe('pipe');
      expect(getStem('inches')).toBe('inch');
    });

    it('preserves short technical abbreviations and words', () => {
      expect(getStem('ms')).toBe('ms');
      expect(getStem('ss')).toBe('ss');
      expect(getStem('gas')).toBe('gas');
    });
  });

  describe('scoreProductSearch ranking & relevance', () => {
    const products = [
      { barcode: '890123456789', name: 'Brass Bib Tap 1/2 inch', category: 'Plumbing', unit: 'PCS' },
      { barcode: '890987654321', name: 'PTFE Teflon Thread Tape 12mm', category: 'Plumbing', unit: 'ROLL' },
      { barcode: '1001', name: 'Finolex PVC 90 Deg Elbow 1 inch', category: 'Plumbing', unit: 'PCS' },
      { barcode: '1002', name: 'Finolex PVC 90 Deg Elbow 1/2 inch', category: 'Plumbing', unit: 'PCS' },
      { barcode: '1003', name: 'Supreme PVC Elbow 10 inch', category: 'Plumbing', unit: 'PCS' },
      { barcode: '2001', name: 'Polycab 2.5 sq.mm FR Wire Red', category: 'Electrical', unit: 'MTR' },
      { barcode: '2002', name: 'Polycab 1.5 sq.mm FR Wire Black', category: 'Electrical', unit: 'MTR' },
      { barcode: '3001', name: 'SS Wood Screws 2 inch', category: 'Fasteners', unit: 'BOX' },
    ];

    it('awards 10,000 points for exact barcode matches', () => {
      const score = scoreProductSearch(products[0], ['890123456789'], '890123456789');
      expect(score).toBe(10000);
    });

    it('awards prefix bonus for barcode prefix matches', () => {
      const score = scoreProductSearch(products[0], ['890123'], '890123');
      expect(score).toBeGreaterThanOrEqual(3000);
    });

    it('prioritizes exact word match over prefix word match (e.g. tap vs tape)', () => {
      const query = 'tap';
      const clean = query.trim().toLowerCase();
      const tokens = tokenizeQuery(clean);

      const tapScore = scoreProductSearch(products[0], tokens, clean); // 'Brass Bib Tap 1/2 inch'
      const tapeScore = scoreProductSearch(products[1], tokens, clean); // 'PTFE Teflon Thread Tape 12mm'

      expect(tapScore).toBeGreaterThan(0);
      expect(tapeScore).toBeGreaterThan(0);
      expect(tapScore).toBeGreaterThan(tapeScore);
    });

    it('matches multi-word queries in any order', () => {
      const query = 'elbow pvc 1';
      const clean = query.trim().toLowerCase();
      const tokens = tokenizeQuery(clean);

      const score1Inch = scoreProductSearch(products[2], tokens, clean); // 'Finolex PVC 90 Deg Elbow 1 inch'
      expect(score1Inch).toBeGreaterThan(0);
    });

    it('discards products that lack any of the required query tokens', () => {
      const query = 'polycab 2.5 red';
      const clean = query.trim().toLowerCase();
      const tokens = tokenizeQuery(clean);

      const redScore = scoreProductSearch(products[5], tokens, clean); // Polycab 2.5 Red
      const blackScore = scoreProductSearch(products[6], tokens, clean); // Polycab 1.5 Black (missing 2.5 and red)

      expect(redScore).toBeGreaterThan(0);
      expect(blackScore).toBe(0);
    });

    it('ranks exact dimension match over larger prefix dimension (1 inch vs 10 inch)', () => {
      const query = 'elbow 1';
      const clean = query.trim().toLowerCase();
      const tokens = tokenizeQuery(clean);

      const score1Inch = scoreProductSearch(products[2], tokens, clean); // Elbow 1 inch
      const score10Inch = scoreProductSearch(products[4], tokens, clean); // Elbow 10 inch

      expect(score1Inch).toBeGreaterThan(score10Inch);
    });

    it('matches plural query against singular product name and vice-versa', () => {
      const query = 'screws';
      const clean = query.trim().toLowerCase();
      const tokens = tokenizeQuery(clean);

      const score = scoreProductSearch(products[7], tokens, clean); // 'SS Wood Screws 2 inch'
      expect(score).toBeGreaterThan(0);

      const singularQuery = 'screw';
      const singularTokens = tokenizeQuery(singularQuery);
      const scoreSingular = scoreProductSearch(products[7], singularTokens, singularQuery);
      expect(scoreSingular).toBeGreaterThan(0);
    });

    it('matches inch quote queries to products with inch in name', () => {
      const query = 'elbow 1/2"';
      const clean = query.trim().toLowerCase();
      const tokens = tokenizeQuery(clean);

      const scoreHalfInch = scoreProductSearch(products[3], tokens, clean); // Elbow 1/2 inch
      expect(scoreHalfInch).toBeGreaterThan(0);
    });
  });

  describe('getInventoryByQuery integration', () => {
    const shopId = 'test-shop-search';

    beforeEach(async () => {
      localStorage.setItem('shop_id', shopId);
      const sampleItems = [
        { shop_id: shopId, barcode: 'BC-001', name: 'Brass Bib Tap 1/2 inch', category: 'Plumbing', is_active: true, stock_store: 10 },
        { shop_id: shopId, barcode: 'BC-002', name: 'PTFE Teflon Tape', category: 'Plumbing', is_active: true, stock_store: 50 },
        { shop_id: shopId, barcode: 'BC-003', name: 'Finolex PVC Elbow 1 inch', category: 'Plumbing', is_active: true, stock_store: 25 },
        { shop_id: shopId, barcode: 'BC-004', name: 'Finolex PVC Elbow 1/2 inch', category: 'Plumbing', is_active: true, stock_store: 5 },
      ];
      await saveInventoryBatch(sampleItems);
    });

    it('returns items sorted by relevance score by default', async () => {
      const res = await getInventoryByQuery({
        limit: 10,
        offset: 0,
        search: 'tap',
      });

      expect(res.data.length).toBe(2);
      expect(res.data[0].barcode).toBe('BC-001'); // Brass Bib Tap ranks first
      expect(res.data[1].barcode).toBe('BC-002'); // PTFE Teflon Tape ranks second
    });

    it('respects explicit column sort when specified alongside search', async () => {
      const res = await getInventoryByQuery({
        limit: 10,
        offset: 0,
        search: 'tap',
        sortOption: 'storestock-asc', // lowest store stock first
      });

      expect(res.data.length).toBe(2);
      expect(res.data[0].barcode).toBe('BC-001'); // 10 stock
      expect(res.data[1].barcode).toBe('BC-002'); // 50 stock
    });

    it('handles out-of-order multi-word query correctly', async () => {
      const res = await getInventoryByQuery({
        limit: 10,
        offset: 0,
        search: 'elbow 1 finolex',
      });

      expect(res.data.length).toBeGreaterThanOrEqual(1);
      expect(res.data[0].barcode).toBe('BC-003'); // PVC Elbow 1 inch
    });
  });
});
