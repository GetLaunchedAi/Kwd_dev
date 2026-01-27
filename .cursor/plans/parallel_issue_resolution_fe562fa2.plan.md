---
name: Parallel Issue Resolution
overview: Group issues 20-24 into 3 parallel work streams that can be addressed simultaneously without conflicts, with comprehensive edge case analysis for each stream.
todos:
  - id: stream1-port-cleanup
    content: Implement port cleanup on startApp() early exit failure
    status: completed
  - id: stream1-temp-cleanup
    content: Implement orphaned temp file cleanup routine
    status: completed
  - id: stream2-build-timeout
    content: Implement activity-based timeout for buildDemo()
    status: completed
  - id: stream2-sse-error-handling
    content: Add error boundaries and cleanup to SSE endpoints
    status: completed
  - id: stream3-file-locking
    content: Implement file-based locking for demo.context.json
    status: completed
  - id: test-all-streams
    content: Write comprehensive tests for all 3 streams
    status: pending
---

# Parallel Issue Resolution Plan

## Overview

Issues 20-24 have been analyzed and grouped into 3 independent work streams that can be executed in parallel without conflicts. Each stream addresses related problems within isolated subsystems.

---

## Work Stream 1: Resource Cleanup & Lifecycle Management

**Issues Addressed:**

- **Issue 22**: Unreleased Port in visualTesting on Early Exit
- **Issue 23**: No Cleanup of Orphaned Temp Files

### Issue 22: Port Cleanup in visualTesting

**Current Problem:**

In [`src/utils/visualTesting.ts`](src/utils/visualTesting.ts:65), the `activePorts` set tracks ports in use (line 65). If `startApp()` throws an exception before the process actually starts (e.g., invalid command, missing package.json), the port is added to `activePorts` but never removed, causing port exhaustion over time.

**Root Cause Location:**

```157:193:src/utils/visualTesting.ts
    const port = await this.findAvailablePort();
    
    // Determine start command - favor npm start if package.json exists
    let command = `npx eleventy --serve --port ${port}`;
    const packageJsonPath = path.join(folderPath, 'package.json');
    
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = await fs.readJson(packageJsonPath);
        if (pkg.scripts?.start) {
          // If using npm start, we need to pass the port somehow.
          // Most of these apps use environment variables or specific flags.
          // For simplicity, we'll try to use the port flag if it's eleventy-based
          // or just hope npm start respects a PORT env var.
          command = `npm start -- --port=${port}`;
          process.env.PORT = port.toString();
        }
      } catch (e) {
        logger.warn(`Could not read package.json in ${folderPath}, using default command`);
      }
    }

    logger.info(`Starting app in ${folderPath} on port ${port} with command: ${command}`);
    
    const instance: PreviewInstance = {
      folderPath,
      port,
      url: `http://localhost:${port}`,
      process: null as any, // Will be set below
      browser: null,
      startTime: Date.now(),
      timeoutTimer: null as any, // Will be set below
      logs: [`Starting with command: ${command}`],
      status: 'starting'
    };
    
    this.instances.set(folderPath, instance);
