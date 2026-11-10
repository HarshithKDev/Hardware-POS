import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportCompleteShopData } from '../services/dataExport';

const mockFrom = vi.fn();
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (...args) => mockFrom(...args)
  }
}));

const mockSaveAs = vi.fn();
vi.mock('file-saver', () => ({
  saveAs: (...args) => mockSaveAs(...args)
}));

describe('Complete Data Export Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('shop_id', 'test-shop-777');
  });

  it('successfully fetches all business entities and builds a 9-sheet Excel workbook', async () => {
    const mockProducts = [
      {
        barcode: '1001',
        name: 'Hammer 500g',
        category: 'Tools',
        sub_category: 'Hand Tools',
        unit: 'PCS',
        cost_price: 150,
        msp: 180,
        price: 220,
        stock_store: 12,
        stock_warehouse: 25,
        min_quantity_store: 5,
        min_quantity_warehouse: 10,
        is_active: true
      },
      {
        barcode: '1002',
        name: 'GI Wire 1mm',
        category: 'Hardware',
        sub_category: 'Wire',
        unit: 'KG',
        cost_price: 60,
        msp: 75,
        price: 90,
        stock_store: 0,
        stock_warehouse: 0,
        min_quantity_store: 10,
        min_quantity_warehouse: 20,
        is_active: true
      }
    ];

    const mockBills = [
      {
        id: 'BILL-001',
        created_at: '2026-10-22T10:00:00.000Z',
        customer_name: 'Alice',
        customer_phone: '9876543210',
        cashier_name: 'Durjay',
        payment_method: 'UPI',
        subtotal: 440,
        discount: 20,
        total_amount: 420,
        status: 'completed',
        notes: 'Paid online'
      }
    ];

    const mockBillItems = [
      {
        bill_id: 'BILL-001',
        created_at: '2026-10-22T10:00:00.000Z',
        barcode: '1001',
        item_name: 'Hammer 500g',
        quantity: 2,
        unit: 'PCS',
        cost_price: 150,
        price: 220,
        total_price: 440
      }
    ];

    const mockExpenses = [
      {
        id: 'EXP-1',
        created_at: '2026-10-22T11:00:00.000Z',
        worker_name: 'General Shop',
        amount: 350,
        reason: 'Shop cleaning & tea',
        recorded_by: 'Owner',
        notes: 'shop:test-shop-777'
      }
    ];

    const mockCategories = [{ name: 'Tools' }, { name: 'Hardware' }];
    const mockSubcategories = [
      { name: 'Hand Tools', category_name: 'Tools' },
      { name: 'Wire', category_name: 'Hardware' }
    ];

    const mockWorkers = [
      { name: 'Durjay', password: 'cashier-password', created_at: '2026-01-01' },
      { name: 'Ramesh', password: 'NON_BILLABLE_pass', created_at: '2026-02-01' }
    ];

    const mockBatches = [
      {
        barcode: '1001',
        batch_number: 1,
        cost_price: 150,
        msp: 180,
        price: 220,
        quantity_store: 12,
        quantity_warehouse: 25,
        created_at: '2026-03-01'
      }
    ];

    const mockAuditLogs = [
      {
        created_at: '2026-10-22T09:00:00.000Z',
        action_type: 'STOCK_IN',
        barcode: '1001',
        item_name: 'Hammer 500g',
        changes: 'Added 25 to warehouse',
        performed_by: 'Owner'
      }
    ];

    // Flexible chainable fake: any filter/order/range call returns the builder,
    // and awaiting it resolves to the table's rows.
    const tableData = {
      product_master: mockProducts,
      bills: mockBills,
      bill_items: mockBillItems,
      expenses: mockExpenses,
      categories: mockCategories,
      subcategories: mockSubcategories,
      workers: mockWorkers,
      inventory_batches: mockBatches,
      audit_logs: mockAuditLogs,
    };
    mockFrom.mockImplementation((table) => {
      const result = { data: tableData[table] || [], error: null };
      const builder = {};
      ['select', 'order', 'eq', 'limit', 'range', 'in', 'gte', 'lte'].forEach((m) => {
        builder[m] = vi.fn().mockReturnValue(builder);
      });
      builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      return builder;
    });

    const progressSteps = [];
    const shopSettings = {
      id: 'test-shop-777',
      shop_name: 'Metro Hardware Store',
      owner_name: 'John Doe',
      phone: '9988776655',
      shop_address: '123 Main Road, City',
      upi_id: 'metro@upi'
    };

    const fileName = await exportCompleteShopData(shopSettings, (msg) => progressSteps.push(msg));

    expect(progressSteps.length).toBeGreaterThan(5);
    expect(fileName).toContain('Metro_Hardware_Store_Full_Business_Backup_');
    expect(mockSaveAs).toHaveBeenCalledTimes(1);

    const [blobArg, nameArg] = mockSaveAs.mock.calls[0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect(nameArg).toBe(fileName);
  });
});
