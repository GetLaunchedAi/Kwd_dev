# Image Retriever Backend

This directory contains the source code for the Image Retriever backend, a TypeScript-based system for fetching, qualifying, and downloading images from various providers.

## File Structure & Contents

### Root Files (`src/`)
- `orchestrator.ts`: The central coordination logic. It manages the multi-turn retrieval loop, calls providers, runs the qualification pipeline, and handles the final selection and download.
- `server.ts`: Express.js server that provides a web API (`/api/retrieve`) and serves the frontend and downloaded images.
- `index.ts`: CLI entry point for running the tool from the terminal.
- `config.ts`: Global configuration, including API keys and default settings, loaded from environment variables.
- `downloader.ts`: Logic for downloading images from URLs and saving them locally.
- `manifest.ts`: Generates JSON metadata (manifests) for each downloaded image.
- `comparator.ts`: Utility for selecting the best candidate from a list based on scores.
- `*.test.ts`: Various test files (e.g., `e2e.test.ts`, `orchestration.test.ts`, `comparator.test.ts`).

### Providers (`src/providers/`)
- `index.ts`: Provider registry and factory (`getProviders`).
- `base-provider.ts`: Abstract interface that all image providers (Unsplash, Google) must implement.
- `unsplash-client.ts`: Implementation for the Unsplash Search API.
- `google-client.ts`: Implementation for the Google Custom Search API.

### Qualification Pipeline (`src/qualification/`)
- `pipeline.ts`: Coordinates the scoring process, running candidates through multiple scorers.
- `config.ts`: Configuration for scoring weights and thresholds (e.g., minimum score to pass).
- `relevance-scorer.ts`: Scores images based on text similarity (Stage 1) and AI Visual analysis (Stage 2) against the provided context.
- `crop-fit-scorer.ts`: Scores how well an image's aspect ratio matches the requested shape (landscape, portrait, square).
- `quality-scorer.ts`: Scores images based on their resolution/pixel count.
- `safety-checker.ts`: Basic filters to ensure URLs are valid and do not point to error placeholders.
- `index.ts`: Exports all qualification components.

### Utilities & Types (`src/utils/`, `src/types/`)
- `utils/enhancer.ts`: Integration with Upscayl CLI to upscale images that are low resolution or detected as blurry.
- `types/candidate.ts`: TypeScript interfaces for `ImageCandidate` and `QualifiedCandidate`.

## Backend Flow

1.  **Entry**: A request is received via the CLI or the Web API with a query, desired shape, and context.
2.  **Orchestration**: `orchestrator.ts` starts a loop that runs for a maximum number of turns.
3.  **Retrieval Loop (per Turn)**:
    - **Fetch**: All active providers search for candidates in parallel.
    - **Stage 1 (Heuristic Scoring)**: Candidates are scored on text relevance, crop fit, and resolution.
    - **Stage 2 (AI Visual Verification)**: Each candidate is analyzed by an AI Vision model (Nvidia Nemotron via OpenRouter) to confirm relevance and check for blurriness.
    - **Selection**: The best candidate is picked based on the weighted final score.
    - **Threshold**: If the best candidate's score meets the "auto-acceptance" threshold (89+), the loop terminates early.
4.  **Final Processing**:
    - **Download**: The selected image is downloaded to the `downloads/` folder.
    - **Enhance**: If the image is small or blurry, it is automatically processed through the Upscayl CLI.
    - **Manifest**: A JSON manifest is saved alongside the image containing all scores, metadata, and attribution.
5.  **Response**: The system returns the selected image details and a list of all qualified alternatives.