```

**Solution:**

- Implement try-catch wrapper around process spawn
- Ensure port is removed from `activePorts` set if process fails to start
- Add cleanup in both sync error paths and async error handlers

### Issue 23: Orphaned Temp File Cleanup

**Current Problem:**

In [`src/storage/jsonStore.ts`](src/storage/jsonStore.ts:81), the atomic write pattern creates `.tmp.{pid}.{timestamp}` files. If the process crashes between write and rename, these files accumulate indefinitely.

**Root Cause Location:**

```77:102:src/storage/jsonStore.ts
export async function writeJsonAtomic<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.ensureDir(dir);

  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  
  try {
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(tempPath, content, 'utf-8');

    const fd = await fs.open(tempPath, 'r+');
    try {
      await fs.fsync(fd);
    } finally {
      await fs.close(fd);
    }

    await fs.rename(tempPath, filePath);
  } catch (error) {
    logger.error(`Failed to write JSON atomically to ${filePath}: ${error}`);
    if (await fs.pathExists(tempPath)) {
      await fs.remove(tempPath).catch(() => {});
    }
    throw error;
  }
}
```

**Solution:**

- Implement startup cleanup routine that scans for orphaned `.tmp.*` files
- Add age check (e.g., > 1 hour old) to avoid cleaning active writes
- Consider periodic cleanup during runtime

### Edge Cases for Stream 1

1. **Port Cleanup Edge Cases:**

   - Port allocated but instance creation fails before `this.instances.set()` is called
   - Multiple rapid `startApp()` calls for same folder during error state
   - Port becomes available between check and actual binding (TOCTOU race)
   - System-level port exhaustion (all ports 8081-8281 taken by other processes)
   - Process fails to start but doesn't throw immediately (zombie state)

2. **Temp File Cleanup Edge Cases:**

   - Temp file from another process/instance still being written
   - Cross-drive rename operations on Windows (atomic rename may fail)
   - Temp file ownership/permission issues preventing cleanup
   - Cleanup running concurrently with active write operations
   - PID reuse: old temp file has same PID as current process
   - Clock skew causing incorrect age calculations
   - Multiple server instances cleaning up same temp files (race condition)

---

## Work Stream 2: Long-Running Operations & Connection Management

**Issues Addressed:**

- **Issue 20**: Build Process Timeout Handling
- **Issue 21**: Missing Error Boundary in SSE Endpoint

### Issue 20: Build Timeout Handling

**Current Problem:**

In [`src/handlers/demoHandler.ts`](src/handlers/demoHandler.ts:1172), `buildDemo()` uses a fixed 120-second timeout without retry logic. Large builds or slow systems will fail unnecessarily.

**Root Cause Location:**

```1169:1204:src/handlers/demoHandler.ts
  // Run the build
  logger.info(`Running npm run build for ${slug}...`);
  
  return new Promise((resolve) => {
    exec('npm run build', { cwd: demoDir, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        logger.error(`Build failed for ${slug}: ${err.message}`);
        logger.debug(`Build stdout: ${stdout}`);
        logger.debug(`Build stderr: ${stderr}`);
        resolve({
          success: false,
          slug,
          message: 'Build failed',
          error: err.message
        });
      } else {
        // Verify public folder was created
        if (fs.existsSync(publicDir)) {
          logger.info(`Build completed successfully for ${slug}`);
          resolve({
            success: true,
            slug,
            message: 'Build completed successfully',
            publicDir: `client-websites/${slug}/public`
          });
        } else {
          logger.warn(`Build completed but public folder not found for ${slug}`);
          resolve({
            success: false,
            slug,
            message: 'Build completed but no output',
            error: 'Build completed but the public/ folder was not created. Check your eleventy config.'
          });
        }
      }
    });
  });
```

**Solution (Activity-Based Timeout):**

- Stream build output and reset timeout on each output line
- Make base timeout configurable in `config.json`
- Add automatic retry with exponential backoff (max 2-3 retries)
- Track build progress through output patterns (e.g., "[11ty] Writing...")

### Issue 21: SSE Endpoint Error Handling

**Current Problem:**

In [`src/server.ts`](src/server.ts:3585), two SSE endpoints use `setInterval` without proper error handling if the connection drops mid-stream, potentially leaving orphaned intervals running indefinitely.

**Root Cause Locations:**

```3585:3599:src/server.ts
  const interval = setInterval(async () => {
    const currentStatus = await taskStatusManager.getStatus(taskId, clientFolder || undefined);
    if (currentStatus) {
      sendEvent({ type: 'status', ...currentStatus });
      if (currentStatus.state === 'DONE' || currentStatus.state === 'FAILED') {
        clearInterval(interval);
        res.end();
      }
    }
  }, 1000);

  req.on('close', () => {
    clearInterval(interval);
  });
