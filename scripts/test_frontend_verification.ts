/**
 * Frontend Verification Test for Task Import
 * Tests that the frontend properly displays and updates task information
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { logger } from '../src/utils/logger';

const TASK_ID = '86b81fu94';
const API_BASE = 'http://localhost:3000';
const TEST_SESSION_ID = `frontend-test-${Date.now()}`;

// Log limiter helper - truncates large data to prevent overwhelming output
function truncateData(data: any, maxLength: number = 500): any {
  if (!data) return data;
  
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  if (str.length <= maxLength) return data;
  
  const truncated = str.substring(0, maxLength) + `... [TRUNCATED ${str.length - maxLength} chars]`;
  return truncated;
}

// Instrumentation helper with log limiting
function logTest(test: string, result: string, details?: any) {
  const truncatedDetails = truncateData(details, 500);
  const logEntry = {
    test,
    result,
    details: truncatedDetails,
    timestamp: new Date().toISOString(),
    sessionId: TEST_SESSION_ID
  };
  console.log(`[${result}] ${test}`, truncatedDetails || '');
  logger.info(`[FRONTEND TEST] ${test}: ${result}`, truncatedDetails || '');
  return logEntry;
}

// API helper
async function apiCall(endpoint: string, options: any = {}) {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  const data = await response.json();
  return { status: response.status, data };
}

// Test 1: Verify /api/tasks endpoint returns task
async function testTasksListEndpoint() {
  console.log('\n[TEST 1] Verifying /api/tasks endpoint...');
  
  try {
    const { status, data } = await apiCall('/api/tasks');
    
    if (status !== 200) {
      throw new Error(`Expected status 200, got ${status}`);
    }
    
    if (!Array.isArray(data)) {
      throw new Error('Expected array response');
    }
    
    const task = data.find((t: any) => t.taskId === TASK_ID);
    
    if (!task) {
      throw new Error(`Task ${TASK_ID} not found in list`);
    }
    
    // Verify required fields
    const requiredFields = ['taskId', 'taskName', 'clientName', 'clientFolder', 'state'];
    for (const field of requiredFields) {
      if (!(field in task)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    logTest('Tasks List Endpoint', 'PASS', {
      totalTasks: data.length,
      taskFound: true,
      taskState: task.state,
      taskName: task.taskName
    });
    
    return { success: true, task };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logTest('Tasks List Endpoint', 'FAIL', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test 2: Verify /api/tasks/:taskId endpoint
async function testTaskDetailsEndpoint() {
  console.log('\n[TEST 2] Verifying /api/tasks/:taskId endpoint...');
  
  try {
    const { status, data } = await apiCall(`/api/tasks/${TASK_ID}`);
    
    if (status !== 200) {
      throw new Error(`Expected status 200, got ${status}`);
    }
    
    // Verify structure
    if (!data.taskState) {
      throw new Error('Missing taskState');
    }
    
    if (!data.taskInfo) {
      throw new Error('Missing taskInfo');
    }
    
    if (!data.clientFolder) {
      throw new Error('Missing clientFolder');
    }
    
    // Verify taskState fields
    const stateFields = ['taskId', 'state', 'clientFolder', 'createdAt', 'updatedAt'];
    for (const field of stateFields) {
      if (!(field in data.taskState)) {
        throw new Error(`Missing taskState field: ${field}`);
      }
    }
    
    // Verify taskInfo fields
    if (!data.taskInfo.task) {
      throw new Error('Missing taskInfo.task');
    }
    
    if (!data.taskInfo.taskId) {
      throw new Error('Missing taskInfo.taskId');
    }
    
    logTest('Task Details Endpoint', 'PASS', {
      state: data.taskState.state,
      taskName: data.taskInfo.task.name,
      description: data.taskInfo.task.description,
      currentStep: data.taskState.currentStep
    });
    
    return { success: true, data };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logTest('Task Details Endpoint', 'FAIL', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test 3: Verify /api/cursor/status endpoint
async function testCursorStatusEndpoint() {
  console.log('\n[TEST 3] Verifying /api/cursor/status endpoint...');
  
  try {
    const { status, data } = await apiCall('/api/cursor/status');
    
    if (status !== 200) {
      throw new Error(`Expected status 200, got ${status}`);
    }
    
    // Verify structure
    const requiredFields = ['state', 'percent', 'step', 'lastUpdate', 'notes', 'errors', 'task'];
    for (const field of requiredFields) {
      if (!(field in data)) {
        throw new Error(`Missing field: ${field}`);
      }
    }
    
    logTest('Cursor Status Endpoint', 'PASS', {
      state: data.state,
      step: data.step,
      percent: data.percent,
      taskId: data.task.taskId || 'none'
    });
    
    return { success: true, data };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logTest('Cursor Status Endpoint', 'FAIL', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test 4: Verify state consistency
async function testStateConsistency() {
  console.log('\n[TEST 4] Verifying state consistency...');
  
  try {
    // Get task from list
    const { status: listStatus, data: listData } = await apiCall('/api/tasks');
    const taskFromList = listData.find((t: any) => t.taskId === TASK_ID);
    
    // Get task details
    const { status: detailStatus, data: detailData } = await apiCall(`/api/tasks/${TASK_ID}`);
    
    if (!taskFromList || !detailData) {
      throw new Error('Could not fetch task data');
    }
    
    // Compare states
    if (taskFromList.state !== detailData.taskState.state) {
      throw new Error(`State mismatch: list shows "${taskFromList.state}", details show "${detailData.taskState.state}"`);
    }
    
    // Compare taskIds
    if (taskFromList.taskId !== detailData.taskState.taskId) {
      throw new Error('TaskId mismatch between list and details');
    }
    
    // Compare client folders
    if (taskFromList.clientFolder !== detailData.clientFolder) {
      throw new Error('ClientFolder mismatch between list and details');
    }
    
    logTest('State Consistency', 'PASS', {
      state: taskFromList.state,
      taskId: taskFromList.taskId,
      clientFolder: taskFromList.clientFolder
    });
    
    return { success: true };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logTest('State Consistency', 'FAIL', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test 5: Verify file system matches API
async function testFileSystemConsistency() {
  console.log('\n[TEST 5] Verifying file system consistency...');
  
  try {
    // Get task from API
    const { status, data: apiData } = await apiCall(`/api/tasks/${TASK_ID}`);
    
    if (status !== 200) {
      throw new Error('Could not fetch task from API');
    }
    
    // Read from file system
    const clientFolder = apiData.clientFolder;
    const stateFile = path.join(clientFolder, '.clickup-workflow', TASK_ID, 'state.json');
    const taskInfoFile = path.join(clientFolder, '.clickup-workflow', TASK_ID, 'task-info.json');
    
    if (!await fs.pathExists(stateFile)) {
      throw new Error('state.json not found on file system');
    }
    
    if (!await fs.pathExists(taskInfoFile)) {
      throw new Error('task-info.json not found on file system');
    }
    
    const fsState = await fs.readJson(stateFile);
    const fsTaskInfo = await fs.readJson(taskInfoFile);
    
    // Compare states
    if (fsState.state !== apiData.taskState.state) {
      throw new Error(`State mismatch: FS shows "${fsState.state}", API shows "${apiData.taskState.state}"`);
    }
    
    // Compare task IDs
    if (fsTaskInfo.taskId !== apiData.taskInfo.taskId) {
      throw new Error('TaskId mismatch between FS and API');
    }
    
    logTest('File System Consistency', 'PASS', {
      state: fsState.state,
      taskId: fsTaskInfo.taskId,
      stateFile,
      taskInfoFile
    });
    
    return { success: true };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logTest('File System Consistency', 'FAIL', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Test 6: Verify task data completeness
async function testTaskDataCompleteness() {
  console.log('\n[TEST 6] Verifying task data completeness...');
  
  try {
    const { status, data } = await apiCall(`/api/tasks/${TASK_ID}`);
    
    if (status !== 200) {
      throw new Error('Could not fetch task');
    }
    
    const task = data.taskInfo.task;
    
    // Check essential fields
    const essentialFields = {
      'id': task.id,
      'name': task.name,
      'description': task.description,
      'status': task.status,
      'url': task.url,
      'creator': task.creator,
      'assignees': task.assignees
    };
    
    const missing = [];
    for (const [field, value] of Object.entries(essentialFields)) {
      if (!value) {
        missing.push(field);
      }
    }
    
    if (missing.length > 0) {
      throw new Error(`Missing essential fields: ${missing.join(', ')}`);
    }
    
    // Verify description matches what we expect
    const expectedDescription = 'Change the footer to red and add a link to kalamazoowebsitedesign.com';
    if (!task.description.includes('footer') || !task.description.includes('kalamazoowebsitedesign.com')) {
      throw new Error('Task description does not match expected content');
    }
    
    logTest('Task Data Completeness', 'PASS', {
      taskName: task.name,
      hasDescription: !!task.description,
      hasAssignees: task.assignees.length > 0,
      hasUrl: !!task.url
    });
    
    return { success: true };
  } catch (error: any) {
    const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
    logTest('Task Data Completeness', 'FAIL', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Main test runner
async function runFrontendTests() {
  console.log('\n========================================');
  console.log('FRONTEND VERIFICATION TESTS');
  console.log('Task ID: ' + TASK_ID);
  console.log('========================================\n');
  
  const results: any = {
    sessionId: TEST_SESSION_ID,
    taskId: TASK_ID,
    startTime: new Date().toISOString(),
    tests: []
  };
  
  // Run all tests
  const tests = [
    { name: 'Tasks List Endpoint', fn: testTasksListEndpoint },
    { name: 'Task Details Endpoint', fn: testTaskDetailsEndpoint },
    { name: 'Cursor Status Endpoint', fn: testCursorStatusEndpoint },
    { name: 'State Consistency', fn: testStateConsistency },
    { name: 'File System Consistency', fn: testFileSystemConsistency },
    { name: 'Task Data Completeness', fn: testTaskDataCompleteness }
  ];
  
  for (const test of tests) {
    const result = await test.fn();
    results.tests.push({
      name: test.name,
      ...result
    });
  }
  
  results.endTime = new Date().toISOString();
  
  // Summary
  const passedTests = results.tests.filter((t: any) => t.success).length;
  const totalTests = results.tests.length;
  
  console.log('\n========================================');
  console.log('FRONTEND TEST SUMMARY');
  console.log('========================================');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Session ID: ${TEST_SESSION_ID}`);
  console.log('========================================\n');
  
  // Save results
  const resultsFile = path.join(process.cwd(), 'logs', `test-frontend-${TASK_ID}-${Date.now()}.json`);
  await fs.ensureDir(path.dirname(resultsFile));
  await fs.writeJson(resultsFile, results, { spaces: 2 });
  console.log(`Results saved to: ${resultsFile}\n`);
  
  return results;
}

// Run tests
runFrontendTests()
  .then((results) => {
    const failedTests = results.tests.filter((t: any) => !t.success);
    process.exit(failedTests.length > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('Fatal error running tests:', error);
    process.exit(1);
  });

