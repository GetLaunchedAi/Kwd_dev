import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { TaskStatusManager } from './taskStatusManager';
import { mapEventToStatus } from './eventMapper';
import { agentQueue } from './agentQueue';

/**
 * Process Registry: Tracks running CursorCliRunner instances by taskId
 * This allows us to kill processes when demos/tasks are cancelled
 */
const runningProcesses: Map<string, CursorCliRunner> = new Map();

/**
 * Registers a runner instance in the process registry
 */
function registerRunner(taskId: string, runner: CursorCliRunner): void {
    // If there's already a runner for this taskId, cancel it first
    const existing = runningProcesses.get(taskId);
    if (existing) {
        logger.warn(`[ProcessRegistry] Replacing existing runner for task ${taskId}`);
        existing.cancel('SIGTERM');
    }
    runningProcesses.set(taskId, runner);
    logger.info(`[ProcessRegistry] Registered runner for task ${taskId} (total: ${runningProcesses.size})`);
}

/**
 * Unregisters a runner instance from the process registry
 */
function unregisterRunner(taskId: string): void {
    if (runningProcesses.delete(taskId)) {
        logger.info(`[ProcessRegistry] Unregistered runner for task ${taskId} (total: ${runningProcesses.size})`);
    }
}

/**
 * Kills a running task by taskId
 * @param taskId - The task ID to kill
 * @param signal - The signal to send (default: SIGTERM)
 * @returns true if a process was found and killed, false otherwise
 */
export function killRunningTask(taskId: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const runner = runningProcesses.get(taskId);
    if (runner) {
        logger.info(`[ProcessRegistry] Killing runner for task ${taskId} with signal ${signal}`);
        runner.cancel(signal);
        return true;
    }
    
    // Also check for demo step tasks (e.g., demo-xyz-step2)
    // If killing "demo-xyz", also kill any step variants
    if (taskId.startsWith('demo-')) {
        let killed = false;
        for (const [registeredTaskId, runner] of runningProcesses.entries()) {
            if (registeredTaskId.startsWith(taskId)) {
                logger.info(`[ProcessRegistry] Killing related runner ${registeredTaskId} for task ${taskId}`);
                runner.cancel(signal);
                killed = true;
            }
        }
        if (killed) return true;
    }
    
    logger.debug(`[ProcessRegistry] No runner found for task ${taskId}`);
    return false;
}

/**
 * Gets the count of currently running processes
 */
export function getRunningProcessCount(): number {
    return runningProcesses.size;
}

/**
 * Gets the list of currently running task IDs
 */
export function getRunningTaskIds(): string[] {
    return Array.from(runningProcesses.keys());
}

/**
 * Checks if a task is currently running
 */
export function isTaskRunning(taskId: string): boolean {
    return runningProcesses.has(taskId);
}

/**
 * Resolves the absolute path to cursor-agent binary on Linux.
 * This is necessary because non-login shells (like when spawning with shell: true)
 * don't load .bashrc/.profile, so npm global bin paths aren't in PATH.
 * 
 * NOTE: cursor-agent authentication is handled via one-time interactive login
 * (cursor-agent login) under the PM2 user account, NOT via API keys.
 * 
 * @returns The absolute path to cursor-agent, or null if not found
 */
