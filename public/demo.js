// Demo Details Page JavaScript

let demoData = null;
let clientSlug = null;
let autoRefreshInterval = null;
let logsExpanded = false;
let eventsViewerExpanded = false;
let demoGallery = null;
let eventsViewer = null;
let stepSelectInitialized = false;
let screenshotRefreshBtnInitialized = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize icons
    if (window.lucide) lucide.createIcons();
    
    // Theme toggle
    initTheme();
    
    // Get slug from URL
    const urlParams = new URLSearchParams(window.location.search);
    clientSlug = urlParams.get('slug');
    
    if (!clientSlug) {
        showError('No demo slug provided. Please return to the dashboard.');
        return;
    }
    
    // Load demo details
    loadDemoDetails();
    
    // Setup event listeners
    setupEventListeners();
});

function setupEventListeners() {
    // Theme toggle
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
    
    // Refresh button
    document.getElementById('refreshDemoBtn')?.addEventListener('click', () => {
        loadDemoDetails({ showNotification: true });
    });
    
    // Retry button
    document.getElementById('retryBtn')?.addEventListener('click', () => {
        loadDemoDetails();
    });
    
    // Toggle logs
    document.getElementById('toggleLogsBtn')?.addEventListener('click', toggleLogs);
    
    // Toggle events viewer
    document.getElementById('toggleEventsViewerBtn')?.addEventListener('click', toggleEventsViewer);
    
    // Kill demo
    document.getElementById('killDemoBtn')?.addEventListener('click', killDemo);
    
    // Delete demo
    document.getElementById('deleteDemoBtn')?.addEventListener('click', showDeleteModal);
    document.getElementById('closeDeleteModal')?.addEventListener('click', hideDeleteModal);
    document.getElementById('cancelDeleteBtn')?.addEventListener('click', hideDeleteModal);
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', deleteDemo);
    
    // Step approval buttons
    document.getElementById('approveStepBtn')?.addEventListener('click', approveCurrentStep);
    document.getElementById('requestStepChangesBtn')?.addEventListener('click', openStepChangesModal);
    
    // Final approval buttons  
    document.getElementById('approvePublishBtn')?.addEventListener('click', approveAndPublish);
    document.getElementById('requestRevisionBtn')?.addEventListener('click', openStepChangesModal);
    document.getElementById('rejectDemoBtn')?.addEventListener('click', openRejectDemoModal);
    
    // Step changes modal
    document.getElementById('closeStepChangesModal')?.addEventListener('click', () => hideModal('stepChangesModal'));
    document.getElementById('cancelStepChangesBtn')?.addEventListener('click', () => hideModal('stepChangesModal'));
    document.getElementById('submitStepChangesBtn')?.addEventListener('click', submitStepChanges);
    
    // Reject demo modal
    document.getElementById('closeRejectDemoModal')?.addEventListener('click', () => hideModal('rejectDemoModal'));
    document.getElementById('cancelRejectDemoBtn')?.addEventListener('click', () => hideModal('rejectDemoModal'));
    document.getElementById('confirmRejectDemoBtn')?.addEventListener('click', confirmRejectDemo);
    
    // Enable/disable submit button based on feedback input
    const stepFeedbackInput = document.getElementById('stepFeedbackInput');
    stepFeedbackInput?.addEventListener('input', () => {
        const submitBtn = document.getElementById('submitStepChangesBtn');
        if (submitBtn) {
            submitBtn.disabled = stepFeedbackInput.value.trim().length < 10;
        }
    });
    
    // Close modals on overlay click
    ['stepChangesModal', 'rejectDemoModal'].forEach(modalId => {
        document.getElementById(modalId)?.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                hideModal(modalId);
            }
        });
    });
    
    // Agent Feedback handlers
    setupAgentFeedbackHandlers();
    
    // Retry Netlify deployment
    document.getElementById('retryNetlifyBtn')?.addEventListener('click', retryNetlifyDeploy);
}

async function loadDemoDetails(options = {}) {
    const { showNotification = false, silent = false } = options;
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const details = document.getElementById('demoDetails');
    
    if (!silent) {
        loading?.classList.remove('hidden');
        error?.classList.add('hidden');
        details?.classList.add('hidden');
    }
    
    try {
        // Fetch merged demo data from the new endpoint
        const data = await api.get(`/demos/${clientSlug}`);
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to load demo details');
        }
        
        demoData = data;
        
        if (!silent) {
            loading?.classList.add('hidden');
            details?.classList.remove('hidden');
        }
        
        renderDemoDetails();
        
        if (showNotification) {
            notifications.success('Demo details refreshed');
        }
        
        // Start auto-refresh if demo is in progress
        const status = demoData.status;
        if (status && ['running', 'triggering', 'cloning', 'installing', 'organizing', 'prompting'].includes(status.state)) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
        
    } catch (err) {
        console.error('Error loading demo details:', err);
        if (!silent) {
            showError(err.message || 'Failed to load demo details');
        }
        if (showNotification) {
            notifications.error(`Failed to refresh: ${err.message}`);
        }
    }
}

function renderDemoDetails() {
    if (!demoData) return;
    
    const { status, context, taskState, clientSlug: slug } = demoData;
    
    // Update page title
    document.title = `${context?.businessName || slug} - Demo Details`;
    
    // Header info
    document.getElementById('businessName').textContent = context?.businessName || slug;
    document.getElementById('clientSlug').textContent = `/${slug}`;
    
    // State badge
    const stateEl = document.getElementById('demoState');
    const state = status?.state || taskState?.state || 'unknown';
    stateEl.textContent = FormattingUtils.formatState(state);
    stateEl.className = `state-badge ${state.replace(/_/g, '-')}`;
    
    // Progress stepper
    renderProgressStepper(status);
    
    // Agent activity
    renderAgentActivity(status);
    
    // Business context
    renderContext(context);
    
    // Branding
    renderBranding(context);
    
    // Timestamps
    renderTimestamps(status, taskState, context);
    
    // Preview link
    setupPreviewLink(status);
    
    // Screenshots
    renderScreenshots();
    
    // Approval section (show/hide based on state)
    renderApprovalSection(status, taskState);
    
    // Publishing section (show GitHub/Netlify status)
    renderPublishingSection(status);
    
    // Error section (show if demo step failed)
    renderDemoErrorSection(status);
    
    // Update feedback section based on current state
    updateFeedbackSectionState();
    
    // Delete modal slug display
    document.getElementById('deleteSlugDisplay').textContent = slug;
    
    // Refresh icons
    if (window.lucide) lucide.createIcons();
}

/**
 * Renders the screenshot gallery for the demo.
 */
function renderScreenshots() {
    const galleryContainer = document.getElementById('demoScreenshotGallery');
    const stepSelect = document.getElementById('screenshotStepSelect');
    
    if (!galleryContainer) return;
    
    // Initialize gallery if not already done
    if (!demoGallery) {
        demoGallery = createScreenshotGallery('demoScreenshotGallery', {
            showPageTabs: true,
            showSectionThumbnails: true,
            enableComparison: true,
            enableLightbox: true,
            comparisonMode: 'side-by-side'
        });
    }
    
    // Load screenshots for the demo task
    const taskId = `demo-${clientSlug}`;
    demoGallery.loadScreenshots(taskId);
    
    // Setup step selector (only once, using module-level flag instead of DOM property)
    if (stepSelect && !stepSelectInitialized) {
        stepSelectInitialized = true;
        stepSelect.addEventListener('change', async (e) => {
            const iteration = e.target.value;
            if (iteration === 'latest') {
                demoGallery.loadScreenshots(taskId);
            } else {
                // Load specific iteration
                try {
                    const response = await fetch(`/api/tasks/${taskId}/screenshots?iteration=${iteration}`);
                    if (response.ok) {
                        const data = await response.json();
                        demoGallery.setData({
                            taskId,
                            manifests: {
                                before: data.before ? { [iteration]: data.before } : {},
                                after: data.after ? { [iteration]: data.after } : {}
                            },
                            hasManifests: !!data.before || !!data.after,
                            hasLegacy: false
                        });
                    }
                } catch (err) {
                    console.error('Error loading iteration screenshots:', err);
                }
            }
        });
    }
    
    // Setup refresh button (only once, using module-level flag instead of DOM property)
    const refreshBtn = document.getElementById('refreshScreenshotsBtn');
    if (refreshBtn && !screenshotRefreshBtnInitialized) {
        screenshotRefreshBtnInitialized = true;
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            refreshBtn.querySelector('i')?.classList.add('animate-spin');
            
            try {
                await demoGallery.loadScreenshots(taskId);
                notifications.success('Screenshots refreshed');
            } catch (err) {
                notifications.error('Failed to refresh screenshots');
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.querySelector('i')?.classList.remove('animate-spin');
            }
        });
    }
}

