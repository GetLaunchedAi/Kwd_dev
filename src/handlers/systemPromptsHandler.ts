import { Request, Response } from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';

// Base directories - use process.cwd() which points to project root
const PROMPTS_DIR = path.join(process.cwd(), 'prompts');
const BACKUPS_DIR = path.join(process.cwd(), 'backups', 'prompts');
const AUDIT_LOG_PATH = path.join(process.cwd(), 'logs', 'prompt-audit.jsonl');

/**
 * Initialize required directories for system prompts.
 * Called at server startup to ensure directories exist.
 */
export async function initSystemPromptsDirectories(): Promise<void> {
    try {
        // Ensure prompts directory exists
        if (!await fs.pathExists(PROMPTS_DIR)) {
            logger.warn(`Prompts directory not found at ${PROMPTS_DIR}. Creating it.`);
            await fs.ensureDir(PROMPTS_DIR);
        }

        // Ensure backups directory exists
        await fs.ensureDir(BACKUPS_DIR);
        
        // Ensure logs directory exists for audit log
        await fs.ensureDir(path.dirname(AUDIT_LOG_PATH));
        
        logger.info('System prompts directories initialized');
    } catch (error: any) {
        logger.error(`Failed to initialize system prompts directories: ${error.message}`);
        // Don't throw - allow server to start even if this fails
    }
}

// Define the prompt files and their metadata
const PROMPT_FILES: Record<number, { filename: string; title: string }> = {
    1: { filename: 'demo_step1_branding.md', title: 'Branding & Identity' },
    2: { filename: 'demo_step2_copywriting.md', title: 'Copywriting & Content' },
    3: { filename: 'demo_step3_imagery.md', title: 'Imagery & Visuals' },
    4: { filename: 'demo_step4_review.md', title: 'Final Review & QA' }
};

// Required placeholders that must be present in prompts
const REQUIRED_PLACEHOLDERS = ['{{taskId}}', '{{businessName}}'];

// Completion banner patterns for validation
const BANNER_PATTERNS: Record<number, RegExp> = {
    1: /STEP 1 COMPLETE.*BRANDING/i,
    2: /STEP 2 COMPLETE.*COPYWRITING/i,
    3: /STEP 3 COMPLETE.*IMAGERY/i,
    4: /STEP 4 COMPLETE.*REVIEW|STEP 4 COMPLETE.*QA/i
};

/**
 * Validates a prompt for required elements
 */
function validatePrompt(prompt: string, step: number): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Check for required placeholders
    for (const placeholder of REQUIRED_PLACEHOLDERS) {
        if (!prompt.includes(placeholder)) {
            warnings.push(`Missing required placeholder: ${placeholder}`);
        }
    }

    // Check for completion banner (warning only, not blocking)
    if (BANNER_PATTERNS[step] && !BANNER_PATTERNS[step].test(prompt)) {
        warnings.push(`Consider including a completion banner for Step ${step} (helps with detection)`);
    }

    return { valid: true, warnings };
}

/**
 * Creates a backup of the current prompts before saving
 */
async function createPromptBackup(prompts: Record<number, string>): Promise<string | null> {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await fs.ensureDir(BACKUPS_DIR);

        const backupPath = path.join(BACKUPS_DIR, `prompts-${timestamp}.json`);
        await fs.writeJson(backupPath, {
            timestamp: new Date().toISOString(),
            prompts: prompts
        }, { spaces: 2 });

        logger.info(`Created prompt backup: ${backupPath}`);
        return backupPath;
    } catch (error: any) {
        logger.warn(`Failed to create prompt backup: ${error.message}`);
        return null;
    }
}

/**
 * GET /api/system-prompts
 * Returns all system prompts as a map of step number to content
 */