function resolveLinuxAgentBinary(): string | null {
    // If CURSOR_AGENT_BIN is set and exists, use it directly
    if (process.env.CURSOR_AGENT_BIN) {
        if (existsSync(process.env.CURSOR_AGENT_BIN)) {
            logger.info(`Using CURSOR_AGENT_BIN from env: ${process.env.CURSOR_AGENT_BIN}`);
            return process.env.CURSOR_AGENT_BIN;
        }
        logger.warn(`CURSOR_AGENT_BIN set but file not found: ${process.env.CURSOR_AGENT_BIN}`);
    }

    const home = homedir();
    
    // Common locations where cursor-agent might be installed
    // Priority: production hardcoded path first
    const candidatePaths = [
        '/home/master/.local/bin/cursor-agent',               // Cloudways production path (hardcoded)
        join(home, '.local', 'bin', 'cursor-agent'),          // Default install location
        join(home, '.cursor', 'bin', 'cursor-agent'),         // Cursor-specific location
        '/usr/local/bin/cursor-agent',                         // System-wide install
        '/usr/bin/cursor-agent',                               // System install
    ];

    // Try to find npm global bin directory dynamically
    try {
        const npmGlobalBin = execSync('npm bin -g 2>/dev/null', { encoding: 'utf8' }).trim();
        if (npmGlobalBin) {
            candidatePaths.push(join(npmGlobalBin, 'cursor-agent'));
        }
    } catch {
        // npm not available or command failed, skip
    }

    // Also try to resolve via which (in case it's in a standard PATH location)
    try {
        const whichResult = execSync('which cursor-agent 2>/dev/null', { encoding: 'utf8' }).trim();
        if (whichResult && existsSync(whichResult)) {
            logger.info(`Found cursor-agent via which: ${whichResult}`);
            return whichResult;
        }
    } catch {
        // which failed, continue checking candidate paths
    }

    // Check each candidate path
    for (const candidatePath of candidatePaths) {
        if (existsSync(candidatePath)) {
            logger.info(`Found cursor-agent at: ${candidatePath}`);
            return candidatePath;
        }
    }

    logger.error(`cursor-agent not found. Checked paths: ${candidatePaths.join(', ')}`);
    return null;
}

/**
 * Builds a clean environment for cursor-agent that strips API key variables.
 * cursor-agent requires one-time interactive login via `cursor-agent login`,
 * NOT API key authentication. If CURSOR_API_KEY is present, the agent will
 * try to use it and fail with "API key is invalid."
 * 
 * @param baseEnv - Optional additional environment variables to merge
 * @returns Clean environment object safe for cursor-agent
 */
function buildAgentEnv(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const agentEnv: NodeJS.ProcessEnv = { ...process.env, ...baseEnv };
    
    // CRITICAL: cursor-agent must NOT receive API-key auth variables
    // If these exist, the agent tries to use them instead of machine login
    // and fails with "API key is invalid"
    delete agentEnv.CURSOR_API_KEY;
    delete agentEnv.CURSOR_API_TOKEN;
    
    return agentEnv;
}

/**
 * Verifies cursor-agent is authenticated by running `cursor-agent whoami`.
 * 
 * cursor-agent requires one-time interactive login via `cursor-agent login`
 * under the PM2 user account. This function checks that login was completed.
 * 
 * @param binaryPath - Absolute path to cursor-agent binary
 * @returns Object with isAuthenticated boolean and optional error message
 */
async function verifyCursorAgentAuth(binaryPath: string): Promise<{ isAuthenticated: boolean; error?: string; user?: string }> {
    return new Promise((resolve) => {
        // Use clean env without API keys so whoami uses machine login
        const checkEnv = buildAgentEnv();
        
        const checkProcess = spawn(binaryPath, ['whoami'], {
            shell: false,
            timeout: 15000,
            env: checkEnv,
        });
        
        let stdout = '';
        let stderr = '';
        let settled = false;
        
        const timeoutId = setTimeout(() => {
            if (!settled) {
                settled = true;
                checkProcess.kill('SIGKILL');
                resolve({ isAuthenticated: false, error: 'Authentication check timed out after 15s' });
            }
        }, 15000);
        
        checkProcess.stdout?.on('data', (data) => { stdout += data.toString(); });
        checkProcess.stderr?.on('data', (data) => { stderr += data.toString(); });
        
        checkProcess.on('exit', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            
            if (code === 0 && stdout.trim()) {
                // Successfully got user info - agent is logged in
                logger.info(`cursor-agent authenticated as: ${stdout.trim()}`);
                resolve({ isAuthenticated: true, user: stdout.trim() });
            } else {
                // Non-zero exit or empty output means not authenticated
                const errorMsg = stderr.trim() || stdout.trim() || `Exit code ${code}`;
                resolve({ isAuthenticated: false, error: errorMsg });
            }
        });
        
        checkProcess.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve({ isAuthenticated: false, error: `Failed to run whoami: ${err.message}` });
        });
    });
}

