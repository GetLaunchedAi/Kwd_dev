# ImageRetriever CLI Tool Guide for AI Agents

## Overview

The ImageRetriever CLI tool is an automated media sourcing system that finds, qualifies, and downloads high-quality images and videos from multiple providers (Unsplash, Google, Pexels, Pixabay, Vecteezy). It uses AI-powered relevance scoring and visual verification to ensure media matches your requirements.

## When to Use ImageRetriever

Use ImageRetriever when you need to:
- Find images for hero sections, banners, or headers
- Source videos for background animations or feature demonstrations
- Get imagery for service descriptions or features
- Find relevant stock media that matches business context
- Replace generic placeholder content with contextually relevant media

## Installation & Setup

### Global Installation (Recommended)

```bash
cd path/to/kwd_image_retriever
npm install
npm run build
npm link
```

Now you can use `kwd-image` from anywhere on your system.

### Verify Installation

```bash
kwd-image --version
kwd-image --help
```

## Basic Usage

### Image Retrieval

```bash
kwd-image image -q "search term" -s landscape -c "description" -o "./output/path"
```

### Video Retrieval

```bash
kwd-image video -q "search term" -s landscape -c "description" --min 5 --max 30 --ideal 15 -o "./output/path"
```

## Required Parameters (Both Image & Video)

1. **-q, --query** (string)
   - The search query for media providers
   - Be specific but not overly restrictive
   - Examples: "ocean waves sunset", "modern office workspace", "coffee shop interior"

2. **-s, --shape** (landscape | portrait | square)
   - `landscape`: Wide media for headers, heroes, banners (16:9, 21:9, etc.)
   - `portrait`: Tall media for sidebars, mobile layouts (9:16, 2:3, etc.)
   - `square`: Perfect squares for thumbnails, social posts (1:1)

3. **-c, --context** (string)
   - Related text for AI relevance scoring
   - Include business description, page content, or section purpose
   - The more context, the better the relevance scoring
   - Examples: "Meditation app background video for relaxation feature"

## Optional Parameters

### Image Options

- **-o, --output** (path, default: `./downloads`)
  - Directory where the image will be saved
  
- **-t, --turns** (number, default: 5)
  - Maximum number of retrieval attempts
  - Range: 1-10 recommended

- **-m, --model** (string, default: `nvidia/nemotron-nano-12b-v2-vl:free`)
  - AI vision model for grading

### Video Options

All image options plus:

- **--min** (number, default: 0)
  - Minimum duration in seconds

- **--max** (number, default: 60)
  - Maximum duration in seconds

- **--ideal** (number, default: 30)
  - Target duration in seconds (videos closer to this score higher)

- **--ai** (flag, default: false)
  - Include AI-generated content in results

## How ImageRetriever Works

### Multi-Stage Pipeline

1. **Provider Search**: Queries multiple sources in parallel (Unsplash, Google, Pexels, Pixabay, Vecteezy)
2. **Text-Based Scoring**: Evaluates title, description, and tags for relevance
3. **Aspect Ratio Scoring**: Checks how well the media fits the requested shape
4. **Quality Scoring**: Considers resolution and dimensions (videos also scored on duration fit)
5. **AI Vision Verification**: Uses AI to visually verify relevance and quality
6. **Selection**: Picks the best candidate based on weighted scores
7. **Download**: Saves media and metadata manifest

### Scoring System

Media is scored on a 0-100 scale:
- **Relevance Score**: How well content matches the context (40% weight)
- **Crop Fit Score**: How well aspect ratio matches shape (30% weight)
- **Quality Score**: Resolution and size/duration considerations (20% weight)
- **Safety Score**: Technical validation (10% weight)

**Passing Threshold**: Media must score 70+ to be considered
**Auto-Accept Threshold**: Media scoring 89+ are immediately accepted

## Practical Examples

### Example 1: Hero Image for a Bakery

```bash
kwd-image image \
  -q "artisan bakery fresh bread pastries" \
  -s landscape \
  -c "Sunny Side Bakery - Family-owned bakery specializing in fresh artisan bread and custom cakes" \
  -o "../sunny-side-bakery/src/assets/images"
```

### Example 2: Background Video for Meditation App

