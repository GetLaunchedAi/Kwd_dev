# ImageRetriever Integration Guide

## Overview

The ImageRetriever tool has been integrated into the KWD Dev workflow to enable automated, AI-powered image sourcing for demo websites. This integration allows Cursor agents to find, qualify, and download high-quality, contextually relevant images during the demo creation process.

## Architecture

### Components

1. **ImageRetriever Tool** (`ImageRetriever/`)
   - Standalone TypeScript application
   - Multi-provider image search (Unsplash, Google Images)
   - AI-powered relevance scoring and visual verification
   - Automatic image enhancement (upscaling for low-res images)
   - CLI and web interface

2. **ImageRetrieverService** (`src/utils/imageRetrieverService.ts`)
   - Service wrapper for the main workflow
   - Handles dependency installation
   - Provides programmatic API for image retrieval
   - Generates agent instructions

3. **Prompt Templates** (`prompts/`)
   - Updated to include ImageRetriever usage instructions
   - Step 3 (Imagery) has detailed ImageRetriever guide
   - All steps mention ImageRetriever availability

4. **Helper Scripts** (`scripts/`)
   - `retrieve-image.sh` - Bash helper script
   - `retrieve-image.ps1` - PowerShell helper script
   - Interactive and command-line modes

5. **Documentation** (`prompts/imageretriever_guide.md`)
   - Comprehensive guide for AI agents
   - Usage examples and best practices
   - Troubleshooting tips

## Integration Points

### 1. Demo Creation Workflow

The ImageRetriever is integrated into the demo creation process via `demoHandler.ts`:

```typescript
// ImageRetriever path is added to context
const imageRetrieverPath = imageRetrieverService.getImageRetrieverPath();

const context = {
  ...data,
  imageRetrieverPath, // Available in all prompt templates
  // ... other context
};
```

### 2. Prompt Templates

All prompt templates now include the `{{imageRetrieverPath}}` placeholder, which gets replaced with the absolute path to the ImageRetriever tool.

**Step 1: Branding & Identity**
- ImageRetriever available for additional branding assets

**Step 2: Copywriting & Content**
- Can note image needs for next agent
- ImageRetriever available if needed

**Step 3: Imagery & Visuals** ⭐ *Primary usage*
- Detailed instructions on using ImageRetriever
- Examples and best practices
- Integration with asset placement workflow

**Step 4: Final Review & QA**
- ImageRetriever available for replacing low-quality images
- Can fix image issues found during review

### 3. Programmatic Usage

The `ImageRetrieverService` can be used programmatically in TypeScript:

```typescript
import { imageRetrieverService } from './utils/imageRetrieverService';

// Check availability
const available = await imageRetrieverService.isAvailable();

// Retrieve an image
const result = await imageRetrieverService.retrieveImage({
  query: 'modern bakery interior',
  shape: 'landscape',
  context: 'Family-owned bakery specializing in artisan bread',
  outputPath: './client-websites/my-client/src/assets/images',
  maxTurns: 5
});

if (result.success) {
  console.log(`Image downloaded: ${result.filename}`);
  console.log(`Manifest: ${result.manifestPath}`);
} else {
  console.error(`Failed: ${result.error}`);
}
```

## How It Works

### Image Retrieval Flow

```
1. Agent reads CURSOR_TASK.md with ImageRetriever instructions
2. Agent determines need for specific image (e.g., hero, service section)
3. Agent constructs appropriate query, shape, and context
4. Agent runs ImageRetriever CLI:
   cd {{imageRetrieverPath}}
   npm start -- --query "..." --shape landscape --context "..." --output "..."
5. ImageRetriever searches providers in parallel
6. Candidates are scored on relevance, quality, aspect ratio
7. AI vision model verifies image relevance
8. Best candidate is downloaded and enhanced if needed
9. Image and metadata manifest saved to output directory
10. Agent updates HTML/template to reference new image
```

### Scoring System

Images are evaluated on multiple dimensions:

- **Relevance (40%)**: Text and AI vision matching
- **Crop Fit (30%)**: Aspect ratio match to requested shape
- **Quality (20%)**: Resolution and dimensions
- **Safety (10%)**: URL validity and technical checks

**Threshold**: 70/100 minimum score
**Auto-accept**: 89/100+ for instant selection

