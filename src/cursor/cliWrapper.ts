import { spawn, exec, execSync, spawnSync } from 'child_process';
import { readFileSync, existsSync, createWriteStream, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

/**
 * Verifies cursor-agent is authenticated by running `cursor-agent whoami`.
 * 
 * cursor-agent requires one-time interactive login via `cursor-agent login`
 * under the PM2 user account. This function checks that login was completed.
 * 
 * @param binaryPath - Absolute path to cursor-agent binary
 * @returns Object with isAuthenticated boolean and optional error message
 */
function verifyCursorAgentAuth(binaryPath: string): { isAuthenticated: boolean; error?: string; user?: string } {
    try {
        const result = spawnSync(binaryPath, ['whoami'], {
            timeout: 15000,
            encoding: 'utf8',
        });
        
        if (result.status === 0 && result.stdout && result.stdout.trim()) {
            console.log(`cursor-agent authenticated as: ${result.stdout.trim()}`);
            return { isAuthenticated: true, user: result.stdout.trim() };
        } else {
            const errorMsg = result.stderr?.trim() || result.stdout?.trim() || `Exit code ${result.status}`;
            return { isAuthenticated: false, error: errorMsg };
        }
    } catch (err: any) {
        return { isAuthenticated: false, error: `Failed to run whoami: ${err.message}` };
    }
}

interface CursorAgentResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    logFilePath: string;
    durationMs: number;
}

/**
 * Kills a process group, escalating from SIGTERM to SIGKILL if necessary (Unix-like) or using taskkill (Windows).
 * @param pid The process ID of the group leader.
 * @param timeoutMs The time to wait for SIGTERM before sending SIGKILL.
 */