```bash
kwd-image video \
  -q "ocean waves peaceful sunset" \
  -s landscape \
  -c "Meditation app background for relaxation and mindfulness exercises" \
  --min 10 \
  --max 30 \
  --ideal 20 \
  -o "../meditation-app/public/videos"
```

### Example 3: Service Section Square Image

```bash
kwd-image image \
  -q "professional plumber working pipes" \
  -s square \
  -c "Professional plumbing services including repairs, installations, and emergency service" \
  -o "../reliable-plumbing/public/img/services"
```

### Example 4: Product Demo Video (Short Duration)

```bash
kwd-image video \
  -q "coffee brewing espresso machine" \
  -s portrait \
  -c "Coffee shop showcasing specialty espresso drinks" \
  --min 5 \
  --max 15 \
  --ideal 10 \
  -o "../coffee-shop/assets/videos"
```

### Example 5: Fast Retrieval with Limited Turns

```bash
kwd-image image \
  -q "modern office building" \
  -s landscape \
  -c "Commercial real estate company headquarters" \
  -t 1 \
  -o "./images"
```

### Example 6: Multiple Media for Website Sections

```bash
# Hero video
kwd-image video -q "city timelapse traffic" -s landscape -c "Urban transportation service" --max 20 -o "./media"

# About section image
kwd-image image -q "professional team meeting" -s square -c "Experienced team collaboration" -o "./media"

# Services background image
kwd-image image -q "modern workspace desk" -s landscape -c "Professional office environment" -o "./media"
```

## Output & Results

### Downloaded Files

After successful retrieval, you'll find:

1. **Media File**: 
   - Images: `provider-id.jpg` (e.g., `unsplash-abc123.jpg`)
   - Videos: `provider-id.mp4` (e.g., `pexels-1234567.mp4`)

2. **Manifest File**: `provider-id.json`
   - Contains metadata, scores, and attribution
   - Includes AI vision analysis results

### Sample Manifest (Video)

```json
{
  "query": "ocean waves",
  "shape": "landscape",
  "context": "Meditation app background",
  "selected": {
    "provider": "pexels",
    "id": "1757800",
    "title": "Ocean Waves at Sunset",
    "photographer": "Taryn Elliott",
    "url": "https://www.pexels.com/video/1757800/",
    "duration": 15,
    "width": 1920,
    "height": 1080,
    "scores": {
      "relevance": 90,
      "cropFit": 95,
      "quality": 88,
      "safety": 100,
      "final": 91
    },
    "aiVerified": true,
    "aiScore": 90
  },
  "filename": "pexels-1757800.mp4",
  "retrievedAt": "2026-01-09T18:00:00.000Z"
}
```

## Best Practices

### Writing Good Queries

✅ **Good Queries:**
- "ocean waves crashing beach sunset"
- "professional barista making coffee"
- "modern dental office waiting room"

❌ **Poor Queries:**
- "nice video" (too vague)
- "the absolute best ocean waves in the entire world" (too complex)
- "water" (needs more context)

### Choosing the Right Shape

- **Landscape**: Hero sections, page headers, full-width backgrounds (most common for web)
- **Square**: Social media, thumbnails, grid layouts (Instagram-style)
- **Portrait**: Mobile-first layouts, stories, vertical video (TikTok/Reels style)

### Video Duration Guidelines

- **Short (5-15s)**: Product demos, UI animations, social media clips
- **Medium (15-30s)**: Hero backgrounds, feature demonstrations
- **Long (30-60s)**: Detailed showcases, about videos, full-screen backgrounds

### Providing Good Context

✅ **Good Context:**
- "Family-owned Italian restaurant serving authentic pasta and pizza since 1985"
- "Fitness app hero video showing workout motivation and healthy lifestyle"

❌ **Poor Context:**
- "Restaurant" (too brief)
- "Video for website" (not descriptive)

### Handling Failures

If ImageRetriever doesn't find suitable media:

1. **Try a different query**: Be more specific or use synonyms
2. **Adjust the shape**: Some queries work better with different aspect ratios
3. **Modify context**: Add more specific details
4. **Increase turns**: Use `-t 7` or `-t 10` for more attempts
5. **Adjust video duration**: Widen the range with `--min 0 --max 60`
6. **Enable AI content**: Add `--ai` flag for videos (if appropriate)

