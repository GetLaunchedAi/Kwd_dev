import * as nodemailer from 'nodemailer';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { ApprovalRequest, getApprovalUrl, getRejectionUrl } from './approvalManager';
import { ChangeSummary } from './changeSummarizer';
import { TestResult } from '../testing/testRunner';

// ISSUE 7 FIX: Common placeholder values that indicate SMTP is not configured
const PLACEHOLDER_HOSTS = [
  'smtp.example.com',
  'example.com',
  'mail.example.com',
  'localhost',
  '127.0.0.1',
  'your-smtp-host',
  'smtp.your-domain.com',
  ''
];

const PLACEHOLDER_AUTH_VALUES = [
  'user@example.com',
  'noreply@example.com',
  'test@example.com',
  'your-password',
  'password',
  'changeme',
  ''
];

interface SmtpConfigStatus {
  configured: boolean;
  reason?: string;
}

/**
 * Checks if SMTP is properly configured with real values (not placeholders)
 * ISSUE 7 FIX: Consolidated validation to prevent DNS errors from placeholder domains
 */
export function isSmtpConfigured(): boolean {
  return getSmtpConfigStatus().configured;
}

/**
 * Gets detailed SMTP configuration status with reason
 */
function getSmtpConfigStatus(): SmtpConfigStatus {
  const emailConfig = config.approval?.email;
  
  if (!emailConfig) {
    return { configured: false, reason: 'Email configuration not found in config' };
  }
  
  if (!emailConfig.smtp) {
    return { configured: false, reason: 'SMTP configuration not found' };
  }
  
  const { host, auth } = emailConfig.smtp;
  
  // Check for placeholder host
  if (!host) {
    return { configured: false, reason: 'SMTP host is empty' };
  }
  
  if (PLACEHOLDER_HOSTS.some(p => host.toLowerCase() === p.toLowerCase())) {
    return { configured: false, reason: `SMTP host "${host}" appears to be a placeholder. Please configure a real SMTP server.` };
  }
  
  // Check for placeholder auth values
  if (!auth || !auth.user) {
    return { configured: false, reason: 'SMTP user is not configured' };
  }
  
  if (PLACEHOLDER_AUTH_VALUES.some(p => auth.user.toLowerCase() === p.toLowerCase())) {
    return { configured: false, reason: `SMTP user "${auth.user}" appears to be a placeholder` };
  }
  
  if (!auth.pass) {
    return { configured: false, reason: 'SMTP password is not configured' };
  }
  
  if (PLACEHOLDER_AUTH_VALUES.some(p => auth.pass.toLowerCase() === p.toLowerCase())) {
    return { configured: false, reason: 'SMTP password appears to be a placeholder' };
  }
  
  // Check if auth values contain 'example' which suggests placeholder
  if (auth.user.includes('example') || auth.pass.includes('example')) {
    return { configured: false, reason: 'SMTP credentials contain "example" suggesting placeholder values' };
  }
  
  return { configured: true };
}

/**
 * Sends failure email
 */