function renderProgressStepper(status) {
    const currentStep = status?.currentStep || 1;
    const totalSteps = status?.totalSteps || 4;
    const state = status?.state || 'pending';
    
    // Check if all steps are truly complete (final step and completed/awaiting)
    const isFinalStep = currentStep >= totalSteps;
    const isFullyCompleted = isFinalStep && (state === 'completed' || state === 'awaiting_approval');
    
    // Update counter - show "Complete!" only when ALL steps are finished
    document.getElementById('demoStepCounter').textContent = isFullyCompleted 
        ? 'Complete!' 
        : `Step ${currentStep} of ${totalSteps}`;
    
    // Update progress bar
    // - Show 100% only when all steps complete
    // - For intermediate approvals (awaiting_approval on non-final step), show step as complete
    let progressPercent;
    if (isFullyCompleted) {
        progressPercent = 100;
    } else if (state === 'awaiting_approval' || state === 'completed') {
        // Step is complete but not the final step - show this step as fully complete
        progressPercent = (currentStep / totalSteps) * 100;
    } else {
        // In progress - show partial progress within current step
        progressPercent = ((currentStep - 1) / totalSteps) * 100 + (status?.currentStepProgress || 0) / totalSteps;
    }
    document.getElementById('demoProgressBar').style.width = `${Math.min(100, progressPercent)}%`;
    
    // Update step items
    // Initialize future steps as "Upcoming" (not queued), current as "Pending" if not started
    const stepStatuses = ['Upcoming', 'Upcoming', 'Upcoming', 'Upcoming'];
    const stepStates = ['', '', '', ''];
    
    for (let i = 1; i <= 4; i++) {
        if (i < currentStep) {
            // Steps before current are completed
            stepStatuses[i - 1] = 'Completed';
            stepStates[i - 1] = 'completed';
        } else if (i === currentStep) {
            // Current step - show actual state based on the outer state variable
            if (state === 'running' || state === 'in_progress') {
                stepStatuses[i - 1] = 'In Progress';
                stepStates[i - 1] = 'active';
            } else if (state === 'failed' || state === 'error') {
                stepStatuses[i - 1] = 'Failed';
                stepStates[i - 1] = 'error';
            } else if (state === 'completed' || state === 'awaiting_approval') {
                stepStatuses[i - 1] = 'Completed';
                stepStates[i - 1] = 'completed';
            } else {
                stepStatuses[i - 1] = 'Pending';
                stepStates[i - 1] = '';
            }
        }
        // Steps after currentStep remain "Upcoming" (not yet queued)
        
        const stepEl = document.querySelector(`.demo-step-item[data-step="${i}"]`);
        if (stepEl) {
            stepEl.className = `demo-step-item ${stepStates[i - 1]}`;
            document.getElementById(`step${i}Status`).textContent = stepStatuses[i - 1];
        }
    }
}

function renderAgentActivity(status) {
    const statusDot = document.getElementById('agentStatusDot');
    const statusText = document.getElementById('agentStatusText');
    const currentStep = document.getElementById('agentCurrentStep');
    const logsContainer = document.getElementById('agentLogs');
    
    // Status indicator
    const state = status?.state || 'idle';
    statusDot.className = 'agent-dot';
    
    if (state === 'running' || state === 'in_progress' || state === 'triggering') {
        statusDot.classList.add('running');
        statusText.textContent = 'Agent Running';
    } else if (state === 'failed' || state === 'error') {
        statusDot.classList.add('error');
        statusText.textContent = 'Error';
    } else if (state === 'completed' || state === 'awaiting_approval') {
        statusDot.classList.add('success');
        statusText.textContent = 'Completed';
    } else {
        statusDot.classList.add('idle');
        statusText.textContent = 'Idle';
    }
    
    // Current step message
    currentStep.textContent = status?.message || '';
    
    // Logs
    const logs = status?.logs || [];
    if (logs.length > 0) {
        logsContainer.innerHTML = logs.map(log => {
            const logStr = String(log);
            let className = 'log-entry';
            
            // Detect step completion banners (large)
            if (logStr.includes('STEP') && logStr.includes('COMPLETE')) {
                className += ' banner';
            }
            // Detect task completion messages (small)
            else if (logStr.includes('Task') && logStr.includes('complete:')) {
                className += ' task-complete';
            }
            
            return `<div class="${className}">${FormattingUtils.escapeHtml(logStr)}</div>`;
        }).join('');
        
        // Auto-scroll to bottom
        logsContainer.scrollTop = logsContainer.scrollHeight;
    } else {
        logsContainer.innerHTML = '<p class="no-logs">No activity logs yet</p>';
    }
}

function renderContext(context) {
    document.getElementById('contextEmail').textContent = context?.email || 'N/A';
    document.getElementById('contextPhone').textContent = context?.phone || 'N/A';
    document.getElementById('contextAddress').textContent = context?.address || 'N/A';
    document.getElementById('contextServices').textContent = context?.services || 'N/A';
}

function renderBranding(context) {
    const primaryColor = context?.primaryColor || '#000000';
    const secondaryColor = context?.secondaryColor || '#ffffff';
    const fontFamily = context?.fontFamily || 'sans-serif';
    
    document.getElementById('colorSwatch').style.backgroundColor = primaryColor;
    document.getElementById('primaryColor').textContent = primaryColor;
    
    document.getElementById('secondaryColorSwatch').style.backgroundColor = secondaryColor;
    document.getElementById('secondaryColor').textContent = secondaryColor;
    
    document.getElementById('fontFamily').textContent = fontFamily;
}

function renderTimestamps(status, taskState, context) {
    const createdAt = context?.createdAt || taskState?.createdAt;
    const updatedAt = status?.updatedAt || taskState?.updatedAt;
    
    document.getElementById('createdAt').textContent = createdAt 
        ? FormattingUtils.formatRelativeTime(createdAt)
        : '-';
    
    document.getElementById('updatedAt').textContent = updatedAt
        ? FormattingUtils.formatRelativeTime(updatedAt)
        : '-';
}

function setupPreviewLink(status) {
    const previewLink = document.getElementById('previewLink');
    // Show preview link if demo is running or completed
    if (status?.state === 'running' || status?.state === 'completed' || status?.state === 'awaiting_approval') {
        // Use environment-aware URL from config
        if (window.APP_CONFIG) {
            // In production or for completed demos, use the static URL
            // In dev with a running preview, we'd ideally use the preview port
            // but demos don't have their own preview server, so use static URL
            const demoUrl = window.APP_CONFIG.getDemoUrl(clientSlug);
            previewLink.href = demoUrl;
        } else {
            // Fallback if config not loaded
            previewLink.href = `/client-websites/${clientSlug}/`;
        }
        previewLink.classList.remove('hidden');
    } else {
        previewLink.classList.add('hidden');
    }
}

