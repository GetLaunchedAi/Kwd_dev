import { test, expect } from '@playwright/test';

test.describe('Dashboard Functionality', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the tasks API
    await page.route('**/api/tasks', async route => {
      const json = [
        { 
          taskInfo: { 
            task: { id: '86b7yt9z5', name: 'Test Task 1', url: 'https://app.clickup.com/t/86b7yt9z5' },
            clientName: 'aimai'
          },
          taskState: { state: 'in_progress', updatedAt: new Date().toISOString() }
        },
        { 
          taskInfo: { 
            task: { id: '86b7yt9z6', name: 'Test Task 2', url: 'https://app.clickup.com/t/86b7yt9z6' },
            clientName: 'alaskans-art-n-around'
          },
          taskState: { state: 'completed', updatedAt: new Date().toISOString() }
        }
      ];
      await route.fulfill({ json });
    });

    // Mock connection health
    await page.route('**/api/health', async route => {
      await route.fulfill({ json: { status: 'ok', clickup: { status: 'connected' } } });
    });

    await page.goto('/index.html');
  });

  test('should display the dashboard and tasks', async ({ page }) => {
    await expect(page.locator('.logo-text')).toContainText('KWD Dev');
    await expect(page.locator('.tasks-grid')).toBeVisible();
    
    // Check if tasks are rendered (using some identifying class or text)
    await expect(page.getByText('Test Task 1')).toBeVisible();
    await expect(page.getByText('Test Task 2')).toBeVisible();
  });

  test('should filter tasks by search input', async ({ page }) => {
    const searchInput = page.locator('#searchInput');
    await searchInput.fill('Task 1');
    
    await expect(page.getByText('Test Task 1')).toBeVisible();
    await expect(page.getByText('Test Task 2')).not.toBeVisible();
  });

  test('should filter tasks by status', async ({ page }) => {
    const filterSelect = page.locator('#filterSelect');
    await filterSelect.selectOption('completed');
    
    await expect(page.getByText('Test Task 2')).toBeVisible();
    await expect(page.getByText('Test Task 1')).not.toBeVisible();
  });

  test('should trigger refresh when button is clicked', async ({ page }) => {
    let refreshTriggered = false;
    await page.route('**/api/tasks', async route => {
      refreshTriggered = true;
      await route.fulfill({ json: [] });
    });

    await page.click('#refreshBtn');
    expect(refreshTriggered).toBe(true);
  });
});



















