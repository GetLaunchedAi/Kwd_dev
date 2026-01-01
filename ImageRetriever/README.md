# Image Retriever Tool

A Node.js/TypeScript tool that fetches candidate images from several providers (Unsplash, Google), qualifies them through a multi-stage pipeline, and iteratively selects the best match for download.

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables:
   - Copy `.env.example` to `.env`.
   - Add your API keys for the supported providers (Unsplash, Google).

## Usage

### Command Line Interface

Run the tool using the following command:

```bash
npm start -- --query "sunset" --shape landscape --context "beautiful sunset on beach" --output ./images
```

### Web Interface

You can also use the tool through a web browser. For more detailed information about the frontend structure and flow, see [public/FRONTEND_README.md](public/FRONTEND_README.md).

1. Start the server:
   ```bash
   npm run serve
   ```
2. Open your browser and navigate to `http://localhost:3000`.

### Options (CLI)

- `-q, --query <string>`: Search query for image providers.
- `-s, --shape <type>`: Desired image shape (`landscape`, `portrait`, `square`).
- `-c, --context <string>`: Related text for relevance scoring.
- `-o, --output <path>`: Where to save the image (default: `./downloads`).
- `-t, --turns <number>`: Maximum number of retrieval turns (default: `5`).

## Development

- Build: `npm run build`
- Dev mode: `npm run dev`
- Test: `npm run test`

## Architecture

The tool is divided into 3 main agents:

1. **Provider API Integration**: Fetches candidates from supported providers (Unsplash, Google).
2. **Qualification Pipeline**: Scores candidates based on relevance, crop fit, quality, and safety.
3. **Orchestration & Selection**: Manages the retrieval loop, compares candidates, and handles downloads.

