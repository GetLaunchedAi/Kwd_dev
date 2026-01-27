import { continueWorkflowAfterAgent } from './src/workflow/workflowOrchestrator';
import * as path from 'path';
import * as fs from 'fs-extra';
import { logger } from './src/utils/logger';

async function testTransition() {
  const clientFolder = path.join(process.cwd(), 'client-websites', 'test-dry-run');
  const taskId = 'demo-test-dry-run-initial';

  console.log('--- Starting Transition Test ---');
  
  try {
    // We expect this to call handleDemoStepTransition internally
    await continueWorkflowAfterAgent(clientFolder, taskId);
  } catch (err: any) {
    console.log('Note: Transition might have partially failed due to triggerAgent, but checking files anyway.');
    console.log('Error was:', err.message);
  }

  // Check results
  const historyPath = path.join(clientFolder, 'workflow_history.json');
  if (await fs.pathExists(historyPath)) {
    const history = await fs.readJson(historyPath);
    console.log('History created:', JSON.stringify(history, null, 2));
  } else {
    console.log('FAIL: workflow_history.json not created');
  }

  const statusPath = path.join(clientFolder, 'demo.status.json');
  const status = await fs.readJson(statusPath);
  console.log('Status updated:', JSON.stringify(status, null, 2));

  const nextPromptPath = path.join(clientFolder, 'CURSOR_TASK.md');
  const nextPrompt = await fs.readFile(nextPromptPath, 'utf-8');
  console.log('Next prompt (Step 2) created. Preview:');
  console.log(nextPrompt.substring(0, 200));
}

testTransition().catch(console.error);