// Toggle logs visibility
function toggleLogs() {
    const logsContainer = document.getElementById('agentLogsContainer');
    const toggleBtn = document.getElementById('toggleLogsBtn');
    
    logsExpanded = !logsExpanded;
    
    if (logsExpanded) {
        logsContainer.classList.remove('collapsed');
        toggleBtn.textContent = 'Hide Logs';
        // Collapse events viewer when showing legacy logs
        if (eventsViewerExpanded) {
            toggleEventsViewer();
        }
    } else {
        logsContainer.classList.add('collapsed');
        toggleBtn.textContent = 'Show Logs';
    }
}

// Toggle live events viewer
function toggleEventsViewer() {
    const eventsContainer = document.getElementById('eventsViewerContainer');
    const toggleBtn = document.getElementById('toggleEventsViewerBtn');
    
    eventsViewerExpanded = !eventsViewerExpanded;
    
    if (eventsViewerExpanded) {
        eventsContainer.classList.remove('collapsed');
        toggleBtn.textContent = 'Hide Events';
        toggleBtn.classList.remove('btn-primary');
        toggleBtn.classList.add('btn-secondary');
        
        // Collapse legacy logs when showing events viewer
        if (logsExpanded) {
            toggleLogs();
        }
        
        // Initialize and connect events viewer
        initEventsViewer();
    } else {
        eventsContainer.classList.add('collapsed');
        toggleBtn.textContent = 'Live Events';
        toggleBtn.classList.remove('btn-secondary');
        toggleBtn.classList.add('btn-primary');
        
        // Disconnect events viewer when hidden
        if (eventsViewer) {
            eventsViewer.disconnect();
        }
    }
}

// Initialize the events viewer
function initEventsViewer() {
    if (!eventsViewer && window.EventsViewer) {
        eventsViewer = new EventsViewer('eventsViewer', {
            autoScroll: true,
            maxEvents: 500,
            defaultView: 'formatted',
            onStatusUpdate: (status) => {
                // Update agent status indicator based on SSE status
                updateAgentStatusFromSSE(status);
            },
            onComplete: (data) => {
                console.log('Events stream completed:', data);
            }
        });
    }
    
    // Connect to the current task's event stream
    if (eventsViewer && clientSlug) {
        // Determine the current step task ID
        const currentStep = demoData?.status?.currentStep || 1;
        const taskId = currentStep > 1 
            ? `demo-${clientSlug}-step${currentStep}`
            : `demo-${clientSlug}`;
        
        eventsViewer.connect(taskId);
    }
}

// Update agent status from SSE data
function updateAgentStatusFromSSE(status) {
    if (!status) return;
    
    const statusDot = document.getElementById('agentStatusDot');
    const statusText = document.getElementById('agentStatusText');
    const currentStep = document.getElementById('agentCurrentStep');
    
    if (statusDot) {
        statusDot.className = 'agent-dot';
        if (status.state === 'RUNNING' || status.state === 'STARTING') {
            statusDot.classList.add('running');
        } else if (status.state === 'DONE') {
            statusDot.classList.add('success');
        } else if (status.state === 'FAILED') {
            statusDot.classList.add('error');
        } else {
            statusDot.classList.add('idle');
        }
    }
    
    if (statusText) {
        const stateText = {
            'STARTING': 'Starting...',
            'RUNNING': 'Agent Running',
            'DONE': 'Completed',
            'FAILED': 'Failed'
        };
        statusText.textContent = stateText[status.state] || status.state;
    }
    
    if (currentStep && status.step) {
        currentStep.textContent = status.step;
    }
}

// Delete demo
function showDeleteModal() {
    document.getElementById('deleteModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('deleteModal').classList.add('show'), 10);
}

function hideDeleteModal() {
    document.getElementById('deleteModal').classList.remove('show');
    setTimeout(() => document.getElementById('deleteModal').classList.add('hidden'), 300);
}

async function deleteDemo() {
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting...';
    
    try {
        const taskId = `demo-${clientSlug}`;
        await api.delete(`/tasks/${taskId}`);
        
        notifications.success('Demo deleted successfully');
        
        // Redirect to dashboard
        setTimeout(() => {
            window.location.href = '/index.html';
        }, 1000);
    } catch (err) {
        notifications.error(`Failed to delete demo: ${err.message}`);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete Demo';
    }
}

// Kill demo - stop running process and remove from queue
async function killDemo() {
    if (!confirm(`Are you sure you want to kill this demo? This will stop any running agent and remove the demo from the queue.`)) {
        return;
    }
    
    const killBtn = document.getElementById('killDemoBtn');
    if (killBtn) {
        killBtn.disabled = true;
        killBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Killing...';
        if (window.lucide) lucide.createIcons();
    }
    
    try {
        const taskId = `demo-${clientSlug}`;
        const response = await api.post(`/tasks/${taskId}/kill`, {});
        
        if (response.success) {
            notifications.success('Demo killed successfully');
            stopAutoRefresh();
            
            // Redirect to dashboard after a short delay
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 1500);
        } else {
            notifications.error(response.error || 'Failed to kill demo');
        }
    } catch (err) {
        notifications.error(`Failed to kill demo: ${err.message}`);
    } finally {
        if (killBtn) {
            killBtn.disabled = false;
            killBtn.innerHTML = '<i data-lucide="x-octagon"></i> Kill Demo';
            if (window.lucide) lucide.createIcons();
        }
    }
}

// Modal helpers
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.add('show'), 10);
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
}

// Open step changes modal
function openStepChangesModal() {
    const input = document.getElementById('stepFeedbackInput');
    if (input) input.value = '';
    
    const submitBtn = document.getElementById('submitStepChangesBtn');
    if (submitBtn) submitBtn.disabled = true;
    
    showModal('stepChangesModal');
}

// Open reject demo modal
function openRejectDemoModal() {
    showModal('rejectDemoModal');
}

