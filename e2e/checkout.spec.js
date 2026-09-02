import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';



test.describe('Checkout Flow', () => {
  const OWNER_PASS = 'owners';
  const WORKER_NAME = 'CheckoutWorker' + Date.now();
  const WORKER_PASS = 'worker123';
  const TEST_ITEM = 'Checkout Item ' + Date.now();
  const ITEM_COST = '10.00';
  const ITEM_MSP = '12.00';
  const ITEM_MRP = '15.00';
  const ITEM_BARCODE = 'BAR' + Date.now();

  test('Worker can add item, bargain, and checkout', async ({ page }) => {
    test.slow();
    
    // 1. Setup: Log in as Owner, create worker and product
    await page.goto('/');
    await page.click('button:has-text("Owner Login")');
    await page.fill('input[placeholder="Owner Password"]', OWNER_PASS);
    await page.click('button:has-text("Login")');
    await expect(page.locator('button', { hasText: 'Overview' })).toBeVisible({ timeout: 10000 });

    // Create product
    await page.click('button:has-text("Add Items")');
    await page.fill('#item-name', TEST_ITEM);
    // Fill explicit barcode
    await page.locator('label', { hasText: 'Enter Barcode Manually' }).click();
    await page.fill('#item-barcode', ITEM_BARCODE);
    await page.fill('#item-cost', ITEM_COST);
    await page.fill('#item-msp', ITEM_MSP);
    await page.fill('#item-mrp', ITEM_MRP);
    await page.fill('#item-min-qty-whse', '10');
    await page.fill('#item-min-qty-store', '5');
    
    // Fill Category and Subcategory
    const TEST_CAT = 'CAT_' + Date.now();
    const TEST_SUB = 'SUB_' + Date.now();
    await page.fill('input[placeholder="Select or type to create..."] >> nth=0', TEST_CAT);
    await page.click(`text=+ Create "${TEST_CAT}"`);
    
    await page.fill('input[placeholder="Select or type to create..."] >> nth=1', TEST_SUB);
    await page.click(`text=+ Create "${TEST_SUB}"`);
    
    await page.click('button:has-text("Save Item")');
    await expect(page.locator('#alert-dialog-desc')).toHaveText(/Added "/, { timeout: 10000 });
    const okButton = page.locator('button:has-text("OK")');
    await expect(okButton).toBeVisible({ timeout: 10000 });
    await okButton.click();

    // Give it stock in the DB so we can actually check it out
    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY);
    await supabase.from('inventory_batches').update({ stock_store: 100 }).eq('barcode', ITEM_BARCODE);

    // Clear IndexedDB in the browser so it fetches fresh data with stock from Supabase on Enter
    await page.evaluate(async () => {
      const dbs = await window.indexedDB.databases();
      for (const db of dbs) {
        window.indexedDB.deleteDatabase(db.name);
      }
    });

    // Create worker
    await page.click('button:has-text("Manage Staff")');
    await page.fill('input[placeholder="e.g. John Doe"]', WORKER_NAME);
    await page.fill('input[placeholder="Min. 6 characters"]', WORKER_PASS);
    await page.click('button:has-text("Create Account")');
    await expect(page.locator('#alert-dialog-desc')).toHaveText('Staff member added successfully.', { timeout: 10000 });
    const okButtonWorker = page.locator('button:has-text("OK")');
    await expect(okButtonWorker).toBeVisible({ timeout: 10000 });
    await okButtonWorker.click();
    await expect(page.locator(`td:has-text("${WORKER_NAME}")`)).toBeVisible({ timeout: 10000 });

    // Log out
    await page.click('button:has-text("Sign Out")');
    await page.click('div[role="dialog"] button:has-text("Sign Out")');

    // 2. Worker Login
    await page.click('button:has-text("Staff Login")');
    await page.fill('input[placeholder="Staff Name"]', WORKER_NAME);
    await page.fill('input[placeholder="Login PIN"]', WORKER_PASS);
    await page.click('button:has-text("Login")');
    await page.click('text=Terminal');
    await expect(page.locator('input[placeholder="Search barcode or name..."]')).toBeVisible({ timeout: 10000 });

    // 3. Add to Cart
    // Add item by barcode
    await page.fill('input[placeholder="Search barcode or name..."]', ITEM_BARCODE);
    
    // Press Enter to trigger fallback fetch from Supabase
    await page.keyboard.press('Enter');
    
    // Verify item is in cart
    await expect(page.locator(`text=${TEST_ITEM}`)).toBeVisible();

    // 4. Bargain / Edit Price
    await page.screenshot({ path: 'checkout-cart.png' });

    // Get the price input for this item
    const priceInput = page.locator('input[placeholder="0.00"]').first();
    await priceInput.fill('13.00'); // Between MSP and MRP
    await priceInput.blur();

    // 5. Checkout
    // Click Complete button in the cart summary
    await page.click('button:has-text("Complete")');

    // Modal appears, enter cash given
    await expect(page.locator('#cash-given')).toBeVisible();
    await page.fill('#cash-given', '20');

    // Click Complete Sale
    await page.click('button:has-text("Complete Sale")');

    // Wait for transaction to complete (cart should be cleared, receipt or success shown)
    // Verify search input is focused again, meaning cart is ready for next customer
    await expect(searchInput).toBeFocused({ timeout: 10000 });
  });
});
