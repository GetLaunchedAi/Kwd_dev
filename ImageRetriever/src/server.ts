import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { retrieveImage, ImagePickerInput } from './orchestrator.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Serve the downloaded images
const downloadsDir = path.resolve(__dirname, '../downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}
app.use('/downloads', express.static(downloadsDir));

app.post('/api/retrieve', async (req, res) => {
  const { query, shape, context } = req.body;

  if (!query || !shape || !context) {
    return res.status(400).json({ error: 'Missing required parameters: query, shape, context' });
  }

  const input: ImagePickerInput = {
    imageQuery: query,
    shape: shape as 'landscape' | 'portrait' | 'square',
    relatedText: context,
    outputFolder: downloadsDir,
    maxTurns: 5,
  };

  try {
    const result = await retrieveImage(input);
    if (result.selected) {
      res.json({
        success: true,
        image: result.selected,
        imageUrl: `/downloads/${result.selected.url}`,
        options: result.options
      });
    } else {
      res.status(404).json({ 
        success: false, 
        message: 'No suitable image found after max turns.',
        options: result.options
      });
    }
  } catch (error) {
    console.error('Error in /api/retrieve:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

