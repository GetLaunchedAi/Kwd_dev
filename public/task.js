// Task Detail Page JavaScript - Enhanced with real-time updates, better diff, modals, timeline

let taskId = null;
let taskData = null;
let diffData = null;
let autoRefreshInterval = null;
let isAutoRefreshPaused = false;

// Workflow states in order
const workflowStates = [
    { state: 'pending', label: 'Pending', icon: '⏳' },
    { state: 'in_progress', label: 'In Progress', icon: '🔄' },
    { state: 'testing', label: 'Testing', icon: '🧪' },
    { state: 'awaiting_approval', label: 'Awaiting Approval', icon: '⏸️' },
    { state: 'approved', label: 'Approved', icon: '✅' },
    { state: 'completed', label: 'Completed', icon: '✨' },
    { state: 'rejected', label: 'Rejected', icon: '❌' },
    { state: 'error', label: 'Error', icon: '⚠️' },
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    taskId = urlParams.get('taskId');
    
    if (!taskId) {
        showError('Task ID is required');
        return;
    }
    
    loadTaskDetails();
    loadDiff();
    
    // Trigger agent button
    document.getElementById('triggerAgentBtn')?.addEventListener('click', handleTriggerAgent);
    
    // Refresh button
    document.getElementById('refreshTaskBtn')?.addEventListener('click', () => {
        loadTaskDetails({ showNotification: true });
        loadDiff({ showNotification: true });
    });

    // Description edit buttons
    document.getElementById('editDescriptionBtn')?.addEventListener('click', toggleEditDescription);
    document.getElementById('cancelDescriptionBtn')?.addEventListener('click', toggleEditDescription);
    document.getElementById('saveDescriptionBtn')?.addEventListener('click', handleSaveDescription);
    
    // Approval buttons
    document.getElementById('approveBtn')?.addEventListener('click', () => {
        showModal('approveModal');
    });
    
    document.getElementById('confirmApproveBtn')?.addEventListener('click', handleApprove);
    
    document.getElementById('closeApproveModal')?.addEventListener('click', () => {
        closeModal('approveModal');
    });
    
    document.getElementById('cancelApproveBtn')?.addEventListener('click', () => {
        closeModal('approveModal');
    });
    
    document.getElementById('rejectBtn')?.addEventListener('click', () => {
        showModal('rejectModal');
    });
    
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
    
    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay.id);
            }
        });
    });
});

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
        
        // Check if data has changed
        const hasChanged = JSON.stringify(data) !== JSON.stringify(taskData);
        
        if (hasChanged || !silent) {
            taskData = data;
            
            renderTaskDetails();
            renderTimeline();
            
            if (!silent) {
                loading.classList.add('hidden');
                taskDetails.classList.remove('hidden');
            }
            
            if (showNotification) {
                notifications.success('Task details refreshed from ClickUp');
            }
        }
        
        // Start auto-refresh if awaiting approval
        if (taskData.taskState?.state === 'awaiting_approval' && !autoRefreshInterval) {
            startAutoRefresh();
        }
    } catch (err) {
        if (!silent) {
            loading.classList.add('hidden');
            showError(`Error loading task: ${err.message}`);
            notifications.error(`Failed to load task: ${err.message}`);
        }
        console.error('Error loading task:', err);
    } finally {
        if (!silent && refreshBtn) refreshBtn.disabled = false;
    }
}

async function loadDiff(options = {}) {
    // Handle both old and new signature
    const showNotification = typeof options === 'boolean' ? options : (options.showNotification || false);
    const silent = typeof options === 'object' ? (options.silent || false) : false;

    try {
        const data = await api.get(`/tasks/${taskId}/diff`);
        
        // Check if data has changed
        const hasChanged = JSON.stringify(data) !== JSON.stringify(diffData);
        
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
        }
    }
}

function startAutoRefresh() {
    if (autoRefreshInterval) return;
    
    const indicator = document.getElementById('autoRefreshIndicator');
    if (indicator) indicator.classList.remove('hidden');
    
    autoRefreshInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
            loadTaskDetails({ silent: true });
            loadDiff({ silent: true });
        }
    }, 3000); // Refresh every 3 seconds when awaiting approval
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    
    const indicator = document.getElementById('autoRefreshIndicator');
    if (indicator) indicator.classList.add('hidden');
}

