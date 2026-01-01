# Image Retriever Frontend

The frontend of the Image Retriever Tool provides a web interface for searching and downloading images.

## File Structure

- `index.html`: The main (and only) file of the frontend. It contains the HTML structure, Tailwind CSS for styling, and JavaScript for handling form submission and results display.

## Contents of `index.html`

- **HTML Structure**:
  - A search form where users can input a query, select an image shape, and provide context text.
  - A loading indicator that appears while the tool is searching.
  - A result section that displays the selected image, its metadata (provider, photographer, attribution link), and various scores (Final, Relevance, Crop Fit, Safety).
  - An "Alternative Options Considered" grid that shows other candidates from the search.
  - An error message display area.

- **Styling**:
  - Uses Tailwind CSS via CDN for a modern and responsive design.

- **JavaScript Flow**:
  1. **Form Submission**: When the user clicks "Retrieve Image", the form data is collected and sent to the `/api/retrieve` endpoint on the backend.
  2. **Wait for Response**: The UI shows a loading spinner while the backend orchestrates the search through multiple turns and providers.
  3. **Display Result**: Once the backend returns a successful result, the main image and its details are rendered.
  4. **Display Alternatives**: All qualified candidates considered during the search are shown in a grid below the main result, highlighting their scores and whether they passed the threshold.
  5. **Download**: Users can click "Download Local Copy" to download the image that has been saved to the server's local storage.

## How it Works with the Backend

The frontend communicates with an Express.js server defined in `src/server.ts`. The server:
1.  Serves the `public/` folder as static files.
2.  Provides the `/api/retrieve` POST endpoint which triggers the `orchestrator.ts` logic.
3.  Serves the `downloads/` folder, allowing the frontend to display and download images stored locally.