### Enhancement Pipeline

Low-resolution or blurry images are automatically enhanced:
- Uses Upscayl CLI for AI-powered upscaling
- Improves quality for images <1200x800
- Handles blurry image detection and correction

## Usage Examples

### Example 1: Retrieve Hero Image

```bash
cd ImageRetriever
npm start -- \
  --query "professional plumbing services truck" \
  --shape landscape \
  --context "Family-owned plumbing company serving residential clients for over 20 years" \
  --output "../client-websites/reliable-plumbing/src/assets/images"
```

### Example 2: Using Helper Script (Interactive)

```bash
# Bash
./scripts/retrieve-image.sh

# PowerShell
.\scripts\retrieve-image.ps1
```

Follow the interactive prompts.

### Example 3: Using Helper Script (Command-line)

```bash
# Bash
./scripts/retrieve-image.sh "bakery fresh bread" landscape "Artisan bakery" "./output"

# PowerShell
.\scripts\retrieve-image.ps1 "bakery fresh bread" landscape "Artisan bakery" ".\output"
```

### Example 4: Multiple Images for Website

```bash
cd ImageRetriever

# Hero image
npm start -- --query "modern dental office" --shape landscape \
  --context "Modern dental practice" --output "../client-websites/smile-dental/assets/images"

# About section  
npm start -- --query "friendly dentist patient" --shape square \
  --context "Experienced dental team" --output "../client-websites/smile-dental/assets/images"

# Services background
npm start -- --query "dental equipment close-up" --shape landscape \
  --context "Advanced dental technology" --output "../client-websites/smile-dental/assets/images"
```

## Agent Instructions

Agents working on the Imagery step should:

1. **Read the business context** from CURSOR_TASK.md
2. **Identify image needs** across the website (hero, sections, backgrounds)
3. **For each image need:**
   - Determine appropriate query based on content
   - Choose correct shape (landscape/portrait/square)
   - Provide detailed context for relevance scoring
   - Run ImageRetriever CLI
   - Verify download success and check manifest
4. **Update templates** to reference new images with proper alt text
5. **Document results** in workflow summary for next agent

## File Outputs

### Downloaded Image

- Filename: `{provider}-{id}-{timestamp}.{ext}`
- Example: `unsplash-abc123.jpg`
- Enhanced if needed: `unsplash-abc123-upscaled.jpg`

### Metadata Manifest

- Filename: `{provider}-{id}-{timestamp}.json`
- Contains:
  - Search parameters (query, shape, context)
  - Selected image details (URL, photographer, title)
  - All scores (relevance, quality, crop fit, final)
  - Dimensions and technical details
  - Attribution information
  - Alternative candidates considered

Example manifest:
```json
{
  "query": "bakery interior",
  "shape": "landscape",
  "context": "Modern artisan bakery",
  "selected": {
    "provider": "unsplash",
    "id": "abc123",
    "title": "Bakery Display Case",
    "photographer": "Jane Smith",
    "url": "https://unsplash.com/photos/abc123",
    "downloadUrl": "https://images.unsplash.com/...",
    "scores": {
      "relevance": 85,
      "cropFit": 92,
      "quality": 88,
      "safety": 100,
      "final": 87
    },
    "width": 2400,
    "height": 1600,
    "aiVerified": true,
    "isBlurry": false
  },
  "filename": "unsplash-abc123.jpg",
  "turn": 2,
  "retrievedAt": "2026-01-08T12:00:00.000Z"
}
```

## Configuration

### Environment Variables

ImageRetriever requires API keys in `.env`:

```env
# Required
UNSPLASH_ACCESS_KEY=your_unsplash_key
GOOGLE_SEARCH_API_KEY=your_google_key
GOOGLE_SEARCH_CX=your_search_engine_id

# Optional - for AI vision verification
OPENROUTER_API_KEY=your_openrouter_key
```

### Config Settings

Located in `ImageRetriever/src/config.ts`:

```typescript
{
  maxTurns: 5,                    // Maximum retrieval attempts
  defaultOutputFolder: './downloads',
  qualificationThreshold: 70,     // Minimum score to accept
  autoAcceptThreshold: 89,        // Score for instant selection
  providers: {
    unsplash: { enabled: true },
    google: { enabled: true }
  }
}
```

