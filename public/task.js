// Task Detail Page JavaScript - Enhanced with real-time updates, better diff, modals, timeline

let taskId = null;
let taskData = null;
let diffData = null;
let autoRefreshInterval = null;
let lastDiffPollTime = 0;
const DIFF_POLL_INTERVAL = 15000; // 15 seconds

/**
 * Deep equality check that properly handles nested objects and arrays.
 * More reliable than JSON.stringify which fails on property reordering.
 * @param {any} obj1 
 * @param {any} obj2 
 * @returns {boolean}
 */
function deepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    
    if (obj1 == null || obj2 == null) return obj1 === obj2;
    
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return obj1 === obj2;
    
    if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
        if (!keys2.includes(key)) return false;
        if (!deepEqual(obj1[key], obj2[key])) return false;
    }
    
    return true;
}

/**
 * Classifies an error as terminal (should stop polling) or transient (should retry).
 * @param {Error} err 
 * @returns {boolean}
 */
function isTerminalError(err) {
    if (!err || !err.message) return false;
    const msg = err.message.toLowerCase();
    // 404 (Not Found) or 403 (Forbidden/Unauthorized) are terminal for task polling
    return msg.includes('404') || msg.includes('403') || msg.includes('not found') || msg.includes('forbidden');
}

/**
 * Checks if a specific task state requires polling for updates.
 * @param {string} state 
 * @returns {boolean}
 */
function shouldPollForState(state) {
    if (!state) return false;
    // Only states with active work should poll
    // awaiting_approval is user-action-dependent - no need to poll until user acts
    // approved, completed, rejected, error are terminal states - no polling needed
    return ['pending', 'in_progress', 'testing'].includes(state);
}

/**
 * Checks if the current task state requires polling for updates.
 * @returns {boolean}
 */
function shouldPoll() {
    return taskData && taskData.taskState && shouldPollForState(taskData.taskState.state);
}

// Workflow states in order
const workflowStates = [
    { state: 'pending', label: 'Pending', icon: 'clock' },
    { state: 'in_progress', label: 'In Progress', icon: 'refresh-cw' },
    { state: 'testing', label: 'Testing', icon: 'test-tube' },
    { state: 'awaiting_approval', label: 'Awaiting Approval', icon: 'eye' },
    { state: 'approved', label: 'Approved', icon: 'check-circle' },
    { state: 'completed', label: 'Completed', icon: 'zap' },
    { state: 'rejected', label: 'Rejected', icon: 'x-circle' },
    { state: 'error', label: 'Error', icon: 'alert-triangle' },
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize icons
    if (window.lucide) lucide.createIcons();
    
    // Theme toggle
    initTheme();

    const urlParams = new URLSearchParams(window.location.search);
    taskId = urlParams.get('taskId');
    
    // Redirect base demo URLs to the dedicated demo page
    // demo-{slug} (but NOT demo-{slug}-step2, etc.) should go to /demo.html
    if (taskId && taskId.startsWith('demo-') && !/^demo-.+-step\d+$/.test(taskId)) {
        const slug = taskId.replace(/^demo-/, '');
        window.location.replace(`/demo.html?slug=${slug}`);
        return; // Stop further initialization
    }
    
    if (!taskId) {
        showError('Task ID is required');
        return;
    }
    
    loadTaskDetails().then(() => loadAgentLogs());
    loadDiff();
    startConnectionPolling();
    loadAvailableModels();
    
    // Trigger agent button
    document.getElementById('triggerAgentBtnOverview')?.addEventListener('click', handleTriggerAgent);
    
    // Kill task button
    document.getElementById('killTaskBtn')?.addEventListener('click', handleKillTask);
    
    // Theme toggle button
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
    
    // Refresh button
    document.getElementById('refreshTaskBtn')?.addEventListener('click', () => {
        loadTaskDetails({ showNotification: true });
        loadDiff({ showNotification: true });
        loadAgentLogs(false);
    });

    // Retry screenshots button
    document.getElementById('retryScreenshotsBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('retryScreenshotsBtn');
        if (!btn || btn.disabled) return; // Prevent double-clicks
        
        btn.disabled = true;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Retrying...';
        if (window.lucide) lucide.createIcons();
        
        try {
            const response = await api.post(`/tasks/${taskId}/retry-screenshots`, {});
            if (response.success) {
                notifications.success('Screenshot capture restarted');
                btn.classList.add('hidden');
                // Trigger immediate re-render to show progress indicator
                await renderScreenshots();
            } else {
                // Re-enable button on error so user can try again
                btn.disabled = false;
                btn.innerHTML = originalHTML;
                if (window.lucide) lucide.createIcons();
                notifications.error(response.error || 'Failed to retry screenshots');
            }
        } catch (err) {
            // Re-enable button on error so user can try again
            btn.disabled = false;
            btn.innerHTML = originalHTML;
            if (window.lucide) lucide.createIcons();
            notifications.error(`Error: ${err.message}`);
        }
    });

    // Description edit buttons
    document.getElementById('editDescriptionBtn')?.addEventListener('click', toggleEditDescription);
    document.getElementById('cancelDescriptionBtn')?.addEventListener('click', toggleEditDescription);
    document.getElementById('saveDescriptionBtn')?.addEventListener('click', handleSaveDescription);
    
    // System Prompt buttons
    document.getElementById('togglePromptBtn')?.addEventListener('click', toggleSystemPrompt);
    document.getElementById('copyPromptBtn')?.addEventListener('click', copySystemPrompt);
    document.getElementById('editPromptBtn')?.addEventListener('click', toggleEditSystemPrompt);
    document.getElementById('cancelPromptBtn')?.addEventListener('click', toggleEditSystemPrompt);
    document.getElementById('savePromptBtn')?.addEventListener('click', handleSaveSystemPrompt);

    // Approval buttons
    const handleApproveClick = () => showModal('approveModal');
    const handleRejectClick = () => showModal('rejectModal');

    document.getElementById('approveBtn')?.addEventListener('click', handleApproveClick);
    
    document.getElementById('confirmApproveBtn')?.addEventListener('click', handleApprove);
    
    document.getElementById('closeApproveModal')?.addEventListener('click', () => {
        closeModal('approveModal');
    });
    
    document.getElementById('cancelApproveBtn')?.addEventListener('click', () => {
        closeModal('approveModal');
    });
    
    document.getElementById('rejectBtn')?.addEventListener('click', handleRejectClick);
    
    document.getElementById('confirmRejectBtn')?.addEventListener('click', handleReject);
    
    document.getElementById('closeRejectModal')?.addEventListener('click', () => {
        closeModal('rejectModal');
    });
    
    document.getElementById('cancelRejectBtn')?.addEventListener('click', () => {
        closeModal('rejectModal');
    });
    
    // Diff controls
    document.getElementById('expandAllBtn')?.addEventListener('click', () => expandCollapseAll(true));
    document.getElementById('collapseAllBtn')?.addEventListener('click', () => expandCollapseAll(false));
    document.getElementById('downloadDiffBtn')?.addEventListener('click', downloadDiff);
    
    // Copy buttons
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('copy-btn')) {
            const targetId = e.target.dataset.copyTarget;
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                copyToClipboard(targetElement.textContent.trim(), e.target);
            }
        }
    });
    
    // Model error modal handlers
    document.getElementById('closeModelErrorModal')?.addEventListener('click', () => {
        closeModal('modelErrorModal');
    });
    
    document.getElementById('cancelModelRetry')?.addEventListener('click', () => {
        closeModal('modelErrorModal');
    });
    
    document.getElementById('confirmModelRetry')?.addEventListener('click', handleModelRetry);

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay.id);
            }
        });
    });

    // Agent Feedback handlers
    setupAgentFeedbackHandlers();

    // Agent Logs controls
    setupLogsControls();

    // Scroll to top button - use passive listener for better scroll performance
    const scrollBtn = document.getElementById('scrollToTopBtn');
    let scrollTicking = false;
    window.addEventListener('scroll', () => {
        if (!scrollTicking) {
            window.requestAnimationFrame(() => {
                if (window.scrollY > 500) {
                    scrollBtn?.classList.remove('hidden');
                } else {
                    scrollBtn?.classList.add('hidden');
                }
                scrollTicking = false;
            });
            scrollTicking = true;
        }
    }, { passive: true });
    scrollBtn?.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Handle tab visibility changes for polling
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            // Tab became visible
            if (shouldPoll() && !autoRefreshInterval) {
                console.log('Tab visible and should poll, restarting refresh');
                startAutoRefresh();
                // Trigger immediate refresh when returning to tab
                loadTaskDetails({ silent: true });
                loadDiff({ silent: true });
                loadAgentLogs(true);
            }
        } else {
            // Tab hidden - stop timer to save resources but keep state
            if (autoRefreshInterval) {
                console.log('Tab hidden, pausing refresh loop');
                clearTimeout(autoRefreshInterval);
                autoRefreshInterval = null;
            }
        }
    });
});

// Theme Management - Using centralized ThemeUtils from theme.js

async function loadTaskDetails(options = {}) {
    // Handle both old and new signature
    const showNotification = typeof options === 'boolean' ? options : (options.showNotification || false);
    const silent = typeof options === 'object' ? (options.silent || false) : false;

    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const taskDetails = document.getElementById('taskDetails');
    const refreshBtn = document.getElementById('refreshTaskBtn');
    
    if (!silent) {
        loading.classList.remove('hidden');
        error.classList.add('hidden');
        taskDetails.classList.add('hidden');
        if (refreshBtn) refreshBtn.disabled = true;
    }
    
    try {
        const refreshParam = showNotification ? '?refresh=true' : '';
        const data = await api.get(`/tasks/${taskId}${refreshParam}`);
        
        // Preserve approval token if it exists locally and is missing in new data
        // This prevents token loss during shallow state merges
        if (taskData?.taskState?.metadata?.approvalToken && 
            data?.taskState?.state === 'awaiting_approval' &&
            !data?.taskState?.metadata?.approvalToken) {
            if (!data.taskState.metadata) {
                data.taskState.metadata = {};
            }
            data.taskState.metadata.approvalToken = taskData.taskState.metadata.approvalToken;
            console.log('Preserved approval token from previous state');
        }
        
        // Check if data has changed using deep equality
        const hasChanged = !deepEqual(data, taskData);
        
        // Track screenshot capture status changes for smart polling
        const prevCapturing = taskData?.taskState?.metadata?.capturingScreenshots;
        const nowCapturing = data?.taskState?.metadata?.capturingScreenshots;
        
        if (hasChanged || !silent) {
            taskData = data;
            
            renderTaskDetails();
            renderTimeline();
            
            // Re-render screenshots if capture status changed (especially when it finishes)
            if (prevCapturing !== nowCapturing) {
                if (prevCapturing && !nowCapturing) {
                    // Screenshots just finished capturing
                    console.log('Screenshot capture completed, refreshing gallery');
                }
                // Always re-render when capture status changes
                renderScreenshots();
            }
            
            if (!silent) {
                loading.classList.add('hidden');
                taskDetails.classList.remove('hidden');
            }
            
            if (showNotification) {
                notifications.success('Task details refreshed from ClickUp');
            }
        }
        
        // Start auto-refresh if in a state that requires polling
        if (shouldPollForState(taskData.taskState?.state) && !autoRefreshInterval) {
            startAutoRefresh();
        }
    } catch (err) {
        if (!silent) {
            loading.classList.add('hidden');
            showError(`Error loading task: ${err.message}`);
            notifications.error(`Failed to load task: ${err.message}`);
        }
        console.error('Error loading task:', err);

        // Stop polling on terminal errors
        if (isTerminalError(err)) {
            console.warn('Terminal error detected in loadTaskDetails, stopping auto-refresh');
            stopAutoRefresh();
        }
    } finally {
        if (!silent && refreshBtn) refreshBtn.disabled = false;
    }
}

