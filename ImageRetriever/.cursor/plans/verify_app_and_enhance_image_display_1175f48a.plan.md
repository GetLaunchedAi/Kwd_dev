---
name: Verify App and Enhance Image Display
overview: This plan provides step-by-step instructions for another agent to verify the full end-to-end integration of the ImageRetriever app and ensure the retrieved image is correctly displayed on the frontend.
todos:
  - id: verify-env-keys-todo-id-1740685200000-1740685200000-0
    content: Verify environment variables and API keys in .env
    status: pending
  - id: install-and-build-todo-id-1740685200000-1740685200000-1
    content: Run npm install and npm run build
    status: pending
  - id: start-server-todo-id-1740685200000-1740685200000-2
    content: Start the server using npm run serve
    status: pending
  - id: test-frontend-todo-id-1740685200000-1740685200000-3
    content: Open the frontend in a browser and perform a test search
    status: pending
  - id: verify-image-display-todo-id-1740685200000-1740685200000-4
    content: Verify the image is correctly displayed in the UI result section
    status: pending
---

# Plan: Verify App and Enhance Image Display

This plan outlines the steps for another agent to verify the `ImageRetriever` application, from backend processing to frontend display.

## 1. Environment and Dependencies

-   **Verify API Keys**: Ensure that `.env` contains valid keys for `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`, etc.
-   **Install Dependencies**: Run `npm install` to ensure all packages are present.
-   **Build Project**: Run `npm run build` to compile TypeScript to JavaScript in the `dist/` directory.

## 2. Server Execution

-   **Start Server**: Run `npm run serve`.
-   **Confirm Running**: Verify the terminal shows `Server running at http://localhost:3000`.

## 3. Frontend Integration Testing

-   **Access UI**: Open `http://localhost:3000` in a local browser tab.
-   **Execute Search**: 

    1. Enter a query (e.g., "mountain sunset").
    2. Select a shape (e.g., "landscape").
    3. Provide context (e.g., "A travel blog post about hiking in the Alps").
    4. Click **Retrieve Image**.

-   **Verify Backend Response**: Check the browser console and network tab to ensure the POST request to `/api/retrieve` returns a `200 OK` with a valid JSON payload including `imageUrl`.

## 4. Image Display Verification

-   **Check Display**: Ensure the image appears in the result section.
-   **Verify Pathing**: The `src` of the `<img>` tag should be something like `/downloads/pexels-12345.jpg`.
-   **Static Serving**: Confirm that [src/server.ts](src/server.ts) correctly serves the `downloads` directory via `app.use('/downloads', express.static(downloadsDir))`.

## 5. Potential Improvements (If Display Fails)

-   **CORS/Path Issues**: If the image doesn't load, verify that the `downloads` folder path is correctly resolved relative to the `dist/server.js` file.
-   **UI Feedback**: Update [public/index.html](public/index.html) to show a "no image found" message if the backend returns a 404 or an empty result.
-   **Loading State**: Ensure the loading spinner is active until the backend returns, and optionally add a skeleton loader for the image itself.
```mermaid
graph TD
    User((User)) -->|Search| Frontend[public/index.html]
    Frontend -->|POST /api/retrieve| Server[src/server.ts]
    Server -->|retrieveImage| Orchestrator[src/orchestrator.ts]
    Orchestrator -->|Search & Qualify| Providers[Providers]
    Orchestrator -->|Download| Downloader[src/downloader.ts]
    Downloader -->|Save File| DownloadsFolder[(downloads/)]
    Server -->|JSON + URL| Frontend
    Frontend -->|Load Image| DownloadsFolder

```