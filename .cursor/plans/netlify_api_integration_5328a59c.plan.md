---
name: Netlify API Integration
overview: "Integrate Netlify API to automatically deploy demo sites after GitHub repo creation. The flow will be: (1) Create GitHub repo and push code, (2) Verify local build works (using existing buildDemo function), (3) Create Netlify site, (4) Connect Netlify to GitHub repo for continuous deployment, (5) Trigger initial build and return live URL."
todos:
  - id: create-deployment-dir
    content: Create src/deployment/ directory for netlifyPublisher.ts module
    status: pending
  - id: config-schema
    content: Add NetlifyConfig interface to src/config/config.ts and add to Config interface, update OPTIONAL_ENV_VARS
    status: pending
  - id: demo-status-interface
    content: Define DemoStatus TypeScript interface in src/handlers/demoHandler.ts with all Netlify fields
    status: pending
  - id: netlify-publisher
    content: Implement src/deployment/netlifyPublisher.ts with all stages (validation, build check, create site, configure, deploy, polling)
    status: pending
  - id: settings-backend
    content: Update GET/POST /api/settings endpoints in src/server.ts to handle Netlify config (accountSlug, tokenConfigured, buildCommand, publishDir)
    status: pending
  - id: orchestration
    content: Update src/server.ts publish endpoint to call GitHub then Netlify sequentially with proper error handling and state management
    status: pending
  - id: retry-endpoint
    content: Add POST /api/demos/:clientSlug/retry-netlify endpoint to retry failed Netlify deployments
    status: pending
  - id: settings-ui
    content: Add Netlify section to public/settings.html and settings.js (account slug, token status, build config)
    status: pending
  - id: demo-ui
    content: Update public/demo.html and demo.js to display Netlify deployment status, links, and retry button
    status: pending
  - id: error-handling
    content: "Implement edge case handlers: site name collision, timeout, partial failures, missing build script, OAuth issues"
    status: pending
  - id: testing
    content: Create unit tests for netlifyPublisher and integration tests for full publish flow
    status: pending
  - id: documentation
    content: Write NETLIFY_SETUP.md and NETLIFY_TROUBLESHOOTING.md guides with detailed instructions
    status: pending
---