// Submit step changes (request changes flow)
async function submitStepChanges() {
    const feedbackInput = document.getElementById('stepFeedbackInput');
    const feedback = feedbackInput?.value?.trim();
    
    if (!feedback || feedback.length < 10) {
        notifications.warning('Please provide at least 10 characters of feedback.');
        return;
    }
    
    const btn = document.getElementById('submitStepChangesBtn');
    if (!btn) return;
    
    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-sm"></span> Sending...';
    
    try {
        // Use the request-changes endpoint
        const response = await api.post(`/demos/${clientSlug}/request-changes`, { feedback });
        
        if (response.success) {
            notifications.success('Feedback sent! Agent will retry with your changes.');
            hideModal('stepChangesModal');
            
            // Hide approval section
            document.getElementById('approvalSection')?.classList.add('hidden');
            
            // Reload to see new status
            await loadDemoDetails({ showNotification: false });
            startAutoRefresh();
        } else {
            throw new Error(response.error || 'Failed to send feedback');
        }
    } catch (err) {
        notifications.error(`Failed to send feedback: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
        if (window.lucide) lucide.createIcons();
    }
}

// Approve and publish (final step)
async function approveAndPublish() {
    const btn = document.getElementById('approvePublishBtn');
    if (!btn) return;
    
    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Publishing...';
    if (window.lucide) lucide.createIcons();
    
    try {
        const taskId = `demo-${clientSlug}`;
        const result = await api.post(`/tasks/${taskId}/approve`, { publish: true });
        
        if (result.repoUrl) {
            notifications.success(`Demo published! Repo: ${result.repoUrl}`);
        } else if (result.completed) {
            notifications.success('Demo approved and completed! 🎉');
        } else {
            notifications.success(result.message || 'Demo approved successfully.');
        }
        
        await loadDemoDetails({ showNotification: false });
    } catch (err) {
        notifications.error(`Failed to publish: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
        if (window.lucide) lucide.createIcons();
    }
}

// Confirm reject demo
async function confirmRejectDemo() {
    const btn = document.getElementById('confirmRejectDemoBtn');
    if (!btn) return;
    
    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-sm"></span> Deleting...';
    
    try {
        const response = await api.post(`/demos/${clientSlug}/reject`, {});
        
        if (response.success) {
            notifications.success('Demo rejected and deleted.');
            hideModal('rejectDemoModal');
            
            // Redirect to dashboard
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 1000);
        } else {
            throw new Error(response.error || 'Failed to reject demo');
        }
    } catch (err) {
        notifications.error(`Failed to reject demo: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
        if (window.lucide) lucide.createIcons();
    }
}

// Render approval section based on state
function renderApprovalSection(status, taskState) {
    const approvalSection = document.getElementById('approvalSection');
    if (!approvalSection) return;
    
    // Determine if approval section should be visible
    const state = status?.state || taskState?.state || 'unknown';
    const showableStates = ['awaiting_approval', 'testing', 'completed', 'awaiting_publish', 'publish_failed'];
    
    // Don't show if agent is running
    const runningStates = ['running', 'in_progress', 'triggering', 'cloning', 'installing'];
    const isRunning = runningStates.includes(state);
    
    // Show section if in showable state and not running
    const currentStep = status?.currentStep || 1;
    const totalSteps = status?.totalSteps || 4;
    const isFinalStep = currentStep >= totalSteps;
    const canApprove = showableStates.includes(state) && !isRunning;
    
    if (canApprove) {
        approvalSection.classList.remove('hidden');
        
        // Update prompt text based on current step
        const promptEl = document.getElementById('approvalPrompt');
        const stepApprovalBtns = document.getElementById('stepApprovalButtons');
        const finalApprovalBtns = document.getElementById('finalApprovalButtons');
        
        if (isFinalStep) {
            // Show final approval buttons (Approve & Publish, Request Revision, Reject)
            if (promptEl) {
                promptEl.textContent = 'All steps complete! Review the final demo and choose an action.';
            }
            stepApprovalBtns?.classList.add('hidden');
            finalApprovalBtns?.classList.remove('hidden');
        } else {
            // Show step approval buttons (Approve & Continue, Request Changes)
            const stepNames = ['Branding', 'Copywriting', 'Imagery', 'Review'];
            const stepName = stepNames[currentStep - 1] || 'Current Step';
            if (promptEl) {
                promptEl.textContent = `Review ${stepName} (Step ${currentStep} of ${totalSteps}) and approve to continue.`;
            }
            stepApprovalBtns?.classList.remove('hidden');
            finalApprovalBtns?.classList.add('hidden');
        }
    } else {
        approvalSection.classList.add('hidden');
    }
}

/**
 * Renders the publishing status section (GitHub + Netlify)
 */
function renderPublishingSection(status) {
    const section = document.getElementById('publishingSection');
    if (!section) return;
    
    const state = status?.state || 'unknown';
    const hasGitHub = status?.githubRepoUrl || status?.repoUrl;
    const hasNetlify = status?.netlifySiteUrl || status?.netlifySiteId;
    const isPublishing = ['publishing', 'deploying'].includes(state);
    const isPublished = state === 'published';
    const isDeployFailed = state === 'deploy_failed';
    
    // Show section if any publishing info exists or if in publishing states
    if (hasGitHub || hasNetlify || isPublishing || isPublished || isDeployFailed) {
        section.classList.remove('hidden');
    } else {
        section.classList.add('hidden');
        return;
    }
    
    // GitHub Status
    const githubStatus = document.getElementById('githubStatus');
    const githubDetails = document.getElementById('githubDetails');
    const githubRepoLink = document.getElementById('githubRepoLink');
    const githubRepoName = document.getElementById('githubRepoName');
    
    if (hasGitHub) {
        githubStatus.textContent = 'Published';
        githubStatus.className = 'publish-status success';
        githubDetails.classList.remove('hidden');
        const repoUrl = status.githubRepoUrl || status.repoUrl;
        const repoName = status.githubRepoFullName || status.repoFullName || repoUrl.split('/').slice(-2).join('/');
        githubRepoLink.href = repoUrl;
        githubRepoName.textContent = repoName;
    } else if (state === 'publishing') {
        githubStatus.textContent = 'Publishing...';
        githubStatus.className = 'publish-status in-progress';
        githubDetails.classList.add('hidden');
    } else {
        githubStatus.textContent = 'Not Started';
        githubStatus.className = 'publish-status not-started';
        githubDetails.classList.add('hidden');
    }
    
    // Netlify Status
    const netlifyStatus = document.getElementById('netlifyStatus');
    const netlifyDetails = document.getElementById('netlifyDetails');
    const netlifySiteLink = document.getElementById('netlifySiteLink');
    const netlifyAdminLink = document.getElementById('netlifyAdminLink');
    const netlifyError = document.getElementById('netlifyError');
    const netlifyErrorText = document.getElementById('netlifyErrorText');
    const netlifyRetrySection = document.getElementById('netlifyRetrySection');
    
    if (status?.netlifySiteUrl && status?.netlifyDeployState === 'ready') {
        netlifyStatus.textContent = 'Deployed';
        netlifyStatus.className = 'publish-status success';
        netlifyDetails.classList.remove('hidden');
        netlifyError.classList.add('hidden');
        netlifyRetrySection.classList.add('hidden');
        
        netlifySiteLink.href = status.netlifySiteUrl;
        if (status.netlifyAdminUrl) {
            netlifyAdminLink.href = status.netlifyAdminUrl;
            netlifyAdminLink.classList.remove('hidden');
        } else {
            netlifyAdminLink.classList.add('hidden');
        }
    } else if (state === 'deploying' || (status?.netlifyDeployState && !['ready', 'error', 'cancelled'].includes(status.netlifyDeployState))) {
        netlifyStatus.textContent = 'Deploying...';
        netlifyStatus.className = 'publish-status in-progress';
        netlifyDetails.classList.add('hidden');
        netlifyError.classList.add('hidden');
        netlifyRetrySection.classList.add('hidden');
    } else if (isDeployFailed || status?.netlifyError) {
        netlifyStatus.textContent = 'Failed';
        netlifyStatus.className = 'publish-status error';
        netlifyDetails.classList.add('hidden');
        netlifyError.classList.remove('hidden');
        netlifyErrorText.textContent = status.netlifyError || 'Deployment failed';
        netlifyRetrySection.classList.remove('hidden');
        
        // Update retry button text based on whether site exists
        const retryBtn = document.getElementById('retryNetlifyBtn');
        if (retryBtn) {
            if (status.netlifySiteId) {
                retryBtn.innerHTML = '<i data-lucide="refresh-cw"></i> Retry Deployment';
                retryBtn.title = 'Site already exists - will retry the deployment';
            } else {
                retryBtn.innerHTML = '<i data-lucide="plus-circle"></i> Create & Deploy Site';
                retryBtn.title = 'Will create a new Netlify site and deploy';
            }
        }
        
        // Show admin link if site was created (even if deploy failed)
        if (status.netlifyAdminUrl) {
            netlifyDetails.classList.remove('hidden');
            netlifySiteLink.classList.add('hidden');
            netlifyAdminLink.href = status.netlifyAdminUrl;
            netlifyAdminLink.classList.remove('hidden');
        }
    } else if (!hasGitHub) {
        // Can't deploy to Netlify without GitHub
        netlifyStatus.textContent = 'Pending GitHub';
        netlifyStatus.className = 'publish-status not-started';
        netlifyDetails.classList.add('hidden');
        netlifyError.classList.add('hidden');
        netlifyRetrySection.classList.add('hidden');
    } else {
        netlifyStatus.textContent = 'Not Started';
        netlifyStatus.className = 'publish-status not-started';
        netlifyDetails.classList.add('hidden');
        netlifyError.classList.add('hidden');
        netlifyRetrySection.classList.add('hidden');
    }
    
    // Refresh icons
    if (window.lucide) lucide.createIcons();
}

/**
 * Retry Netlify deployment
 * Distinguishes between retrying an existing site vs creating a new one
 */
async function retryNetlifyDeploy() {
    const btn = document.getElementById('retryNetlifyBtn');
    if (!btn) return;
    
    btn.disabled = true;
    const originalContent = btn.innerHTML;
    
    // Check if we have an existing site (from the current demo status)
    // The backend will determine this from status, but we show appropriate UI feedback
    const hasExistingSite = demoData?.status?.netlifySiteId;
    const loadingText = hasExistingSite 
        ? '<i data-lucide="loader" class="animate-spin"></i> Retrying deployment...'
        : '<i data-lucide="loader" class="animate-spin"></i> Creating site...';
    
    btn.innerHTML = loadingText;
    if (window.lucide) lucide.createIcons();
    
    try {
        const response = await api.post(`/demos/${clientSlug}/retry-netlify`, {});
        
        if (response.success) {
            notifications.success(`Deployed to Netlify: ${response.netlifySiteUrl}`);
            
            // Reload to show new status
            await loadDemoDetails({ showNotification: false });
        } else {
            // Check for specific error codes that might help user
            if (response.errorCode === 'OAUTH_NOT_CONFIGURED') {
                notifications.error('Netlify GitHub OAuth not configured. Install the Netlify GitHub App first.');
            } else if (response.errorCode === 'MISSING_CONFIG') {
                notifications.error('Netlify not configured. Check Settings page.');
            } else {
                throw new Error(response.error || 'Retry failed');
            }
        }
    } catch (err) {
        notifications.error(`Netlify deployment failed: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
        if (window.lucide) lucide.createIcons();
    }
}

// Approve current step (intermediate step approval)
async function approveCurrentStep() {
    const btn = document.getElementById('approveStepBtn');
    if (!btn) return;
    
    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Approving...';
    if (window.lucide) lucide.createIcons();
    
    try {
        const taskId = `demo-${clientSlug}`;
        const result = await api.post(`/tasks/${taskId}/approve`, {});
        
        if (result.completed) {
            notifications.success('Demo approved and completed! 🎉');
        } else if (result.nextStep) {
            notifications.success(`Step approved! Moving to step ${result.nextStep}.`);
        } else {
            notifications.success(result.message || 'Step approved successfully.');
        }
        
        // Reload details
        await loadDemoDetails({ showNotification: false });
    } catch (err) {
        notifications.error(`Failed to approve: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
        if (window.lucide) lucide.createIcons();
    }
}

// Auto-refresh
function startAutoRefresh() {
    if (autoRefreshInterval) return;
    
    const indicator = document.getElementById('autoRefreshIndicator');
    indicator?.classList.remove('hidden');
    
    autoRefreshInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
            loadDemoDetails({ silent: true });
        }
    }, 3000); // Refresh every 3 seconds when demo is in progress
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    
    const indicator = document.getElementById('autoRefreshIndicator');
    indicator?.classList.add('hidden');
}

// Error handling
function showError(message) {
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const errorMessage = document.getElementById('errorMessage');
    const details = document.getElementById('demoDetails');
    
    loading?.classList.add('hidden');
    details?.classList.add('hidden');
    error?.classList.remove('hidden');
    
    if (errorMessage) {
        errorMessage.textContent = message;
    }
}

// Theme Management - Using centralized ThemeUtils from theme.js

// Cleanup
window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
});

// Pause auto-refresh when page is hidden
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && demoData) {
        const status = demoData.status;
        if (status && ['running', 'triggering', 'cloning', 'installing'].includes(status.state)) {
            loadDemoDetails({ silent: true });
        }
    }
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
    const submitBtn = document.getElementById('submitAgentFeedbackBtn');
    const historyBtn = document.getElementById('toggleFeedbackHistoryBtn');
    const applyCheckbox = document.getElementById('applyOnNextRunCheckbox');
    const rerunCheckbox = document.getElementById('triggerRerunCheckbox');
    
    // Enable/disable submit button based on input
    feedbackInput?.addEventListener('input', () => {
        if (submitBtn) {
            submitBtn.disabled = feedbackInput.value.trim().length < 3;
        }
    });
    
    // Submit feedback button
    submitBtn?.addEventListener('click', handleSubmitAgentFeedback);
    
    // Toggle history visibility
    historyBtn?.addEventListener('click', toggleFeedbackHistory);
    
    // When "trigger rerun" is checked, ensure "apply on next run" is also checked
    rerunCheckbox?.addEventListener('change', () => {
        if (rerunCheckbox.checked && applyCheckbox) {
            applyCheckbox.checked = true;
        }
    });
    
    // Allow Ctrl+Enter to submit
    feedbackInput?.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter' && !submitBtn?.disabled) {
            handleSubmitAgentFeedback();
        }
    });
}

/**
 * Handles submitting feedback to the agent
 */
async function handleSubmitAgentFeedback() {
    const feedbackInput = document.getElementById('agentFeedbackInput');
    const submitBtn = document.getElementById('submitAgentFeedbackBtn');
    const applyCheckbox = document.getElementById('applyOnNextRunCheckbox');
    const rerunCheckbox = document.getElementById('triggerRerunCheckbox');
    
    const feedback = feedbackInput?.value?.trim();
    const taskId = `demo-${clientSlug}`;
    
    if (!feedback || feedback.length < 3) {
        notifications.warning('Please enter at least 3 characters of feedback');
        return;
    }
    
    const applyOnNextRun = applyCheckbox?.checked ?? true;
    const triggerRerun = rerunCheckbox?.checked ?? false;
    
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
            if (response.rerunTriggered) {
                notifications.success('Feedback sent! Agent rerun triggered.');
            } else if (applyOnNextRun) {
                notifications.success('Feedback saved and will be applied on next step.');
            } else {
                notifications.success('Feedback saved for reference.');
            }
            
            // Clear input
            if (feedbackInput) feedbackInput.value = '';
            
            // Reset rerun checkbox
            if (rerunCheckbox) rerunCheckbox.checked = false;
            
            // Refresh feedback history
            await loadAgentFeedbackHistory();
            
            // If rerun was triggered, start polling for updates
            if (response.rerunTriggered) {
                loadDemoDetails({ silent: true });
                if (!autoRefreshInterval) {
                    startAutoRefresh();
                }
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
        loadAgentFeedbackHistory();
    } else {
        container?.classList.add('collapsed');
        if (btn) btn.textContent = 'History';
    }
}

/**
 * Loads and renders the agent feedback history
 */
async function loadAgentFeedbackHistory() {
    const listContainer = document.getElementById('feedbackHistoryList');
    const countBadge = document.getElementById('feedbackHistoryCount');
    const taskId = `demo-${clientSlug}`;
    
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
 * Updates the feedback section based on current demo state
 */
function updateFeedbackSectionState() {
    const section = document.getElementById('agentFeedbackSection');
    const submitBtn = document.getElementById('submitAgentFeedbackBtn');
    const rerunCheckbox = document.getElementById('triggerRerunCheckbox');
    const rerunLabel = rerunCheckbox?.parentElement;
    
    if (!section || !demoData?.status) return;
    
    const state = demoData.status.state || demoData.taskState?.state || 'unknown';
    
    // States where rerun can be triggered
    const rerunnableStates = ['completed', 'awaiting_approval', 'error', 'idle'];
    const isRerunnable = rerunnableStates.includes(state);
    
    // States where agent is actively running
    const runningStates = ['running', 'in_progress', 'triggering', 'cloning', 'installing', 'organizing', 'prompting'];
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
}

// ============================================
// Demo Error Recovery System
// ============================================

/**
 * Error category definitions for demo workflow
 */
const DEMO_ERROR_CATEGORIES = {
    credit_limit: {
        label: 'Credits Exhausted',
        icon: 'credit-card',
        className: 'credit',
        recoverable: true,
        autoRetry: false,
        canSkipStep: false
    },
    model_error: {
        label: 'Model Unavailable',
        icon: 'cpu',
        className: 'model',
        recoverable: true,
        autoRetry: false,
        canSkipStep: false
    },
    network_error: {
        label: 'Network Error',
        icon: 'wifi-off',
        className: 'network',
        recoverable: true,
        autoRetry: true,
        canSkipStep: false,
        backoff: [5000, 10000, 30000]
    },
    timeout: {
        label: 'Request Timeout',
        icon: 'clock',
        className: 'timeout',
        recoverable: true,
        autoRetry: true,
        canSkipStep: true,
        backoff: [5000, 15000]
    },
    step_failed: {
        label: 'Step Failed',
        icon: 'alert-triangle',
        className: 'unknown',
        recoverable: true,
        autoRetry: false,
        canSkipStep: true
    },
    unknown: {
        label: 'Unexpected Error',
        icon: 'alert-triangle',
        className: 'unknown',
        recoverable: true,
        autoRetry: false,
        canSkipStep: true
    }
};

// Demo retry state
let demoRetryState = {
    slug: null,
    errorCategory: null,
    failedStep: null,
    retryCount: 0,
    lastErrorTime: null,
    autoRetryTimer: null,
    countdownTimer: null
};

/**
 * Loads demo retry state from localStorage
 */
function loadDemoRetryState() {
    try {
        const stored = localStorage.getItem(`demoRetryState_${clientSlug}`);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.slug === clientSlug && 
                parsed.lastErrorTime && 
                Date.now() - parsed.lastErrorTime < 24 * 60 * 60 * 1000) {
                demoRetryState = { ...demoRetryState, ...parsed };
            }
        }
    } catch (err) {
        console.warn('Failed to load demo retry state:', err);
    }
}

/**
 * Saves demo retry state to localStorage
 */
function saveDemoRetryState() {
    try {
        localStorage.setItem(`demoRetryState_${clientSlug}`, JSON.stringify({
            slug: demoRetryState.slug,
            errorCategory: demoRetryState.errorCategory,
            failedStep: demoRetryState.failedStep,
            retryCount: demoRetryState.retryCount,
            lastErrorTime: demoRetryState.lastErrorTime
        }));
    } catch (err) {
        console.warn('Failed to save demo retry state:', err);
    }
}

/**
 * Clears demo retry state
 */
function clearDemoRetryState() {
    demoRetryState = {
        slug: null,
        errorCategory: null,
        failedStep: null,
        retryCount: 0,
        lastErrorTime: null,
        autoRetryTimer: null,
        countdownTimer: null
    };
    try {
        localStorage.removeItem(`demoRetryState_${clientSlug}`);
    } catch (err) {
        console.warn('Failed to clear demo retry state:', err);
    }
}

/**
 * Detects error category from demo status
 */
function detectDemoErrorCategory(status) {
    if (!status) return 'unknown';
    
    // Check explicit error category
    if (status.errorCategory) {
        return status.errorCategory;
    }
    
    // Infer from error message
    const errorMsg = (status.error || status.message || '').toLowerCase();
    
    if (errorMsg.includes('credit') || errorMsg.includes('usage limit') || errorMsg.includes('quota')) {
        return 'credit_limit';
    }
    if (errorMsg.includes('model') || errorMsg.includes('unavailable')) {
        return 'model_error';
    }
    if (errorMsg.includes('network') || errorMsg.includes('connection')) {
        return 'network_error';
    }
    if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
        return 'timeout';
    }
    if (errorMsg.includes('step') && errorMsg.includes('failed')) {
        return 'step_failed';
    }
    
    return 'unknown';
}

/**
 * Renders the demo error section with enhanced recovery options
 */
async function renderDemoErrorSection(status) {
    const errorSection = document.getElementById('demoErrorSection');
    const errorBadge = document.getElementById('demoErrorCategoryBadge');
    const errorUserMessage = document.getElementById('demoErrorUserMessage');
    const errorDetails = document.getElementById('demoErrorDetails');
    const errorActions = document.getElementById('demoErrorActions');
    
    const state = status?.state || 'unknown';
    const isError = state === 'failed' || state === 'error';
    
    if (!errorSection || !isError) {
        if (errorSection) errorSection.classList.add('hidden');
        clearDemoAutoRetryTimers();
        return;
    }
    
    // Detect error category
    const category = detectDemoErrorCategory(status);
    const categoryInfo = DEMO_ERROR_CATEGORIES[category] || DEMO_ERROR_CATEGORIES.unknown;
    
    // Update retry state
    if (demoRetryState.errorCategory !== category || demoRetryState.slug !== clientSlug) {
        demoRetryState.slug = clientSlug;
        demoRetryState.errorCategory = category;
        demoRetryState.failedStep = status.currentStep || 1;
        demoRetryState.lastErrorTime = Date.now();
        saveDemoRetryState();
    }
    
    // Show error section
    errorSection.classList.remove('hidden');
    
    // Update badge
    if (errorBadge) {
        errorBadge.innerHTML = `<i data-lucide="${categoryInfo.icon}"></i> ${categoryInfo.label}`;
        errorBadge.className = `error-category-badge ${categoryInfo.className}`;
    }
    
    // User message
    const userMessage = status.userMessage || getDemoErrorMessage(category, status.currentStep);
    if (errorUserMessage) {
        errorUserMessage.textContent = userMessage;
    }
    
    // Error details
    if (errorDetails) {
        errorDetails.textContent = status.error || status.message || 'No additional details available.';
    }
    
    // **NEW**: Fetch recovery options from backend for enhanced UI
    try {
        const recoveryData = await api.get(`/demos/${clientSlug}/recovery-options`);
        
        if (recoveryData.success) {
            renderRecoveryOptions(recoveryData, status);
            // Refresh icons after rendering
            if (window.lucide) lucide.createIcons();
            return; // Skip default action rendering
        }
    } catch (err) {
        console.warn(`Could not fetch recovery options: ${err.message}`);
        // Fallback to basic retry buttons (existing behavior)
    }
    
    // Fallback: Show basic action buttons
    if (errorActions) {
        errorActions.classList.remove('hidden');
        
        // Show/hide skip button based on category
        const skipBtn = document.getElementById('demoSkipStepBtn');
        if (skipBtn) {
            if (categoryInfo.canSkipStep && status.currentStep < (status.totalSteps || 4)) {
                skipBtn.classList.remove('hidden');
            } else {
                skipBtn.classList.add('hidden');
            }
        }
    }
    
    // Setup error action handlers
    setupDemoErrorActionHandlers(category, status);
    
    // Start auto-retry for transient errors
    if (categoryInfo.autoRetry && demoRetryState.retryCount < 3) {
        startDemoAutoRetry(category);
    }
    
    // Refresh icons
    if (window.lucide) lucide.createIcons();
}

/**
 * Renders enhanced recovery options with rollback preview
 */
function renderRecoveryOptions(recoveryData, status) {
    const { failedStep, checkpoint, preview, options, retryCount, maxRetries, canRetry, canSkip } = recoveryData;
    
    // Get or create the recovery context container
    let recoveryContainer = document.getElementById('recoveryContextContainer');
    const errorActions = document.getElementById('demoErrorActions');
    
    if (!recoveryContainer && errorActions) {
        recoveryContainer = document.createElement('div');
        recoveryContainer.id = 'recoveryContextContainer';
        recoveryContainer.className = 'recovery-context';
        errorActions.parentNode.insertBefore(recoveryContainer, errorActions);
    }
    
    if (!recoveryContainer) return;
    
    // Build the recovery UI HTML
    let html = `
        <h4>Recovery Options</h4>
    `;
    
    // Checkpoint info
    if (checkpoint) {
        html += `
            <div class="checkpoint-info">
                <i data-lucide="save"></i>
                <span>Last checkpoint: Step ${checkpoint.stepNumber} (${checkpoint.stepName})</span>
                <span class="checkpoint-time">${FormattingUtils.formatRelativeTime(checkpoint.timestamp)}</span>
            </div>
        `;
    } else {
        html += `
            <div class="checkpoint-info warning">
                <i data-lucide="alert-circle"></i>
                <span>No checkpoint available - step will restart from current state</span>
            </div>
        `;
    }
    
    // Retry warning
    if (retryCount > 0) {
        html += `
            <div class="retry-warning">
                <i data-lucide="alert-triangle"></i>
                <span>This step has been retried ${retryCount} time${retryCount === 1 ? '' : 's'}</span>
                ${retryCount >= maxRetries ? '<span class="retry-limit-reached">(limit reached)</span>' : ''}
            </div>
        `;
    }
    
    // Rollback preview
    if (preview && (preview.preservedSteps.length > 0 || preview.discardedChanges.length > 0)) {
        html += `
            <div class="rollback-preview">
                <h5>What will happen on retry:</h5>
        `;
        
        if (preview.preservedSteps.length > 0) {
            html += `
                <div class="preview-section preserved">
                    <i data-lucide="check-circle"></i>
                    <div>
                        <strong>Preserved:</strong>
                        <ul>${preview.preservedSteps.map(step => `<li>${FormattingUtils.escapeHtml(step)}</li>`).join('')}</ul>
                    </div>
                </div>
            `;
        }
        
        if (preview.discardedChanges.length > 0) {
            html += `
                <div class="preview-section discarded">
                    <i data-lucide="x-circle"></i>
                    <div>
                        <strong>Will be discarded:</strong>
                        <ul>${preview.discardedChanges.map(change => `<li>${FormattingUtils.escapeHtml(change)}</li>`).join('')}</ul>
                    </div>
                </div>
            `;
        }
        
        html += `</div>`;
    }
    
    // Recovery action buttons
    html += `<div class="recovery-actions">`;
    
    for (const option of options) {
        const variantClass = option.variant === 'primary' ? 'btn-primary' : 
                            option.variant === 'danger' ? 'btn-danger' : 
                            option.variant === 'warning' ? 'btn-warning' : 'btn-secondary';
        
        html += `
            <div class="recovery-action-item">
                <button 
                    class="btn ${variantClass}" 
                    onclick="handleRecoveryAction('${option.action}', this)"
                    ${option.disabled ? 'disabled' : ''}
                    ${option.disabledReason ? `title="${FormattingUtils.escapeHtml(option.disabledReason)}"` : ''}
                >
                    <i data-lucide="${option.icon}"></i>
                    ${FormattingUtils.escapeHtml(option.label)}
                </button>
                <p class="action-description">${FormattingUtils.escapeHtml(option.description)}</p>
            </div>
        `;
    }
    
    html += `</div>`;
    
    recoveryContainer.innerHTML = html;
    
    // Hide the default error actions since we have custom recovery UI
    const defaultActions = document.getElementById('demoErrorActions');
    if (defaultActions) {
        defaultActions.classList.add('hidden');
    }
}

/**
 * Handles recovery action from the enhanced UI
 * @param {string} action - The recovery action ('retry', 'skip', 'wait', 'abort')
 * @param {HTMLButtonElement} [buttonElement] - Optional button element that triggered the action
 */
// FIX: Add global flag to prevent double-clicks during recovery operations
// Reset on page load to handle navigation edge cases
let recoveryInProgress = false;
let recoveryActionTimestamp = 0; // Track when last recovery action started

// FIX: Reset recovery flag when page loads/unloads to prevent stuck state after navigation
window.addEventListener('load', () => { 
    recoveryInProgress = false;
    recoveryActionTimestamp = 0;
});
window.addEventListener('beforeunload', () => { 
    recoveryInProgress = false;
    recoveryActionTimestamp = 0;
});

// FIX: Also reset if flag has been stuck for too long (safety timeout)
function checkRecoveryTimeout() {
    if (recoveryInProgress && recoveryActionTimestamp > 0) {
        const elapsed = Date.now() - recoveryActionTimestamp;
        if (elapsed > 60000) { // 1 minute timeout
            console.warn('Recovery action timed out, resetting flag');
            recoveryInProgress = false;
            recoveryActionTimestamp = 0;
        }
    }
}

async function handleRecoveryAction(action, buttonElement) {
    // FIX: Check for stuck flag and reset if needed
    checkRecoveryTimeout();
    
    // FIX: Prevent double-clicks with global flag (checked before any async operations)
    if (recoveryInProgress) {
        console.log('Recovery already in progress, ignoring duplicate click');
        notifications.warning('Please wait, recovery action is in progress...');
        return;
    }
    
    // Handle 'wait' and 'abort' actions differently
    if (action === 'wait') {
        notifications.info('Please wait for credits to reset. You can check back later.');
        return;
    }
    
    if (action === 'abort') {
        if (!confirm('Are you sure you want to cancel this demo? You can restart it later from the dashboard.')) {
            return;
        }
        // Redirect to dashboard
        window.location.href = '/index.html';
        return;
    }
    
    // Set flag immediately before any async work
    recoveryInProgress = true;
    recoveryActionTimestamp = Date.now();
    
    // For retry and skip, call the backend
    // FIX: Use passed button element directly instead of deprecated global event
    const btn = buttonElement || null;
    let originalContent = '';
    if (btn) {
        btn.disabled = true;
        originalContent = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="loader" class="animate-spin"></i> ${action === 'retry' ? 'Retrying...' : 'Skipping...'}`;
        if (window.lucide) lucide.createIcons();
    }
    
    try {
        const response = await api.post(`/demos/${clientSlug}/retry-step`, { action });
        
        if (response.success) {
            notifications.success(response.message);
            
            // Clear retry state
            clearDemoRetryState();
            
            // Hide error section
            document.getElementById('demoErrorSection')?.classList.add('hidden');
            
            // Remove recovery context
            document.getElementById('recoveryContextContainer')?.remove();
            
            // Reload details and start polling
            await loadDemoDetails({ showNotification: false });
            startAutoRefresh();
        } else {
            throw new Error(response.error || 'Recovery failed');
        }
    } catch (err) {
        notifications.error(`Recovery failed: ${err.message}`);
        // Re-render error section
        renderDemoErrorSection(demoData?.status);
    } finally {
        // FIX: Always reset flag to allow future recovery attempts
        recoveryInProgress = false;
        recoveryActionTimestamp = 0;
        
        // FIX: Always restore button state in finally (not just on error)
        // This handles edge cases where success path doesn't re-render the button
        if (btn && originalContent) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
            if (window.lucide) lucide.createIcons();
        }
    }
}

/**
 * Gets user-friendly error message for demo errors
 */
function getDemoErrorMessage(category, step) {
    const stepNames = ['Branding', 'Copywriting', 'Imagery', 'Review'];
    const stepName = stepNames[(step || 1) - 1] || 'current step';
    
    const messages = {
        credit_limit: `Credits exhausted during ${stepName}. Please wait for credits to reset or upgrade your plan.`,
        model_error: `The AI model is unavailable. The ${stepName} step cannot continue until the model is available.`,
        network_error: `A network error occurred during ${stepName}. We'll retry automatically.`,
        timeout: `The ${stepName} step timed out. This can happen with complex customizations.`,
        step_failed: `The ${stepName} step failed. You can retry or skip to the next step.`,
        unknown: `An unexpected error occurred during ${stepName}.`
    };
    
    return messages[category] || messages.unknown;
}

/**
 * Sets up demo error action handlers
 */
function setupDemoErrorActionHandlers(category, status) {
    // Main retry button
    const mainRetryBtn = document.getElementById('demoErrorRetryBtn');
    if (mainRetryBtn) {
        mainRetryBtn.onclick = () => handleRetryDemoStep();
    }
    
    // Retry step button
    const retryStepBtn = document.getElementById('demoRetryStepBtn');
    if (retryStepBtn) {
        retryStepBtn.onclick = () => handleRetryDemoStep();
    }
    
    // Skip step button
    const skipStepBtn = document.getElementById('demoSkipStepBtn');
    if (skipStepBtn) {
        skipStepBtn.onclick = () => handleSkipDemoStep(status);
    }
    
    // Restart demo button
    const restartBtn = document.getElementById('demoRestartBtn');
    if (restartBtn) {
        restartBtn.onclick = () => handleRestartDemo();
    }
    
    // Cancel auto-retry
    const cancelBtn = document.getElementById('demoCancelAutoRetryBtn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            clearDemoAutoRetryTimers();
            hideDemoAutoRetryProgress();
        };
    }
}

