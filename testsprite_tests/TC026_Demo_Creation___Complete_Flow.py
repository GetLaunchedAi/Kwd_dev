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
        # -> First, check if the slug 'test-automated-demo-123' is available
        await page.goto('http://localhost:3001/api/demo/check-slug?slug=test-automated-demo-123', timeout=10000)
        await asyncio.sleep(2)
        

        # -> Navigate to the main dashboard to access the Create Demo form
        await page.goto('http://localhost:3001', timeout=10000)
        await asyncio.sleep(2)
        

        # -> Click on 'Create Demo' navigation link to access the demo creation form
        frame = context.pages[-1]
        # Click on 'Create Demo' link
        elem = frame.locator('xpath=html/body/div/aside/nav/a[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Fill in all required fields for demo creation: Business Name, Client Slug, Primary Color, and optional fields like Contact Email, Phone, Address, Secondary Color, and Font Family
        frame = context.pages[-1]
        # Input Business Name
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[2]/div/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('Test Automated Demo')
        

        frame = context.pages[-1]
        # Input Client Slug
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[2]/div[2]/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('test-automated-demo-123')
        

        frame = context.pages[-1]
        # Input Contact Email
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[3]/div/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('test@testautomated.com')
        

        frame = context.pages[-1]
        # Input Contact Phone
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[3]/div[2]/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('(555) 999-8888')
        

        frame = context.pages[-1]
        # Input Business Address
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[4]/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('456 Test Ave, Demo City, CA 90001')
        

        frame = context.pages[-1]
        # Input Primary Color Hex (without # symbol)
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div[2]/div[2]/div/div/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('ff6b6b')
        

        frame = context.pages[-1]
        # Input Secondary Color Hex (without # symbol)
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div[2]/div[2]/div[2]/div/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('4ecdc4')
        

        frame = context.pages[-1]
        # Select Font Family from dropdown
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div[2]/div[3]/div/div/select').nth(0)
        await page.wait_for_timeout(3000); await elem.select_option('Inter')
        

        # -> Click the 'Generate Demo Website' button to submit the form and initiate demo creation
        frame = context.pages[-1]
        # Click 'Generate Demo Website' button to submit the form
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div[4]/button').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Wait for the demo creation response which should return success and a clientSlug
        await asyncio.sleep(5)
        

        # -> Poll the demo status endpoint to verify that the demo creation process has started
        await page.goto('http://localhost:3001/api/demo/status/test-automated-demo-123', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Continue polling the demo status endpoint to monitor progress through the workflow stages
        await page.goto('http://localhost:3001/api/demo/status/test-automated-demo-123', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Poll one more time to confirm the demo is progressing and the status can be retrieved successfully
        await page.goto('http://localhost:3001/api/demo/status/test-automated-demo-123', timeout=10000)
        await asyncio.sleep(3)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        try:
            # Check that the API response indicates the demo status exists and is being tracked
            await expect(frame.locator('text="clientSlug"').first).to_be_visible(timeout=5000)
        except AssertionError:
            raise AssertionError('Test case failed: The demo creation endpoint did not return the expected response with a clientSlug, or the status endpoint failed to return status information. The complete demo creation flow must successfully accept all required fields, initiate the demo creation process in the background, and provide status tracking.')
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    