## Troubleshooting

### Common Issues

**Issue**: "No suitable image/video found after 5 turns"
- **Solution**: Try a broader query or increase `-t` parameter

**Issue**: "Error: Invalid shape. Must be one of: landscape, portrait, square"
- **Solution**: Check spelling and use lowercase shape values

**Issue**: Videos are wrong duration
- **Solution**: Adjust `--min`, `--max`, and `--ideal` parameters

**Issue**: AI Vision scoring errors (502 errors)
- **Solution**: Tool automatically retries, but transient API errors may occur; run again if needed

**Issue**: Command not found: kwd-image
- **Solution**: Run `npm link` in the kwd_image_retriever directory

### Debug Mode

Check the manifest JSON file to see:
- Final scores and AI verification results
- Alternative options that were considered
- Why certain media was rejected
- Full metadata and attribution

## Integration Examples

### Programmatic Usage (Node.js)

After installing as a local dependency with `npm install /path/to/kwd_image_retriever`:

```javascript
import { retrieveImage, retrieveVideo } from 'imageretriever';

// Retrieve image
const imageResult = await retrieveImage({
  imageQuery: 'sunset beach',
  shape: 'landscape',
  relatedText: 'Travel blog hero image',
  outputFolder: './images',
  maxTurns: 5
});

// Retrieve video
const videoResult = await retrieveVideo({
  videoQuery: 'ocean waves',
  shape: 'landscape',
  relatedText: 'Meditation app background',
  outputFolder: './videos',
  minDuration: 10,
  maxDuration: 30,
  idealDuration: 20,
  maxTurns: 5
});

if (imageResult.selected) {
  console.log(`Image saved: ${imageResult.selected.url}`);
}
```

### Shell Command from Another Project

```javascript
import { execSync } from 'child_process';

try {
  const output = execSync(
    'kwd-image image -q "cats" -s "square" -c "pet blog header"',
    { encoding: 'utf-8' }
  );
  console.log(output);
} catch (error) {
  console.error('Image retrieval failed:', error.message);
}
```

## Attribution & Licensing

- **Unsplash**: Free to use under Unsplash License (https://unsplash.com/license)
- **Pexels**: Free to use under Pexels License (https://www.pexels.com/license/)
- **Pixabay**: Free to use under Pixabay License (https://pixabay.com/service/license/)
- **Vecteezy**: Free to use under Vecteezy License (https://www.vecteezy.com/licensing-agreement)
- **Google Images**: Results may vary in licensing - check source before commercial use

Always check the manifest file for attribution information and source URLs.

## Advanced Tips

### Optimize for Speed
- Use `-t 1` or `-t 2` for faster results
- Target Unsplash or Pexels specifically by using their naming style in queries

### Maximize Quality
- Use `-t 7` or higher for thorough searching
- Provide detailed, specific context
- Review manifest to see alternative options and scores

### Batch Processing Script

```bash
#!/bin/bash

# Retrieve all media for a restaurant website
kwd-image image -q "restaurant interior elegant" -s landscape -c "Fine dining restaurant" -o "./media"
kwd-image image -q "chef cooking kitchen" -s square -c "Professional chef preparing dishes" -o "./media"
kwd-image video -q "food plating gourmet" -s landscape -c "Restaurant presentation" --max 15 -o "./media"
kwd-image image -q "wine glasses dining" -s portrait -c "Wine selection showcase" -o "./media"
```

## Unlinking from Another Project

To remove the old version from another project and link the updated version:

```bash
# In the project using the old version
cd /path/to/your-project
npm unlink imageretriever

# Then link the new version
npm link imageretriever
```

## Support

For issues with the ImageRetriever CLI:
1. Check the README.md and LOCAL_DOWNLOAD.md in the kwd_image_retriever directory
2. Review error messages in console output
3. Examine manifest files for score details
4. Consult BACKEND_README.md for technical architecture details

---

**Version**: 1.0.0  
**CLI Command**: `kwd-image`  
**Package Name**: `imageretriever`  
**Last Updated**: January 2026