export interface RunResult {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    durationMs: number;
    logFilePath: string;
    outputPaths?: string[];
    error?: string;
    modelError?: boolean;
    failedModel?: string;
}

export interface RunnerCallbacks {
    onEvent?: (event: any) => void;
    onStderr?: (line: string) => void;
    onExit?: (exitCode: number | null, signal: NodeJS.Signals | null) => void;
    onRawLine?: (line: string) => void;
}

export interface CursorRunnerOptions {
    workspacePath: string;
    taskId: string;
    prompt: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    callbacks?: RunnerCallbacks;
    model?: string;
}

export class CursorCliRunner extends EventEmitter {
    private childProcess: ChildProcess | null = null;
    private startTime: number = 0;
    private logFilePath: string = '';
    private timeoutId: NodeJS.Timeout | null = null;
    private isCancelled: boolean = false;
    private outputPaths: string[] = [];
    private statusManager: TaskStatusManager;

    constructor(private options: CursorRunnerOptions) {
        super();
        this.statusManager = new TaskStatusManager(options.workspacePath);
        const logsDir = join(options.workspacePath, 'logs', 'tasks', options.taskId);
        if (!existsSync(logsDir)) {
            mkdirSync(logsDir, { recursive: true });
        }
        this.logFilePath = join(logsDir, `runner-${Date.now()}.log`);
    }

