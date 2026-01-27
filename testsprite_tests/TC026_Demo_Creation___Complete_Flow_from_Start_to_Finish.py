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
        # -> Click on the 'Create Demo' navigation link
        frame = context.pages[-1]
        # Click on the 'Create Demo' navigation link to access the demo creation form
        elem = frame.locator('xpath=html/body/div/aside/nav/a[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Fill in the Business Name field with valid data
        frame = context.pages[-1]
        # Fill in the Business Name field with valid data
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[2]/div/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('Sunny Plumbing')
        

        # -> Fill in the Client Slug field with a unique slug value
        frame = context.pages[-1]
        # Fill in the Client Slug field with a unique slug value
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[2]/div[2]/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('sunny-plumbing-unique-123')
        

        # -> Fill in the Contact Phone field with a valid phone number
        frame = context.pages[-1]
        # Fill in the Contact Phone field with a valid phone number
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[3]/div[2]/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('5551234567')
        

        # -> Correct the Contact Phone field with a valid phone number format
        frame = context.pages[-1]
        # Correct the Contact Phone field with a valid phone number format
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[3]/div[2]/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('(555) 123-4567')
        

        # -> Correct the Contact Phone field with a valid phone number format or try a different valid phone number
        frame = context.pages[-1]
        # Try a different valid phone number format for Contact Phone field
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[3]/div[2]/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('555-123-4567')
        

        # -> Try clearing and re-entering the Contact Phone field with a valid phone number format
        frame = context.pages[-1]
        # Clear the Contact Phone field to try re-entering a valid phone number
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[3]/div[2]/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('')
        

        frame = context.pages[-1]
        # Re-enter the Contact Phone field with a valid phone number without special characters
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[3]/div[2]/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('5551234567')
        

        # -> Try entering Contact Phone with a different valid format including country code
        frame = context.pages[-1]
        # Try entering Contact Phone with country code to fix validation
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div/div[3]/div[2]/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('+1 5551234567')
        

        frame = context.pages[-1]
        # Click the 'Generate Demo Website' button to submit the form
        elem = frame.locator('xpath=html/body/div/main/div/div/form/div[4]/button').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        await expect(frame.locator('text=Create Demo Website').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=Generating CURSOR_TASK.md for Step 1 (Branding)...').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=## Branding & Identity Implementation Complete').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=Website Ready for Customization! Your demo has been created and the AI agent is now working on it.').first).to_be_visible(timeout=30000)
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    