```
```3653:3673:src/server.ts
    const pollInterval = setInterval(async () => {
      if (closed) {
        clearInterval(pollInterval);
        return;
      }

      try {
        const { events: newEvents, totalLines: newTotal } = await taskStatusManager.getEventsFrom(
          taskId, 
          lastLineCount, 
          clientFolder || undefined
        );

        if (newEvents.length > 0) {
          sendEvent('batch', { events: newEvents, totalLines: newTotal });
          lastLineCount = newTotal;
        }

        // Also send current task status for UI updates
        const status = await taskStatusManager.getStatus(taskId, clientFolder || undefined);
```

**Solution:**

- Wrap async callback in try-catch to prevent unhandled rejections
- Add connection liveness check before each `sendEvent()`
- Implement heartbeat mechanism to detect stale connections
- Track active intervals in a Map and clean up on server shutdown

### Edge Cases for Stream 2

1. **Build Timeout Edge Cases:**

   - Build hangs indefinitely with no output (deadlock)
   - Output comes in large bursts (e.g., 50 lines at once after long silence)
   - Build completes but `public/` creation is delayed by file system
   - Multiple concurrent builds for different demos exhausting resources
   - Build process spawns child processes that outlive parent
   - Timeout occurs during critical file write (corrupted output)
   - Retry attempts overlap if first build is slow but not dead
   - Build success but with warnings that could indicate partial failure

2. **SSE Endpoint Edge Cases:**

   - Client disconnects but `req.on('close')` never fires (TCP keepalive issue)
   - Exception in `getStatus()` or `getEventsFrom()` crashes interval handler
   - Client reconnects with same taskId while old connection still active
   - Server restart leaves client connection open (ghost connection)
   - sendEvent() throws after connection closed (write after end)
   - Multiple clients streaming same taskId causing resource exhaustion
   - Task completes but status file is locked/unavailable temporarily
   - Polling continues after task deletion (taskId no longer exists)

---

## Work Stream 3: Concurrency & File Synchronization

**Issues Addressed:**

- **Issue 24**: Concurrent Demo Context Reads During Step Transition

### Issue 24: Demo Context Race Condition

**Current Problem:**

In [`src/workflow/workflowOrchestrator.ts`](src/workflow/workflowOrchestrator.ts:679), `handleDemoStepTransition()` reads `demo.context.json` without locking, which can conflict with simultaneous context updates from agent completion handlers or other workflow events.

**Root Cause Location:**

```676:683:src/workflow/workflowOrchestrator.ts
    let promptContent = await fs.readFile(promptTemplatePath, 'utf-8');
    
    // Load context for placeholder replacement
    const contextPath = path.join(clientFolder, 'demo.context.json');
    if (!(await fs.pathExists(contextPath))) {
      throw new Error(`Demo context file not found: ${contextPath}`);
    }
    const context = await fs.readJson(contextPath);
```

**Solution:**

- Implement file-based locking mechanism using `.lock` files
- Add retry logic with exponential backoff for lock acquisition
- Use read-write lock semantics (multiple readers, single writer)
- Implement lock timeout to prevent deadlocks

### Edge Cases for Stream 3

1. **File Locking Edge Cases:**

   - Lock file created but process crashes before release (stale lock)
   - Multiple processes trying to acquire lock simultaneously (thundering herd)
   - Lock held during long operation blocking other readers unnecessarily
   - File system doesn't support atomic lock file creation (some network drives)
   - Clock skew between processes causing incorrect lock age calculation
   - Lock acquisition timeout during critical section (partial state update)
   - Read-write lock upgrade (reader wants to become writer)
   - Cross-platform lock file handling differences (Windows vs Unix)
   - Lock file permissions preventing cleanup by other processes
   - Nested locking (function A acquires lock, calls function B which tries to acquire same lock)
   - Context file deleted while lock is held
   - Multiple demo.context.json files for different demos causing lock name collision

2. **Context Update Race Conditions:**

   - Agent updates context while step transition reads it (torn read)
   - Two step transitions triggered simultaneously (duplicate step advancement)
   - Context update batched with status update causing partial visibility
   - Agent completion handler updates context after step already transitioned
   - Manual context edits (via API or filesystem) during automated workflow
   - Context schema version mismatch between reader and writer

---

## Implementation Dependencies

### Stream 1 Dependencies

- No external dependencies
- Touches: `visualTesting.ts`, `jsonStore.ts`
- Isolated from other streams

### Stream 2 Dependencies

- Requires config schema update for timeout settings
- Touches: `demoHandler.ts`, `server.ts`, `config.ts`
- No overlap with Stream 1 or 3

### Stream 3 Dependencies

- May need new utility module for file locking
- Touches: `workflowOrchestrator.ts`, potentially new `fileLock.ts`
- No overlap with Stream 1 or 2

---

## Testing Strategy

### Stream 1 Testing

- **Port Cleanup**: Inject failures before process spawn, verify port release
- **Temp Files**: Kill process during write, verify cleanup on next startup

### Stream 2 Testing

- **Build Timeout**: Mock slow builds with controlled output timing
- **SSE Endpoint**: Simulate client disconnects, exception injection in callbacks

### Stream 3 Testing

- **File Locking**: Concurrent access simulation, stale lock recovery tests
- **Race Conditions**: Parallel step transitions with simulated delays

---

## Risk Assessment

### Low Risk (Stream 1)

- Resource cleanup is defensive - failures are logged but don't break workflows
- Worst case: slight resource leak until next cleanup cycle

### Medium Risk (Stream 2)

- Timeout changes could cause builds to take longer before failing
- SSE changes affect real-time UI updates but don't break core workflow
- Mitigation: Make timeouts configurable, extensive testing

### Medium Risk (Stream 3)

- File locking adds complexity and potential for deadlocks
- Incorrect implementation could block all demo workflows
- Mitigation: Implement lock timeouts, comprehensive retry logic, extensive testing

---

## Additional Edge Cases Not Covered by Issues

### Cross-Stream Edge Cases

1. **Resource Exhaustion Cascade:**

   - Failed port cleanup (Stream 1) + concurrent builds (Stream 2) = no ports available for new preview servers
   - Orphaned temp files (Stream 1) + concurrent context updates (Stream 3) = disk space exhaustion
   - SSE connections (Stream 2) + file locks (Stream 3) = file descriptor exhaustion

2. **Timing Edge Cases:**

   - Server restart during active build (Stream 2) leaves orphaned temp files (Stream 1)
   - Demo step transition (Stream 3) triggers build (Stream 2) which times out during port allocation failure (Stream 1)

3. **State Consistency Edge Cases:**

   - Build timeout (Stream 2) occurs while context is locked (Stream 3) for status update
   - Port cleanup (Stream 1) runs while SSE endpoint (Stream 2) is streaming port status
   - Temp file cleanup (Stream 1) deletes lock file (Stream 3) prematurely

4. **Platform-Specific Edge Cases:**

   - Windows: File locking behavior differs from Unix (Stream 3)
   - Windows: Port release may be delayed by TIME_WAIT state (Stream 1)
   - Windows: Process termination doesn't immediately free resources (Stream 1, 2)

5. **Configuration Edge Cases:**

   - Timeout set to 0 or negative value (Stream 2)
   - Lock timeout shorter than typical operation duration (Stream 3)
   - Cleanup interval longer than temp file age threshold (Stream 1)

---

## Success Criteria

### Stream 1

- Port reuse works correctly after failed `startApp()` calls
- Orphaned temp files cleaned up within 1 startup cycle
- No resource leaks after 100 consecutive failures

### Stream 2

- Large builds complete successfully with activity-based timeout
- SSE connections clean up within 5 seconds of client disconnect
- No orphaned intervals after 1000 SSE connection cycles

### Stream 3

- Concurrent context reads succeed with lock contention
- Stale locks recovered within 60 seconds
- No deadlocks after 1000 concurrent operations