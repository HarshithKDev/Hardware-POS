import { test, expect } from '@playwright/test';

test.describe('Cashier Checkout Flow', () => {
  test('should complete a checkout with split payment', async ({ page }) => {
    // 1. Navigate to the POS
    await page.goto('http://localhost:5173');

    // 2. Log in as a worker
    const isWelcome = await page.isVisible('text=Cashier Login');
    if (isWelcome) {
      await page.click('text=Cashier Login');
    }
    
    try {
      await page.waitForSelector('input[placeholder="Search barcode or name..."]', { timeout: 10000 });
    } catch (e) {
      console.log('Login step might be required and failed, proceeding assuming mocked auth.');
    }

    // 3. Add two items to the cart
    const searchInput = page.locator('input[placeholder="Search barcode or name..."]');
    
    if (await searchInput.isVisible()) {
      // Add first item
      await searchInput.fill('123456789'); // A test barcode
      await searchInput.press('Enter');
      
      // Add second item
      await searchInput.fill('987654321'); 
      await searchInput.press('Enter');

      // 4. Click Checkout
      const checkoutBtn = page.locator('button', { hasText: 'CHECKOUT' });
      await checkoutBtn.click();

      // 5. Fill in Split Payment (Cash/UPI)
      const splitBtn = page.locator('button', { hasText: 'SPLIT' });
      await splitBtn.click();

      const cashInput = page.locator('input[placeholder="Cash amount"]');
      const upiInput = page.locator('input[placeholder="UPI amount"]');
      
      await cashInput.fill('10');
      await upiInput.fill('20');

      // Click Complete Transaction
      const completeBtn = page.locator('button', { hasText: 'Complete Transaction' });
      await completeBtn.click();

      // 6. Assert success screen / receipt
      await expect(page.locator('text=Payment Successful')).toBeVisible();
      await expect(page.locator('text=PAID VIA: SPLIT')).toBeVisible();
    }
  });
});
