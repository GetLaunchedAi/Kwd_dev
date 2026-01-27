import { test, expect } from '@playwright/test';

test.describe('Workspace Mappings Management', () => {
  test.beforeEach(async ({ page }) => {
    // Mock initial mappings
    await page.route('**/api/mappings', async route => {
      await route.fulfill({ 
        json: { 
          patterns: [{ pattern: 'old-.*', clientName: 'old-client' }],
          tasks: { '12345': 'specific-client' }
        } 
      });
    });

    await page.goto('/mappings.html');
  });

  test('should add and display pattern mapping', async ({ page }) => {
    // Fill the pattern form
    await page.fill('#patternInput', 'test-.*');
    await page.fill('#patternClientInput', 'test-client');

    // Mock the POST request
    await page.route('**/api/mappings/pattern', async route => {
      expect(route.request().method()).toBe('POST');
      await route.fulfill({ json: { success: true } });
    });

    // Mock the subsequent GET refresh
    await page.route('**/api/mappings', async route => {
      await route.fulfill({ 
        json: { 
          patterns: [
            { pattern: 'old-.*', clientName: 'old-client' },
            { pattern: 'test-.*', clientName: 'test-client' }
          ],
          tasks: { '12345': 'specific-client' }
        } 
      });
    });

    await page.click('button:has-text("Add Mapping")');

    // Verify it appears in the table
    await expect(page.locator('#patternMappingsTableBody')).toContainText('test-.*');
    await expect(page.locator('#patternMappingsTableBody')).toContainText('test-client');
  });

  test('should add and display task mapping', async ({ page }) => {
    // Switch to tasks tab
    await page.click('button[data-tab="tasks"]');
    await expect(page.locator('#tasksTab')).toBeVisible();

    // Fill task mapping form
    await page.fill('#taskIdMappingInput', '86b7yt9z5');
    await page.fill('#taskClientMappingInput', 'aimai');

    // Mock POST
    await page.route('**/api/mappings/task/86b7yt9z5', async route => {
      await route.fulfill({ json: { success: true } });
    });

    // Mock refresh
    await page.route('**/api/mappings', async route => {
      await route.fulfill({ 
        json: { 
          patterns: [{ pattern: 'old-.*', clientName: 'old-client' }],
          tasks: { 
            '12345': 'specific-client',
            '86b7yt9z5': 'aimai'
          }
        } 
      });
    });

    await page.click('#tasksTab button:has-text("Add Mapping")');

    // Verify it appears
    await expect(page.locator('#taskMappingsTableBody')).toContainText('86b7yt9z5');
    await expect(page.locator('#taskMappingsTableBody')).toContainText('aimai');
  });

  test('should delete a mapping', async ({ page }) => {
    // Mock the DELETE request
    await page.route('**/api/mappings/pattern', async route => {
      expect(route.request().method()).toBe('DELETE');
      await route.fulfill({ json: { success: true } });
    });

    // Mock refresh after delete
    await page.route('**/api/mappings', async route => {
      await route.fulfill({ 
        json: { 
          patterns: [],
          tasks: {}
        } 
      });
    });

    // Find and click delete button for the 'old-.*' pattern
    const deleteBtn = page.locator('tr:has-text("old-.*") button.btn-danger');
    await deleteBtn.click();

    // Verify table is empty or doesn't have the deleted item
    await expect(page.locator('#patternMappingsTableBody')).not.toContainText('old-.*');
  });
});



