function renderTaskDetails() {
    if (!taskData) return;
    
    const { taskState, taskInfo } = taskData;
    const stateClass = taskState.state.replace(/_/g, '-');
    
    document.getElementById('taskName').textContent = taskInfo.task?.name || taskId;
    document.getElementById('taskState').textContent = FormattingUtils.formatState(taskState.state);
    document.getElementById('taskState').className = `state-badge ${stateClass}`;
    document.getElementById('taskId').textContent = taskId;
    document.getElementById('clientName').textContent = taskInfo.clientName || 'N/A';
    document.getElementById('branchName').textContent = taskState.branchName || 'N/A';
    
    // Setup ClickUp link - always show and make it clickable
    const link = document.getElementById('clickUpUrl');
    if (link) {
        const linkContainer = link.parentElement;
        
        // Always construct ClickUp URL - use from API if available, otherwise construct from taskId
        let clickUpUrl = taskInfo.task?.url;
        if (!clickUpUrl || clickUpUrl === '#' || clickUpUrl.trim() === '') {
            // Construct ClickUp URL from taskId if URL is missing
            clickUpUrl = `https://app.clickup.com/t/${taskId}`;
        }
        
        // Always set up the link if we have a taskId
        if (taskId) {
            // Set link properties using setAttribute for reliability
            link.setAttribute('href', clickUpUrl);
            link.textContent = 'View in ClickUp';
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
            
            // Remove any onclick handlers that might prevent navigation
            link.onclick = null;
            link.removeAttribute('onclick');
            
            // Ensure link is visible and clickable with explicit styles
            link.classList.remove('hidden');
            link.style.display = '';
            link.style.pointerEvents = 'auto';
            link.style.cursor = 'pointer';
            link.style.textDecoration = 'underline';
            link.style.color = '#0066cc';
            link.style.position = 'relative';
            link.style.zIndex = '1';
            
            // Ensure parent container is visible and doesn't block clicks
            if (linkContainer) {
                linkContainer.classList.remove('hidden');
                linkContainer.style.pointerEvents = 'auto';
                linkContainer.style.position = 'relative';
                linkContainer.style.zIndex = '1';
            }
        }
    }
    
    document.getElementById('createdAt').textContent = FormattingUtils.formatDate(taskState.createdAt);
    document.getElementById('updatedAt').textContent = FormattingUtils.formatRelativeTime(taskState.updatedAt);
    
    // Description
    const description = taskInfo.task?.description || 'No description provided';
    document.getElementById('taskDescription').textContent = description;
    
    // Show approval section if awaiting approval
    const approvalSection = document.getElementById('approvalSection');
    if (taskState.state === 'awaiting_approval') {
        approvalSection.classList.remove('hidden');
        if (!autoRefreshInterval) {
            startAutoRefresh();
        }
    } else {
        approvalSection.classList.add('hidden');
        stopAutoRefresh();
    }
    
    // Show error section if error state
    const errorSection = document.getElementById('errorSection');
    const errorDetails = document.getElementById('errorDetails');
    if (taskState.state === 'error' && taskState.error) {
        errorSection.classList.remove('hidden');
        errorDetails.textContent = taskState.error;
    } else {
        errorSection.classList.add('hidden');
    }
}

function renderTimeline() {
    if (!taskData) return;
    
    const { taskState } = taskData;
    const currentState = taskState.state;
    const timeline = document.getElementById('timeline');
    const timelineSection = document.getElementById('timelineSection');
    
    if (!timeline || !timelineSection) return;
    
    let html = '';
    let foundCurrent = false;
    
    workflowStates.forEach((stateInfo, index) => {
        const isCurrent = stateInfo.state === currentState;
        const isCompleted = !foundCurrent && (isCurrent || 
            (index < workflowStates.findIndex(s => s.state === currentState)));
        
        if (isCurrent) foundCurrent = true;
        
        let statusClass = '';
        if (isCurrent) {
            statusClass = 'active';
        } else if (isCompleted) {
            statusClass = 'completed';
        } else if (stateInfo.state === 'error' && currentState === 'error') {
            statusClass = 'error';
        }
        
        const time = isCurrent ? FormattingUtils.formatRelativeTime(taskState.updatedAt) : '';
        
        html += `
            <div class="timeline-item ${statusClass}">
                <div class="timeline-content">
                    <div class="timeline-title">${stateInfo.icon} ${stateInfo.label}</div>
                    ${time ? `<div class="timeline-time">${time}</div>` : ''}
                </div>
            </div>
        `;
    });
    
    timeline.innerHTML = html;
    timelineSection.classList.remove('hidden');
}