## Troubleshooting

### Common Issues

**Issue**: "ImageRetriever directory not found"
- **Cause**: Incorrect path or missing directory
- **Solution**: Verify `ImageRetriever/` exists in project root

**Issue**: "No suitable image found after N turns"
- **Cause**: Query too specific, low-quality results, or API issues
- **Solution**: 
  - Try broader query
  - Increase `--turns` parameter
  - Check API keys and rate limits
  - Review context for clarity

**Issue**: "Failed to install dependencies"
- **Cause**: npm issues, network problems, or missing node_modules
- **Solution**: 
  - Manually run `npm install` in ImageRetriever directory
  - Check npm and Node.js versions
  - Clear npm cache: `npm cache clean --force`

**Issue**: Images are low quality or wrong aspect ratio
- **Cause**: Scoring weights, provider limitations, or shape mismatch
- **Solution**:
  - Verify shape parameter is correct
  - Check manifest to see scores and why image was selected
  - Try different providers or queries
  - Enhancement should auto-upscale low-res images

### Debug Tips

1. **Check the manifest**: Review scores to understand why an image was selected
2. **Review alternatives**: Manifest includes other candidates considered
3. **Test queries**: Try variations of your search query
4. **Provider status**: Ensure API keys are valid and not rate-limited
5. **Logs**: Check ImageRetriever console output for detailed logs

## Best Practices

### Query Construction

✅ **Good**: "modern dental office waiting room"
❌ **Poor**: "dentist" (too vague)

✅ **Good**: "artisan bakery bread display"
❌ **Poor**: "food" (too broad)

### Context Writing

✅ **Good**: "Family-owned Italian restaurant serving authentic pasta and wood-fired pizza in downtown Boston since 1985"
❌ **Poor**: "restaurant" (minimal context)

### Shape Selection

- **Landscape**: Headers, heroes, banners, wide sections (16:9, 21:9)
- **Square**: Icons, profiles, thumbnails, social media (1:1)
- **Portrait**: Sidebars, mobile-first, vertical sections (9:16, 2:3)

### Performance

- Use `--turns 3` for quick results (acceptable quality)
- Use `--turns 5` for balanced quality/speed (default)
- Use `--turns 7-10` for maximum quality (thorough search)

## Future Enhancements

Potential improvements:

1. **Caching**: Cache search results to avoid re-fetching
2. **Batch mode**: Retrieve multiple images in one command
3. **Custom providers**: Add more image sources (Pexels, Pixabay, etc.)
4. **Size presets**: Pre-defined size optimizations for web
5. **Format conversion**: Automatic WebP conversion for modern browsers
6. **A/B testing**: Return multiple options for agent to choose from
7. **Local AI**: Use local vision models instead of API calls

## Support & Resources

- **ImageRetriever README**: `ImageRetriever/README.md`
- **Backend Details**: `ImageRetriever/src/BACKEND_README.md`
- **Frontend Guide**: `ImageRetriever/public/FRONTEND_README.md`
- **Agent Guide**: `prompts/imageretriever_guide.md`
- **API Documentation**: See source code in `ImageRetriever/src/`

## Maintenance

### Updating ImageRetriever

```bash
cd ImageRetriever
git pull  # if it's a git submodule
npm install
npm run build
```

### Adding New Providers

1. Create provider class in `ImageRetriever/src/providers/`
2. Implement `BaseProvider` interface
3. Register in `ImageRetriever/src/providers/index.ts`
4. Add API keys to `.env`
5. Update configuration

### Modifying Scoring Weights

Edit `ImageRetriever/src/qualification/config.ts`:

```typescript
export const scoringWeights = {
  relevance: 0.4,  // 40%
  cropFit: 0.3,    // 30%
  quality: 0.2,    // 20%
  safety: 0.1      // 10%
};
```

## Conclusion

The ImageRetriever integration provides powerful, automated image sourcing capabilities for the demo creation workflow. By leveraging AI-powered search, relevance scoring, and visual verification, it ensures high-quality, contextually appropriate images are used in every demo website.

For questions or issues, refer to the documentation files listed above or consult the source code.

---

**Version**: 1.0.0  
**Last Updated**: January 8, 2026  
**Author**: KWD Dev Team





