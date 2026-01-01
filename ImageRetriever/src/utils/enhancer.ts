import { exec } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { config } from '../config.js';
import fs from 'fs';

const execPromise = promisify(exec);

/**
 * Upscales an image using Upscayl CLI.
 * 
 * @param inputPath Path to the input image file.
 * @param outputFolder Folder where the upscaled image will be saved.
 * @returns Path to the upscaled image.
 */
export async function upscaleImage(inputPath: string, outputFolder: string): Promise<string> {
  const absoluteInputPath = path.resolve(inputPath);
  const absoluteOutputFolder = path.resolve(outputFolder);

  // Upscayl CLI typically outputs a file with a suffix in the same directory or specified directory.
  // Command: upscayl -i <input> -o <output_dir> -m <model>
  // We'll use the configured upscaylPath and upscaylModel.

  const model = config.upscaylModel;
  const upscaylPath = config.upscaylPath;

  console.log(`Enhancing image with Upscayl: ${inputPath}`);

  try {
    // Ensure output folder exists
    if (!fs.existsSync(absoluteOutputFolder)) {
      fs.mkdirSync(absoluteOutputFolder, { recursive: true });
    }

    const command = `"${upscaylPath}" -i "${absoluteInputPath}" -o "${absoluteOutputFolder}" -m "${model}"`;
    
    console.log(`Running command: ${command}`);
    const { stdout, stderr } = await execPromise(command);

    if (stderr && !stderr.includes('Upscayl Finished')) {
      console.warn('Upscayl stderr:', stderr);
    }

    // Upscayl CLI usually appends something like _upscayl_4x_ to the filename.
    // Let's find the most recent file in the output folder that matches the input filename.
    const inputExt = path.extname(inputPath);
    const inputBasename = path.basename(inputPath, inputExt);
    
    const files = fs.readdirSync(absoluteOutputFolder);
    const outputFiles = files.filter(f => f.startsWith(inputBasename) && f !== path.basename(inputPath));
    
    if (outputFiles.length === 0) {
      console.warn('Upscayl did not produce an output file in the expected directory.');
      return inputPath; // Fallback to original
    }

    // Sort by modification time to get the latest one
    outputFiles.sort((a, b) => {
      const aStat = fs.statSync(path.join(absoluteOutputFolder, a));
      const bStat = fs.statSync(path.join(absoluteOutputFolder, b));
      return bStat.mtime.getTime() - aStat.mtime.getTime();
    });

    const outputFilename = outputFiles[0];
    console.log(`Image enhanced successfully: ${outputFilename}`);
    return outputFilename;
  } catch (error) {
    console.error('Error during image enhancement:', error instanceof Error ? error.message : error);
    return path.basename(inputPath); // Fallback to original basename
  }
}

