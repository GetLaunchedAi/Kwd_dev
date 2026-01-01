import { spawn, exec } from 'child_process';
import { readFileSync, existsSync, createWriteStream, appendFileSync } from 'fs';
import { join } from 'path';

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
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:24',message:'Attempting to kill process group',data:{pid: pid, platform: process.platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (process.platform === 'win32') {
        // On Windows, use taskkill to terminate the process and its children.
        // /T: Terminate child processes
        // /F: Force terminate
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:32',message:'Using taskkill on Windows',data:{pid: pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        return new Promise((resolve, reject) => {
            exec(`taskkill /pid ${pid} /T /F`, (error, stdout, stderr) => {
                if (error) {
                    // #region agent log
                    fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:39',message:'taskkill error',data:{pid: pid, error: error.message, stderr: stderr},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                    reject(error);
                } else {
                    // #region agent log
                    fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:44',message:'taskkill successful',data:{pid: pid, stdout: stdout},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                    resolve();
                }
            });
        });
    } else {
        // On Unix-like systems, use process.kill with negative PID for process groups.
        try {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:54',message:'Using SIGTERM on Unix-like system',data:{pid: pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            process.kill(-pid, 'SIGTERM'); // Kill the process group

            await new Promise(resolve => setTimeout(resolve, 100)); // Give some time for graceful shutdown

            // Check if the process is still alive
            try {
                // #region agent log
                fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:64',message:'Checking if process group still alive',data:{pid: pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                // #endregion
                process.kill(-pid, 0); // Check if process group exists
                // If it's still alive, escalate to SIGKILL
                console.warn(`Process group ${pid} did not terminate with SIGTERM, escalating to SIGKILL.`);
                // #region agent log
                fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:70',message:'Escalating to SIGKILL',data:{pid: pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                // #endregion
                process.kill(-pid, 'SIGKILL');
            } catch (error: any) {
                if (error.code === 'ESRCH') {
                    // #region agent log
                    fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:77',message:'Process group already dead after SIGTERM',data:{pid: pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                    // #endregion
                    // Process group already dead
                    return;
                } else {
                    // #region agent log
                    fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:83',message:'Error checking process group status',data:{pid: pid, error: error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                    // #endregion
                    throw error;
                }
            }
        } catch (error: any) {
            if (error.code === 'ESRCH') {
                // #region agent log
                fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:91',message:'Process already dead or no such process',data:{pid: pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                // #endregion
                // Process already dead, or no such process
                return;
            } else {
                console.error(`Error killing process group ${pid}:`, error);
                // #region agent log
                fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:99',message:'Error during process group kill attempt',data:{pid: pid, error: error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:119',message:'runCursorAgent called',data:{repoPath: repoPath, promptFilePath: promptFilePath, timeoutMs: timeoutMs},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (!existsSync(promptFilePath)) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:123',message:'Prompt file not found',data:{promptFilePath: promptFilePath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        throw new Error(`Prompt file not found: ${promptFilePath}`);
    }
    if (!promptFilePath.endsWith('.md')) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:129',message:'Prompt file not markdown',data:{promptFilePath: promptFilePath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        throw new Error(`Prompt file must be a markdown file: ${promptFilePath}`);
    }

    const logFilePath = join(repoPath, `cursor-agent-log-${Date.now()}.txt`);
    const promptContent = readFileSync(promptFilePath, 'utf-8');
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:137',message:'Prompt content loaded',data:{promptFilePath: promptFilePath, contentLen: promptContent.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const agentCommand = process.env.CURSOR_AGENT_BIN ?? 'cursor-agent';
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:149',message:'Spawning agent process',data:{command: agentCommand, repoPath: repoPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        const agentProcess = spawn(agentCommand, [
            'chat',
            `--print=${promptContent}`,
        ], {
            cwd: repoPath,
            env: {
                ...process.env,
            },
            // Do not use `shell: true` or `detached: true` for predictable signals and timeout behavior.
            // Instead, manage process groups manually for reliable killing of child processes.
        });

        if (agentProcess.pid === undefined) {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:167',message:'Agent process failed to start, PID is undefined',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            return reject(new Error('Failed to start agent process: PID is undefined'));
        }
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:172',message:'Agent process started',data:{pid: agentProcess.pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion

        const logStream = createWriteStream(logFilePath, { flags: 'a' });

        const timeoutId = timeoutMs > 0 ? setTimeout(async () => {
            timedOut = true;
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:181',message:'Timeout reached, attempting to kill process',data:{pid: agentProcess.pid!},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
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
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:203',message:'Agent process closed',data:{exitCode: exitCode, signal: signal, timedOut: timedOut},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            logStream.end();
            const durationMs = Date.now() - startTime;
            resolve({ stdout, stderr, exitCode, signal, timedOut, logFilePath, durationMs });
        });

        agentProcess.on('error', async (err) => {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:216',message:'Agent process error',data:{error: err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            logStream.end();
            stderr += err.message;
            logStream.write(`AGENT ERROR: ${err.message}`); // Write error to log stream
            // Attempt to kill the process group if an error occurs early and the process is still running
            if (agentProcess.pid) {
                // #region agent log
                fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cliWrapper.ts:228',message:'Attempting to kill process group on error',data:{pid: agentProcess.pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                await killProcessGroup(agentProcess.pid);
            }
            const durationMs = Date.now() - startTime;
            reject({ stdout, stderr, exitCode: null, signal: null, timedOut: false, logFilePath, durationMs });
        });
    });
}
