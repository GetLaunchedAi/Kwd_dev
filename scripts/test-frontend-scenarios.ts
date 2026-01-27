import * as fs from 'fs-extra';
import * as path from 'path';
import { WorkflowState, saveTaskState, TaskState } from '../src/state/stateManager';
import { logger } from '../src/utils/logger';

async function runScenario(name: string, taskId: string, steps: { state: WorkflowState, delay: number }[]) {
  console.log(`\n--- Running Scenario: ${name} (Task: ${taskId}) ---`);
  
  // Use a test client folder
  const clientFolder = path.join(process.cwd(), 'client-websites', 'test-client');
  await fs.ensureDir(clientFolder);

  for (const step of steps) {
    console.log(`Step: Transitioning to ${step.state}...`);
    await saveTaskState(clientFolder, taskId, {
      state: step.state,
      updatedAt: new Date().toISOString()
    });
    console.log(`Current state: ${step.state}. Waiting ${step.delay / 1000}s...`);
    await new Promise(resolve => setTimeout(resolve, step.delay));
  }
  
  console.log(`Scenario ${name} complete.`);
}

async function main() {
  const taskId = 'test-notification-task-' + Date.now();
  
  // T-01: Agent completion detection
  // Start in_progress, then move to completed
  await runScenario('T-01: Agent completion detection', taskId, [
    { state: WorkflowState.IN_PROGRESS, delay: 10000 },
    { state: WorkflowState.COMPLETED, delay: 2000 }
  ]);

  // T-02: Transition from testing to awaiting_approval
  const taskId2 = 'test-approval-task-' + Date.now();
  await runScenario('T-02: Testing to Awaiting Approval', taskId2, [
    { state: WorkflowState.TESTING, delay: 10000 },
    { state: WorkflowState.AWAITING_APPROVAL, delay: 2000 }
  ]);

  // T-03: Rapid multi-state changes
  const taskId3 = 'test-rapid-task-' + Date.now();
  await runScenario('T-03: Rapid Multi-state changes', taskId3, [
    { state: WorkflowState.PENDING, delay: 2000 },
    { state: WorkflowState.IN_PROGRESS, delay: 2000 },
    { state: WorkflowState.TESTING, delay: 2000 },
    { state: WorkflowState.AWAITING_APPROVAL, delay: 2000 }
  ]);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});




















