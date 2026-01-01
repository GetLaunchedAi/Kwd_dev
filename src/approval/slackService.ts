import { IncomingWebhook } from '@slack/webhook';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { ApprovalRequest, getApprovalUrl, getRejectionUrl } from './approvalManager';
import { TestResult } from '../testing/testRunner';

/**
 * Sends a failure notification to Slack
 */
export async function sendSlackFailureNotification(
  taskId: string,
  testResult: TestResult
): Promise<void> {
  if (config.approval.method !== 'slack') {
    return;
  }

  if (!config.approval.slack.webhookUrl) {
    logger.warn('Slack webhook URL not configured');
    return;
  }

  try {
    const webhook = new IncomingWebhook(config.approval.slack.webhookUrl);
    
    await webhook.send({
      text: `❌ Workflow Failed - Task ${taskId}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'Workflow Failed: Tests Failed',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Tests for task *${taskId}* failed. Manual intervention may be required.`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Test Command:* \`${testResult.testCommand}\`\n*Error:* \`${testResult.error || 'Unknown error'}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Test Output:*\n\`\`\`${testResult.output.substring(0, 1000)}...\`\`\``,
          },
        },
      ],
    });

    logger.info(`Sent Slack failure notification for task ${taskId}`);
  } catch (error: any) {
    logger.error(`Error sending Slack failure notification: ${error.message}`);
  }
}

/**
 * Sends approval notification to Slack
 */
export async function sendSlackNotification(request: ApprovalRequest): Promise<void> {
  if (config.approval.method !== 'slack') {
    logger.debug('Slack approval method not enabled, skipping Slack notification');
    return;
  }

  if (!config.approval.slack.webhookUrl) {
    logger.warn('Slack webhook URL not configured');
    return;
  }

  try {
    const webhook = new IncomingWebhook(config.approval.slack.webhookUrl);
    
    const approvalUrl = getApprovalUrl(request.token);
    const rejectionUrl = getRejectionUrl(request.token);

    const testStatus = request.testResult.success ? '✅ PASSED' : '❌ FAILED';
    const fileList = request.changeSummary.fileList
      .slice(0, 10)
      .map(f => `• ${f.path} (${f.status}${f.additions ? `, +${f.additions}/-${f.deletions}` : ''})`)
      .join('\n');
    
    const moreFiles = request.changeSummary.fileList.length > 10 
      ? `\n... and ${request.changeSummary.fileList.length - 10} more files`
      : '';

    await webhook.send({
      text: `Code Changes Ready for Review - Task ${request.taskId}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'Code Changes Ready for Review',
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Task ID:*\n${request.taskId}`,
            },
            {
              type: 'mrkdwn',
              text: `*Branch:*\n${request.branchName}`,
            },
            {
              type: 'mrkdwn',
              text: `*Files Modified:*\n${request.changeSummary.filesModified}`,
            },
            {
              type: 'mrkdwn',
              text: `*Lines Changed:*\n+${request.changeSummary.linesAdded} / -${request.changeSummary.linesRemoved}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Files Changed:*\n\`\`\`${fileList}${moreFiles}\`\`\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Test Results:* ${testStatus}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Diff Preview:*\n\`\`\`${request.changeSummary.diffPreview.substring(0, 500)}...\`\`\``,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Approve Changes',
                emoji: true,
              },
              style: 'primary',
              url: approvalUrl,
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Reject Changes',
                emoji: true,
              },
              style: 'danger',
              url: rejectionUrl,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Expires on ${request.expiresAt.toLocaleString()}`,
            },
          ],
        },
      ],
    });

    logger.info(`Sent Slack notification for task ${request.taskId}`);
  } catch (error: any) {
    logger.error(`Error sending Slack notification: ${error.message}`);
    throw error;
  }
}















