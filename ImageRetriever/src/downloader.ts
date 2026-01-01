import axios from 'axios';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { QualifiedCandidate } from './types/candidate.js';

export async function downloadImage(
  candidate: QualifiedCandidate,
  outputFolder: string
): Promise<string> {
  // Ensure output folder exists
  if (!fs.existsSync(outputFolder)) {
    await fsPromises.mkdir(outputFolder, { recursive: true });
  }

  const url = candidate.url;
  const extension = path.extname(new URL(url).pathname) || '.jpg';
  const filename = `${candidate.provider}-${candidate.id}${extension}`;
  const filePath = path.join(outputFolder, filename);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  const writer = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    let error: Error | null = null;
    writer.on('error', (err) => {
      error = err;
      writer.close();
      reject(err);
    });
    writer.on('close', () => {
      if (!error) {
        resolve(filename);
      }
    });
  });
}