    public async run(): Promise<RunResult> {
        this.startTime = Date.now();
        const { workspacePath, prompt, env, timeoutMs, callbacks } = this.options;
        const taskId = this.options.taskId;

        // Initialize status
        await this.statusManager.initialize();

        // REQUIREMENT: If the repo is not a Git repository, gracefully fail before launching the agent.
        if (!existsSync(join(workspacePath, '.git'))) {
            const errorMsg = `Error: ${workspacePath} is not a Git repository. Cursor agent requires a Git repository to track changes and commit work.`;
            logger.error(errorMsg);
            await this.statusManager.updateStatus(taskId, {
                state: 'FAILED',
                percent: 0,
                step: 'Git check failed',
                error: errorMsg,
                exitCode: -1
            });
            return {
                exitCode: -1,
                signal: null,
                durationMs: Date.now() - this.startTime,
                logFilePath: this.logFilePath,
                error: errorMsg
            };
        }

        logger.info(`Workspace opened: ${workspacePath}`);

        await this.statusManager.updateStatus(taskId, {
            state: 'RUNNING',
            step: 'Pre-flight checks',
            percent: 5,
            startedAt: new Date().toISOString()
        });

        let agentCommand = process.env.CURSOR_AGENT_BIN ?? 'cursor-agent';
        
        // REQUIREMENT: Use 'chat' mode for autonomous execution instead of just passing a prompt file.
        // This ensures the agent understands it needs to execute the task fully.
        const executionPrompt = `Open the CURSOR_TASK.md file and follow the instructions there.`;
        
        logger.info(`Execution instruction sent for task ${taskId}: ${executionPrompt}`);

        let args = [
            'chat',
            executionPrompt,
            '--force',
            '--output-format', 'stream-json',
            '--stream-partial-output'
        ];

        // Add model selection if specified
        const selectedModel = this.options.model || config.cursor.defaultModel;
        if (selectedModel) {
            args.push('--model', selectedModel);
            logger.info(`Using AI model: ${selectedModel} for task ${taskId}`);
        }

        // Build clean environment for cursor-agent (strips CURSOR_API_KEY/TOKEN)
        // CRITICAL: cursor-agent must NOT see API key vars or it ignores machine login
        const agentEnv = buildAgentEnv(env);
        
        // Default spawn options - shell: false with absolute binary path for reliability
        // Using shell: true breaks PATH resolution on non-login shells (Cloudways, etc.)
        let spawnOptions: any = {
            cwd: workspacePath,
            env: agentEnv,
            shell: false,  // CRITICAL: shell: false ensures we use the resolved binary directly
        };

        // Platform-specific binary resolution and preflight checks
        if (config.cursor.useWsl && process.platform === 'win32') {
            const wslDistro = config.cursor.wslDistribution || 'Ubuntu';
            logger.info(`WSL mode active: running cursor-agent in ${wslDistro}`);
            
            const agentCmd = `~/.local/bin/${agentCommand}`;
            
            // Pre-flight check: verify cursor-agent exists in WSL (with PATH setup)
            logger.info(`Checking if cursor-agent exists in WSL at ${agentCmd}...`);
            try {
                // Use same PATH export as the actual command
                // NOTE: PATH must be quoted in WSL because Windows PATH segments often contain spaces
                const checkCmd = `export PATH="$HOME/.local/bin:$PATH"; if [ -f "${agentCmd}" ] || command -v cursor-agent >/dev/null 2>&1; then echo EXISTS; else echo NOT_FOUND; fi`;
                
                const checkResult = await new Promise<string>((resolve, reject) => {
                    const checkProcess = spawn('wsl', [
                        '-d', wslDistro,
                        'bash', '-c',
                        checkCmd
                    ], { shell: false });
                    
                    let output = '';
                    let errorOutput = '';
                    let settled = false;
                    
                    // Longer timeout (15s) and properly cleared to avoid race conditions
                    const timeoutId = setTimeout(() => {
                        if (!settled) {
                            settled = true;
                            checkProcess.kill();
                            reject(new Error('Check timeout'));
                        }
                    }, 15000);
                    
                    checkProcess.stdout?.on('data', (data) => { output += data.toString(); });
                    checkProcess.stderr?.on('data', (data) => { errorOutput += data.toString(); });
                    checkProcess.on('exit', (code) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeoutId);
                        if (code === 0) resolve(output.trim());
                        else reject(new Error(`Check failed with code ${code}: ${errorOutput}`));
                    });
                    checkProcess.on('error', (err) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeoutId);
                        reject(err);
                    });
                });
                
                if (checkResult !== 'EXISTS') {
                    const errorMsg = `cursor-agent not found in WSL at ${agentCmd}.\n\nTo install cursor-agent in WSL:\n1. Open WSL terminal: wsl -d ${wslDistro}\n2. Run: curl https://cursor.com/install -fsS | bash\n3. Or manually place cursor-agent binary in ~/.local/bin/\n\nAlternatively, set useWsl: false in config.json to run cursor-agent on Windows.`;
                    logger.error(errorMsg);
                    
                    await this.statusManager.updateStatus(taskId, {
                        state: 'FAILED',
                        percent: 0,
                        step: 'Pre-flight check failed',
                        error: errorMsg,
                        exitCode: -1
                    });
                    
                    // Also update queue status
                    try {
                        await agentQueue.completeTask(false, errorMsg, taskId);
                        // Trigger next queued task since this one failed early
                        const { processNextQueuedTask } = await import('./agentCompletionDetector');
                        await processNextQueuedTask();
                    } catch (queueErr) {
                        logger.warn(`Could not update queue markers: ${queueErr}`);
                    }
                    
                    return {
                        exitCode: -1,
                        signal: null,
                        durationMs: Date.now() - this.startTime,
                        logFilePath: this.logFilePath,
                        error: errorMsg
                    };
                }
                
                logger.info('cursor-agent found in WSL, proceeding...');
            } catch (checkError: any) {
                const errorMsg = `Failed to verify cursor-agent in WSL: ${checkError.message}`;
                logger.error(errorMsg);
                
                await this.statusManager.updateStatus(taskId, {
                    state: 'FAILED',
                    percent: 0,
                    step: 'Pre-flight check error',
                    error: errorMsg,
                    exitCode: -1
                });
                
                // Also update queue status
                try {
                    await agentQueue.completeTask(false, errorMsg, taskId);
                    // Trigger next queued task since this one failed early
                    const { processNextQueuedTask } = await import('./agentCompletionDetector');
                    await processNextQueuedTask();
                } catch (queueErr) {
                    logger.warn(`Could not update queue markers: ${queueErr}`);
                }
                
                return {
                    exitCode: -1,
                    signal: null,
                    durationMs: Date.now() - this.startTime,
                    logFilePath: this.logFilePath,
                    error: errorMsg
                };
            }

            // Reconstruct command for WSL
            // CRITICAL: bash -c requires a single quoted string containing the entire command
            // Pattern: wsl bash -c "export PATH=...; exec cursor-agent ..."
            
            // NOTE: PATH must be quoted in WSL because Windows PATH segments often contain spaces
            // NOTE: No CURSOR_API_KEY - cursor-agent uses interactive login auth, not API keys
            // The WSL user must run `cursor-agent login` once to authenticate
            const envExports = 'export PATH="$HOME/.local/bin:$PATH"';
            
            // Build cursor-agent command with properly escaped arguments
            const escapedArgs = args.map(a => {
                // Escape single quotes in each argument for bash
                const escaped = a.replace(/'/g, "'\\''");
                return `'${escaped}'`;
            }).join(' ');
            
            // The entire command must be a single string passed to bash -c
            // Using exec to replace bash process with cursor-agent
            const fullBashCmd = `echo "BASH_STARTING"; ${envExports}; echo "BASH_ENV_READY"; exec "${agentCmd}" ${escapedArgs}`;
            logger.info(`WSL command length: ${fullBashCmd.length} chars`);

            const wslArgs = [
                '-d', wslDistro,
                '--cd', workspacePath,
                'bash', '-c',
                fullBashCmd  // This becomes a single argument to bash -c
            ];
            
            agentCommand = 'wsl';
            args = wslArgs;
            spawnOptions.shell = false;  // Critical: shell=false ensures args are passed correctly
            delete spawnOptions.cwd;
        } else if (process.platform === 'linux' || process.platform === 'darwin') {
            // LINUX/MACOS: Resolve absolute binary path
            // This is CRITICAL because shell: false requires an absolute path,
            // and non-login shells don't have npm global bin in PATH
            logger.info(`Linux/macOS detected, resolving cursor-agent binary path...`);
            
            const resolvedBinary = resolveLinuxAgentBinary();
            
            if (!resolvedBinary) {
                const errorMsg = `cursor-agent not found on this system.\n\nTo install cursor-agent:\n  curl https://cursor.com/install -fsS | bash\n\nOr set CURSOR_AGENT_BIN environment variable to the absolute path of the cursor-agent binary.\n\nCommon install locations:\n  ~/.local/bin/cursor-agent\n  /usr/local/bin/cursor-agent`;
                logger.error(errorMsg);
                
                await this.statusManager.updateStatus(taskId, {
                    state: 'FAILED',
                    percent: 0,
                    step: 'Pre-flight check failed',
                    error: errorMsg,
                    exitCode: -1
                });
                
                // Also update queue status
                try {
                    await agentQueue.completeTask(false, errorMsg, taskId);
                    const { processNextQueuedTask } = await import('./agentCompletionDetector');
                    await processNextQueuedTask();
                } catch (queueErr) {
                    logger.warn(`Could not update queue markers: ${queueErr}`);
                }
                
                return {
                    exitCode: -1,
                    signal: null,
                    durationMs: Date.now() - this.startTime,
                    logFilePath: this.logFilePath,
                    error: errorMsg
                };
            }
            
            // Use the resolved absolute path - shell: false is already set above
            agentCommand = resolvedBinary;
            logger.info(`Using resolved cursor-agent binary: ${agentCommand}`);
            
            // PREFLIGHT CHECK: Verify cursor-agent is authenticated via `cursor-agent whoami`
            // NOTE: cursor-agent uses one-time interactive login (cursor-agent login),
            // NOT API key authentication. The PM2 user must run `cursor-agent login` once.
            logger.info(`Verifying cursor-agent authentication via whoami...`);
            const authCheck = await verifyCursorAgentAuth(resolvedBinary);
            
            if (!authCheck.isAuthenticated) {
                const errorMsg = `cursor-agent is not authenticated.\n\nError: ${authCheck.error}\n\nTo authenticate cursor-agent:\n1. SSH into the server as the PM2 user (e.g., master)\n2. Run: ${resolvedBinary} login\n3. Complete the interactive authentication flow\n4. Restart PM2: pm2 restart all\n\nNOTE: cursor-agent does NOT support API key authentication.\nAuthentication is stored in the user's home directory after login.`;
                logger.error(errorMsg);
                
                await this.statusManager.updateStatus(taskId, {
                    state: 'FAILED',
                    percent: 0,
                    step: 'Authentication check failed',
                    error: errorMsg,
                    exitCode: -1
                });
                
                // Also update queue status
                try {
                    await agentQueue.completeTask(false, errorMsg, taskId);
                    const { processNextQueuedTask } = await import('./agentCompletionDetector');
                    await processNextQueuedTask();
                } catch (queueErr) {
                    logger.warn(`Could not update queue markers: ${queueErr}`);
                }
                
                return {
                    exitCode: -1,
                    signal: null,
                    durationMs: Date.now() - this.startTime,
                    logFilePath: this.logFilePath,
                    error: errorMsg
                };
            }
            
            logger.info(`cursor-agent authenticated as: ${authCheck.user}`);
            
            // NOTE: No CURSOR_API_KEY injection - cursor-agent uses interactive login auth
        } else if (process.platform === 'win32') {
            // WINDOWS (non-WSL): Use shell: true since Windows PATH handling is different
            // Windows cmd.exe properly resolves PATH even in non-login contexts
            spawnOptions.shell = true;
            logger.info(`Windows detected (non-WSL mode), using shell: true`);
            
            // NOTE: No CURSOR_API_KEY injection - cursor-agent uses interactive login auth
            // The user must run `cursor-agent login` once to authenticate
        }

        logger.info(`Starting ${agentCommand} for task ${this.options.taskId} in ${workspacePath}`);
        
        // Log spawn arguments for debugging
        logger.debug(`Spawn arguments: ${JSON.stringify(args)}`);
        logger.debug(`Spawn options: ${JSON.stringify({ ...spawnOptions, env: '...' })}`);
        
        // Build command for status display
        const sanitizedCommand = `${agentCommand} ${args.join(' ')}`;
        this.statusManager.updateStatus(taskId, { command: sanitizedCommand }).catch(() => {});
        
        // Register this runner in the process registry BEFORE spawning
        // This allows killing the task even if spawn fails or takes time
        registerRunner(taskId, this);

        return new Promise((resolve) => {
            try {
                this.childProcess = spawn(agentCommand, args, spawnOptions);

                logger.debug(`Child process spawned with PID: ${this.childProcess.pid}`);
                if (!this.childProcess.stdout) logger.warn(`Child process stdout is NULL`);
                if (!this.childProcess.stderr) logger.warn(`Child process stderr is NULL`);

                if (this.childProcess.pid) {
                    logger.info(`Agent running: ${agentCommand} with PID ${this.childProcess.pid}`);
                    this.statusManager.updateStatus(taskId, { pid: this.childProcess.pid }).catch(() => {});
                    
                    // NEW: Close stdin to ensure the process doesn't wait for input
                    this.childProcess.stdin?.end();
                    logger.debug(`Closed stdin for task ${taskId}`);
                }

                const logStream = createWriteStream(this.logFilePath, { flags: 'a' });

                if (timeoutMs && timeoutMs > 0) {
                    this.timeoutId = setTimeout(() => {
                        logger.warn(`Task ${this.options.taskId} timed out after ${timeoutMs}ms`);
                        this.cancel('SIGTERM');
                    }, timeoutMs);
                }

                let stdoutRemainder = '';
                let lastOutputTime = Date.now();
                
                // Heartbeat monitor: disabled to avoid race conditions with agent
                // agent handles its own heartbeat and status updates
                
                this.childProcess.stdout?.on('data', async (data: Buffer) => {
                    const chunk = data.toString();
                    logger.debug(`[Agent Stdout Chunk] [${taskId}] ${chunk.length} bytes received`);
                    logStream.write(chunk);
                    lastOutputTime = Date.now();
                    
                    const lines = (stdoutRemainder + chunk).split('\n');
                    stdoutRemainder = lines.pop() || '';

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue;

                        // NEW: Always log output to the main system logger for visibility
                        logger.debug(`[Agent Stdout] [${taskId}] ${trimmedLine}`);

                        if (callbacks?.onRawLine) {
                            callbacks.onRawLine(trimmedLine);
                        }

                        try {
                            const event = JSON.parse(trimmedLine);
                            if (callbacks?.onEvent) {
                                callbacks.onEvent(event);
                            }
                            this.emit('event', event);

                            // Status updates disabled to avoid race conditions with agent
                            // agent handles its own status updates in current.json
                            await this.statusManager.appendLog(taskId, event);

                            // Try to detect output paths from events if available
                            if (event.type === 'file_change' && event.path) {
                                this.outputPaths.push(event.path);
                            }
                        } catch (e) {
                            // If not JSON, just treat as raw output
                            await this.statusManager.appendLog(taskId, trimmedLine);
                            if (callbacks?.onEvent) {
                                callbacks.onEvent(trimmedLine);
                            }
                            this.emit('event', trimmedLine);
                        }
                    }
                });

                this.childProcess.stderr?.on('data', async (data: Buffer) => {
                    const chunk = data.toString();
                    logger.debug(`[Agent Stderr Chunk] [${taskId}] ${chunk.length} bytes received`);
                    logStream.write(`STDERR: ${chunk}`);
                    
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine) {
                            // NEW: Log stderr to the main system logger
                            logger.warn(`[Agent Stderr] [${taskId}] ${trimmedLine}`);

                            if (callbacks?.onStderr) {
                                callbacks.onStderr(trimmedLine);
                            }
                            this.emit('stderr', trimmedLine);
                            await this.statusManager.appendStderr(taskId, trimmedLine);
                        }
                    }
                });

                this.childProcess.on('exit', async (code, signal) => {
                    logger.info(`Agent exited: task ${taskId} finished with code ${code} and signal ${signal}`);
                    
                    // CRITICAL: Unregister from process registry immediately on exit
                    unregisterRunner(taskId);
                    
                    if (this.timeoutId) {
                        clearTimeout(this.timeoutId);
                    }
                    logStream.end();

                    const durationMs = Date.now() - this.startTime;
                    const result: RunResult = {
                        exitCode: code,
                        signal: signal as NodeJS.Signals,
                        durationMs,
                        logFilePath: this.logFilePath,
                        outputPaths: [...new Set(this.outputPaths)], // De-duplicate
                    };

                    let state: 'DONE' | 'FAILED' = code === 0 ? 'DONE' : 'FAILED';
                    let error: string | null = null;

                    if (this.isCancelled) {
                        result.error = 'Process cancelled';
                        state = 'FAILED';
                        error = 'Process cancelled';
                        logger.warn(`Task ${taskId} was cancelled.`);
                    } else if (code !== 0 && code !== null) {
                        result.error = `Process exited with non-zero code: ${code}`;
                        state = 'FAILED';
                        error = result.error;
                        logger.error(`Task ${taskId} failed with exit code ${code}. Check agent logs for details.`);
                    } else if (code === 0) {
                        logger.info(`Task ${taskId} finished successfully (code 0).`);
                    }

                    // Detect model-specific errors for frontend handling
                    if (result.error && (
                        result.error.toLowerCase().includes('model') ||
                        result.error.includes('unavailable') ||
                        result.error.includes('not supported')
                    )) {
                        result.modelError = true;
                        result.failedModel = this.options.model;
                        logger.warn(`Model error detected for task ${taskId}: ${result.failedModel}`);
                    }

                    await this.statusManager.updateStatus(taskId, {
                        state,
                        percent: 100,
                        step: state === 'DONE' ? 'Completed' : 'Failed',
                        exitCode: code,
                        error
                    });

                    // Update queue markers
                    try {
                        await agentQueue.completeTask(code === 0, error || undefined, taskId);
                    } catch (queueErr) {
                        logger.warn(`Could not update queue markers for task ${taskId}: ${queueErr}`);
                    }

                    if (callbacks?.onExit) {
                        callbacks.onExit(code, signal as NodeJS.Signals);
                    }
                    this.emit('exit', code, signal);
                    resolve(result);
                });

                this.childProcess.on('error', (err) => {
                    logger.error(`Failed to start cursor-agent: ${err.message}`);
                    
                    // CRITICAL: Unregister from process registry on spawn error
                    unregisterRunner(taskId);
                    
                    if (this.timeoutId) {
                        clearTimeout(this.timeoutId);
                    }
                    logStream.end();
                    
                    const durationMs = Date.now() - this.startTime;
                    resolve({
                        exitCode: null,
                        signal: null,
                        durationMs,
                        logFilePath: this.logFilePath,
                        error: `Spawn error: ${err.message}`
                    });
                });

            } catch (err: any) {
                logger.error(`Error in runner setup: ${err.message}`);
                
                // CRITICAL: Unregister from process registry on setup error
                unregisterRunner(taskId);
                
                resolve({
                    exitCode: null,
                    signal: null,
                    durationMs: 0,
                    logFilePath: this.logFilePath,
                    error: `Setup error: ${err.message}`
                });
            }
        });
    }

    public cancel(signal: NodeJS.Signals = 'SIGTERM'): void {
        if (!this.childProcess || this.childProcess.killed) {
            return;
        }

        this.isCancelled = true;
        logger.info(`Cancelling task ${this.options.taskId} with ${signal}`);

        if (process.platform === 'win32') {
            const { exec } = require('child_process');
            exec(`taskkill /pid ${this.childProcess.pid} /T /F`, (error: any) => {
                if (error) {
                    logger.error(`Failed to kill process ${this.childProcess?.pid}: ${error.message}`);
                }
            });
        } else {
            // Send signal to process group if possible
            try {
                process.kill(-(this.childProcess.pid as number), signal);
            } catch (e) {
                this.childProcess.kill(signal);
            }

            // Fallback to SIGKILL after a short delay if it doesn't die
            setTimeout(() => {
                if (this.childProcess && !this.childProcess.killed) {
                    logger.warn(`Process ${this.childProcess.pid} didn't exit after ${signal}, sending SIGKILL`);
                    try {
                        process.kill(-(this.childProcess.pid as number), 'SIGKILL');
                    } catch (e) {
                        this.childProcess.kill('SIGKILL');
                    }
                }
            }, 2000);
        }
    }

    public getLogFilePath(): string {
        return this.logFilePath;
    }

    public async getLastLogLines(n: number = 50): Promise<string[]> {
        if (!existsSync(this.logFilePath)) {
            return [];
        }

        try {
            const { readFileSync } = require('fs');
            const content = readFileSync(this.logFilePath, 'utf-8');
            const lines = content.split('\n');
            return lines.slice(-n);
        } catch (err) {
            logger.error(`Failed to read log file: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
}