export async function getSystemPrompts(req: Request, res: Response) {
    try {
        // Check if prompts directory exists
        if (!await fs.pathExists(PROMPTS_DIR)) {
            logger.error(`Prompts directory not found: ${PROMPTS_DIR}`);
            return res.status(500).json({ 
                error: 'Prompts directory not found. Please ensure the prompts folder exists in the project root.' 
            });
        }

        const prompts: Record<number, string> = {};
        const metadata: Record<number, { filename: string; title: string }> = {};

        for (const [stepStr, info] of Object.entries(PROMPT_FILES)) {
            const step = parseInt(stepStr);
            const filePath = path.join(PROMPTS_DIR, info.filename);
            
            try {
                if (await fs.pathExists(filePath)) {
                    prompts[step] = await fs.readFile(filePath, 'utf-8');
                } else {
                    prompts[step] = `# ${info.title}\n\nPrompt file not found: ${info.filename}`;
                    logger.warn(`Prompt file not found: ${filePath}`);
                }
            } catch (err: any) {
                logger.warn(`Failed to read ${filePath}: ${err.message}`);
                prompts[step] = `# ${info.title}\n\nError reading prompt file: ${err.message}`;
            }
            
            metadata[step] = info;
        }

        res.json({ prompts, metadata });
    } catch (err: any) {
        logger.error('Error loading system prompts:', err);
        res.status(500).json({ error: 'Failed to load system prompts' });
    }
}

/**
 * POST /api/system-prompts
 * Saves modified system prompts with validation and backup
 */
export async function saveSystemPrompts(req: Request, res: Response) {
    try {
        const { prompts } = req.body;
        
        // Validate input
        if (typeof prompts !== 'object' || !prompts) {
            return res.status(400).json({ error: 'Invalid prompts data' });
        }

        // Check if prompts directory exists and is writable
        if (!await fs.pathExists(PROMPTS_DIR)) {
            logger.error(`Prompts directory not found: ${PROMPTS_DIR}`);
            return res.status(500).json({ 
                error: 'Prompts directory not found. Please ensure the prompts folder exists.' 
            });
        }

        // Test write access
        try {
            const testFile = path.join(PROMPTS_DIR, '.write-test');
            await fs.writeFile(testFile, 'test');
            await fs.remove(testFile);
        } catch (writeErr: any) {
            logger.error(`Prompts directory is not writable: ${writeErr.message}`);
            return res.status(500).json({ 
                error: 'Prompts directory is not writable. Please check file permissions.' 
            });
        }

        const allWarnings: Record<number, string[]> = {};
        const savedSteps: number[] = [];

        // Load current prompts for backup
        const currentPrompts: Record<number, string> = {};
        for (const [stepStr, info] of Object.entries(PROMPT_FILES)) {
            const step = parseInt(stepStr);
            const filePath = path.join(PROMPTS_DIR, info.filename);
            if (await fs.pathExists(filePath)) {
                currentPrompts[step] = await fs.readFile(filePath, 'utf-8');
            }
        }

        // Create backup before saving
        const backupPath = await createPromptBackup(currentPrompts);

        // Validate and save each prompt
        for (const [stepStr, content] of Object.entries(prompts)) {
            const step = parseInt(stepStr);
            
            if (!PROMPT_FILES[step]) {
                logger.warn(`Invalid step number: ${step}`);
                continue;
            }
            
            if (typeof content !== 'string') {
                logger.warn(`Invalid content for step ${step}`);
                continue;
            }

            // Validate prompt
            const validation = validatePrompt(content, step);
            if (validation.warnings.length > 0) {
                allWarnings[step] = validation.warnings;
            }

            // Save the prompt
            const filePath = path.join(PROMPTS_DIR, PROMPT_FILES[step].filename);
            await fs.writeFile(filePath, content, 'utf-8');
            savedSteps.push(step);
            
            logger.info(`Saved system prompt for step ${step}: ${PROMPT_FILES[step].filename}`);
        }

        // Log the change for audit purposes
        const auditEntry = {
            timestamp: new Date().toISOString(),
            action: 'prompts_modified',
            stepsModified: savedSteps,
            backupPath
        };
        
        await fs.ensureDir(path.dirname(AUDIT_LOG_PATH));
        await fs.appendFile(AUDIT_LOG_PATH, JSON.stringify(auditEntry) + '\n');

        res.json({ 
            success: true, 
            savedSteps,
            warnings: Object.keys(allWarnings).length > 0 ? allWarnings : undefined,
            backupPath 
        });
    } catch (err: any) {
        logger.error('Error saving system prompts:', err);
        res.status(500).json({ error: `Failed to save system prompts: ${err.message}` });
    }
}