async function loadQueueStatus(silent = false) {
    const section = document.getElementById('queueStatusSection');
    const badge = document.getElementById('queueStateBadge');
    const progressBar = document.getElementById('queueProgressBar');
    const currentStep = document.getElementById('queueCurrentStep');
    const percentText = document.getElementById('queuePercent');
    const notesContainer = document.getElementById('queueNotes');

    try {
        const status = await api.get('/cursor/status');
        
        // Only show if there's an active task and it matches our current taskId
        // or if it's the general dashboard (but this is task.js)
        if (!status || status.state === 'idle' || (status.task && status.task.taskId !== taskId)) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        
        // Update UI
        badge.textContent = FormattingUtils.formatState(status.state);
        badge.className = `state-badge ${status.state}`;
        
        const percent = status.percent || 0;
        progressBar.style.width = `${percent}%`;
        percentText.textContent = `${percent}%`;
        
        currentStep.textContent = status.step || 'Processing...';
        
        if (status.notes && status.notes.length > 0) {
            notesContainer.innerHTML = '<strong>Latest Notes:</strong><ul>' + 
                status.notes.map(note => `<li>${FormattingUtils.escapeHtml(note)}</li>`).join('') + 
                '</ul>';
        } else {
            notesContainer.innerHTML = '';
        }

        // If the task just finished, refresh the main task details
        if (status.state === 'done' || status.state === 'failed') {
            loadTaskDetails({ silent: true });
        }
    } catch (err) {
        console.error('Error loading queue status:', err);
        // Hide section on error to avoid showing stale data
        section?.classList.add('hidden');
    }
}

let logsCollapsed = false;
let lastLogsLength = 0;

async function loadAgentLogs(silent = false) {
    const section = document.getElementById('agentLogsSection');
    const container = document.getElementById('logsContainer');
    const countBadge = document.getElementById('logsCount');
    
    if (!section || !container) return;
    
    // Skip if taskData hasn't loaded yet (avoid premature hide on initial race)
    if (!taskData?.taskState) return;
    
    try {
        const response = await api.get(`/tasks/${taskId}/logs?tail=100`);
        
        if (!response || response.length === 0) {
            const activeStates = ['pending', 'in_progress', 'testing'];
            const isActive = activeStates.includes(taskData.taskState.state);
            if (isActive) {
                // Show section with waiting message for active tasks
                section.classList.remove('hidden');
                if (!silent || container.querySelector('.hint')) {
                    container.innerHTML = '<div class="log-entry hint">Waiting for agent activity...</div>';
                }
                if (countBadge) countBadge.textContent = '0 entries';
            } else if (taskData.taskState.state === 'error') {
                // Show section for error state (may help diagnose what went wrong)
                section.classList.remove('hidden');
                if (!silent || container.querySelector('.hint')) {
                    container.innerHTML = '<div class="log-entry hint">No agent activity recorded</div>';
                }
                if (countBadge) countBadge.textContent = '0 entries';
            } else {
                // No logs and task is finished — hide the section
                section.classList.add('hidden');
            }
            return;
        }
        
        section.classList.remove('hidden');
        
        // Only update if logs have changed (by length check for performance)
        if (response.length !== lastLogsLength || !silent) {
            lastLogsLength = response.length;
            
            // Build logs HTML
            const logsHtml = response.map(log => {
                const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
                const message = log.line || log.message || log.step || JSON.stringify(log);
                
                // Determine log type for styling
                let logClass = '';
                const msgLower = message.toLowerCase();
                
                if (msgLower.includes('error') || msgLower.includes('failed')) {
                    logClass = 'error';
                } else if (msgLower.includes('complete') || msgLower.includes('success') || msgLower.includes('✓')) {
                    logClass = 'success';
                } else if (msgLower.includes('step') && (msgLower.includes('complete') || msgLower.includes('finished'))) {
                    logClass = 'step-complete';
                } else if (msgLower.includes('warning') || msgLower.includes('warn')) {
                    logClass = 'warning';
                } else if (msgLower.includes('starting') || msgLower.includes('processing')) {
                    logClass = 'info';
                }
                
                return `<div class="log-entry ${logClass}"><span class="timestamp">${timestamp}</span>${FormattingUtils.escapeHtml(message)}</div>`;
            }).join('');
            
            container.innerHTML = logsHtml;
            
            // Update count badge
            if (countBadge) {
                countBadge.textContent = `${response.length} ${response.length === 1 ? 'entry' : 'entries'}`;
            }
            
            // Auto-scroll to bottom
            container.scrollTop = container.scrollHeight;
        }
    } catch (err) {
        console.error('Error loading agent logs:', err);
        // Don't hide the section on error, just log it
    }
}

function setupLogsControls() {
    const toggleBtn = document.getElementById('toggleLogsBtn');
    const refreshBtn = document.getElementById('refreshLogsBtn');
    const content = document.getElementById('agentLogsContent');
    
    toggleBtn?.addEventListener('click', () => {
        logsCollapsed = !logsCollapsed;
        content?.classList.toggle('collapsed', logsCollapsed);
        
        const icon = toggleBtn.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', logsCollapsed ? 'chevron-right' : 'chevron-down');
            if (window.lucide) lucide.createIcons();
        }
    });
    
    refreshBtn?.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.querySelector('i')?.classList.add('animate-spin');
        
        await loadAgentLogs(false);
        
        refreshBtn.disabled = false;
        refreshBtn.querySelector('i')?.classList.remove('animate-spin');
        notifications.success('Logs refreshed');
    });
}

async function loadDiff(options = {}) {
    // Handle both old and new signature
    const showNotification = typeof options === 'boolean' ? options : (options.showNotification || false);
    const silent = typeof options === 'object' ? (options.silent || false) : false;

    try {
        const data = await api.get(`/tasks/${taskId}/diff`);
        
        // Handle "no branch" case from backend (prevents 400 errors)
        if (data && data.noBranch) {
            document.getElementById('changesSummary').innerHTML = 
                `<div class="info">No changes available yet. A branch will be created when the workflow starts.</div>`;
            document.getElementById('diffViewer').innerHTML = 
                `<div class="info">No code changes available yet. The diff will appear once a branch is created and changes are made.</div>`;
            return;
        }

        // Check if data has changed using deep equality
        const hasChanged = !deepEqual(data, diffData);
        
        if (hasChanged || !silent) {
            diffData = data;
            renderChangesSummary();
            renderDiff();
            if (showNotification) {
                notifications.success('Diff refreshed');
            }
        }
    } catch (err) {
        if (!silent) {
            console.error('Error loading diff:', err);
            const isNoBranchError = err.message && err.message.includes('No branch');
            
            // Handle "no branch" error gracefully - show message instead of error
            if (isNoBranchError) {
                document.getElementById('changesSummary').innerHTML = 
                    `<div class="info">No changes available yet. A branch will be created when the workflow starts.</div>`;
                document.getElementById('diffViewer').innerHTML = 
                    `<div class="info">No code changes available yet. The diff will appear once a branch is created and changes are made.</div>`;
            } else {
                document.getElementById('changesSummary').innerHTML = 
                    `<div class="error">Error loading changes: ${err.message}</div>`;
                document.getElementById('diffViewer').innerHTML = 
                    `<div class="error">Error loading diff: ${err.message}</div>`;
                // Only show error notification for unexpected errors
                if (showNotification) {
                    notifications.error(`Failed to load diff: ${err.message}`);
                }
            }
        } else {
            console.error('Error loading diff (silent):', err);
            
            // Stop polling on terminal errors even in silent mode
            if (isTerminalError(err)) {
                console.warn('Terminal error detected in loadDiff, stopping auto-refresh');
                stopAutoRefresh();
            }
        }
    }
}

