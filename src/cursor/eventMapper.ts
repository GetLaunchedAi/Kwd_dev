import { TaskStatus } from './taskStatusManager';

export interface AgentEvent {
  type: string;
  message?: string;
  step?: string;
  percent?: number;
  path?: string;
  [key: string]: any;
}

export function mapEventToStatus(event: AgentEvent, currentStatus: Partial<TaskStatus>): Partial<TaskStatus> {
  const updates: Partial<TaskStatus> = {};

  if (event.message) {
    updates.notes = event.message;
  }

  if (event.step) {
    updates.step = event.step;
  } else if (event.type === 'file_change') {
    updates.step = 'Applying changes';
    if (event.path) {
      updates.notes = `Modified ${event.path}`;
    }
  } else if (event.type === 'command_start') {
    updates.step = 'Running command';
    if (event.command) {
      updates.notes = `Executing: ${event.command}`;
    }
  } else if (event.type === 'thought') {
    updates.step = 'Thinking';
    if (event.thought) {
      updates.notes = event.thought.length > 100 ? event.thought.substring(0, 97) + '...' : event.thought;
    }
  }

  if (event.percent !== undefined) {
    updates.percent = event.percent;
  } else {
    // Basic estimation logic if percent is missing
    if (currentStatus.percent !== undefined) {
      if (currentStatus.percent < 90) {
        updates.percent = currentStatus.percent + 1;
      }
    } else {
      updates.percent = 5;
    }
  }

  return updates;
}