function renderChangesSummary() {
    if (!diffData) return;
    
    const summary = `
        <div class="changes-summary">
            <div class="summary-card">
                <div class="summary-card-value">${diffData.filesModified || 0}</div>
                <div class="summary-card-label">Files Modified</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-value">${diffData.filesAdded || 0}</div>
                <div class="summary-card-label">Files Added</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-value">${diffData.filesDeleted || 0}</div>
                <div class="summary-card-label">Files Deleted</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-value">+${diffData.linesAdded || 0}</div>
                <div class="summary-card-label">Lines Added</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-value">-${diffData.linesRemoved || 0}</div>
                <div class="summary-card-label">Lines Removed</div>
            </div>
        </div>
        <div class="file-list">
            <h4>Changed Files</h4>
            ${(diffData.fileList || []).map(file => `
                <div class="file-item">
                    <span class="file-item-path">${FormattingUtils.escapeHtml(file.path)}</span>
                    <div class="file-item-stats">
                        ${file.additions !== undefined ? `<span class="additions">+${file.additions}</span>` : ''}
                        ${file.deletions !== undefined ? `<span class="deletions">-${file.deletions}</span>` : ''}
                        <span class="status">${file.status || ''}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    
    document.getElementById('changesSummary').innerHTML = summary;
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
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = '📋';
        copyBtn.title = 'Copy file path';
        copyBtn.style.marginLeft = '10px';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(pathEl.textContent.trim(), copyBtn);
        });
        copyBtn.classList.add('ml-sm');
        pathEl.parentElement.appendChild(copyBtn);
    });
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
            setTimeout(() => {
                window.location.reload();
            }, 1500);
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
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            const text = await response.text();
            notifications.error(`Failed to reject: ${text}`);
        }
    } catch (err) {
        notifications.error(`Error rejecting changes: ${err.message}`);
        console.error('Error rejecting:', err);
    }
}

async function handleTriggerAgent() {
    if (!taskId) {
        notifications.error('Task ID is required');
        return;
    }
    
    const triggerBtn = document.getElementById('triggerAgentBtn');
    const statusHint = document.getElementById('agentStatus');
    
    if (triggerBtn) {
        triggerBtn.disabled = true;
        triggerBtn.textContent = '⏳ Starting...';
    }
    
    if (statusHint) {
        statusHint.textContent = 'Opening workspace...';
        statusHint.classList.remove('hidden');
    }
    
    try {
        // Simulated progress updates for better UX
        const updateStatus = (text, delay) => new Promise(resolve => {
            setTimeout(() => {
                if (statusHint) statusHint.textContent = text;
                resolve();
            }, delay);
        });

        const triggerPromise = api.post(`/tasks/${taskId}/trigger-agent`, {});
        
        await updateStatus('Preparing task prompt...', 1000);
        await updateStatus('Triggering Cursor agent...', 1000);
        
        const response = await triggerPromise;
        
        if (response.success) {
            if (statusHint) {
                statusHint.textContent = '✅ Agent Triggered!';
                statusHint.style.color = 'var(--color-success)';
            }
            notifications.success('Cursor agent triggered successfully! The workspace should open shortly.');
            
            // Refresh task details after a short delay
            setTimeout(() => {
                loadTaskDetails({ showNotification: true });
                if (statusHint) statusHint.classList.add('hidden');
            }, 3000);
        } else {
            if (statusHint) statusHint.classList.add('hidden');
            notifications.error(response.error || 'Failed to trigger agent');
        }
    } catch (err) {
        if (statusHint) statusHint.classList.add('hidden');
        notifications.error(`Error triggering agent: ${err.message}`);
        console.error('Error triggering agent:', err);
    } finally {
        if (triggerBtn) {
            triggerBtn.disabled = false;
            triggerBtn.textContent = '🤖 Trigger Cursor Agent';
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

function showError(message) {
    const error = document.getElementById('error');
    if (error) {
        error.classList.remove('hidden');
        error.textContent = message;
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
});
