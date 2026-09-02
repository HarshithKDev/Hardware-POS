import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  const OWNER_PASS = 'owners';
  const WORKER_NAME = 'Test Worker ' + Date.now();
  const WORKER_PASS = 'password123';

  test('Owner can log in, create a worker, and log out', async ({ page }) => {
    await page.goto('/');

    // 1. Log in as Owner
    await page.click('button:has-text("Owner Login")');
    await page.fill('input[placeholder="Owner Password"]', OWNER_PASS);
    await page.click('button:has-text("Login")');

    // Verify Owner Dashboard is visible
    await expect(page.locator('button', { hasText: 'Overview' })).toBeVisible({ timeout: 10000 });

    // 2. Navigate to Staff page and create a worker
    await page.click('button:has-text("Manage Staff")');
    await expect(page.locator('h1', { hasText: 'Manage Staff' })).toBeVisible();

    await page.fill('input[placeholder="e.g. John Doe"]', WORKER_NAME);
    await page.fill('input[placeholder="Min. 6 characters"]', WORKER_PASS);
    await page.selectOption('select', { value: 'true' }); // Billable
    await page.click('button:has-text("Create Account")');
    await expect(page.locator('#alert-dialog-desc')).toHaveText('Staff member added successfully.', { timeout: 10000 });
    const okButton1 = page.locator('button:has-text("OK")');
    await expect(okButton1).toBeVisible({ timeout: 10000 });
    await okButton1.click();
    await expect(page.getByRole('cell', { name: WORKER_NAME, exact: true })).toBeVisible({ timeout: 10000 });

    // 3. Log out
    await page.click('button:has-text("Sign Out")');
    await page.click('div[role="dialog"] button:has-text("Sign Out")');

    // 4. Verify logged out state
    await expect(page.locator('button:has-text("Owner Login")')).toBeVisible();
  });

  test('Worker can log in using created credentials', async ({ page }) => {
    // Note: Since tests run in isolated browser contexts, we need to create the worker first 
    // if it doesn't exist. But to keep it simple, we'll run it sequentially or just create a temporary one here.
    test.slow();
    
    // First, login as owner and create worker for THIS test context
    await page.goto('/');
    await page.click('button:has-text("Owner Login")');
    await page.fill('input[placeholder="Owner Password"]', OWNER_PASS);
    await page.click('button:has-text("Login")');
    await expect(page.locator('button', { hasText: 'Overview' })).toBeVisible({ timeout: 10000 });
    
    await page.click('button:has-text("Manage Staff")');
    await page.fill('input[placeholder="e.g. John Doe"]', WORKER_NAME + '2');
    await page.fill('input[placeholder="Min. 6 characters"]', WORKER_PASS);
    await page.click('button:has-text("Create Account")');
    await expect(page.locator('#alert-dialog-desc')).toHaveText('Staff member added successfully.', { timeout: 10000 });
    const okButton2 = page.locator('button:has-text("OK")');
    await expect(okButton2).toBeVisible({ timeout: 10000 });
    await okButton2.click();
    await expect(page.getByRole('cell', { name: WORKER_NAME + '2', exact: true })).toBeVisible({ timeout: 10000 });
    
    await page.click('button:has-text("Sign Out")');
    await page.click('div[role="dialog"] button:has-text("Sign Out")');

    // Now, login as Worker
    await page.click('button:has-text("Staff Login")');
    await page.fill('input[placeholder="Staff Name"]', WORKER_NAME + '2');
    await page.fill('input[placeholder="Login PIN"]', WORKER_PASS);
    await page.click('button:has-text("Login")');
    await page.click('text=Terminal');

    // Verify Worker POS terminal is visible
    await expect(page.locator('input[placeholder="Search barcode or name..."]')).toBeVisible({ timeout: 10000 });
  });

  test('Invalid credentials show error', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Owner Login")');
    await page.fill('input[placeholder="Owner Password"]', 'wrongpassword');
    await page.click('button:has-text("Login")');

    // Check for error message
    await expect(page.locator('text=Incorrect Password')).toBeVisible();
  });
});