/**
 * GET /api/system-prompts/backups
 * Lists available prompt backups
 */
export async function getPromptBackups(req: Request, res: Response) {
    try {
        if (!await fs.pathExists(BACKUPS_DIR)) {
            return res.json({ backups: [] });
        }

        const files = await fs.readdir(BACKUPS_DIR);
        const backups = files
            .filter(f => f.startsWith('prompts-') && f.endsWith('.json'))
            .map(f => {
                // Parse timestamp from filename: prompts-YYYY-MM-DDTHH-mm-ss-sssZ.json
                const timestampPart = f.replace('prompts-', '').replace('.json', '');
                // Convert back to ISO format for display
                const isoTimestamp = timestampPart.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
                return {
                    filename: f,
                    timestamp: isoTimestamp
                };
            })
            .sort((a, b) => b.filename.localeCompare(a.filename))
            .slice(0, 50); // Limit to last 50 backups

        res.json({ backups });
    } catch (err: any) {
        logger.error('Error listing prompt backups:', err);
        res.status(500).json({ error: 'Failed to list prompt backups' });
    }
}

/**
 * POST /api/system-prompts/restore/:filename
 * Restores prompts from a backup file
 */
export async function restorePromptBackup(req: Request, res: Response) {
    try {
        const { filename } = req.params;
        
        // Validate filename to prevent directory traversal
        // Only allow alphanumeric, hyphens, and specific format
        if (!filename || !/^prompts-[\d\-T]+Z?\.json$/.test(filename)) {
            return res.status(400).json({ error: 'Invalid backup filename format' });
        }

        // Additional security: ensure no path separators in filename
        if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
            logger.warn(`Potential path traversal attempt with filename: ${filename}`);
            return res.status(400).json({ error: 'Invalid backup filename' });
        }

        const backupPath = path.join(BACKUPS_DIR, filename);
        
        // Verify the resolved path is still within the backups directory
        const resolvedPath = path.resolve(backupPath);
        const resolvedBackupsDir = path.resolve(BACKUPS_DIR);
        if (!resolvedPath.startsWith(resolvedBackupsDir)) {
            logger.warn(`Path traversal blocked: ${resolvedPath}`);
            return res.status(400).json({ error: 'Invalid backup filename' });
        }
        
        if (!await fs.pathExists(backupPath)) {
            return res.status(404).json({ error: 'Backup file not found' });
        }

        const backup = await fs.readJson(backupPath);
        
        if (!backup.prompts || typeof backup.prompts !== 'object') {
            return res.status(400).json({ error: 'Invalid backup file format' });
        }

        // Check prompts directory is writable before restoring
        if (!await fs.pathExists(PROMPTS_DIR)) {
            return res.status(500).json({ error: 'Prompts directory not found' });
        }

        const restoredSteps: number[] = [];

        // Restore each prompt
        for (const [stepStr, content] of Object.entries(backup.prompts)) {
            const step = parseInt(stepStr);
            
            if (!PROMPT_FILES[step] || typeof content !== 'string') {
                continue;
            }

            const filePath = path.join(PROMPTS_DIR, PROMPT_FILES[step].filename);
            await fs.writeFile(filePath, content, 'utf-8');
            restoredSteps.push(step);
            
            logger.info(`Restored system prompt for step ${step} from backup ${filename}`);
        }

        // Log the restore action
        const auditEntry = {
            timestamp: new Date().toISOString(),
            action: 'prompts_restored',
            backupFile: filename,
            stepsRestored: restoredSteps
        };
        
        await fs.ensureDir(path.dirname(AUDIT_LOG_PATH));
        await fs.appendFile(AUDIT_LOG_PATH, JSON.stringify(auditEntry) + '\n');

        res.json({ 
            success: true, 
            restoredSteps,
            message: `Restored ${restoredSteps.length} prompts from backup`
        });
    } catch (err: any) {
        logger.error('Error restoring prompt backup:', err);
        res.status(500).json({ error: `Failed to restore prompt backup: ${err.message}` });
    }
}