function startAutoRefresh() {
    // If already running or tab is hidden, don't start a new loop
    if (autoRefreshInterval || document.visibilityState !== 'visible') return;
    
    const indicator = document.getElementById('autoRefreshIndicator');
    if (indicator) indicator.classList.remove('hidden');
    
    console.log('Starting auto-refresh loop');
    
    const runPoll = async () => {
        if (document.visibilityState !== 'visible' || !shouldPoll()) {
            // FIX: Do one final load of task details and logs before stopping
            // so any completion-phase log entries (testing, approval) are captured
            try {
                await loadTaskDetails({ silent: true });
                await loadAgentLogs(true);
            } catch (e) {
                // Best-effort final refresh
            }
            stopAutoRefresh();
            return;
        }

        try {
            await loadTaskDetails({ silent: true });
            await loadQueueStatus(true);
            await loadAgentLogs(true);
            
            // Decoupled diff polling (Path 3 optimization)
            // Only poll diff in in_progress or testing states
            const state = taskData?.taskState?.state;
            if (['in_progress', 'testing'].includes(state)) {
                const now = Date.now();
                if (now - lastDiffPollTime >= DIFF_POLL_INTERVAL) {
                    await loadDiff({ silent: true });
                    lastDiffPollTime = now;
                }
            }
        } catch (err) {
            console.error('Auto-refresh loop error:', err);
            if (isTerminalError(err)) {
                stopAutoRefresh();
                return;
            }
        }

        // Determine next interval based on state:
        // - in_progress: 5s (active agent work)
        // - testing: 3s (tests running)
        // - pending: 3s (may start soon)
        // Note: awaiting_approval and terminal states don't poll (handled by shouldPoll())
        const currentState = taskData?.taskState?.state;
        const interval = currentState === 'in_progress' ? 5000 : 3000;
        
        // Only schedule next poll if we haven't been stopped
        if (autoRefreshInterval) {
            autoRefreshInterval = setTimeout(runPoll, interval);
        }
    };

    // Use a small initial delay to start the loop
    autoRefreshInterval = setTimeout(runPoll, 3000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearTimeout(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    
    const indicator = document.getElementById('autoRefreshIndicator');
    if (indicator) indicator.classList.add('hidden');
    console.log('Auto-refresh stopped');
}

let lastLoggedCommand = null;

function renderTaskDetails() {
    if (!taskData) return;
    
    const { taskState, taskInfo } = taskData;
    
    // Guard against missing taskState or state
    if (!taskState || !taskState.state) {
        console.warn('Task state data is incomplete');
        return;
    }

    const stateClass = taskState.state.replace(/_/g, '-');
    const formattedState = FormattingUtils.formatState(taskState.state);
    const taskTitle = taskInfo.task?.name || taskId;
    
    // Log agent command to console if available and new
    if (taskState.command && taskState.command !== lastLoggedCommand) {
        console.log(`%c[Cursor Agent Command] %c${taskState.command}`, 'color: #3b82f6; font-weight: bold', 'color: inherit');
        lastLoggedCommand = taskState.command;
    }
    
    // Main Header
    document.getElementById('taskName').textContent = taskTitle;
    const stateEl = document.getElementById('taskState');
    stateEl.textContent = formattedState;
    stateEl.className = `state-badge ${stateClass}`;
    
    // Add current step if available and meaningful (filter out stale queue messages)
    // Only show step for states where active processing occurs (not awaiting_approval where agent is idle)
    const existingStep = document.getElementById('currentStepDisplay');
    const isStaleQueueMessage = taskState.currentStep && (
        taskState.currentStep.toLowerCase().includes('waiting in queue') ||
        taskState.currentStep.toLowerCase().includes('queued') ||
        taskState.currentStep.toLowerCase().includes('position in queue')
    );
    const showStep = taskState.currentStep && 
                     !isStaleQueueMessage &&
                     (taskState.state === 'in_progress' || taskState.state === 'testing' || taskState.state === 'pending');
    
    if (showStep) {
        if (!existingStep) {
            const stepEl = document.createElement('div');
            stepEl.id = 'currentStepDisplay';
            stepEl.className = 'current-step-text';
            stateEl.parentNode.appendChild(stepEl);
        }
        document.getElementById('currentStepDisplay').textContent = `➜ ${taskState.currentStep}`;
    } else if (existingStep) {
        existingStep.remove();
    }
    
    // Meta Info
    document.getElementById('taskId').textContent = taskId;
    document.getElementById('clientName').textContent = taskInfo.clientName || 'N/A';
    document.getElementById('branchName').textContent = taskState.branchName || 'N/A';
    
    // Setup ClickUp link (hide for local tasks)
    const link = document.getElementById('clickUpUrl');
    const isLocalTask = taskId && taskId.startsWith('local-');
    if (link) {
        if (isLocalTask) {
            // Hide ClickUp link for local tasks
            link.closest('.meta-item')?.classList.add('hidden');
        } else {
            link.closest('.meta-item')?.classList.remove('hidden');
            let clickUpUrl = taskInfo.task?.url;
            if (!clickUpUrl || clickUpUrl === '#' || clickUpUrl.trim() === '') {
                clickUpUrl = `https://app.clickup.com/t/${taskId}`;
            }
            link.setAttribute('href', clickUpUrl);
            link.textContent = 'View Task ↗';
        }
    }
    
    // Add local task badge to header if this is a local task
    const stateBadgeContainer = document.querySelector('.task-title-group');
    if (stateBadgeContainer && isLocalTask) {
        // Check if badge already exists
        if (!stateBadgeContainer.querySelector('.local-task-badge')) {
            const localBadge = document.createElement('span');
            localBadge.className = 'local-task-badge';
            localBadge.textContent = 'Local Task';
            localBadge.title = 'This task was created locally, not imported from ClickUp';
            stateBadgeContainer.insertBefore(localBadge, stateBadgeContainer.firstChild);
        }
    }
    
    document.getElementById('createdAt').textContent = FormattingUtils.formatDate(taskState.createdAt);
    document.getElementById('updatedAt').textContent = FormattingUtils.formatRelativeTime(taskState.updatedAt);
    
    // System Prompt
    const systemPromptSection = document.getElementById('systemPromptSection');
    const systemPromptText = document.getElementById('systemPromptText');
    if (systemPromptSection && systemPromptText) {
        if (taskData.systemPrompt) {
            systemPromptSection.classList.remove('hidden');
            systemPromptText.textContent = taskData.systemPrompt;
        } else {
            systemPromptSection.classList.add('hidden');
        }
    }

    // Description
    const description = taskInfo.task?.description || 'No description provided';
    document.getElementById('taskDescription').textContent = description;
    
    // Attachments
    renderAttachments();
    
    // Show/hide approval section based on state
    const approvalSection = document.getElementById('approvalSection');
    
    if (taskState.state === 'awaiting_approval') {
        approvalSection?.classList.remove('hidden');
    } else {
        approvalSection?.classList.add('hidden');
    }
    
    // Toggle Trigger Agent button based on state
    const isRunning = ['in_progress', 'testing'].includes(taskState.state);
    const triggerBtnOverview = document.getElementById('triggerAgentBtnOverview');
    
    if (triggerBtnOverview) {
        triggerBtnOverview.disabled = isRunning;
        if (isRunning) {
            triggerBtnOverview.innerHTML = '<span class="loading-spinner"></span> Agent Running...';
        } else {
            triggerBtnOverview.innerHTML = '🤖 Run Agent';
        }
    }
    
    // Show enhanced error section if error state
    renderErrorSection(taskState);

    // Visual Changes / Screenshots
    renderScreenshots();

    // Render Demo Progress if it's a demo task
    if (taskId.startsWith('demo-')) {
        renderDemoProgress();
    } else {
        document.getElementById('demoStepsContainer')?.classList.add('hidden');
    }

    // Path 2 & 3: Ensure polling stops if we're in a terminal state
    if (!shouldPollForState(taskState.state)) {
        stopAutoRefresh();
    }

    // Update feedback section based on current state
    updateFeedbackSectionState();

    // Re-initialize icons
    if (window.lucide) lucide.createIcons();
}

/**
 * Renders the multi-step progress for demo tasks.
 */
function renderDemoProgress() {
    const container = document.getElementById('demoStepsContainer');
    if (!container || !taskData) return;

    const metadata = taskData.taskState?.metadata || {};
    const currentStep = metadata.demoStep || 1;
    // Use dynamic totalSteps from backend metadata, fallback to 4 (standard demo workflow)
    const totalSteps = metadata.totalSteps || 4;
    
    container.classList.remove('hidden');

    // Update counter
    const counter = document.getElementById('demoStepCounter');
    if (counter) counter.textContent = `Step ${currentStep} of ${totalSteps}`;

    // Update progress bar
    const progressBar = document.getElementById('demoProgressBar');
    if (progressBar) {
        const percent = (currentStep / totalSteps) * 100;
        progressBar.style.width = `${percent}%`;
    }

    // Update step dots (using new demo-step class)
    document.querySelectorAll('.demo-step').forEach(stepEl => {
        const stepNum = parseInt(stepEl.dataset.step);
        stepEl.classList.remove('active', 'completed');
        
        if (stepNum === currentStep) {
            stepEl.classList.add('active');
        } else if (stepNum < currentStep) {
            stepEl.classList.add('completed');
        }
    });
}

let gallery = null;
let screenshotRefreshBtnInitialized = false;
let screenshotPollingTimer = null; // Prevent multiple polling loops
let isRenderingScreenshots = false; // Prevent concurrent renders

// Helper function to escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function checkScreenshotStatus(taskId) {
    if (!taskId) {
        console.warn('checkScreenshotStatus called with invalid taskId');
        return { capturing: false, phase: 'before', progress: 0 };
    }
    
    try {
        const response = await api.get(`/tasks/${taskId}/screenshot-status`);
        // Validate response structure
        return {
            capturing: Boolean(response?.capturing),
            phase: response?.phase || 'before',
            progress: typeof response?.progress === 'number' ? response.progress : 0
        };
    } catch (err) {
        console.error('Error checking screenshot status:', err);
        return { capturing: false, phase: 'before', progress: 0 };
    }
}

async function renderScreenshots() {
    // Prevent concurrent renders
    if (isRenderingScreenshots) {
        return;
    }
    
    if (!taskData) return;
    
    const visualChangesSection = document.getElementById('visualChangesSection');
    const galleryContainer = document.getElementById('screenshotGalleryContainer');
    
    if (!visualChangesSection || !galleryContainer) return;
    
    isRenderingScreenshots = true;
    
    try {

    // For demo step tasks (e.g., demo-slug-step2), screenshots are stored under
    // the base demo taskId (demo-slug), not the step-specific ID
    let screenshotTaskId = taskId;
    const stepMatch = taskId.match(/^(demo-.+)-step\d+$/);
    if (stepMatch) {
        screenshotTaskId = stepMatch[1]; // Use base demo taskId for screenshots
    }

    // Check if screenshots are currently being captured
    const status = await checkScreenshotStatus(screenshotTaskId);
    
    if (status.capturing) {
        // Show progress indicator instead of empty gallery
        const safePhase = escapeHtml(status.phase || 'screenshots');
        const safeProgress = Math.min(100, Math.max(0, status.progress || 0)); // Clamp 0-100
        
        galleryContainer.innerHTML = `
            <div class="screenshot-capturing-indicator" style="text-align: center; padding: 3rem; background: var(--bg-secondary); border-radius: 8px; margin: 1rem 0;">
                <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid var(--border-color); border-top-color: var(--primary-color); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 1rem;"></div>
                <p style="font-size: 1.1rem; font-weight: 500; margin-bottom: 0.5rem;">Capturing ${safePhase}...</p>
                <div style="max-width: 400px; margin: 1rem auto; background: var(--bg-tertiary); border-radius: 4px; height: 8px; overflow: hidden;">
                    <div style="background: var(--primary-color); height: 100%; width: ${safeProgress}%; transition: width 0.3s ease;"></div>
                </div>
                <p style="color: var(--text-muted); font-size: 0.9rem;">This may take 1-2 minutes for large sites</p>
            </div>
        `;
        
        // Clear any existing polling timer to prevent multiple loops
        if (screenshotPollingTimer) {
            clearTimeout(screenshotPollingTimer);
        }
        
        // Poll again in 3 seconds (release lock before scheduling to avoid blocking)
        screenshotPollingTimer = setTimeout(() => {
            screenshotPollingTimer = null;
            isRenderingScreenshots = false; // Reset flag before next call
            renderScreenshots();
        }, 3000);
        return;
    }
    
    // Clear polling timer if we're not capturing anymore
    if (screenshotPollingTimer) {
        clearTimeout(screenshotPollingTimer);
        screenshotPollingTimer = null;
    }
    
    // Check if screenshots failed and show error message
    if (taskData?.taskState?.screenshotCaptureSuccess === false) {
        const retryBtn = document.getElementById('retryScreenshotsBtn');
        if (retryBtn) {
            retryBtn.classList.remove('hidden');
        }
        
        // Escape error message to prevent XSS
        const safeError = escapeHtml(taskData.taskState.screenshotError || 'Unknown error');
        
        // Show error message in gallery
        galleryContainer.innerHTML = `
            <div class="screenshot-error" style="text-align: center; padding: 3rem; background: var(--bg-secondary); border-radius: 8px; margin: 1rem 0; border: 1px solid var(--error-color);">
                <i data-lucide="alert-circle" style="width: 48px; height: 48px; color: var(--error-color); margin-bottom: 1rem;"></i>
                <p style="font-size: 1.1rem; font-weight: 500; margin-bottom: 0.5rem; color: var(--error-color);">Screenshot capture failed</p>
                <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.5rem;">${safeError}</p>
                <p style="color: var(--text-muted); font-size: 0.9rem;">Click "Retry Capture" above to try again</p>
            </div>
        `;
        
        // Reinitialize Lucide icons for the error icon
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        return;
    }

    // Initialize gallery if not already done
    if (!gallery) {
        gallery = createScreenshotGallery('screenshotGalleryContainer', {
            showPageTabs: true,
            showSectionThumbnails: true,
            enableComparison: true,
            enableLightbox: true,
            comparisonMode: 'side-by-side'
        });
    }
    
    // Load screenshots from the API
    gallery.loadScreenshots(screenshotTaskId);
    
    // Hide retry button if screenshots are successful
    const retryBtn = document.getElementById('retryScreenshotsBtn');
    if (retryBtn) {
        retryBtn.classList.add('hidden');
    }
    
    // Setup refresh button (only once, using module-level flag instead of DOM property)
    const refreshBtn = document.getElementById('refreshScreenshotsBtn');
    if (refreshBtn && !screenshotRefreshBtnInitialized) {
        screenshotRefreshBtnInitialized = true;
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            refreshBtn.querySelector('i')?.classList.add('animate-spin');
            
            try {
                await gallery.loadScreenshots(screenshotTaskId);
                notifications.success('Screenshots refreshed');
            } catch (err) {
                notifications.error('Failed to refresh screenshots');
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.querySelector('i')?.classList.remove('animate-spin');
            }
        });
    }
    
    } catch (err) {
        console.error('Error in renderScreenshots:', err);
        // Show error in UI
        if (galleryContainer) {
            galleryContainer.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: var(--error-color);">
                    <p>Error loading screenshots</p>
                </div>
            `;
        }
    } finally {
        // Always reset the rendering flag
        isRenderingScreenshots = false;
    }
}

function renderTimeline() {
    if (!taskData) return;
    
    const { taskState } = taskData;
    const currentState = taskState.state;
    const timeline = document.getElementById('timeline');
    const timelineSection = document.getElementById('timelineSection');
    
    if (!timeline || !timelineSection) return;
    
    // Define the valid workflow progression path (non-terminal states)
    // Error, rejected, approved, completed are terminal/branch states
    const progressionPath = ['pending', 'in_progress', 'testing', 'awaiting_approval'];
    
    // Determine which states should show as completed based on actual workflow progression
    // Only mark states as completed if they are in the progression path AND come before the current state
    const currentProgressIndex = progressionPath.indexOf(currentState);
    const completedStates = new Set();
    
    if (currentProgressIndex > 0) {
        // Only states that precede the current state in the normal flow are completed
        progressionPath.slice(0, currentProgressIndex).forEach(s => completedStates.add(s));
    } else if (currentState === 'approved' || currentState === 'completed') {
        // For approved/completed, the full progression path was followed
        progressionPath.forEach(s => completedStates.add(s));
        if (currentState === 'completed') completedStates.add('approved');
    } else if (currentState === 'rejected') {
        // Rejected comes from awaiting_approval, so the path up to there is completed
        ['pending', 'in_progress', 'testing', 'awaiting_approval'].forEach(s => completedStates.add(s));
    } else if (currentState === 'error') {
        // For error state, don't mark any states as completed - error can occur at any point
        // The timeline should reflect that we didn't successfully complete the workflow
    }
    
    let html = '';
    
    workflowStates.forEach((stateInfo) => {
        const isCurrent = stateInfo.state === currentState;
        const isCompleted = completedStates.has(stateInfo.state);
        
        let statusClass = '';
        if (isCurrent) {
            statusClass = stateInfo.state === 'error' ? 'error' : 'active';
        } else if (isCompleted) {
            statusClass = 'completed';
        }
        
        const time = isCurrent ? (taskState.currentStep || FormattingUtils.formatRelativeTime(taskState.updatedAt)) : '';
        
        html += `
            <div class="timeline-item ${statusClass}">
                <div class="timeline-content">
                    <div class="timeline-title">
                        <i data-lucide="${stateInfo.icon}"></i>
                        <span>${stateInfo.label}</span>
                    </div>
                    ${time ? `<div class="timeline-time">${time}</div>` : ''}
                </div>
            </div>
        `;
    });
    
    timeline.innerHTML = html;
    timelineSection.classList.remove('hidden');
    
    // Refresh icons
    if (window.lucide) lucide.createIcons();
}

function renderChangesSummary() {
    if (!diffData) return;
    
    const summary = `
        <div class="changes-summary-stats">
            <div class="stat-card">
                <div class="stat-icon"><i data-lucide="file-text"></i></div>
                <div class="stat-info">
                    <div class="stat-value">${diffData.filesModified || 0}</div>
                    <div class="stat-label">Modified</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i data-lucide="file-plus"></i></div>
                <div class="stat-info">
                    <div class="stat-value">${diffData.filesAdded || 0}</div>
                    <div class="stat-label">Added</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i data-lucide="file-minus"></i></div>
                <div class="stat-info">
                    <div class="stat-value">${diffData.filesDeleted || 0}</div>
                    <div class="stat-label">Deleted</div>
                </div>
            </div>
            <div class="stat-card additions">
                <div class="stat-icon"><i data-lucide="trending-up"></i></div>
                <div class="stat-info">
                    <div class="stat-value">+${diffData.linesAdded || 0}</div>
                    <div class="stat-label">Additions</div>
                </div>
            </div>
            <div class="stat-card deletions">
                <div class="stat-icon"><i data-lucide="trending-down"></i></div>
                <div class="stat-info">
                    <div class="stat-value">-${diffData.linesRemoved || 0}</div>
                    <div class="stat-label">Deletions</div>
                </div>
            </div>
        </div>
        <div class="file-list">
            <h4>Changed Files</h4>
            <div class="file-items-container">
                ${(diffData.fileList || []).map(file => `
                    <div class="file-item-row">
                        <div class="file-item-main">
                            <span class="file-status-icon ${file.status || 'modified'}">
                                ${file.status === 'added' ? '<i data-lucide="file-plus"></i>' : 
                                  file.status === 'deleted' ? '<i data-lucide="file-minus"></i>' : 
                                  '<i data-lucide="file-text"></i>'}
                            </span>
                            <span class="file-item-path" title="${FormattingUtils.escapeHtml(file.path)}">${FormattingUtils.escapeHtml(file.path)}</span>
                        </div>
                        <div class="file-item-stats">
                            ${file.additions !== undefined ? `<span class="diff-tag addition">+${file.additions}</span>` : ''}
                            ${file.deletions !== undefined ? `<span class="diff-tag deletion">-${file.deletions}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    document.getElementById('changesSummary').innerHTML = summary;
    if (window.lucide) lucide.createIcons();
}

function getFileStatusIcon(status) {
    switch (status) {
        case 'added': return '🆕';
        case 'deleted': return '❌';
        case 'renamed': return '📝';
        default: return '📄';
    }
}

function renderDiff() {
    if (!diffData || !diffData.fullDiff) {
        document.getElementById('diffViewer').innerHTML = '<div class="loading">No changes to display</div>';
        return;
    }
    
    const files = DiffUtils.parseDiff(diffData.fullDiff);
    const diffHtml = files.map((file, fileIndex) => createDiffFile(file, fileIndex)).join('');
    
    document.getElementById('diffViewer').innerHTML = diffHtml;
    
    // Add toggle handlers
    document.querySelectorAll('.diff-file-header').forEach(header => {
        header.addEventListener('click', () => {
            const file = header.closest('.diff-file');
            file.classList.toggle('collapsed');
            const toggle = header.querySelector('.diff-file-toggle');
            toggle.textContent = file.classList.contains('collapsed') ? '▶' : '▼';
        });
    });
    
    // Add copy path buttons
    document.querySelectorAll('.diff-file-path').forEach(pathEl => {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn btn-icon';
        copyBtn.innerHTML = '<i data-lucide="copy"></i>';
        copyBtn.title = 'Copy file path';
        copyBtn.style.marginLeft = '10px';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(pathEl.textContent.trim(), copyBtn);
        });
        pathEl.parentElement.appendChild(copyBtn);
    });

    if (window.lucide) lucide.createIcons();
}

function createDiffFile(file, fileIndex) {
    let oldLineNum = 0;
    let newLineNum = 0;
    
    const lines = file.lines.map((line, index) => {
        let lineNumHtml = '';
        
        if (line.type === 'hunk') {
            const match = line.content.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
            if (match) {
                oldLineNum = parseInt(match[1]) - 1;
                newLineNum = parseInt(match[3]) - 1;
            }
            lineNumHtml = '<span class="diff-line-number"></span>';
        } else if (line.type === 'removed') {
            oldLineNum++;
            lineNumHtml = `<span class="diff-line-number">${oldLineNum}</span>`;
        } else if (line.type === 'added') {
            newLineNum++;
            lineNumHtml = `<span class="diff-line-number">${newLineNum}</span>`;
        } else if (line.type === 'context') {
            oldLineNum++;
            newLineNum++;
            lineNumHtml = `<span class="diff-line-number">${oldLineNum}</span>`;
        } else {
            lineNumHtml = '<span class="diff-line-number"></span>';
        }
        
        return `
            <div class="diff-line ${line.type}">
                ${lineNumHtml}
                <span class="diff-line-content">${DiffUtils.escapeHtml(line.content)}</span>
            </div>
        `;
    }).join('');
    
    return `
        <div class="diff-file" data-file-index="${fileIndex}">
            <div class="diff-file-header">
                <span class="diff-file-path">${DiffUtils.escapeHtml(file.path)}</span>
                <span class="diff-file-toggle">▼</span>
            </div>
            <div class="diff-content">${lines}</div>
        </div>
    `;
}

function expandCollapseAll(expand) {
    document.querySelectorAll('.diff-file').forEach(file => {
        if (expand) {
            file.classList.remove('collapsed');
            file.querySelector('.diff-file-toggle').textContent = '▼';
        } else {
            file.classList.add('collapsed');
            file.querySelector('.diff-file-toggle').textContent = '▶';
        }
    });
}

function downloadDiff() {
    if (!diffData || !diffData.fullDiff) {
        notifications.warning('No diff available to download');
        return;
    }
    
    const blob = new Blob([diffData.fullDiff], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diff-${taskId}-${Date.now()}.patch`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    notifications.success('Diff downloaded');
}

function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
        const originalText = button.textContent;
        button.textContent = '✓';
        button.classList.add('copied');
        setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove('copied');
        }, 2000);
        notifications.success('Copied to clipboard');
    }).catch(err => {
        notifications.error('Failed to copy to clipboard');
        console.error('Copy error:', err);
    });
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        // Use setTimeout to ensure CSS transition works
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        // Wait for transition to complete before hiding
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300);
        
        // Clear reject reason
        if (modalId === 'rejectModal') {
            const reasonInput = document.getElementById('rejectReason');
            if (reasonInput) reasonInput.value = '';
        }
    }
}

// Make closeModal available globally for backwards compatibility
window.closeModal = closeModal;

async function handleApprove() {
    closeModal('approveModal');
    
    const approvalToken = taskData?.taskState?.metadata?.approvalToken;
    if (!approvalToken) {
        notifications.error('No approval token found. The task may not be in awaiting approval state.');
        return;
    }
    
    try {
        const response = await fetch(`/approve/${approvalToken}`, {
            method: 'GET'
        });
        
        if (response.ok) {
            notifications.success('Changes approved successfully!');
            
            // Update local state immediately for responsive UI
            if (taskData?.taskState) {
                taskData.taskState.state = 'approved';
                taskData.taskState.updatedAt = new Date().toISOString();
                if (taskData.taskState.metadata) {
                    delete taskData.taskState.metadata.approvalToken;
                }
                renderTaskDetails();
                renderTimeline();
            }
            
            // Fetch actual server state after a brief delay
            setTimeout(() => {
                loadTaskDetails({ silent: true });
                loadDiff({ silent: true });
            }, 2000);
        } else {
            const text = await response.text();
            notifications.error(`Failed to approve: ${text}`);
        }
    } catch (err) {
        notifications.error(`Error approving changes: ${err.message}`);
        console.error('Error approving:', err);
    }
}

async function handleReject() {
    const reason = document.getElementById('rejectReason').value.trim();
    closeModal('rejectModal');
    
    const approvalToken = taskData?.taskState?.metadata?.approvalToken;
    if (!approvalToken) {
        notifications.error('No approval token found. The task may not be in awaiting approval state.');
        return;
    }
    
    try {
        const url = `/reject/${approvalToken}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`;
        const response = await fetch(url, {
            method: 'GET'
        });
        
        if (response.ok) {
            notifications.success('Changes rejected successfully!');
            
            // Update local state immediately for responsive UI
            if (taskData?.taskState) {
                taskData.taskState.state = 'rejected';
                taskData.taskState.updatedAt = new Date().toISOString();
                if (reason) taskData.taskState.error = `Rejected: ${reason}`;
                if (taskData.taskState.metadata) {
                    delete taskData.taskState.metadata.approvalToken;
                }
                renderTaskDetails();
                renderTimeline();
            }
            
            // Fetch actual server state after a brief delay
            setTimeout(() => {
                loadTaskDetails({ silent: true });
                loadDiff({ silent: true });
            }, 2000);
        } else {
            const text = await response.text();
            notifications.error(`Failed to reject: ${text}`);
        }
    } catch (err) {
        notifications.error(`Error rejecting changes: ${err.message}`);
        console.error('Error rejecting:', err);
    }
}

let availableModelsCache = [];

async function loadAvailableModels() {
    try {
        const modelsData = await api.get('/models');
        availableModelsCache = modelsData.availableModels || ['gpt-4', 'gpt-4-turbo', 'claude-3.5-sonnet'];
        const defaultModel = modelsData.defaultModel || 'gpt-4';
        
        const agentModelSelect = document.getElementById('agentModelSelect');
        const retryModelSelect = document.getElementById('retryModelSelect');
        
        if (agentModelSelect) {
            agentModelSelect.innerHTML = '';
            availableModelsCache.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                if (model === defaultModel) option.selected = true;
                agentModelSelect.appendChild(option);
            });
        }
        
        if (retryModelSelect) {
            retryModelSelect.innerHTML = '';
            availableModelsCache.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                retryModelSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Failed to load available models:', error);
        // Use fallback defaults
        availableModelsCache = ['gpt-4', 'gpt-4-turbo', 'claude-3.5-sonnet', 'claude-3-haiku'];
        const agentModelSelect = document.getElementById('agentModelSelect');
        if (agentModelSelect) {
            agentModelSelect.innerHTML = '';
            availableModelsCache.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                agentModelSelect.appendChild(option);
            });
        }
    }
}

function showModelErrorModal(failedModel) {
    const modal = document.getElementById('modelErrorModal');
    const failedModelName = document.getElementById('failedModelName');
    const retryModelSelect = document.getElementById('retryModelSelect');
    
    if (failedModelName) failedModelName.textContent = failedModel;
    
    // Populate retry select with available models (excluding the failed one)
    if (retryModelSelect) {
        retryModelSelect.innerHTML = '';
        availableModelsCache.filter(m => m !== failedModel).forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            retryModelSelect.appendChild(option);
        });
    }
    
    showModal('modelErrorModal');
}

async function handleModelRetry() {
    const retryModelSelect = document.getElementById('retryModelSelect');
    const selectedModel = retryModelSelect?.value;
    
    if (!selectedModel) {
        notifications.warning('Please select a model');
        return;
    }
    
    closeModal('modelErrorModal');
    
    // Update the main model select and trigger agent
    const agentModelSelect = document.getElementById('agentModelSelect');
    if (agentModelSelect) agentModelSelect.value = selectedModel;
    
    await handleTriggerAgent();
}

async function handleTriggerAgent() {
    if (!taskId) {
        notifications.error('Task ID is required');
        return;
    }
    
    const triggerBtnOverview = document.getElementById('triggerAgentBtnOverview');
    const agentModelSelect = document.getElementById('agentModelSelect');
    const selectedModel = agentModelSelect?.value || undefined;
    
    if (triggerBtnOverview) {
        triggerBtnOverview.disabled = true;
        triggerBtnOverview.textContent = '⏳ Starting...';
    }
    
    try {
        // Status updates for better UX
        const updateStatus = (text, delay) => new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });

        const triggerPromise = api.post(`/tasks/${taskId}/trigger-agent`, { model: selectedModel });
        
        await updateStatus('Claiming task & preparing workspace...', 500);
        await updateStatus('Starting single-shot agent...', 1000);
        
        const response = await triggerPromise;
        
        // Handle model error response
        if (response.modelError) {
            showModelErrorModal(response.failedModel);
            return;
        }

        if (response.success) {
            notifications.success('Cursor agent started! It will handle this task and exit.');
            
            // Clear diff view since new changes will come
            diffData = null;
            const changesSummary = document.getElementById('changesSummary');
            const diffViewer = document.getElementById('diffViewer');
            if (changesSummary) changesSummary.innerHTML = '<div class="info">Agent triggered, waiting for new changes...</div>';
            if (diffViewer) diffViewer.innerHTML = '<div class="info">Agent triggered, waiting for new changes...</div>';

            // Start polling immediately if not already running
            if (!autoRefreshInterval) {
                startAutoRefresh();
            }

            // Immediately fetch actual backend state instead of assuming 'pending'
            // This avoids race conditions where UI shows stale state
            loadTaskDetails({ silent: true });
        } else {
            notifications.error(response.error || 'Failed to trigger agent');
        }
    } catch (err) {
        notifications.error(`Error triggering agent: ${err.message}`);
        console.error('Error triggering agent:', err);
    } finally {
        if (triggerBtnOverview) {
            triggerBtnOverview.disabled = false;
            triggerBtnOverview.innerHTML = '🤖 Run Agent';
        }
    }
}

async function handleKillTask() {
    if (!taskId) {
        notifications.error('Task ID is required');
        return;
    }
    
    // Confirm with user
    if (!confirm(`Are you sure you want to kill task ${taskId}? This will stop the task and remove it from the queue.`)) {
        return;
    }
    
    const killBtn = document.getElementById('killTaskBtn');
    if (killBtn) {
        killBtn.disabled = true;
        killBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Killing...';
        if (window.lucide) lucide.createIcons();
    }
    
    try {
        const response = await api.post(`/tasks/${taskId}/kill`, {});
        
        if (response.success) {
            notifications.success('Task killed successfully');
            stopAutoRefresh();
            
            // Update local state to reflect killed status instead of redirecting
            // This allows users to review the task's final state
            if (taskData?.taskState) {
                taskData.taskState.state = 'error';
                taskData.taskState.error = 'Task was manually killed';
                taskData.taskState.updatedAt = new Date().toISOString();
                renderTaskDetails();
                renderTimeline();
            }
            
            // Refresh from server to get accurate final state
            setTimeout(() => {
                loadTaskDetails({ silent: true });
            }, 2000);
        } else {
            notifications.error(response.error || 'Failed to kill task');
        }
    } catch (err) {
        notifications.error(`Error killing task: ${err.message}`);
        console.error('Error killing task:', err);
    } finally {
        if (killBtn) {
            killBtn.disabled = false;
            killBtn.innerHTML = '<i data-lucide="x-octagon"></i> Kill Task';
            if (window.lucide) lucide.createIcons();
        }
    }
}

function toggleEditDescription() {
    const content = document.getElementById('taskDescription');
    const container = document.getElementById('editDescriptionContainer');
    const input = document.getElementById('editDescriptionInput');
    const editBtn = document.getElementById('editDescriptionBtn');

    if (content.classList.contains('hidden')) {
        // Cancel edit
        content.classList.remove('hidden');
        container.classList.add('hidden');
        editBtn.classList.remove('hidden');
    } else {
        // Start edit
        input.value = taskData.taskInfo.task?.description || '';
        content.classList.add('hidden');
        container.classList.remove('hidden');
        editBtn.classList.add('hidden');
        input.focus();
    }
}

async function handleSaveDescription() {
    const input = document.getElementById('editDescriptionInput');
    const saveBtn = document.getElementById('saveDescriptionBtn');
    const newDescription = input.value;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const result = await api.patch(`/tasks/${taskId}/description`, { description: newDescription });
        if (result.success) {
            notifications.success('Description updated successfully');
            taskData.taskInfo.task.description = newDescription;
            document.getElementById('taskDescription').textContent = newDescription || 'No description provided';
            toggleEditDescription();
        } else {
            notifications.error(result.error || 'Failed to update description');
        }
    } catch (err) {
        notifications.error(`Error saving description: ${err.message}`);
        console.error('Save description error:', err);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
    }
}

function toggleSystemPrompt() {
    const content = document.getElementById('systemPromptContent');
    const btn = document.getElementById('togglePromptBtn');
    if (!content || !btn) return;

    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        btn.textContent = 'Hide Details';
    } else {
        content.classList.add('collapsed');
        btn.textContent = 'Show Details';
    }
}

function toggleEditSystemPrompt() {
    const content = document.getElementById('systemPromptContent');
    const container = document.getElementById('editPromptContainer');
    const input = document.getElementById('editPromptInput');
    const editBtn = document.getElementById('editPromptBtn');
    const copyBtn = document.getElementById('copyPromptBtn');
    const toggleBtn = document.getElementById('togglePromptBtn');

    if (content.classList.contains('hidden')) {
        // Cancel edit
        content.classList.remove('hidden');
        container.classList.add('hidden');
        editBtn.classList.remove('hidden');
        copyBtn.classList.remove('hidden');
        toggleBtn.classList.remove('hidden');
    } else {
        // Start edit
        input.value = taskData.systemPrompt || '';
        content.classList.add('hidden');
        container.classList.remove('hidden');
        editBtn.classList.add('hidden');
        copyBtn.classList.add('hidden');
        toggleBtn.classList.add('hidden');
        input.focus();
    }
}

async function handleSaveSystemPrompt() {
    const input = document.getElementById('editPromptInput');
    const saveBtn = document.getElementById('savePromptBtn');
    const newPrompt = input.value;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const result = await api.patch(`/tasks/${taskId}/system-prompt`, { systemPrompt: newPrompt });
        if (result.success) {
            notifications.success('System prompt updated successfully');
            taskData.systemPrompt = newPrompt;
            document.getElementById('systemPromptText').textContent = newPrompt;
            toggleEditSystemPrompt();
        } else {
            notifications.error(result.error || 'Failed to update system prompt');
        }
    } catch (err) {
        notifications.error(`Error saving system prompt: ${err.message}`);
        console.error('Save system prompt error:', err);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
    }
}

function copySystemPrompt() {
    if (!taskData || !taskData.systemPrompt) return;
    const btn = document.getElementById('copyPromptBtn');
    copyToClipboard(taskData.systemPrompt, btn);
}

function showError(message) {
    const error = document.getElementById('error');
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
    if (error) {
        error.classList.remove('hidden');
        error.textContent = message;
    }
}

function renderAttachments() {
    if (!taskData || !taskData.taskInfo || !taskData.taskInfo.task) return;
    
    const attachments = taskData.taskInfo.task.attachments || [];
    const section = document.getElementById('attachmentsSection');
    const list = document.getElementById('attachmentsList');
    
    if (!section || !list) return;
    
    if (attachments.length === 0) {
        section.classList.add('hidden');
        return;
    }
    
    section.classList.remove('hidden');
    
    list.innerHTML = attachments.map(a => {
        const name = a.name || a.title || 'Unnamed file';
        const url = a.url_w_query || a.url;
        const previewUrl = a.thumbnail_medium || a.thumbnail_small || a.url_w_query || a.url;
        
        // Better image detection
        const extension = (a.extension || '').toLowerCase();
        const mimetype = (a.mimetype || '').toLowerCase();
        const lowerName = name.toLowerCase();
        
        const isImage = 
            ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension) ||
            mimetype.startsWith('image/') ||
            (lowerName.match(/\.(jpg|jpeg|png|gif|webp|svg)$/) && !lowerName.endsWith('.url')) ||
            (!!a.thumbnail_medium && !lowerName.endsWith('.url'));
        
        const previewHtml = isImage 
            ? `<img src="${previewUrl}" alt="${FormattingUtils.escapeHtml(name)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
               <div class="attachment-fallback hidden"><i data-lucide="file-text"></i></div>`
            : `<i data-lucide="file-text"></i>`;
            
        return `
            <a href="${url}" target="_blank" class="attachment-item" title="${FormattingUtils.escapeHtml(name)}">
                <div class="attachment-preview">
                    ${previewHtml}
                </div>
                <div class="attachment-name">${FormattingUtils.escapeHtml(name)}</div>
            </a>
        `;
    }).join('');
    
    if (window.lucide) lucide.createIcons();
}

let connectionPollingInterval = null;

// Connection Polling Logic
function startConnectionPolling() {
    if (connectionPollingInterval) return;
    
    const setupInterval = () => {
        checkConnection();
        connectionPollingInterval = setInterval(checkConnection, 30000); // Check every 30 seconds
    };

    // Perform first check after everything has rendered
    if (document.readyState === 'complete') {
        setupInterval();
    } else {
        window.addEventListener('load', setupInterval);
    }
}

async function checkConnection() {
    try {
        const data = await api.get('/health');
        updateConnectionStatus(data.clickup?.status || 'disconnected', data.clickup?.user);
    } catch (error) {
        updateConnectionStatus('offline');
    }
}

function updateConnectionStatus(status, user) {
    const indicator = document.getElementById('statusIndicator');
    const text = document.getElementById('statusText');
    
    if (!indicator || !text) return;
    
    indicator.className = 'status-indicator';
    
    switch (status) {
        case 'connected':
            indicator.classList.add('status-online');
            text.textContent = user ? `Connected: ${user.username}` : 'ClickUp Connected';
            break;
        case 'expired':
            indicator.classList.add('status-expired');
            text.innerHTML = 'ClickUp Token Expired <a href="/auth/clickup" class="connect-link">Reconnect</a>';
            break;
        case 'disconnected':
            indicator.classList.add('status-offline');
            text.innerHTML = 'ClickUp Disconnected <a href="/auth/clickup" class="connect-link">Connect</a>';
            break;
        case 'offline':
        default:
            indicator.classList.add('status-offline');
            text.textContent = 'Server Offline';
            break;
    }
}

// Cleanup on page unload/navigation
['beforeunload', 'pagehide', 'unload'].forEach(event => {
    window.addEventListener(event, () => {
        stopAutoRefresh();
        if (connectionPollingInterval) {
            clearInterval(connectionPollingInterval);
            connectionPollingInterval = null;
        }
    });
});

// ============================================
// Agent Feedback Functions
// ============================================

let feedbackHistoryVisible = false;
let feedbackHandlersInitialized = false;

/**
 * Sets up all event handlers for the agent feedback section.
 * Guards against duplicate registration.
 */
function setupAgentFeedbackHandlers() {
    // Prevent duplicate event handler registration
    if (feedbackHandlersInitialized) return;
    feedbackHandlersInitialized = true;

    const feedbackInput = document.getElementById('agentFeedbackInput');
    const submitBtn = document.getElementById('submitFeedbackBtn');
    const historyBtn = document.getElementById('toggleFeedbackHistoryBtn');
    
    // Enable/disable submit button based on input
    feedbackInput?.addEventListener('input', () => {
        if (submitBtn) {
            submitBtn.disabled = feedbackInput.value.trim().length < 3;
        }
    });
    
    // Submit feedback button
    submitBtn?.addEventListener('click', handleSubmitFeedback);
    
    // Toggle history visibility
    historyBtn?.addEventListener('click', toggleFeedbackHistory);
    
    // Allow Ctrl+Enter to submit
    feedbackInput?.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter' && !submitBtn?.disabled) {
            handleSubmitFeedback();
        }
    });
}

/**
 * Handles submitting feedback to the agent
 */
async function handleSubmitFeedback() {
    const feedbackInput = document.getElementById('agentFeedbackInput');
    const submitBtn = document.getElementById('submitFeedbackBtn');
    
    const feedback = feedbackInput?.value?.trim();
    
    if (!feedback || feedback.length < 3) {
        notifications.warning('Please enter at least 3 characters of feedback');
        return;
    }
    
    // Always apply feedback and trigger a rerun
    const applyOnNextRun = true;
    const triggerRerun = true;
    
    // Disable button during submission
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Sending...';
        if (window.lucide) lucide.createIcons();
    }
    
    try {
        const response = await api.post(`/tasks/${taskId}/feedback`, {
            feedback,
            applyOnNextRun,
            triggerRerun
        });
        
        if (response.success) {
            // Show success message based on what happened
            notifications.success(response.rerunTriggered 
                ? 'Feedback sent! Agent rerun triggered.' 
                : 'Feedback saved and will be applied on next run.');
            
            // Clear input
            if (feedbackInput) feedbackInput.value = '';
            
            // Refresh feedback history
            await loadFeedbackHistory();
            
            // Start polling for updates since rerun is always triggered
            loadTaskDetails({ silent: true });
            if (!autoRefreshInterval) {
                startAutoRefresh();
            }
        } else {
            notifications.error(response.error || 'Failed to send feedback');
        }
    } catch (err) {
        notifications.error(`Error sending feedback: ${err.message}`);
        console.error('Feedback error:', err);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = feedbackInput?.value?.trim()?.length < 3;
            submitBtn.innerHTML = '<i data-lucide="send"></i> Submit Feedback';
            if (window.lucide) lucide.createIcons();
        }
    }
}

/**
 * Toggles the visibility of feedback history
 */
function toggleFeedbackHistory() {
    const container = document.getElementById('feedbackHistoryContainer');
    const btn = document.getElementById('toggleFeedbackHistoryBtn');
    
    feedbackHistoryVisible = !feedbackHistoryVisible;
    
    if (feedbackHistoryVisible) {
        container?.classList.remove('collapsed');
        if (btn) btn.textContent = 'Hide';
        loadFeedbackHistory();
    } else {
        container?.classList.add('collapsed');
        if (btn) btn.textContent = 'History';
    }
}

/**
 * Loads and renders the feedback history
 */
async function loadFeedbackHistory() {
    const listContainer = document.getElementById('feedbackHistoryList');
    const countBadge = document.getElementById('feedbackHistoryCount');
    
    if (!listContainer) return;
    
    try {
        const response = await api.get(`/tasks/${taskId}/feedback`);
        
        if (!response.success) {
            listContainer.innerHTML = '<p class="error-text">Failed to load feedback history</p>';
            return;
        }
        
        const feedback = response.feedback || [];
        
        // Update count badge
        if (countBadge) {
            countBadge.textContent = feedback.length;
            countBadge.className = `badge ${response.pendingCount > 0 ? 'badge-warning' : ''}`;
        }
        
        if (feedback.length === 0) {
            listContainer.innerHTML = '<p class="no-feedback">No feedback submitted yet</p>';
            return;
        }
        
        // Sort by timestamp (newest first)
        const sorted = [...feedback].sort((a, b) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        
        listContainer.innerHTML = sorted.map(fb => {
            const date = new Date(fb.timestamp);
            const timeAgo = FormattingUtils.formatRelativeTime(fb.timestamp);
            const statusClass = fb.applied ? 'applied' : (fb.applyOnNextRun ? 'pending' : 'reference');
            const statusText = fb.applied ? 'Applied' : (fb.applyOnNextRun ? 'Pending' : 'Reference');
            const stateText = fb.state ? FormattingUtils.formatState(fb.state) : '';
            
            return `
                <div class="feedback-item ${statusClass}">
                    <div class="feedback-item-header">
                        <span class="feedback-time" title="${date.toLocaleString()}">${timeAgo}</span>
                        <span class="feedback-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="feedback-item-content">${FormattingUtils.escapeHtml(fb.feedback)}</div>
                    <div class="feedback-item-footer">
                        <span class="feedback-state">Submitted during: ${stateText}</span>
                        ${fb.applied && fb.appliedAt ? `<span class="feedback-applied-at">Applied: ${FormattingUtils.formatRelativeTime(fb.appliedAt)}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (err) {
        console.error('Error loading feedback history:', err);
        listContainer.innerHTML = '<p class="error-text">Error loading feedback history</p>';
    }
}

/**
 * Updates the feedback section based on current task state
 */
function updateFeedbackSectionState() {
    const section = document.getElementById('agentFeedbackSection');
    const submitBtn = document.getElementById('submitFeedbackBtn');
    const rerunCheckbox = document.getElementById('triggerRerunCheckbox');
    const rerunLabel = rerunCheckbox?.parentElement;
    
    if (!section || !taskData?.taskState) return;
    
    const state = taskData.taskState.state;
    
    // States where rerun can be triggered
    const rerunnableStates = ['pending', 'completed', 'rejected', 'awaiting_approval', 'error'];
    const isRerunnable = rerunnableStates.includes(state);
    
    // States where agent is actively running
    const runningStates = ['in_progress', 'testing'];
    const isRunning = runningStates.includes(state);
    
    // Update rerun checkbox visibility and state
    if (rerunLabel) {
        if (isRunning) {
            rerunLabel.classList.add('disabled');
            rerunLabel.title = 'Cannot trigger rerun while agent is running';
            if (rerunCheckbox) {
                rerunCheckbox.disabled = true;
                rerunCheckbox.checked = false;
            }
        } else if (!isRerunnable) {
            rerunLabel.classList.add('disabled');
            rerunLabel.title = `Rerun not available in ${state} state`;
            if (rerunCheckbox) {
                rerunCheckbox.disabled = true;
                rerunCheckbox.checked = false;
            }
        } else {
            rerunLabel.classList.remove('disabled');
            rerunLabel.title = '';
            if (rerunCheckbox) rerunCheckbox.disabled = false;
        }
    }
    
    // Update submit button text based on state
    if (submitBtn && isRunning) {
        // When running, feedback will be queued for next run
        submitBtn.title = 'Feedback will be applied when agent runs again';
    } else {
        submitBtn?.removeAttribute('title');
    }
}

// ============================================
// Error Recovery System
// ============================================

/**
 * Error category definitions with display info and recovery options
 */
const ERROR_CATEGORIES = {
    credit_limit: {
        label: 'Credits Exhausted',
        icon: 'credit-card',
        className: 'credit',
        recoverable: true,
        suggestedWait: 60 * 60 * 1000, // 1 hour default
        maxRetries: 1,
        autoRetry: false
    },
    model_error: {
        label: 'Model Unavailable',
        icon: 'cpu',
        className: 'model',
        recoverable: true,
        suggestedWait: 0,
        maxRetries: 3,
        autoRetry: false
    },
    auth_error: {
        label: 'Authentication Failed',
        icon: 'key',
        className: 'auth',
        recoverable: true,
        suggestedWait: 0,
        maxRetries: 0,
        autoRetry: false
    },
    network_error: {
        label: 'Network Error',
        icon: 'wifi-off',
        className: 'network',
        recoverable: true,
        suggestedWait: 5000,
        maxRetries: 3,
        autoRetry: true,
        backoff: [5000, 10000, 30000]
    },
    timeout: {
        label: 'Request Timeout',
        icon: 'clock',
        className: 'timeout',
        recoverable: true,
        suggestedWait: 0,
        maxRetries: 2,
        autoRetry: true,
        backoff: [5000, 15000]
    },
    unknown: {
        label: 'Unexpected Error',
        icon: 'alert-triangle',
        className: 'unknown',
        recoverable: true,
        suggestedWait: 0,
        maxRetries: 1,
        autoRetry: false
    }
};

// Retry state management
let retryState = {
    taskId: null,
    errorCategory: null,
    retryCount: 0,
    lastErrorTime: null,
    autoRetryTimer: null,
    countdownTimer: null,
    suggestedRetryTime: null
};

/**
 * Loads retry state from localStorage
 */
function loadRetryState() {
    try {
        const stored = localStorage.getItem(`retryState_${taskId}`);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Only restore if same task and error is recent (within 24 hours)
            if (parsed.taskId === taskId && 
                parsed.lastErrorTime && 
                Date.now() - parsed.lastErrorTime < 24 * 60 * 60 * 1000) {
                retryState = { ...retryState, ...parsed };
                console.log('Restored retry state:', retryState);
            }
        }
    } catch (err) {
        console.warn('Failed to load retry state:', err);
    }
}

/**
 * Saves retry state to localStorage
 */
function saveRetryState() {
    try {
        localStorage.setItem(`retryState_${taskId}`, JSON.stringify({
            taskId: retryState.taskId,
            errorCategory: retryState.errorCategory,
            retryCount: retryState.retryCount,
            lastErrorTime: retryState.lastErrorTime,
            suggestedRetryTime: retryState.suggestedRetryTime
        }));
    } catch (err) {
        console.warn('Failed to save retry state:', err);
    }
}

/**
 * Clears retry state
 */
function clearRetryState() {
    retryState = {
        taskId: null,
        errorCategory: null,
        retryCount: 0,
        lastErrorTime: null,
        autoRetryTimer: null,
        countdownTimer: null,
        suggestedRetryTime: null
    };
    try {
        localStorage.removeItem(`retryState_${taskId}`);
    } catch (err) {
        console.warn('Failed to clear retry state:', err);
    }
}

/**
 * Detects error category from task state
 * @param {object} taskState 
 * @returns {string} Error category key
 */
function detectErrorCategory(taskState) {
    if (!taskState) return 'unknown';
    
    // Check explicit flags first
    if (taskState.creditError || taskState.errorCategory === 'credit_limit') {
        return 'credit_limit';
    }
    if (taskState.modelError || taskState.errorCategory === 'model_error') {
        return 'model_error';
    }
    if (taskState.errorCategory) {
        return taskState.errorCategory;
    }
    
    // Infer from error message if no explicit category
    const errorMsg = (taskState.error || '').toLowerCase();
    
    if (errorMsg.includes('credit') || errorMsg.includes('usage limit') || 
        errorMsg.includes('rate limit') || errorMsg.includes('quota')) {
        return 'credit_limit';
    }
    if (errorMsg.includes('model') || errorMsg.includes('unavailable') ||
        errorMsg.includes('capacity')) {
        return 'model_error';
    }
    if (errorMsg.includes('auth') || errorMsg.includes('unauthorized') ||
        errorMsg.includes('forbidden') || errorMsg.includes('token')) {
        return 'auth_error';
    }
    if (errorMsg.includes('network') || errorMsg.includes('connection') ||
        errorMsg.includes('econnrefused') || errorMsg.includes('enotfound')) {
        return 'network_error';
    }
    if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
        return 'timeout';
    }
    
    return 'unknown';
}

/**
 * Renders the enhanced error section with category-specific UI
 * @param {object} taskState 
 */
function renderErrorSection(taskState) {
    const errorSection = document.getElementById('errorSection');
    const errorCategoryBadge = document.getElementById('errorCategoryBadge');
    const errorUserMessage = document.getElementById('errorUserMessage');
    const errorDetails = document.getElementById('errorDetails');
    const errorActionsContainer = document.getElementById('errorActionsContainer');
    const errorStackTrace = document.getElementById('errorStackTrace');
    
    if (!errorSection || !taskState || taskState.state !== 'error') {
        if (errorSection) errorSection.classList.add('hidden');
        clearAutoRetryTimers();
        return;
    }
    
    // Detect and store error category
    const category = detectErrorCategory(taskState);
    const categoryInfo = ERROR_CATEGORIES[category] || ERROR_CATEGORIES.unknown;
    
    // Update retry state
    if (retryState.errorCategory !== category || retryState.taskId !== taskId) {
        retryState.taskId = taskId;
        retryState.errorCategory = category;
        retryState.lastErrorTime = Date.now();
        
        // Calculate suggested retry time for credit errors
        if (category === 'credit_limit') {
            retryState.suggestedRetryTime = Date.now() + categoryInfo.suggestedWait;
        }
        
        saveRetryState();
    }
    
    // Show error section
    errorSection.classList.remove('hidden');
    
    // Update category badge
    if (errorCategoryBadge) {
        errorCategoryBadge.innerHTML = `<i data-lucide="${categoryInfo.icon}"></i> ${categoryInfo.label}`;
        errorCategoryBadge.className = `error-category-badge ${categoryInfo.className}`;
    }
    
    // User-friendly message
    const userMessage = taskState.userMessage || getDefaultUserMessage(category);
    if (errorUserMessage) {
        errorUserMessage.textContent = userMessage;
    }
    
    // Technical error details
    if (errorDetails) {
        errorDetails.textContent = taskState.error || 'No additional details available.';
    }
    
    // Stack trace (if available)
    if (errorStackTrace) {
        if (taskState.stackTrace || taskState.stderr) {
            errorStackTrace.textContent = taskState.stackTrace || taskState.stderr;
            errorStackTrace.parentElement.classList.remove('hidden');
        } else {
            errorStackTrace.parentElement.classList.add('hidden');
        }
    }
    
    // Show appropriate action group
    showErrorActions(category);
    if (errorActionsContainer) {
        errorActionsContainer.classList.remove('hidden');
    }
    
    // Setup error action handlers
    setupErrorActionHandlers(category);
    
    // Start auto-retry for transient errors if applicable
    if (categoryInfo.autoRetry && retryState.retryCount < categoryInfo.maxRetries) {
        startAutoRetry(category);
    }
    
    // Start countdown for credit errors
    if (category === 'credit_limit' && retryState.suggestedRetryTime) {
        startCreditCountdown();
    }
    
    // Refresh icons
    if (window.lucide) lucide.createIcons();
}

/**
 * Gets default user-friendly message for error category
 */
function getDefaultUserMessage(category) {
    const messages = {
        credit_limit: 'Your Cursor credits have been exhausted. Please wait for credits to reset or upgrade your plan.',
        model_error: 'The AI model is currently unavailable. Please try a different model.',
        auth_error: 'Your authentication has expired. Please re-authenticate to continue.',
        network_error: 'A network error occurred. Please check your connection and try again.',
        timeout: 'The request timed out. This may happen with complex tasks.',
        unknown: 'An unexpected error occurred. You can try again or report this issue.'
    };
    return messages[category] || messages.unknown;
}

/**
 * Shows the appropriate error action group
 */
function showErrorActions(category) {
    // Hide all action groups
    const actionGroups = [
        'creditErrorActions',
        'networkErrorActions',
        'authErrorActions',
        'timeoutErrorActions',
        'unknownErrorActions'
    ];
    actionGroups.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    
    // Show the relevant action group
    const groupMap = {
        credit_limit: 'creditErrorActions',
        model_error: 'unknownErrorActions', // Uses model modal instead
        auth_error: 'authErrorActions',
        network_error: 'networkErrorActions',
        timeout: 'timeoutErrorActions',
        unknown: 'unknownErrorActions'
    };
    
    const targetGroup = document.getElementById(groupMap[category]);
    if (targetGroup) {
        targetGroup.classList.remove('hidden');
    }
}

/**
 * Sets up event handlers for error action buttons
 */
function setupErrorActionHandlers(category) {
    // Main retry button
    const retryBtn = document.getElementById('errorRetryBtn');
    retryBtn?.addEventListener('click', () => handleRetryTask(), { once: true });
    
    // Credit error actions
    document.getElementById('creditWaitRetryBtn')?.addEventListener('click', () => {
        showCreditErrorModal();
    }, { once: true });
    
    document.getElementById('creditRetryNowBtn')?.addEventListener('click', () => {
        handleRetryTask();
    }, { once: true });
    
    // Network error actions
    document.getElementById('networkRetryBtn')?.addEventListener('click', () => {
        handleRetryTask();
    }, { once: true });
    
    document.getElementById('networkAutoRetryBtn')?.addEventListener('click', () => {
        startAutoRetry('network_error');
    }, { once: true });
    
    // Timeout error actions
    document.getElementById('timeoutRetryBtn')?.addEventListener('click', () => {
        handleRetryTask();
    }, { once: true });
    
    document.getElementById('timeoutExtendedBtn')?.addEventListener('click', () => {
        handleRetryTask({ extendedTimeout: true });
    }, { once: true });
    
    // Unknown error actions
    document.getElementById('unknownRetryBtn')?.addEventListener('click', () => {
        handleRetryTask();
    }, { once: true });
    
    document.getElementById('viewLogsBtn')?.addEventListener('click', () => {
        // Scroll to and expand technical details
        const details = document.getElementById('errorTechnicalDetails');
        if (details) {
            details.open = true;
            details.scrollIntoView({ behavior: 'smooth' });
        }
    }, { once: true });
    
    // Auto-retry cancel
    document.getElementById('cancelAutoRetryBtn')?.addEventListener('click', () => {
        clearAutoRetryTimers();
        hideAutoRetryProgress();
    }, { once: true });
}

/**
 * Handles retry task with error-type-specific logic
 */
async function handleRetryTask(options = {}) {
    const categoryInfo = ERROR_CATEGORIES[retryState.errorCategory] || ERROR_CATEGORIES.unknown;
    
    // Check if we've exceeded max retries
    if (retryState.retryCount >= categoryInfo.maxRetries && categoryInfo.maxRetries > 0) {
        notifications.warning(`Maximum retry attempts (${categoryInfo.maxRetries}) reached. Please try again later.`);
        return;
    }
    
    // For model errors, show the model selection modal
    if (retryState.errorCategory === 'model_error') {
        const failedModel = taskData?.taskState?.metadata?.failedModel || 
                           document.getElementById('agentModelSelect')?.value;
        showModelErrorModal(failedModel);
        return;
    }
    
    // For auth errors, redirect to auth
    if (retryState.errorCategory === 'auth_error') {
        window.location.href = '/auth/clickup';
        return;
    }
    
    // Increment retry count
    retryState.retryCount++;
    saveRetryState();
    
    // Clear any pending auto-retry
    clearAutoRetryTimers();
    
    // Trigger the agent
    try {
        await handleTriggerAgent();
        
        // If successful, clear retry state
        clearRetryState();
    } catch (err) {
        console.error('Retry failed:', err);
        // Don't clear state - let error handling update it
    }
}

/**
 * Starts auto-retry with exponential backoff
 */
function startAutoRetry(category) {
    const categoryInfo = ERROR_CATEGORIES[category] || ERROR_CATEGORIES.unknown;
    
    if (!categoryInfo.autoRetry || !categoryInfo.backoff) return;
    if (retryState.retryCount >= categoryInfo.maxRetries) return;
    
    const delay = categoryInfo.backoff[retryState.retryCount] || categoryInfo.backoff[categoryInfo.backoff.length - 1];
    const seconds = Math.floor(delay / 1000);
    
    // Show auto-retry progress
    showAutoRetryProgress(seconds);
    
    // Start countdown
    let remaining = seconds;
    const countdownEl = document.getElementById('autoRetryCountdown');
    
    retryState.countdownTimer = setInterval(() => {
        remaining--;
        if (countdownEl) countdownEl.textContent = remaining;
        updateAutoRetryBar(remaining, seconds);
        
        if (remaining <= 0) {
            clearAutoRetryTimers();
            hideAutoRetryProgress();
            handleRetryTask();
        }
    }, 1000);
    
    // Store timer reference
    retryState.autoRetryTimer = setTimeout(() => {
        // Backup trigger if interval somehow fails
        clearAutoRetryTimers();
        handleRetryTask();
    }, delay + 500);
}

/**
 * Starts credit countdown timer
 */
function startCreditCountdown() {
    const timerEl = document.getElementById('creditCountdownTimer');
    const modalTimerEl = document.getElementById('creditModalCountdown');
    
    if (!retryState.suggestedRetryTime) return;
    
    const updateCountdown = () => {
        const remaining = retryState.suggestedRetryTime - Date.now();
        
        if (remaining <= 0) {
            if (timerEl) timerEl.textContent = 'Credits may be available now';
            if (modalTimerEl) modalTimerEl.textContent = 'Ready to retry!';
            clearInterval(retryState.countdownTimer);
            
            // Show notification
            notifications.info('Credits may be available now. Click "Check Now" to retry.');
            return;
        }
        
        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
        
        const timeStr = hours > 0 
            ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
            : `${minutes}:${String(seconds).padStart(2, '0')}`;
        
        if (timerEl) timerEl.textContent = timeStr;
        if (modalTimerEl) modalTimerEl.textContent = timeStr;
    };
    
    // Initial update
    updateCountdown();
    
    // Start interval
    retryState.countdownTimer = setInterval(updateCountdown, 1000);
}

/**
 * Shows auto-retry progress bar
 */
function showAutoRetryProgress(seconds) {
    const container = document.getElementById('autoRetryProgress');
    const countdownEl = document.getElementById('autoRetryCountdown');
    
    if (container) container.classList.remove('hidden');
    if (countdownEl) countdownEl.textContent = seconds;
    
    updateAutoRetryBar(seconds, seconds);
}

/**
 * Hides auto-retry progress bar
 */
function hideAutoRetryProgress() {
    const container = document.getElementById('autoRetryProgress');
    if (container) container.classList.add('hidden');
}

/**
 * Updates auto-retry progress bar
 */
function updateAutoRetryBar(remaining, total) {
    const bar = document.getElementById('autoRetryBarFill');
    if (bar) {
        const percent = ((total - remaining) / total) * 100;
        bar.style.width = `${percent}%`;
    }
}

/**
 * Clears all auto-retry timers
 */
function clearAutoRetryTimers() {
    if (retryState.autoRetryTimer) {
        clearTimeout(retryState.autoRetryTimer);
        retryState.autoRetryTimer = null;
    }
    if (retryState.countdownTimer) {
        clearInterval(retryState.countdownTimer);
        retryState.countdownTimer = null;
    }
}

/**
 * Shows credit error modal
 */
function showCreditErrorModal() {
    const modal = document.getElementById('creditErrorModal');
    if (modal) {
        showModal('creditErrorModal');
        
        // Start countdown in modal
        if (retryState.suggestedRetryTime) {
            startCreditCountdown();
        }
    }
}

// Credit error modal handlers
document.getElementById('closeCreditErrorModal')?.addEventListener('click', () => {
    closeModal('creditErrorModal');
});

document.getElementById('creditModalCancel')?.addEventListener('click', () => {
    closeModal('creditErrorModal');
});

document.getElementById('creditModalWaitRetry')?.addEventListener('click', () => {
    closeModal('creditErrorModal');
    notifications.info('Auto-retry enabled. You will be notified when the task resumes.');
});

document.getElementById('creditModalRetryNow')?.addEventListener('click', () => {
    closeModal('creditErrorModal');
    handleRetryTask();
});

// Load retry state on init (after taskId is set)
document.addEventListener('DOMContentLoaded', () => {
    // Delay to ensure taskId is parsed from URL
    setTimeout(() => {
        if (taskId) {
            loadRetryState();
        }
    }, 100);
})
