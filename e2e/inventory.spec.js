import { test, expect } from '@playwright/test';

test.describe('Inventory Flow', () => {
  const OWNER_PASS = 'owners';
  const TEST_ITEM = 'Test Product ' + Date.now();

  test.beforeEach(async ({ page }) => {
    // Log in as Owner before each test
    await page.goto('/');
    await page.click('button:has-text("Owner Login")');
    await page.fill('input[placeholder="Owner Password"]', OWNER_PASS);
    await page.click('button:has-text("Login")');
    await expect(page.locator('button', { hasText: 'Overview' })).toBeVisible({ timeout: 10000 });
  });

  test('Owner can add a product to the catalog, view it in inventory, and delete it', async ({ page }) => {
    // 1. Navigate to Catalog
    await page.click('button:has-text("Add Items")');
    await expect(page.locator('h1', { hasText: 'Register New Item' })).toBeVisible();

    // 2. Add new item
    await page.fill('#item-name', TEST_ITEM);
    await page.fill('#item-cost', '10.00');
    await page.fill('#item-msp', '12.00');
    await page.fill('#item-mrp', '15.00');
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

    // 3. Go to Inventory
    await page.click('button:has-text("Main Storage")');
    await expect(page.locator('input[placeholder="Search Barcode or Name..."]')).toBeVisible({ timeout: 10000 });

    // Wait for the inventory list to load initially before searching
    await page.waitForTimeout(2000);
    
    // Search for it
    await page.fill('input[placeholder="Search Barcode or Name..."]', TEST_ITEM);

    // Wait for item to appear in the table
    const itemTextLocator = page.locator(`td:visible`, { hasText: TEST_ITEM }).first();
    await expect(itemTextLocator).toBeVisible({ timeout: 15000 });

    // 4. Delete the item (Cleanup)
    // First, we need to click "Select Items" mode
    await page.click('button:has-text("Select Items")');
    
    // Check the checkbox for our item
    const itemRow = page.locator('tr:visible').filter({ hasText: TEST_ITEM }).first();
    await itemRow.locator('input[type="checkbox"]:visible').check();

    // Click Delete Selected
    await page.click('button:has-text("Delete Selected")');
    
    // Confirm Deletion Dialog
    await page.click('button:has-text("Delete")');

    // Wait for success alert
    await expect(page.locator('text=Successfully removed')).toBeVisible({ timeout: 10000 });

    // Verify it is removed from active inventory
    await expect(itemRow).toBeHidden({ timeout: 10000 });
  });
});
