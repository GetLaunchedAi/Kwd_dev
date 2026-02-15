import * as path from 'path';
import * as fs from 'fs-extra';
import { continueWorkflowAfterAgent } from './src/workflow/workflowOrchestrator';

async function runFullDryRun() {
  const clientSlug = 'full-dry-run';
  const taskId = `demo-${clientSlug}`;
  const clientFolder = path.join(process.cwd(), 'client-websites', clientSlug);
  const imagesDir = 'src/assets/images';
  
  await fs.ensureDir(path.join(clientFolder, imagesDir));

  // Initial Context
  const context = {
    businessName: "Full Dry Run Biz",
    clientSlug: clientSlug,
    email: "full@example.com",
    phone: "555-9999",
    address: "456 Full St",
    primaryColor: "#0000ff",
    secondaryColor: "#ff00ff",
    fontFamily: "Verdana",
    services: "Full service testing",
    imagesDir: imagesDir,
    assets: {},
    createdAt: new Date().toISOString()
  };
  await fs.writeJson(path.join(clientFolder, 'demo.context.json'), context, { spaces: 2 });

  // Initialize task state for the stable taskId
  const { saveTaskState, WorkflowState } = await import('./src/state/stateManager');
  await saveTaskState(clientFolder, taskId, {
    branchName: 'main',
    state: WorkflowState.IN_PROGRESS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // STEP 1 -> 2
  console.log('\n--- Step 1 -> 2 ---');
  await fs.writeJson(path.join(clientFolder, 'demo.status.json'), {
    state: "running",
    currentStep: 1,
    totalSteps: 4,
    taskId: taskId
  }, { spaces: 2 });
  
  await fs.writeFile(path.join(clientFolder, 'CURSOR_TASK.md'), `
# Demo Customization Step 1: Branding
# Summary
Successfully applied branding with colors #0000ff and #ff00ff.
`);

  try { await continueWorkflowAfterAgent(clientFolder, taskId); } catch (e: any) {
    console.error('Error in Step 1 transition:', e.message);
  }

  let history = await fs.readJson(path.join(clientFolder, 'workflow_history.json'));
  console.log('Step 1 Summary:', history[0].summary);
  let status = await fs.readJson(path.join(clientFolder, 'demo.status.json'));
  console.log('Now at Step:', status.currentStep);
  console.log('Task ID:', taskId);

  // STEP 2 -> 3
  console.log('\n--- Step 2 -> 3 ---');
  await fs.writeFile(path.join(clientFolder, 'CURSOR_TASK.md'), `
# Demo Customization Step 2: Copywriting
# Summary
Generated copy for Full Dry Run Biz. Added services and contact info.
`);
  try { await continueWorkflowAfterAgent(clientFolder, taskId); } catch (e: any) {
    console.error('Error in Step 2 transition:', e.message);
  }

  history = await fs.readJson(path.join(clientFolder, 'workflow_history.json'));
  console.log('Step 2 Summary:', history[1].summary);
  status = await fs.readJson(path.join(clientFolder, 'demo.status.json'));
  console.log('Now at Step:', status.currentStep);

  // STEP 3 -> 4
  console.log('\n--- Step 3 -> 4 ---');
  await fs.writeFile(path.join(clientFolder, 'CURSOR_TASK.md'), `
# Demo Customization Step 3: Imagery
# Summary
Retrieved 5 images for the gallery. Hero image set to ${imagesDir}/hero.jpg.
`);
  try { await continueWorkflowAfterAgent(clientFolder, taskId); } catch (e: any) {
    console.error('Error in Step 3 transition:', e.message);
  }

  history = await fs.readJson(path.join(clientFolder, 'workflow_history.json'));
  console.log('Step 3 Summary:', history[2].summary);
  status = await fs.readJson(path.join(clientFolder, 'demo.status.json'));
  console.log('Now at Step:', status.currentStep);

  // STEP 4 -> Final
  console.log('\n--- Step 4 -> Final ---');
  await fs.writeFile(path.join(clientFolder, 'CURSOR_TASK.md'), `
# Demo Customization Step 4: Review
# Summary
Final review complete. All links verified. Site is responsive.
`);
  // When currentStep === totalSteps (4), it should proceed to normal completion (testing/etc)
  try { await continueWorkflowAfterAgent(clientFolder, taskId); } catch (e: any) {
      // We expect an error here in dry run because it will try to run real tests/approval
      console.log('Step 4 finished (Normal flow triggered)');
  }
  
  status = await fs.readJson(path.join(clientFolder, 'demo.status.json'));
  console.log('Final State:', status.state);
}

runFullDryRun().catch(console.error);