export async function sendFailureEmail(
  taskId: string,
  testResult: TestResult,
  toEmailOverride?: string
): Promise<void> {
  if (config.approval.method !== 'email') {
    return;
  }
  
  if (!isSmtpConfigured()) {
    logger.debug(`Skipping failure email for task ${taskId} - SMTP not configured. Configure SMTP settings in config/config.json or set enableEmailNotifications to false.`);
    return;
  }

  try {
    const transporter = createTransporter();
    const emailConfig = config.approval.email;
    
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #f44336; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .test-fail { background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; margin: 15px 0; border-radius: 5px; }
    .code { background-color: #f4f4f4; padding: 10px; border-radius: 3px; font-family: monospace; font-size: 12px; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Workflow Failed: Tests Failed</h1>
    </div>
    <div class="content">
      <h2>Task: ${taskId}</h2>
      <p>Tests for task <strong>${taskId}</strong> failed. Manual intervention may be required.</p>
      
      <h3>Test Details</h3>
      <p><strong>Command:</strong> <code>${testResult.testCommand}</code></p>
      <p><strong>Error:</strong> <code>${testResult.error || 'Unknown error'}</code></p>

      <h3>Test Output</h3>
      <div class="test-fail">
        <pre class="code">${testResult.output.substring(0, 2000)}</pre>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
Workflow Failed: Tests Failed for Task ${taskId}

Tests for task ${taskId} failed. Manual intervention may be required.

Test Details:
Command: ${testResult.testCommand}
Error: ${testResult.error || 'Unknown error'}

Test Output:
${testResult.output.substring(0, 1000)}
    `;

    const toEmail = toEmailOverride || process.env.APPROVAL_EMAIL_TO;
    
    if (!toEmail) {
      logger.warn(`No email recipient configured for failure notification (task ${taskId}). Set APPROVAL_EMAIL_TO in environment.`);
      return;
    }

    await transporter.sendMail({
      from: emailConfig.from,
      to: toEmail,
      subject: `Workflow FAILED: Task ${taskId}`,
      text: textContent,
      html: htmlContent,
    });

    logger.info(`Sent failure email for task ${taskId} to ${toEmail}`);
  } catch (error: any) {
    logger.error(`Error sending failure email: ${error.message}`);
  }
}

/**
 * Creates email transporter if SMTP is properly configured
 * @throws Error if SMTP is not configured
 */
function createTransporter(): nodemailer.Transporter {
  // ISSUE 7 FIX: Validate SMTP configuration before creating transporter
  const smtpStatus = getSmtpConfigStatus();
  if (!smtpStatus.configured) {
    throw new Error(`SMTP not configured: ${smtpStatus.reason}. Email notifications are disabled.`);
  }
  
  const emailConfig = config.approval.email;
  
  return nodemailer.createTransport({
    host: emailConfig.smtp.host,
    port: emailConfig.smtp.port,
    secure: emailConfig.smtp.secure,
    auth: {
      user: emailConfig.smtp.auth.user,
      pass: emailConfig.smtp.auth.pass,
    },
  });
}

/**
 * Formats change summary for email
 */
function formatChangeSummary(summary: ChangeSummary): string {
  return `
Files Modified: ${summary.filesModified}
Files Added: ${summary.filesAdded}
Files Deleted: ${summary.filesDeleted}
Lines Added: ${summary.linesAdded}
Lines Removed: ${summary.linesRemoved}

Files Changed:
${summary.fileList.map(f => `- ${f.path} (${f.status}${f.additions ? `, +${f.additions}/-${f.deletions}` : ''})`).join('\n')}

Diff Preview:
\`\`\`
${summary.diffPreview.substring(0, 500)}...
\`\`\`
`;
}

/**
 * Sends approval email
 */
export async function sendApprovalEmail(request: ApprovalRequest): Promise<void> {
  if (config.approval.method !== 'email') {
    logger.debug('Email approval method not enabled, skipping email');
    return;
  }
  
  if (!isSmtpConfigured()) {
    logger.debug(`Skipping approval email for task ${request.taskId} - SMTP not configured. Configure SMTP settings in config/config.json or set enableEmailNotifications to false.`);
    return;
  }

  try {
    const transporter = createTransporter();
    const emailConfig = config.approval.email;
    
    const approvalUrl = getApprovalUrl(request.token);
    const rejectionUrl = getRejectionUrl(request.token);

    const changeSummaryText = formatChangeSummary(request.changeSummary);
    const testStatus = request.testResult.success ? '✅ PASSED' : '❌ FAILED';
    const testOutput = request.testResult.output.substring(0, 500);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #4CAF50; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .button { display: inline-block; padding: 12px 24px; margin: 10px 5px; text-decoration: none; border-radius: 5px; color: white; }
    .approve { background-color: #4CAF50; }
    .reject { background-color: #f44336; }
    .test-result { padding: 15px; margin: 15px 0; border-radius: 5px; }
    .test-pass { background-color: #d4edda; border: 1px solid #c3e6cb; }
    .test-fail { background-color: #f8d7da; border: 1px solid #f5c6cb; }
    .code { background-color: #f4f4f4; padding: 10px; border-radius: 3px; font-family: monospace; font-size: 12px; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Code Changes Ready for Review</h1>
    </div>
    <div class="content">
      <h2>Task: ${request.taskId}</h2>
      <p><strong>Branch:</strong> ${request.branchName}</p>
      
      <h3>Change Summary</h3>
      <ul>
        <li>Files Modified: ${request.changeSummary.filesModified}</li>
        <li>Files Added: ${request.changeSummary.filesAdded}</li>
        <li>Files Deleted: ${request.changeSummary.filesDeleted}</li>
        <li>Lines Added: ${request.changeSummary.linesAdded}</li>
        <li>Lines Removed: ${request.changeSummary.linesRemoved}</li>
      </ul>

      <h3>Files Changed</h3>
      <ul>
        ${request.changeSummary.fileList.map(f => 
          `<li>${f.path} <strong>(${f.status}${f.additions ? `, +${f.additions}/-${f.deletions}` : ''})</strong></li>`
        ).join('')}
      </ul>

      <h3>Test Results</h3>
      <div class="test-result ${request.testResult.success ? 'test-pass' : 'test-fail'}">
        <strong>${testStatus}</strong>
        <pre class="code">${testOutput}</pre>
      </div>

      <h3>Diff Preview</h3>
      <pre class="code">${request.changeSummary.diffPreview.substring(0, 1000)}...</pre>

      <div style="text-align: center; margin-top: 30px;">
        <a href="${approvalUrl}" class="button approve">✓ Approve Changes</a>
        <a href="${rejectionUrl}" class="button reject">✗ Reject Changes</a>
      </div>

      <p style="margin-top: 30px; font-size: 12px; color: #666;">
        This approval request will expire on ${request.expiresAt.toLocaleString()}
      </p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
Code Changes Ready for Review

Task: ${request.taskId}
Branch: ${request.branchName}

Change Summary:
${changeSummaryText}

Test Results: ${testStatus}
${testOutput}

Approve: ${approvalUrl}
Reject: ${rejectionUrl}

This approval request will expire on ${request.expiresAt.toLocaleString()}
    `;

    // Get email address from task assignee or config
    const toEmail = request.assigneeEmail || process.env.APPROVAL_EMAIL_TO;
    
    if (!toEmail) {
      logger.warn(`No email recipient configured for approval request (task ${request.taskId}). Set APPROVAL_EMAIL_TO in environment.`);
      return;
    }

    await transporter.sendMail({
      from: emailConfig.from,
      to: toEmail,
      subject: `Code Review Required: Task ${request.taskId}`,
      text: textContent,
      html: htmlContent,
    });

    logger.info(`Sent approval email for task ${request.taskId} to ${toEmail}`);
  } catch (error: any) {
    logger.error(`Error sending approval email: ${error.message}`);
    throw error;
  }
}















