/**
 * Comprehensive Test for Task Import: 86b81fu94
 * Tests the entire workflow from import to frontend updates
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { logger } from '../src/utils/logger';

// Test configuration
const TASK_ID = '86b81fu94';
const API_BASE = 'http://localhost:3000';
const CLIENT_NAME = 'jacks-roofing-llc';
const TEST_SESSION_ID = `test-${Date.now()}`;

// Log limiter helper - truncates large data to prevent overwhelming output
function truncateData(data: any, maxLength: number = 500): any {
  if (!data) return data;
  
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  if (str.length <= maxLength) return data;
  
  const truncated = str.substring(0, maxLength) + `... [TRUNCATED ${str.length - maxLength} chars]`;
  return truncated;
}

// Instrumentation helper with log limiting
function logInstrumentation(location: string, message: string, data?: any) {
  const truncatedData = truncateData(data, 500);
  const logEntry = {
    location,
    message,
    data: truncatedData,
    timestamp: Date.now(),
    sessionId: TEST_SESSION_ID
  };
  console.log(`[INSTRUMENT] ${location}: ${message}`, truncatedData || '');
  logger.info(`[TEST INSTRUMENT] ${location}: ${message}`, truncatedData || '');
  return logEntry;
}

// API helper
async function apiCall(endpoint: string, options: any = {}) {
  const url = `${API_BASE}${endpoint}`;
  logInstrumentation('apiCall', `Calling ${options.method || 'GET'} ${endpoint}`);
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  const data = await response.json();
  logInstrumentation('apiCall', `Response from ${endpoint}`, { status: response.status, data });
  
  return { status: response.status, data };
}

// Wait helper
async function wait(ms: number) {
  logInstrumentation('wait', `Waiting ${ms}ms`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test Step 1: Verify server is running
async function testServerHealth() {
  logInstrumentation('testServerHealth', 'Starting health check');
  
  try {
    const { status, data } = await apiCall('/api/health');
    
    if (status !== 200) {
      throw new Error(`Server health check failed with status ${status}`);
    }
    
    logInstrumentation('testServerHealth', 'Server is healthy', data);
    return { success: true, data };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logInstrumentation('testServerHealth', 'Health check failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test Step 2: Check if task already exists (cleanup if needed)
async function checkExistingTask() {
  logInstrumentation('checkExistingTask', `Checking if task ${TASK_ID} already exists`);
  
  try {
    const { status, data } = await apiCall(`/api/tasks/${TASK_ID}`);
    
    if (status === 200) {
      logInstrumentation('checkExistingTask', 'Task already exists', data);
      return { exists: true, data };
    } else {
      logInstrumentation('checkExistingTask', 'Task does not exist');
      return { exists: false };
    }
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logInstrumentation('checkExistingTask', 'Error checking task', { error: errorMsg });
    return { exists: false };
  }
}

// Test Step 3: Delete existing task if present
async function cleanupExistingTask() {
  logInstrumentation('cleanupExistingTask', `Attempting to delete task ${TASK_ID}`);
  
  try {
    const { status, data } = await apiCall(`/api/tasks/${TASK_ID}`, {
      method: 'DELETE'
    });
    
    if (status === 200 || status === 404) {
      logInstrumentation('cleanupExistingTask', 'Task deleted or not found', data);
      
      // Also cleanup the file system
      const clientFolder = path.join(process.cwd(), 'client-websites', CLIENT_NAME);
      const workflowDir = path.join(clientFolder, '.clickup-workflow', TASK_ID);
      
      if (await fs.pathExists(workflowDir)) {
        await fs.remove(workflowDir);
        logInstrumentation('cleanupExistingTask', 'Removed workflow directory', { path: workflowDir });
      }
      
      return { success: true };
    } else {
      throw new Error(`Delete failed with status ${status}`);
    }
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logInstrumentation('cleanupExistingTask', 'Cleanup failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test Step 4: Import the task
async function importTask() {
  logInstrumentation('importTask', `Importing task ${TASK_ID}`);
  
  try {
    const { status, data } = await apiCall('/api/tasks/import', {
      method: 'POST',
      body: JSON.stringify({
        taskId: TASK_ID,
        clientName: CLIENT_NAME,
        triggerWorkflow: false // Don't trigger workflow yet, we'll do it manually
      })
    });
    
    if (status !== 200 || !data.success) {
      throw new Error(`Import failed: ${data.error || 'Unknown error'}`);
    }
    
    logInstrumentation('importTask', 'Task imported successfully', data);
    return { success: true, data };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logInstrumentation('importTask', 'Import failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test Step 5: Verify task appears in frontend API
async function verifyTaskInList() {
  logInstrumentation('verifyTaskInList', 'Checking if task appears in /api/tasks');
  
  try {
    const { status, data } = await apiCall('/api/tasks');
    
    if (status !== 200) {
      throw new Error(`Failed to fetch tasks list with status ${status}`);
    }
    
    // Find our task
    const taskFound = data.find((t: any) => t.taskId === TASK_ID);
    
    if (taskFound) {
      logInstrumentation('verifyTaskInList', 'Task found in list', taskFound);
      return { success: true, task: taskFound };
    } else {
      throw new Error('Task not found in tasks list');
    }
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logInstrumentation('verifyTaskInList', 'Verification failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test Step 6: Verify task details endpoint
async function verifyTaskDetails() {
  logInstrumentation('verifyTaskDetails', `Fetching task details for ${TASK_ID}`);
  
  try {
    const { status, data } = await apiCall(`/api/tasks/${TASK_ID}`);
    
    if (status !== 200) {
      throw new Error(`Failed to fetch task details with status ${status}`);
    }
    
    // Verify structure
    if (!data.taskState || !data.taskInfo || !data.clientFolder) {
      throw new Error('Task data missing required fields');
    }
    
    logInstrumentation('verifyTaskDetails', 'Task details verified', {
      state: data.taskState.state,
      taskName: data.taskInfo.task.name,
      clientFolder: data.clientFolder
    });
    
    return { success: true, data };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logInstrumentation('verifyTaskDetails', 'Verification failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test Step 7: Verify file system state
async function verifyFileSystemState() {
  logInstrumentation('verifyFileSystemState', 'Checking file system for task data');
  
  try {
    const clientFolder = path.join(process.cwd(), 'client-websites', CLIENT_NAME);
    const workflowDir = path.join(clientFolder, '.clickup-workflow', TASK_ID);
    const stateFile = path.join(workflowDir, 'state.json');
    const taskInfoFile = path.join(workflowDir, 'task-info.json');
    
    // Check directory exists
    if (!await fs.pathExists(workflowDir)) {
      throw new Error(`Workflow directory does not exist: ${workflowDir}`);
    }
    
    // Check state.json
    if (!await fs.pathExists(stateFile)) {
      throw new Error(`state.json does not exist: ${stateFile}`);
    }
    const stateData = await fs.readJson(stateFile);
    logInstrumentation('verifyFileSystemState', 'state.json found', stateData);
    
    // Check task-info.json
    if (!await fs.pathExists(taskInfoFile)) {
      throw new Error(`task-info.json does not exist: ${taskInfoFile}`);
    }
    const taskInfoData = await fs.readJson(taskInfoFile);
    logInstrumentation('verifyFileSystemState', 'task-info.json found', {
      taskId: taskInfoData.taskId,
      taskName: taskInfoData.task.name
    });
    
    return { success: true, state: stateData, taskInfo: taskInfoData };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logInstrumentation('verifyFileSystemState', 'File system verification failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test Step 8: Trigger the agent
async function triggerAgent() {
  logInstrumentation('triggerAgent', `Triggering agent for task ${TASK_ID}`);
  
  try {
    const { status, data } = await apiCall(`/api/tasks/${TASK_ID}/trigger-agent`, {
      method: 'POST'
    });
    
    if (status !== 200 || !data.success) {
      throw new Error(`Agent trigger failed: ${data.error || 'Unknown error'}`);
    }
    
    logInstrumentation('triggerAgent', 'Agent triggered successfully', data);
    return { success: true, data };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logInstrumentation('triggerAgent', 'Agent trigger failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test Step 9: Monitor workflow state changes
async function monitorWorkflowProgress(maxWaitTimeMs: number = 60000) {
  logInstrumentation('monitorWorkflowProgress', `Monitoring workflow for up to ${maxWaitTimeMs}ms`);
  
  const startTime = Date.now();
  const states: any[] = [];
  
  while (Date.now() - startTime < maxWaitTimeMs) {
    try {
      const { status, data } = await apiCall(`/api/tasks/${TASK_ID}`);
      
      if (status === 200) {
        const currentState = data.taskState.state;
        const currentStep = data.taskState.currentStep;
        
        // Log if state changed
        const lastState = states.length > 0 ? states[states.length - 1].state : null;
        if (currentState !== lastState) {
          logInstrumentation('monitorWorkflowProgress', 'State changed', {
            from: lastState,
            to: currentState,
            step: currentStep
          });
          states.push({
            state: currentState,
            step: currentStep,
            timestamp: new Date().toISOString()
          });
        }
        
        // Check if workflow is done (success or error)
        if (['completed', 'error', 'awaiting_approval', 'rejected'].includes(currentState)) {
          logInstrumentation('monitorWorkflowProgress', 'Workflow reached terminal state', {
            state: currentState,
            totalStates: states.length
          });
          return { success: true, states, finalState: currentState };
        }
      }
      
      await wait(2000); // Poll every 2 seconds
    } catch (error: any) {
      const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
      logInstrumentation('monitorWorkflowProgress', 'Monitoring error', { error: errorMsg });
    }
  }
  
  logInstrumentation('monitorWorkflowProgress', 'Monitoring timeout reached', { states });
  return { success: false, states, error: 'Timeout reached' };
}

// Test Step 10: Verify cursor status endpoint
async function verifyCursorStatus() {
  logInstrumentation('verifyCursorStatus', 'Checking cursor status endpoint');
  
  try {
    const { status, data } = await apiCall('/api/cursor/status');
    
    if (status !== 200) {
      throw new Error(`Failed to fetch cursor status with status ${status}`);
    }
    
    logInstrumentation('verifyCursorStatus', 'Cursor status retrieved', data);
    return { success: true, data };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logInstrumentation('verifyCursorStatus', 'Status check failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Main test runner
async function runTests() {
  console.log('\n========================================');
  console.log('TASK IMPORT TEST FOR 86b81fu94');
  console.log('========================================\n');
  
  const results: any = {
    sessionId: TEST_SESSION_ID,
    startTime: new Date().toISOString(),
    tests: []
  };
  
  // Test 1: Server Health
  console.log('\n[TEST 1] Checking server health...');
  const healthResult = await testServerHealth();
  results.tests.push({ name: 'Server Health', ...healthResult });
  
  if (!healthResult.success) {
    console.error('❌ Server is not running. Start the server first with: npm start');
    return results;
  }
  console.log('✅ Server is healthy');
  
  // Test 2: Check existing task
  console.log('\n[TEST 2] Checking for existing task...');
  const existingTaskResult = await checkExistingTask();
  results.tests.push({ name: 'Check Existing Task', ...existingTaskResult });
  
  if (existingTaskResult.exists) {
    console.log('⚠️  Task already exists, cleaning up...');
    
    // Test 3: Cleanup
    console.log('\n[TEST 3] Cleaning up existing task...');
    const cleanupResult = await cleanupExistingTask();
    results.tests.push({ name: 'Cleanup Existing Task', ...cleanupResult });
    
    if (!cleanupResult.success) {
      console.error('❌ Failed to cleanup existing task');
      return results;
    }
    console.log('✅ Cleanup successful');
    await wait(1000); // Wait for cleanup to complete
  }
  
  // Test 4: Import task
  console.log('\n[TEST 4] Importing task...');
  const importResult = await importTask();
  results.tests.push({ name: 'Import Task', ...importResult });
  
  if (!importResult.success) {
    console.error('❌ Failed to import task:', importResult.error);
    return results;
  }
  console.log('✅ Task imported successfully');
  
  await wait(2000); // Wait for import to settle
  
  // Test 5: Verify task in list
  console.log('\n[TEST 5] Verifying task appears in /api/tasks...');
  const listResult = await verifyTaskInList();
  results.tests.push({ name: 'Verify Task in List', ...listResult });
  
  if (!listResult.success) {
    console.error('❌ Task not found in list');
    return results;
  }
  console.log('✅ Task found in list');
  
  // Test 6: Verify task details
  console.log('\n[TEST 6] Verifying task details endpoint...');
  const detailsResult = await verifyTaskDetails();
  results.tests.push({ name: 'Verify Task Details', ...detailsResult });
  
  if (!detailsResult.success) {
    console.error('❌ Task details verification failed');
    return results;
  }
  console.log('✅ Task details verified');
  console.log(`   State: ${detailsResult.data.taskState.state}`);
  console.log(`   Task Name: ${detailsResult.data.taskInfo.task.name}`);
  
  // Test 7: Verify file system
  console.log('\n[TEST 7] Verifying file system state...');
  const fsResult = await verifyFileSystemState();
  results.tests.push({ name: 'Verify File System', ...fsResult });
  
  if (!fsResult.success) {
    console.error('❌ File system verification failed');
    return results;
  }
  console.log('✅ File system state verified');
  console.log(`   State: ${fsResult.state.state}`);
  console.log(`   Workflow Dir: .clickup-workflow/${TASK_ID}/`);
  
  // Test 8: Trigger agent
  console.log('\n[TEST 8] Triggering Cursor agent...');
  const triggerResult = await triggerAgent();
  results.tests.push({ name: 'Trigger Agent', ...triggerResult });
  
  if (!triggerResult.success) {
    console.error('❌ Failed to trigger agent:', triggerResult.error);
    // Don't return, continue with monitoring
  } else {
    console.log('✅ Agent triggered successfully');
  }
  
  await wait(3000); // Wait for agent to start
  
  // Test 9: Verify cursor status
  console.log('\n[TEST 9] Checking cursor status...');
  const cursorStatusResult = await verifyCursorStatus();
  results.tests.push({ name: 'Cursor Status', ...cursorStatusResult });
  
  if (cursorStatusResult.success) {
    console.log('✅ Cursor status retrieved');
    console.log(`   State: ${cursorStatusResult.data.state}`);
    console.log(`   Step: ${cursorStatusResult.data.step}`);
  } else {
    console.log('⚠️  Could not retrieve cursor status (may be idle)');
  }
  
  // Test 10: Monitor workflow
  console.log('\n[TEST 10] Monitoring workflow progress (up to 60s)...');
  console.log('   Note: This will monitor state changes. Press Ctrl+C to stop early.');
  const monitorResult = await monitorWorkflowProgress(60000);
  results.tests.push({ name: 'Monitor Workflow', ...monitorResult });
  
  if (monitorResult.success) {
    console.log('✅ Workflow monitoring complete');
    console.log(`   Final State: ${monitorResult.finalState}`);
    console.log(`   State Transitions:`);
    monitorResult.states.forEach((s: any, i: number) => {
      console.log(`     ${i + 1}. ${s.state} - ${s.step || 'No step'} (${s.timestamp})`);
    });
  } else {
    console.log('⚠️  Workflow monitoring did not reach terminal state');
    console.log(`   Last known states:`);
    monitorResult.states.forEach((s: any, i: number) => {
      console.log(`     ${i + 1}. ${s.state} - ${s.step || 'No step'} (${s.timestamp})`);
    });
  }
  
  // Final verification
  console.log('\n[FINAL] Final state verification...');
  const finalDetailsResult = await verifyTaskDetails();
  results.tests.push({ name: 'Final State Verification', ...finalDetailsResult });
  
  if (finalDetailsResult.success) {
    console.log('✅ Final state retrieved');
    console.log(`   State: ${finalDetailsResult.data.taskState.state}`);
    console.log(`   Step: ${finalDetailsResult.data.taskState.currentStep || 'N/A'}`);
  }
  
  // Summary
  results.endTime = new Date().toISOString();
  const passedTests = results.tests.filter((t: any) => t.success).length;
  const totalTests = results.tests.length;
  
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Session ID: ${TEST_SESSION_ID}`);
  console.log('========================================\n');
  
  // Save results to file
  const resultsFile = path.join(process.cwd(), 'logs', `test-import-${TASK_ID}-${Date.now()}.json`);
  await fs.ensureDir(path.dirname(resultsFile));
  await fs.writeJson(resultsFile, results, { spaces: 2 });
  console.log(`Test results saved to: ${resultsFile}\n`);
  
  return results;
}

// Run tests
runTests()
  .then((results) => {
    const failedTests = results.tests.filter((t: any) => !t.success);
    process.exit(failedTests.length > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('Fatal error running tests:', error);
    process.exit(1);
  });

