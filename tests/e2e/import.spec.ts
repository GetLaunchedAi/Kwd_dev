import { test, expect } from '@playwright/test';

test.describe('Task Import Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the initial empty tasks list
    await page.route('**/api/tasks', async route => {
      await route.fulfill({ json: [] });
    });

    // Mock health
    await page.route('**/api/health', async route => {
      await route.fulfill({ json: { status: 'ok', clickup: { status: 'connected' } } });
    });

    await page.goto('/index.html');
  });

  test('should import a task successfully', async ({ page }) => {
    // Click import button
    await page.click('#importTaskBtn');
    await expect(page.locator('#importModal')).toBeVisible();

    // Fill task ID
    await page.fill('#taskIdInput', '86b7yt9z5');

    // Mock preview response
    await page.route('**/api/tasks/import/preview/86b7yt9z5*', async route => {
      await route.fulfill({ 
        json: { 
          taskId: '86b7yt9z5', 
          task: { name: 'New Imported Task', id: '86b7yt9z5' },
          clientName: 'aimai'
        } 
      });
    });

    // Click preview
    await page.click('#previewImportBtn');
    await expect(page.locator('#importPreview')).toBeVisible();
    await expect(page.locator('#previewContent')).toContainText('New Imported Task');

    // Mock actual import
    await page.route('**/api/tasks/import', async route => {
      await route.fulfill({ json: { success: true } });
    });

    // After import, the dashboard should refresh. Mock the new tasks list.
    await page.route('**/api/tasks', async route => {
      const json = [
        { 
          taskInfo: { 
            task: { id: '86b7yt9z5', name: 'New Imported Task', url: 'https://app.clickup.com/t/86b7yt9z5' },
            clientName: 'aimai'
          },
          taskState: { state: 'pending', updatedAt: new Date().toISOString() }
        }
      ];
      await route.fulfill({ json });
    });

    // Confirm import
    await page.click('#confirmImportBtn');

    // Verify modal is closed and task appears
    await expect(page.locator('#importModal')).not.toBeVisible();
    await expect(page.getByText('New Imported Task')).toBeVisible();
  });
});




