/**
 * Handles retrying the current demo step
 */
async function handleRetryDemoStep() {
    demoRetryState.retryCount++;
    saveDemoRetryState();
    
    clearDemoAutoRetryTimers();
    
    const btn = document.getElementById('demoRetryStepBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Retrying...';
        if (window.lucide) lucide.createIcons();
    }
    
    try {
        const taskId = `demo-${clientSlug}`;
        const currentStep = demoData?.status?.currentStep || 1;
        
        // Use request-changes endpoint to trigger a retry
        const response = await api.post(`/demos/${clientSlug}/request-changes`, {
            feedback: `Retry step ${currentStep} after error`
        });
        
        if (response.success) {
            notifications.success('Retrying step...');
            clearDemoRetryState();
            
            // Hide error section
            document.getElementById('demoErrorSection')?.classList.add('hidden');
            
            // Reload details and start polling
            await loadDemoDetails({ showNotification: false });
            startAutoRefresh();
        } else {
            throw new Error(response.error || 'Failed to retry step');
        }
    } catch (err) {
        notifications.error(`Failed to retry: ${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="refresh-cw"></i> Retry Current Step';
            if (window.lucide) lucide.createIcons();
        }
    }
}

/**
 * Handles skipping to the next demo step
 */
async function handleSkipDemoStep(status) {
    const currentStep = status?.currentStep || 1;
    const totalSteps = status?.totalSteps || 4;
    
    if (currentStep >= totalSteps) {
        notifications.warning('Already on the final step.');
        return;
    }
    
    if (!confirm(`Skip Step ${currentStep} and continue to Step ${currentStep + 1}? The skipped step may be incomplete.`)) {
        return;
    }
    
    const btn = document.getElementById('demoSkipStepBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Skipping...';
        if (window.lucide) lucide.createIcons();
    }
    
    try {
        const taskId = `demo-${clientSlug}`;
        
        // Approve current step to move to next (even though it failed)
        const result = await api.post(`/tasks/${taskId}/approve`, { skipFailed: true });
        
        if (result.nextStep || result.completed) {
            notifications.success(`Skipped to step ${currentStep + 1}`);
            clearDemoRetryState();
            
            // Hide error section
            document.getElementById('demoErrorSection')?.classList.add('hidden');
            
            await loadDemoDetails({ showNotification: false });
        } else {
            throw new Error(result.error || 'Failed to skip step');
        }
    } catch (err) {
        notifications.error(`Failed to skip step: ${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="skip-forward"></i> Skip to Next Step';
            if (window.lucide) lucide.createIcons();
        }
    }
}

/**
 * Handles restarting the entire demo
 */
async function handleRestartDemo() {
    if (!confirm('Restart the entire demo from Step 1? All progress will be lost.')) {
        return;
    }
    
    const btn = document.getElementById('demoRestartBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Restarting...';
        if (window.lucide) lucide.createIcons();
    }
    
    try {
        const response = await api.post(`/demos/${clientSlug}/restart`, {});
        
        if (response.success) {
            notifications.success('Demo restarted from Step 1');
            clearDemoRetryState();
            
            // Hide error section
            document.getElementById('demoErrorSection')?.classList.add('hidden');
            
            await loadDemoDetails({ showNotification: false });
            startAutoRefresh();
        } else {
            throw new Error(response.error || 'Failed to restart demo');
        }
    } catch (err) {
        notifications.error(`Failed to restart: ${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="rotate-ccw"></i> Restart Demo';
            if (window.lucide) lucide.createIcons();
        }
    }
}

/**
 * Starts auto-retry for transient demo errors
 */
function startDemoAutoRetry(category) {
    const categoryInfo = DEMO_ERROR_CATEGORIES[category];
    if (!categoryInfo?.autoRetry || !categoryInfo.backoff) return;
    if (demoRetryState.retryCount >= 3) return;
    
    const delay = categoryInfo.backoff[demoRetryState.retryCount] || categoryInfo.backoff[categoryInfo.backoff.length - 1];
    const seconds = Math.floor(delay / 1000);
    
    showDemoAutoRetryProgress(seconds);
    
    let remaining = seconds;
    const countdownEl = document.getElementById('demoAutoRetryCountdown');
    
    demoRetryState.countdownTimer = setInterval(() => {
        remaining--;
        if (countdownEl) countdownEl.textContent = remaining;
        updateDemoAutoRetryBar(remaining, seconds);
        
        if (remaining <= 0) {
            clearDemoAutoRetryTimers();
            hideDemoAutoRetryProgress();
            handleRetryDemoStep();
        }
    }, 1000);
    
    demoRetryState.autoRetryTimer = setTimeout(() => {
        clearDemoAutoRetryTimers();
        handleRetryDemoStep();
    }, delay + 500);
}

/**
 * Shows demo auto-retry progress
 */
function showDemoAutoRetryProgress(seconds) {
    const container = document.getElementById('demoAutoRetryProgress');
    const countdownEl = document.getElementById('demoAutoRetryCountdown');
    
    if (container) container.classList.remove('hidden');
    if (countdownEl) countdownEl.textContent = seconds;
    
    updateDemoAutoRetryBar(seconds, seconds);
}

/**
 * Hides demo auto-retry progress
 */
function hideDemoAutoRetryProgress() {
    const container = document.getElementById('demoAutoRetryProgress');
    if (container) container.classList.add('hidden');
}

/**
 * Updates demo auto-retry bar
 */
function updateDemoAutoRetryBar(remaining, total) {
    const bar = document.getElementById('demoAutoRetryBarFill');
    if (bar) {
        const percent = ((total - remaining) / total) * 100;
        bar.style.width = `${percent}%`;
    }
}

/**
 * Clears demo auto-retry timers
 */
function clearDemoAutoRetryTimers() {
    if (demoRetryState.autoRetryTimer) {
        clearTimeout(demoRetryState.autoRetryTimer);
        demoRetryState.autoRetryTimer = null;
    }
    if (demoRetryState.countdownTimer) {
        clearInterval(demoRetryState.countdownTimer);
        demoRetryState.countdownTimer = null;
    }
}

// Load retry state on init
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (clientSlug) {
            loadDemoRetryState();
        }
    }, 100);
});
