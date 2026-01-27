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
        # -> Navigate to dashboard to find an existing task
        await page.goto('http://localhost:3001', timeout=10000)
        await asyncio.sleep(2)
        

        # -> Try to use the evaluation API to perform PATCH request with proper method
        # Since browser navigation uses GET, we need to use the evaluation API
        response = await page.evaluate("""
            async () => {
                try {
                    const response = await fetch('/api/tasks/demo-sunny-side-bakery-84/description', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            description: 'Updated task description for testing' 
                        })
                    });
                    return { status: response.status, ok: response.ok };
                } catch (error) {
                    return { error: error.message };
                }
            }
        """)
        await asyncio.sleep(1)
        

        # -> Also test system prompt update
        response2 = await page.evaluate("""
            async () => {
                try {
                    const response = await fetch('/api/tasks/demo-sunny-side-bakery-84/system-prompt', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            systemPrompt: 'Updated system prompt for testing' 
                        })
                    });
                    return { status: response.status, ok: response.ok };
                } catch (error) {
                    return { error: error.message };
                }
            }
        """)
        await asyncio.sleep(1)
        

        # --> Assertions to verify final state
        try:
            # Check if either request was successful (200 or 204 status)
            assert response.get('status') in [200, 204] or response.get('ok') == True or response2.get('status') in [200, 204] or response2.get('ok') == True
        except (AssertionError, AttributeError):
            raise AssertionError(f'Test case failed: The PATCH requests to update task description and system prompt did not succeed. Description response: {response}, System prompt response: {response2}')
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    