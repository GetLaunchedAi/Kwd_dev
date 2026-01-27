import { agentQueue } from './src/cursor/agentQueue';
import { ClickUpTask } from './src/clickup/apiClient';

async function testEnqueue() {
  console.log('Initializing queue...');
  await agentQueue.initialize();

  const mockTask: Partial<ClickUpTask> = {
    id: 'test_task_123',
    name: 'Test Task',
    description: 'This is a test task for the queue system.',
    priority: { priority: 'high', color: '#ff0000', id: '1', orderindex: '1' },
    custom_fields: [
      { id: 'client_name_id', name: 'Client Name', value: 'TestClient' }
    ]
  };

  console.log('Enqueuing task...');
  const filePath = await agentQueue.enqueueTask(mockTask as ClickUpTask, process.cwd(), 'feature/test-task');
  console.log(`Task enqueued at: ${filePath}`);

  console.log('Updating status...');
  await agentQueue.updateStatus({
    task: {
      file: '0001_test_task_123.md',
      id: '0001',
      taskId: 'test_task_123'
    },
    state: 'running',
    percent: 50,
    step: 'Testing updates',
    notes: ['Initialized test'],
    errors: []
  });
  console.log('Status updated.');
}

testEnqueue().catch(console.error);

