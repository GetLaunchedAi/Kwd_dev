import { Request } from 'express';
import { clickUpApiClient, ClickUpWebhookEvent, ClickUpTask } from './apiClient';
import { config } from '../config/config';
import { logger } from '../utils/logger';

export interface ProcessedWebhookEvent {
  taskId: string;
  task: ClickUpTask;
  eventType: string;
  statusChanged: boolean;
  newStatus?: string;
}

/**
 * Validates and processes a ClickUp webhook event
 */
export async function processWebhookEvent(req: Request): Promise<ProcessedWebhookEvent | null> {
  try {
    // Get webhook signature from headers if available
    const signature = req.headers['x-clickup-signature'] as string;
    const payload = JSON.stringify(req.body);

    // Validate signature (if configured)
    if (config.clickup.webhookSecret && signature) {
      const isValid = clickUpApiClient.validateWebhookSignature(payload, signature);
      if (!isValid) {
        logger.warn('Invalid webhook signature');
        return null;
      }
    }

    const event: ClickUpWebhookEvent = req.body;

    logger.info(`Received webhook event: ${event.event} for task: ${event.task_id}`);

    // ISSUE 5 FIX: Filter out local task IDs from webhook processing
    // Local tasks (created via dashboard without ClickUp) use IDs prefixed with "local-"
    // These should never come from ClickUp webhooks, but we guard against:
    // 1. Malicious/malformed webhook payloads with crafted task IDs
    // 2. Edge cases where ClickUp might use IDs starting with "local-" (extremely unlikely)
    if (event.task_id && event.task_id.startsWith('local-')) {
      logger.warn(`Ignoring webhook event with local task ID: ${event.task_id}. Local tasks are not managed via ClickUp webhooks.`);
      return null;
    }

    // Check if this is a status change event
    if (event.event !== 'taskStatusUpdated' && event.event !== 'taskUpdated') {
      logger.debug(`Event type ${event.event} is not a status change, ignoring`);
      return null;
    }

    // Fetch full task details
    const task = await clickUpApiClient.getTask(event.task_id);

    // Check if status matches trigger status
    const currentStatus = task.status.status;
    const triggerStatus = config.clickup.triggerStatus;

    if (currentStatus !== triggerStatus) {
      logger.debug(`Task status "${currentStatus}" does not match trigger status "${triggerStatus}"`);
      return null;
    }

    logger.info(`Task ${task.id} status changed to trigger status: ${triggerStatus}`);

    // Check if status actually changed (from history)
    let statusChanged = false;
    let newStatus: string | undefined;

    if (event.history_items) {
      const statusHistoryItem = event.history_items.find(item => item.field === 'status');
      if (statusHistoryItem) {
        statusChanged = true;
        newStatus = statusHistoryItem.value?.status || currentStatus;
      }
    } else {
      // If no history, assume status changed if it matches trigger
      statusChanged = true;
      newStatus = currentStatus;
    }

    return {
      taskId: task.id,
      task,
      eventType: event.event,
      statusChanged,
      newStatus,
    };
  } catch (error: any) {
    logger.error(`Error processing webhook event: ${error.message}`);
    throw error;
  }
}
