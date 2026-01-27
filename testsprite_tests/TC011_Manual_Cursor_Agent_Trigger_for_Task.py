import asyncio
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None
    
    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()
        
        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",         # Set the browser window size
                "--disable-dev-shm-usage",        # Avoid using /dev/shm which can cause issues in containers
                "--ipc=host",                     # Use host-level IPC for better stability
                "--single-process"                # Run the browser in a single process mode
            ],
        )
        
        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        context.set_default_timeout(5000)
        
        # Open a new page in the browser context
        page = await context.new_page()
        
        # Navigate to your target URL and wait until the network request is committed
        await page.goto("http://localhost:3001", wait_until="commit", timeout=10000)
        
        # Wait for the main page to reach DOMContentLoaded state (optional for stability)
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=3000)
        except async_api.Error:
            pass
        
        # Iterate through all iframes and wait for them to load as well
        for frame in page.frames:
            try:
                await frame.wait_for_load_state("domcontentloaded", timeout=3000)
            except async_api.Error:
                pass
        
        # Interact with the page elements to simulate user flow
        # -> Navigate to the main dashboard to see available tasks
        await page.goto('http://localhost:3001', timeout=10000)
        await asyncio.sleep(2)
        

        # -> Find and click on the first available demo task in the dashboard
        frame = context.pages[-1]
        # Look for any demo task card and click on its trigger button
        try:
            # Try to find a task with "demo-" prefix and click its agent trigger button
            task_trigger_btn = frame.locator('button:has-text("Trigger Agent")').first
            await task_trigger_btn.click(timeout=5000)
            await asyncio.sleep(2)
        except:
            # If no button, try navigating directly to a known task
            await page.goto('http://localhost:3001/api/tasks/demo-sunny-side-bakery-84/trigger-agent', timeout=10000)
            await asyncio.sleep(3)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        try:
            # Check for success message or successful trigger confirmation
            await expect(frame.locator('text=Agent triggered').first).to_be_visible(timeout=5000)
        except AssertionError:
            # Also accept if we see the task was added to queue
            try:
                await expect(frame.locator('text=added to queue').first).to_be_visible(timeout=1000)
            except AssertionError:
                raise AssertionError('Test case failed: The Cursor agent trigger did not return success confirmation as expected.')
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    