# ClickUp to Cursor Workflow Tool

Automated workflow tool that receives ClickUp tasks via webhooks, triggers Cursor's agent to make code changes, runs tests, and manages approval workflow before pushing to GitHub.

## Features

- Receives ClickUp webhooks for task status changes
- Automatically finds and opens client website folders
- Triggers Cursor agent to make code changes
- Runs automated tests
- Sends approval notifications via email/Slack
- Pushes approved changes to GitHub

## Setup

See the plan file for detailed setup instructions.

## Quick Start

1. Install dependencies: `npm install`
2. Configure `.env` file with your tokens
3. Configure `config/config.json`
4. Build: `npm run build`
5. Start: `npm start` (or use PM2 for production)

## License

MIT