async function killProcessGroup(pid: number, timeoutMs: number = 5000): Promise<void> {
    if (process.platform === 'win32') {
        // On Windows, use taskkill to terminate the process and its children.
        // /T: Terminate child processes
        // /F: Force terminate
        return new Promise((resolve, reject) => {
            exec(`taskkill /pid ${pid} /T /F`, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    } else {
        // On Unix-like systems, use process.kill with negative PID for process groups.
        try {
            process.kill(-pid, 'SIGTERM'); // Kill the process group

            await new Promise(resolve => setTimeout(resolve, 100)); // Give some time for graceful shutdown

            // Check if the process is still alive
            try {
                process.kill(-pid, 0); // Check if process group exists
                // If it's still alive, escalate to SIGKILL
                console.warn(`Process group ${pid} did not terminate with SIGTERM, escalating to SIGKILL.`);
                process.kill(-pid, 'SIGKILL');
            } catch (error: any) {
                if (error.code === 'ESRCH') {
                    // Process group already dead
                    return;
                } else {
                    throw error;
                }
            }
        } catch (error: any) {
            if (error.code === 'ESRCH') {
                // Process already dead, or no such process
                return;
            } else {
                console.error(`Error killing process group ${pid}:`, error);
                throw error;
            }
        }
    }
}

/**
 * Runs the cursor-agent programmatically within a target repository.
 * @param repoPath The path to the target repository directory.
 * @param promptFilePath The path to the markdown file containing the prompt.
 * @param timeoutMs Optional. The maximum time in milliseconds to wait for the agent to complete. Defaults to 0 (no timeout).
 * @returns A Promise that resolves with the CursorAgentResult.
 */
export async function runCursorAgent(
    repoPath: string,
    promptFilePath: string,
    timeoutMs: number = 0
): Promise<CursorAgentResult> {
    if (!existsSync(promptFilePath)) {
        throw new Error(`Prompt file not found: ${promptFilePath}`);
    }
    if (!promptFilePath.endsWith('.md')) {
        throw new Error(`Prompt file must be a markdown file: ${promptFilePath}`);
    }

    const logFilePath = join(repoPath, `cursor-agent-log-${Date.now()}.txt`);

    // REQUIREMENT: If the repo is not a Git repository, gracefully fail before launching the agent.
    if (!existsSync(join(repoPath, '.git'))) {
        const errorMsg = `Error: ${repoPath} is not a Git repository. Cursor agent requires a Git repository to track changes and commit work.`;
        console.error(errorMsg);
        return {
            stdout: '',
            stderr: errorMsg,
            exitCode: -1,
            signal: null,
            timedOut: false,
            logFilePath,
            durationMs: 0
        };
    }

    console.log(`Workspace opened: ${repoPath}`);

    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        // Determine cursor-agent command
        // Note: cursor-agent is a separate CLI tool, not part of Cursor IDE
        // Install: curl https://cursor.com/install -fsS | bash
        let agentCommand = process.env.CURSOR_AGENT_BIN ?? 'cursor-agent';
        let useShell = false;  // Default to shell: false for reliability
        
        // Platform-specific binary resolution
        // CRITICAL: On Linux, shell: true breaks PATH resolution in non-login shells
        if (process.platform === 'linux' || process.platform === 'darwin') {
            // Try to resolve absolute path on Linux/macOS
            const home = homedir();
            const candidatePaths = [
                process.env.CURSOR_AGENT_BIN,
                '/home/master/.local/bin/cursor-agent',       // Cloudways production path (hardcoded)
                join(home, '.local', 'bin', 'cursor-agent'),
                join(home, '.cursor', 'bin', 'cursor-agent'),
                '/usr/local/bin/cursor-agent',
                '/usr/bin/cursor-agent',
            ].filter(Boolean) as string[];

            // Try which command first
            try {
                const whichResult = execSync('which cursor-agent 2>/dev/null', { encoding: 'utf8' }).trim();
                if (whichResult && existsSync(whichResult)) {
                    agentCommand = whichResult;
                    console.log(`Found cursor-agent via which: ${agentCommand}`);
                }
            } catch {
                // which failed, check candidate paths
                let found = false;
                for (const path of candidatePaths) {
                    if (existsSync(path)) {
                        agentCommand = path;
                        console.log(`Found cursor-agent at: ${agentCommand}`);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    throw new Error(`cursor-agent not found. Install: curl https://cursor.com/install -fsS | bash\nOr set CURSOR_AGENT_BIN environment variable to absolute path.\nChecked: ${candidatePaths.join(', ')}`);
                }
            }
            
            // PREFLIGHT CHECK: Verify cursor-agent is authenticated via `cursor-agent whoami`
            // NOTE: cursor-agent uses one-time interactive login (cursor-agent login),
            // NOT API key authentication. The PM2 user must run `cursor-agent login` once.
            console.log(`Verifying cursor-agent authentication via whoami...`);
            const authCheck = verifyCursorAgentAuth(agentCommand);
            
            if (!authCheck.isAuthenticated) {
                throw new Error(`cursor-agent is not authenticated.\n\nError: ${authCheck.error}\n\nTo authenticate cursor-agent:\n1. SSH into the server as the PM2 user (e.g., master)\n2. Run: ${agentCommand} login\n3. Complete the interactive authentication flow\n4. Restart PM2: pm2 restart all\n\nNOTE: cursor-agent does NOT support API key authentication.\nAuthentication is stored in the user's home directory after login.`);
            }
            
            console.log(`cursor-agent authenticated as: ${authCheck.user}`);
        } else if (process.platform === 'win32') {
            // Windows: shell: true works fine because cmd.exe handles PATH properly
            useShell = true;
            // Verify cursor-agent exists
            try {
                execSync('where cursor-agent', { stdio: 'ignore' });
            } catch {
                throw new Error('cursor-agent not found. On Windows, install via WSL: curl https://cursor.com/install -fsS | bash\nOr set CURSOR_AGENT_BIN environment variable.');
            }
        }

        // REQUIREMENT: Use 'chat' mode for autonomous execution instead of just passing a prompt file.
        const executionPrompt = `Open the CURSOR_TASK.md file and follow the instructions there.`;
        
        console.log(`Execution instruction sent: ${executionPrompt}`);

        const agentProcess = spawn(agentCommand, [
            'chat',
            executionPrompt,
            '--force',
        ], {
            cwd: repoPath,
            env: {
                ...process.env,
            },
            shell: useShell,  // shell: false on Linux to avoid PATH issues in non-login shells
            // Do not use `detached: true` for predictable signals and timeout behavior.
            // Instead, manage process groups manually for reliable killing of child processes.
        });

        if (agentProcess.pid === undefined) {
            return reject(new Error('Failed to start agent process: PID is undefined'));
        }

        console.log(`Agent running: ${agentCommand} with PID ${agentProcess.pid}`);

        const logStream = createWriteStream(logFilePath, { flags: 'a' });

        const timeoutId = timeoutMs > 0 ? setTimeout(async () => {
            timedOut = true;
            await killProcessGroup(agentProcess.pid!); // Kill the process group
        }, timeoutMs) : null;

        agentProcess.stdout.on('data', (data) => {
            const dataStr = data.toString();
            stdout += dataStr;
            logStream.write(dataStr);
        });

        agentProcess.stderr.on('data', (data) => {
            const dataStr = data.toString();
            stderr += dataStr;
            logStream.write(`ERROR: ${dataStr}`);
        });

        agentProcess.on('close', (exitCode, signal) => {
            console.log(`Agent exited: task finished with code ${exitCode} and signal ${signal}`);
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            logStream.end();
            const durationMs = Date.now() - startTime;
            resolve({ stdout, stderr, exitCode, signal, timedOut, logFilePath, durationMs });
        });

        agentProcess.on('error', async (err) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            logStream.end();
            stderr += err.message;
            logStream.write(`AGENT ERROR: ${err.message}`); // Write error to log stream
            // Attempt to kill the process group if an error occurs early and the process is still running
            if (agentProcess.pid) {
                await killProcessGroup(agentProcess.pid);
            }
            const durationMs = Date.now() - startTime;
            reject({ stdout, stderr, exitCode: null, signal: null, timedOut: false, logFilePath, durationMs });
        });
    });
}
