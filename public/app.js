// Main Dashboard JavaScript - Enhanced with real-time updates, search, and sort

let allTasks = [];
let allTasksGrouped = []; // Tasks in the "All Tasks" section, grouped by client
let currentFilter = 'all';
let currentSort = 'updated_desc';
let searchQuery = '';
let autoRefreshInterval = null;
let isAutoRefreshPaused = false;
let lastUpdateTime = null;
let connectionPollingInterval = null;
let webhookPollingInterval = null;
let queuePollingInterval = null;
let lastQueueOverview = null;
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

// ===== Demo Detection Helpers =====

/**
 * Checks if a taskId represents a demo step task (not the base demo).
 * Pattern: demo-{slug}-step{N} where N is 2, 3, or 4
 * @param {string} taskId 
 * @returns {boolean}
 */
function isDemoStepTask(taskId) {
    return /^demo-.+-step\d+$/.test(taskId);
}

/**
 * Checks if a taskId represents a base demo task.
 * Pattern: demo-{slug} but NOT demo-{slug}-stepN
 * @param {string} taskId 
 * @returns {boolean}
 */
function isBaseDemoTask(taskId) {
    return taskId.startsWith('demo-') && !isDemoStepTask(taskId);
}

/**
 * Extracts the client slug from a demo task ID.
 * demo-sunny-plumbing -> sunny-plumbing
 * @param {string} taskId 
 * @returns {string}
 */
function extractSlugFromDemoTaskId(taskId) {
    return taskId.replace(/^demo-/, '');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize icons
    if (window.lucide) lucide.createIcons();
    
    // Theme toggle
    initTheme();
    
    // Check for client filter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const clientParam = urlParams.get('client');
    if (clientParam) {
        searchQuery = clientParam.toLowerCase();
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = clientParam;
        
        // Update header title to show we're filtering by client
        const headerTitle = document.querySelector('.header-title h1');
        if (headerTitle) headerTitle.textContent = `Dashboard: ${clientParam}`;
        
        // Add a clear button to the header
        const headerActions = document.querySelector('.header-actions');
        if (headerActions) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'btn btn-ghost btn-sm mr-sm';
            clearBtn.innerHTML = '<i data-lucide="x-circle"></i> <span>Clear Filter</span>';
            clearBtn.onclick = () => {
                window.location.href = '/index.html';
            };
            headerActions.prepend(clearBtn);
        }
    }
    
    loadTasks();
    startConnectionPolling();
    loadFailedImports();
    loadWebhookStatus();
    startWebhookStatusPolling();
    loadAvailableModelsForImport();
    loadQueueStatus();
    startQueuePolling();
    
    // Refresh button
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
        loadTasks({ showNotification: true });
    });

    // Theme toggle button
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

    // Git check button
    document.getElementById('checkGitBtn')?.addEventListener('click', async () => {
        const checkGitBtn = document.getElementById('checkGitBtn');
        const originalIcon = checkGitBtn.innerHTML;
        checkGitBtn.disabled = true;
        checkGitBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i>';
        if (window.lucide) lucide.createIcons();

        try {
            const response = await fetch('/api/git/status');
            const data = await response.json();
            
            if (response.ok) {
                notifications.success('Git is working correctly');
            } else {
                notifications.error(`git isnt working: ${data.error || 'Unknown error'}`);
            }
        } catch (error) {
            notifications.error(`git isnt working: ${error.message}`);
        } finally {
            checkGitBtn.disabled = false;
            checkGitBtn.innerHTML = originalIcon;
            if (window.lucide) lucide.createIcons();
        }
    });

    // Webhook toggle button
    document.getElementById('webhookToggleBtn')?.addEventListener('click', toggleWebhook);

    // Pause/resume auto-refresh
    const pauseBtn = document.getElementById('pauseRefreshBtn');
    pauseBtn?.addEventListener('click', () => {
        isAutoRefreshPaused = !isAutoRefreshPaused;
        
        // Update icon
        pauseBtn.innerHTML = isAutoRefreshPaused 
            ? '<i data-lucide="play"></i>' 
            : '<i data-lucide="pause"></i>';
        
        // Update tooltip
        pauseBtn.title = isAutoRefreshPaused ? 'Resume auto-refresh' : 'Pause auto-refresh';
        
        // Refresh icons
        if (window.lucide) lucide.createIcons();
        
        if (isAutoRefreshPaused) {
            stopAutoRefresh();
        } else {
            startAutoRefresh();
        }
    });
    
    // Filter dropdown
    const filterSelect = document.getElementById('filterSelect');
    filterSelect?.addEventListener('change', (e) => {
        currentFilter = e.target.value;
        renderTasks();
    });

    // Search input with debounce
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    searchInput?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchQuery = e.target.value.toLowerCase().trim();
        searchTimeout = setTimeout(() => {
            renderTasks();
        }, 300);
    });

    // Sort select
    const sortSelect = document.getElementById('sortSelect');
    sortSelect?.addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderTasks();
    });

    // Bulk import button
    const importIncompleteBtn = document.getElementById('importIncompleteBtn');
    importIncompleteBtn?.addEventListener('click', async () => {
        if (!confirm('This will fetch all incomplete tasks from ClickUp and attempt to import them. Continue?')) {
            return;
        }

        importIncompleteBtn.disabled = true;
        const originalText = importIncompleteBtn.textContent;
        importIncompleteBtn.textContent = 'Importing...';

        try {
            const results = await api.post('/tasks/import-incomplete', {});
            notifications.success(`Bulk import completed: ${results.imported} tasks imported, ${results.skipped} skipped, ${results.errors.length} errors.`);
            
            if (results.errors.length > 0) {
                loadFailedImports();
            }
            
            await loadTasks({ showNotification: false });
        } catch (error) {
            notifications.error(`Bulk import failed: ${error.message}`);
        } finally {
            importIncompleteBtn.disabled = false;
            importIncompleteBtn.textContent = originalText;
        }
    });

    // Failed imports button and modal
    const failedImportsBtn = document.getElementById('failedImportsBtn');
    const failedImportsModal = document.getElementById('failedImportsModal');
    const closeFailedImportsModal = document.getElementById('closeFailedImportsModal');
    const closeFailedImportsBtn = document.getElementById('closeFailedImportsBtn');
    const retryAllFailedBtn = document.getElementById('retryAllFailedBtn');
    const clearFailedImportsBtn = document.getElementById('clearFailedImportsBtn');

    failedImportsBtn?.addEventListener('click', () => {
        failedImportsModal.classList.remove('hidden');
        setTimeout(() => failedImportsModal.classList.add('show'), 10);
        loadFailedImports();
    });

    function closeFailedImportsModalFn() {
        failedImportsModal.classList.remove('show');
        setTimeout(() => {
            failedImportsModal.classList.add('hidden');
        }, 300);
    }

    closeFailedImportsModal?.addEventListener('click', closeFailedImportsModalFn);
    closeFailedImportsBtn?.addEventListener('click', closeFailedImportsModalFn);
    failedImportsModal?.addEventListener('click', (e) => {
        if (e.target === failedImportsModal) {
            closeFailedImportsModalFn();
        }
    });

    retryAllFailedBtn?.addEventListener('click', async () => {
        const failures = await fetchFailedImports();
        if (failures.length === 0) return;

        const taskIds = failures.map(f => f.taskId);
        
        retryAllFailedBtn.disabled = true;
        const originalHtml = retryAllFailedBtn.innerHTML;
        retryAllFailedBtn.innerHTML = '<span class="spinner-sm"></span> Retrying...';

        try {
            const results = await api.post('/tasks/retry-import', { taskIds });
            notifications.success(`Retry completed: ${results.imported} tasks imported, ${results.errors.length} errors.`);
            
            await loadFailedImports();
            await loadTasks({ showNotification: false });
        } catch (error) {
            notifications.error(`Retry failed: ${error.message}`);
        } finally {
            retryAllFailedBtn.disabled = false;
            retryAllFailedBtn.innerHTML = originalHtml;
            if (window.lucide) lucide.createIcons();
        }
    });

    clearFailedImportsBtn?.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to clear the failed imports history?')) {
            return;
        }

        try {
            await api.delete('/tasks/failed-imports');
            notifications.success('Failed imports history cleared');
            await loadFailedImports();
        } catch (error) {
            notifications.error(`Failed to clear history: ${error.message}`);
        }
    });

    // Retry button
    document.getElementById('retryBtn')?.addEventListener('click', () => {
        loadTasks({ showNotification: true });
    });

    // Import task button and modal
    const importBtn = document.getElementById('importTaskBtn');
    const importModal = document.getElementById('importModal');
    const closeImportModal = document.getElementById('closeImportModal');
    const cancelImportBtn = document.getElementById('cancelImportBtn');
    const confirmImportBtn = document.getElementById('confirmImportBtn');
    const previewImportBtn = document.getElementById('previewImportBtn');
    const taskIdInput = document.getElementById('taskIdInput');
    const clientNameInput = document.getElementById('clientNameInput');
    const triggerWorkflowCheckbox = document.getElementById('triggerWorkflowCheckbox');
    const importPreview = document.getElementById('importPreview');
    const previewContent = document.getElementById('previewContent');
    const importError = document.getElementById('importError');

    importBtn?.addEventListener('click', () => {
        importModal.classList.remove('hidden');
        setTimeout(() => importModal.classList.add('show'), 10);
        taskIdInput?.focus();
        // Reset form
        importPreview.classList.add('hidden');
        importError.classList.add('hidden');
    });

    function closeImportModalFn() {
        importModal.classList.remove('show');
        setTimeout(() => {
            importModal.classList.add('hidden');
            taskIdInput.value = '';
            clientNameInput.value = '';
            triggerWorkflowCheckbox.checked = false;
            importPreview.classList.add('hidden');
            importError.classList.add('hidden');
        }, 300);
    }

    closeImportModal?.addEventListener('click', closeImportModalFn);
    cancelImportBtn?.addEventListener('click', closeImportModalFn);
    importModal?.addEventListener('click', (e) => {
        if (e.target === importModal) {
            closeImportModalFn();
        }
    });

    // Preview import functionality
    previewImportBtn?.addEventListener('click', async () => {
        const taskId = taskIdInput?.value.trim();
        if (!taskId) {
            importError.textContent = 'Please enter a task ID';
            importError.classList.remove('hidden');
            return;
        }

        previewImportBtn.disabled = true;
        const originalText = previewImportBtn.textContent;
        previewImportBtn.textContent = 'Loading...';
        importError.classList.add('hidden');
        importPreview.classList.add('hidden');

        try {
            const clientName = clientNameInput?.value.trim() || undefined;
            const queryParams = clientName ? `?clientName=${encodeURIComponent(clientName)}` : '';
            

            const preview = await api.get(`/tasks/import/preview/${taskId}${queryParams}`);

            if (preview.canImport) {
                let methodLabel = '';
                switch (preview.determinationMethod) {
                    case 'manual': methodLabel = ' (Manual Mapping)'; break;
                    case 'pattern': methodLabel = ' (Pattern Mapping)'; break;
                    case 'folder': methodLabel = ' (From ClickUp Folder)'; break;
                    case 'extracted': methodLabel = ' (Extracted from Name)'; break;
                }

                previewContent.innerHTML = `
                    <div class="preview-success">
                        <p><strong>✓ Task Name:</strong> ${FormattingUtils.escapeHtml(preview.taskName || 'N/A')}</p>
                        <p><strong>✓ Client:</strong> ${FormattingUtils.escapeHtml(preview.clientName || 'N/A')}<span class="text-hint">${methodLabel}</span></p>
                        <p><strong>✓ Folder:</strong> <code>${FormattingUtils.escapeHtml(preview.clientFolder || 'N/A')}</code></p>
                        ${preview.warnings && preview.warnings.length > 0 ? `
                            <div class="preview-warnings">
                                <strong>⚠ Warnings:</strong>
                                <ul>
                                    ${preview.warnings.map(w => `<li>${FormattingUtils.escapeHtml(w)}</li>`).join('')}
                                </ul>
                            </div>
                        ` : ''}
                        <p class="preview-ready">Ready to import!</p>
                    </div>
                `;
                importPreview.classList.remove('hidden');
            } else {
                let errorHtml = `<p><strong>✗ Cannot import:</strong> ${FormattingUtils.escapeHtml(preview.error || 'Unknown error')}</p>`;
                if (preview.suggestions && preview.suggestions.length > 0) {
                    errorHtml += `
                        <div class="preview-suggestions">
                            <strong>Suggestions:</strong>
                            <ul>
                                ${preview.suggestions.map(s => `<li>${FormattingUtils.escapeHtml(s)}</li>`).join('')}
                            </ul>
                        </div>
                    `;
                }
                importError.innerHTML = errorHtml;
                importError.classList.remove('hidden');
            }
        } catch (error) {
            importError.textContent = `Preview failed: ${error.message || 'Unknown error'}`;
            importError.classList.remove('hidden');
        } finally {
            previewImportBtn.disabled = false;
            previewImportBtn.textContent = originalText;
        }
    });

    // Confirm import functionality
    confirmImportBtn?.addEventListener('click', async () => {
        const taskId = taskIdInput?.value.trim();
        if (!taskId) {
            importError.textContent = 'Please enter a task ID';
            importError.classList.remove('hidden');
            return;
        }

        confirmImportBtn.disabled = true;
        previewImportBtn.disabled = true;
        const originalText = confirmImportBtn.textContent;
        confirmImportBtn.textContent = 'Importing...';
        importError.classList.add('hidden');

        try {
            const clientName = clientNameInput?.value.trim() || undefined;
            const triggerWorkflow = triggerWorkflowCheckbox?.checked || false;
            const importModelSelect = document.getElementById('importModelSelect');
            const model = importModelSelect?.value || undefined;

            const result = await api.post('/tasks/import', { 
                taskId,
                clientName,
                triggerWorkflow,
                model
            });

            let successMsg = `Task ${taskId} imported successfully!`;
            if (result.workflowStarted) {
                successMsg += ' Workflow has been started.';
            }
            if (result.warnings && result.warnings.length > 0) {
                successMsg += ` Warnings: ${result.warnings.join(', ')}`;
            }

            notifications.success(successMsg);
            closeImportModalFn();
            
            // Refresh tasks list
            await loadTasks({ showNotification: true });
        } catch (error) {
            let errorMsg = `Failed to import task: ${error.message || 'Unknown error'}`;
            if (error.suggestions && error.suggestions.length > 0) {
                errorMsg += `\n\nSuggestions:\n${error.suggestions.map(s => `• ${s}`).join('\n')}`;
            }
            importError.textContent = errorMsg;
            importError.classList.remove('hidden');
        } finally {
            confirmImportBtn.disabled = false;
            previewImportBtn.disabled = false;
            confirmImportBtn.textContent = originalText;
        }
    });

    // Enter key to confirm import
    taskIdInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            confirmImportBtn?.click();
        }
    });

    clientNameInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            confirmImportBtn?.click();
        }
    });

    // Delete All Tasks button and modal
    const deleteAllBtn = document.getElementById('deleteAllTasksBtn');
    const clearQueueBtn = document.getElementById('clearQueueBtn');
    const deleteAllModal = document.getElementById('deleteAllModal');
    const closeDeleteAllModal = document.getElementById('closeDeleteAllModal');
    const cancelDeleteAllBtn = document.getElementById('cancelDeleteAllBtn');
    const confirmDeleteAllBtn = document.getElementById('confirmDeleteAllBtn');
    const deleteAllError = document.getElementById('deleteAllError');

    // Delete Single Task modal elements
    const deleteTaskModal = document.getElementById('deleteTaskModal');
    const closeDeleteTaskModal = document.getElementById('closeDeleteTaskModal');
    const cancelDeleteTaskBtn = document.getElementById('cancelDeleteTaskBtn');
    const confirmDeleteTaskBtn = document.getElementById('confirmDeleteTaskBtn');
    const deleteTaskError = document.getElementById('deleteTaskError');
    const deleteTaskNameDisplay = document.getElementById('deleteTaskName');
    let taskIdToDelete = null;

    deleteAllBtn?.addEventListener('click', () => {
        deleteAllModal.classList.remove('hidden');
        setTimeout(() => deleteAllModal.classList.add('show'), 10);
        deleteAllError.classList.add('hidden');
    });

    clearQueueBtn?.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to clear the agent queue? This will remove all pending tasks that have not started running yet.')) {
            return;
        }

        clearQueueBtn.disabled = true;
        const originalIcon = clearQueueBtn.innerHTML;
        clearQueueBtn.innerHTML = '<div class="spinner-sm"></div>';

        try {
            const result = await api.delete('/cursor/queue');
            if (result.success) {
                notifications.success(`Successfully cleared ${result.cleared} task(s) from the queue`);
                // Refresh tasks list and queue status
                await loadTasks({ showNotification: false });
                await loadQueueStatus();
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error) {
            notifications.error(`Failed to clear agent queue: ${error.message}`);
        } finally {
            clearQueueBtn.disabled = false;
            clearQueueBtn.innerHTML = originalIcon;
            if (window.lucide) lucide.createIcons();
        }
    });

    // Queue Viewer Modal
    const viewQueueBtn = document.getElementById('viewQueueBtn');
    const queueModal = document.getElementById('queueModal');
    const closeQueueModal = document.getElementById('closeQueueModal');
    const closeQueueModalBtn = document.getElementById('closeQueueModalBtn');
    const refreshQueueBtn = document.getElementById('refreshQueueBtn');
    const unstickQueueBtn = document.getElementById('unstickQueueBtn');
    const clearAllQueuesBtn = document.getElementById('clearAllQueuesBtn');

    viewQueueBtn?.addEventListener('click', async () => {
        queueModal.classList.remove('hidden');
        setTimeout(() => queueModal.classList.add('show'), 10);
        await loadQueueOverview();
    });

    function closeQueueModalFn() {
        queueModal.classList.remove('show');
        setTimeout(() => queueModal.classList.add('hidden'), 300);
    }

    closeQueueModal?.addEventListener('click', closeQueueModalFn);
    closeQueueModalBtn?.addEventListener('click', closeQueueModalFn);
    queueModal?.addEventListener('click', (e) => {
        if (e.target === queueModal) {
            closeQueueModalFn();
        }
    });

    refreshQueueBtn?.addEventListener('click', async () => {
        refreshQueueBtn.disabled = true;
        refreshQueueBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Refreshing...';
        if (window.lucide) lucide.createIcons();
        
        try {
            await loadQueueOverview();
            notifications.success('Queue status refreshed');
        } catch (error) {
            notifications.error(`Failed to refresh queue: ${error.message}`);
        } finally {
            refreshQueueBtn.disabled = false;
            refreshQueueBtn.innerHTML = '<i data-lucide="refresh-cw"></i> Refresh';
            if (window.lucide) lucide.createIcons();
        }
    });

    unstickQueueBtn?.addEventListener('click', async () => {
        if (!confirm('This will force-move any stuck running tasks to failed. Continue?')) {
            return;
        }

        unstickQueueBtn.disabled = true;
        unstickQueueBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Unsticking...';
        if (window.lucide) lucide.createIcons();

        try {
            const result = await api.post('/cursor/queue/unstick', {});
            if (result.success) {
                if (result.unstuck.length > 0) {
                    notifications.success(`Unstuck ${result.unstuck.length} task(s): ${result.unstuck.join(', ')}`);
                } else {
                    notifications.info('No stuck tasks found to unstick');
                }
                if (result.errors.length > 0) {
                    notifications.warning(`Some errors: ${result.errors.join(', ')}`);
                }
                await loadQueueOverview();
                await loadTasks({ showNotification: false });
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error) {
            notifications.error(`Failed to unstick queue: ${error.message}`);
        } finally {
            unstickQueueBtn.disabled = false;
            unstickQueueBtn.innerHTML = '<i data-lucide="unlock"></i> Unstick Running';
            if (window.lucide) lucide.createIcons();
        }
    });

    clearAllQueuesBtn?.addEventListener('click', async () => {
        if (!confirm('⚠️ DANGER: This will clear ALL queue data including running, done, and failed tasks. This is a nuclear option for recovery. Continue?')) {
            return;
        }

        clearAllQueuesBtn.disabled = true;
        clearAllQueuesBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Clearing...';
        if (window.lucide) lucide.createIcons();

        try {
            const result = await api.delete('/cursor/queue/all');
            if (result.success) {
                const { cleared } = result;
                notifications.success(`Cleared all queues: ${cleared.queued} queued, ${cleared.running} running, ${cleared.done} done, ${cleared.failed} failed`);
                await loadQueueOverview();
                await loadTasks({ showNotification: false });
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error) {
            notifications.error(`Failed to clear all queues: ${error.message}`);
        } finally {
            clearAllQueuesBtn.disabled = false;
            clearAllQueuesBtn.innerHTML = '<i data-lucide="trash-2"></i> Clear All';
            if (window.lucide) lucide.createIcons();
        }
    });

    function closeDeleteAllModalFn() {
        deleteAllModal.classList.remove('show');
        setTimeout(() => {
            deleteAllModal.classList.add('hidden');
            deleteAllError.classList.add('hidden');
        }, 300);
    }

    closeDeleteAllModal?.addEventListener('click', closeDeleteAllModalFn);
    cancelDeleteAllBtn?.addEventListener('click', closeDeleteAllModalFn);
    deleteAllModal?.addEventListener('click', (e) => {
        if (e.target === deleteAllModal) {
            closeDeleteAllModalFn();
        }
    });

    // Delete Single Task functionality
    function closeDeleteTaskModalFn() {
        deleteTaskModal.classList.remove('show');
        setTimeout(() => {
            deleteTaskModal.classList.add('hidden');
            deleteTaskError.classList.add('hidden');
            taskIdToDelete = null;
        }, 300);
    }

    closeDeleteTaskModal?.addEventListener('click', closeDeleteTaskModalFn);
    cancelDeleteTaskBtn?.addEventListener('click', closeDeleteTaskModalFn);
    deleteTaskModal?.addEventListener('click', (e) => {
        if (e.target === deleteTaskModal) {
            closeDeleteTaskModalFn();
        }
    });

    // Global click listener for delete buttons (delegation)
    document.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.delete-task-btn');
        if (deleteBtn) {
            e.stopPropagation(); // Prevent card click
            taskIdToDelete = deleteBtn.dataset.taskId;
            const taskName = deleteBtn.dataset.taskName;
            
            deleteTaskNameDisplay.textContent = taskName;
            deleteTaskModal.classList.remove('hidden');
            setTimeout(() => deleteTaskModal.classList.add('show'), 10);
            deleteTaskError.classList.add('hidden');
        }
    });

    confirmDeleteTaskBtn?.addEventListener('click', async () => {
        if (!taskIdToDelete) return;
        
        confirmDeleteTaskBtn.disabled = true;
        const originalText = confirmDeleteTaskBtn.textContent;
        confirmDeleteTaskBtn.textContent = 'Deleting...';
        deleteTaskError.classList.add('hidden');

        try {
            const result = await api.delete(`/tasks/${taskIdToDelete}`);

            if (result.success) {
                notifications.success(`Successfully deleted task ${taskIdToDelete}`);
                closeDeleteTaskModalFn();
                
                // Refresh tasks list
                await loadTasks({ showNotification: false });
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error) {
            const errorMsg = `Failed to delete task: ${error.message || 'Unknown error'}`;
            deleteTaskError.textContent = errorMsg;
            deleteTaskError.classList.remove('hidden');
            notifications.error(errorMsg);
        } finally {
            confirmDeleteTaskBtn.disabled = false;
            confirmDeleteTaskBtn.textContent = originalText;
        }
    });

    // Confirm delete all functionality
    confirmDeleteAllBtn?.addEventListener('click', async () => {
        confirmDeleteAllBtn.disabled = true;
        const originalText = confirmDeleteAllBtn.textContent;
        confirmDeleteAllBtn.textContent = 'Deleting...';
        deleteAllError.classList.add('hidden');

        try {
            const result = await api.delete('/tasks');

            if (result.success) {
                notifications.success(`Successfully deleted ${result.deletedCount} task(s)`);
                
                if (result.errors && result.errors.length > 0) {
                    notifications.warning(`Some errors occurred: ${result.errors.join(', ')}`);
                }
                
                closeDeleteAllModalFn();
                
                // Refresh tasks list
                await loadTasks({ showNotification: false });
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error) {
            const errorMsg = `Failed to delete tasks: ${error.message || 'Unknown error'}`;
            deleteAllError.textContent = errorMsg;
            deleteAllError.classList.remove('hidden');
            notifications.error(errorMsg);
        } finally {
            confirmDeleteAllBtn.disabled = false;
            confirmDeleteAllBtn.textContent = originalText;
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Skip keyboard shortcuts when focus is in any form element or when modals are open
        const isFormElement = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName);
        const isContentEditable = e.target.isContentEditable;
        const isModalOpen = document.querySelector('.modal-overlay.show') !== null;
        
        if (isFormElement || isContentEditable || isModalOpen) {
            return;
        }
        
        // R key for refresh (when not typing in input)
        if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            loadTasks({ showNotification: true });
        }
        // / key to focus search
        if (e.key === '/') {
            e.preventDefault();
            searchInput?.focus();
        }
    });
});

// Theme Management - Using centralized ThemeUtils from theme.js

async function loadTasks(options = {}) {
    const { showNotification = false, silent = false } = options;
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const container = document.getElementById('tasksContainer');
    const refreshBtn = document.getElementById('refreshBtn');
    
    if (!silent) {
        loading.classList.remove('hidden');
        error.classList.add('hidden');
        container.classList.add('hidden');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Loading...';
        }
    }
    
    try {
        const data = await api.get('/tasks');
        
        // Check if data has changed
        const hasChanged = !deepEqual(data, allTasks);
        
        if (hasChanged || !silent) {
            allTasks = data;
            allTasksGrouped = data;
            lastUpdateTime = new Date();
            
            if (!silent) {
                loading.classList.add('hidden');
                container.classList.remove('hidden');
            }
            
            updateFilterBadges();
            renderTasks();
            renderAllTasksGrouped();
            
            if (showNotification) {
                notifications.success('Tasks refreshed successfully');
            }
        }

        // Start auto-refresh if not paused
        if (!isAutoRefreshPaused && !autoRefreshInterval) {
            startAutoRefresh();
        }
    } catch (err) {
        if (!silent) {
            loading.classList.add('hidden');
            error.classList.remove('hidden');
            const errorMessage = document.getElementById('errorMessage');
            if (errorMessage) {
                errorMessage.textContent = `Error loading tasks: ${err.message}`;
            }
            
            notifications.error(`Failed to load tasks: ${err.message}`);
        }
        console.error('Error loading tasks:', err);
    } finally {
        if (!silent && refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh';
        }
    }
}

function startAutoRefresh() {
    if (autoRefreshInterval) return;
    
    const indicator = document.getElementById('autoRefreshIndicator');
    const pauseBtn = document.getElementById('pauseRefreshBtn');
    
    indicator?.classList.remove('hidden');
    pauseBtn?.classList.remove('hidden');
    
    // Ensure correct icon and title
    if (pauseBtn) {
        pauseBtn.innerHTML = '<i data-lucide="pause"></i>';
        pauseBtn.title = 'Pause auto-refresh';
        if (window.lucide) lucide.createIcons();
    }
    
    autoRefreshInterval = setInterval(() => {
        if (!isAutoRefreshPaused && document.visibilityState === 'visible') {
            loadTasks({ silent: true });
        }
    }, 5000); // Refresh every 5 seconds
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    
    const indicator = document.getElementById('autoRefreshIndicator');
    const pauseBtn = document.getElementById('pauseRefreshBtn');
    
    indicator?.classList.add('hidden');
    
    // Only hide the pause button if we're not manually paused
    if (!isAutoRefreshPaused) {
        pauseBtn?.classList.add('hidden');
    }
}

function updateFilterBadges() {
    const filterSelect = document.getElementById('filterSelect');
    if (!filterSelect) return;
    
    // Filter out demo step tasks for accurate counts
    const visibleTasks = allTasks.filter(task => !isDemoStepTask(task.taskId));
    
    const filters = [
        { value: 'all', label: 'All Tasks' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'awaiting_approval', label: 'Awaiting Approval' },
        { value: 'testing', label: 'Testing' },
        { value: 'completed', label: 'Completed' }
    ];
    
    filters.forEach(({ value, label }) => {
        const option = filterSelect.querySelector(`option[value="${value}"]`);
        if (!option) return;
        
        let count = 0;
        if (value === 'all') {
            count = visibleTasks.length;
        } else {
            count = visibleTasks.filter(task => task.state === value).length;
        }
        
        // Update option text with count
        option.textContent = `${label} (${count})`;
    });
}

/**
 * Handles task card click navigation via event delegation.
 * Using a single delegated handler prevents memory leaks from re-adding listeners.
 */
function handleTaskCardClick(e) {
    const card = e.target.closest('.task-card');
    if (!card) return;
    
    // Don't navigate if clicking on a button or link
    if (e.target.closest('button') || e.target.closest('a')) {
        return;
    }
    
    const taskId = card.dataset.taskId;
    if (!taskId) return;
    
    // Route demos to demo.html, regular tasks to task.html
    if (isBaseDemoTask(taskId)) {
        const slug = card.dataset.slug || extractSlugFromDemoTaskId(taskId);
        window.location.href = `/demo.html?slug=${slug}`;
    } else {
        window.location.href = `/task.html?taskId=${taskId}`;
    }
}

// Track if delegated listener is attached to prevent duplicates
let tasksListDelegatedListenerAttached = false;

function renderTasks() {
    const tasksList = document.getElementById('tasksList');
    const emptyState = document.getElementById('emptyState');
    
    // Filter tasks
    let filteredTasks = allTasks;
    
    // Filter out demo step tasks (keep only base demos, e.g., demo-sunny-plumbing not demo-sunny-plumbing-step2)
    filteredTasks = filteredTasks.filter(task => !isDemoStepTask(task.taskId));
    
    // Apply state filter
    if (currentFilter !== 'all') {
        filteredTasks = filteredTasks.filter(task => task.state === currentFilter);
    }
    
    // Apply search filter
    if (searchQuery) {
        filteredTasks = filteredTasks.filter(task => {
            const searchableText = [
                task.taskName || '',
                task.taskId || '',
                task.clientName || '',
                task.branchName || '',
            ].join(' ').toLowerCase();
            return searchableText.includes(searchQuery);
        });
    }
    
    // Sort tasks
    filteredTasks = sortTasks(filteredTasks, currentSort);
    
    // Show empty state if no tasks
    if (filteredTasks.length === 0) {
        tasksList.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }
    
    // Clear and rebuild to trigger animations
    tasksList.innerHTML = '';
    setTimeout(() => {
        tasksList.classList.remove('hidden');
        emptyState.classList.add('hidden');
        tasksList.innerHTML = filteredTasks.map(task => createTaskCard(task)).join('');
        
        // Initialize icons for new cards
        if (window.lucide) lucide.createIcons();

        // Use event delegation - attach listener once to container, not to each card
        // This prevents memory leaks from re-adding listeners on each render
        if (!tasksListDelegatedListenerAttached) {
            tasksList.addEventListener('click', handleTaskCardClick);
            tasksListDelegatedListenerAttached = true;
        }
    }, 10);
}

function sortTasks(tasks, sortBy) {
    // Validate input parameters to prevent crashes
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return tasks || [];
    }
    
    if (!sortBy || typeof sortBy !== 'string') {
        return tasks;
    }
    
    const [field, direction] = sortBy.split('_');
    if (!field || !direction) {
        return tasks;
    }
    
    const sorted = [...tasks];
    
    /**
     * Safely parse a date value, returning 0 for invalid/null dates.
     * This ensures consistent sorting behavior when dates are missing.
     */
    const safeParseDate = (dateVal) => {
        if (dateVal === null || dateVal === undefined) return 0;
        const parsed = new Date(dateVal);
        return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    };
    
    /**
     * Safely extract string value with fallback to empty string.
     * Handles null, undefined, and non-string types.
     */
    const safeString = (val) => {
        if (val === null || val === undefined) return '';
        return String(val).toLowerCase();
    };
    
    sorted.sort((a, b) => {
        let aVal, bVal;
        
        switch (field) {
            case 'updated':
                aVal = safeParseDate(a?.updatedAt);
                bVal = safeParseDate(b?.updatedAt);
                break;
            case 'created':
                aVal = safeParseDate(a?.createdAt);
                bVal = safeParseDate(b?.createdAt);
                break;
            case 'name':
                aVal = safeString(a?.taskName);
                bVal = safeString(b?.taskName);
                break;
            case 'client':
                aVal = safeString(a?.clientName);
                bVal = safeString(b?.clientName);
                break;
            case 'state':
                aVal = safeString(a?.state);
                bVal = safeString(b?.state);
                break;
            default:
                return 0;
        }
        
        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
        return 0;
    });
    
    return sorted;
}

function createTaskCard(task) {
    // Route demos to dedicated demo card renderer
    if (isBaseDemoTask(task.taskId)) {
        return createDemoCard(task);
    }
    return createRegularTaskCard(task);
}

function createDemoCard(task) {
    const stateClass = task.state.replace(/_/g, '-');
    const updatedAt = FormattingUtils.formatRelativeTime(task.updatedAt);
    const slug = extractSlugFromDemoTaskId(task.taskId);
    
    // Extract step info from metadata if available, or parse from related tasks
    // For now, we'll default to step 1 and update via API if needed
    const currentStep = task.metadata?.demoStep || 1;
    const totalSteps = 4;
    const stepNames = ['Branding', 'Copywriting', 'Imagery', 'Review'];
    const currentStepName = stepNames[currentStep - 1] || 'Processing';
    
    // Check if demo is in a completion state
    const isCompleted = task.state === 'completed' || task.state === 'awaiting_approval';
    
    // Generate progress dots - mark all as completed for terminal states
    const progressDots = [1, 2, 3, 4].map(step => {
        let dotClass = 'demo-progress-dot';
        if (isCompleted) {
            dotClass += ' completed';
        } else if (step < currentStep) {
            dotClass += ' completed';
        } else if (step === currentStep) {
            dotClass += ' active';
        }
        return `<span class="${dotClass}" title="Step ${step}: ${stepNames[step - 1]}"></span>`;
    }).join('');
    
    // Step label - show "Complete!" for terminal states
    const stepLabel = isCompleted 
        ? 'Complete!' 
        : `Step ${currentStep} of ${totalSteps}: ${currentStepName}`;
    
    // Check if task has an active agent step
    const isStaleQueueMessage = task.currentStep && (
        task.currentStep.toLowerCase().includes('waiting in queue') ||
        task.currentStep.toLowerCase().includes('queued')
    );
    const showStep = task.currentStep && !isStaleQueueMessage && (task.state === 'in_progress' || task.state === 'testing' || task.state === 'pending');
    const stepHtml = showStep
        ? `<div class="current-step-text">➜ ${FormattingUtils.escapeHtml(task.currentStep)}</div>`
        : '';

    return `
        <div class="task-card demo-card" data-task-id="${task.taskId}" data-slug="${slug}">
            <div class="task-card-header">
                <div class="task-card-header-main">
                    <div class="state-badge-container">
                        <span class="demo-badge">Demo</span>
                        <span class="state-badge ${stateClass}">${FormattingUtils.formatState(task.state)}</span>
                        ${stepHtml}
                    </div>
                    <div class="task-card-title" title="${FormattingUtils.escapeHtml(task.taskName || 'Untitled Demo')}">
                        ${FormattingUtils.escapeHtml(task.taskName || 'Untitled Demo')}
                    </div>
                </div>
                <button class="delete-task-btn" data-task-id="${task.taskId}" data-task-name="${FormattingUtils.escapeHtml(task.taskName || task.taskId)}" title="Delete demo">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
            
            <div class="demo-progress-mini">
                <div class="demo-progress-info">
                    <span class="demo-step-label">${stepLabel}</span>
                </div>
                <div class="demo-progress-dots">
                    ${progressDots}
                </div>
            </div>
            
            <div class="task-card-meta">
                <div class="meta-item" title="Client Slug">
                    <i data-lucide="folder"></i>
                    <span>${FormattingUtils.escapeHtml(slug)}</span>
                </div>
                <div class="meta-item" title="Last Updated">
                    <i data-lucide="clock"></i>
                    <span>${updatedAt}</span>
                </div>
                ${task.clientName ? `
                <div class="meta-item" title="Business Name">
                    <i data-lucide="building-2"></i>
                    <span>${FormattingUtils.escapeHtml(task.clientName)}</span>
                </div>` : ''}
            </div>
        </div>
    `;
}

/**
 * Checks if a taskId represents a local task (created via dashboard, not imported from ClickUp).
 * Pattern: local-{timestamp}-{random}
 * @param {string} taskId 
 * @returns {boolean}
 */
function isLocalTask(taskId) {
    return taskId && taskId.startsWith('local-');
}

function createRegularTaskCard(task) {
    const stateClass = task.state.replace(/_/g, '-');
    const updatedAt = FormattingUtils.formatRelativeTime(task.updatedAt);
    const createdAt = FormattingUtils.formatDateShort(task.createdAt);
    const description = task.description || 'No description provided';
    // Truncate description if too long (max 120 characters for new layout)
    const truncatedDescription = description.length > 120 
        ? description.substring(0, 120) + '...' 
        : description;
    
    // Check if this is a local task (not imported from ClickUp)
    const isLocal = isLocalTask(task.taskId);
    const localBadgeHtml = isLocal ? '<span class="local-task-badge">Local</span>' : '';
    
    // Check if task has an active agent step (filter out stale queue messages)
    const isStaleQueueMessage = task.currentStep && (
        task.currentStep.toLowerCase().includes('waiting in queue') ||
        task.currentStep.toLowerCase().includes('queued') ||
        task.currentStep.toLowerCase().includes('position in queue')
    );
    const showStep = task.currentStep && !isStaleQueueMessage && (task.state === 'in_progress' || task.state === 'testing' || task.state === 'pending' || task.state === 'awaiting_approval');
    const stepHtml = showStep
        ? `<div class="current-step-text">➜ ${FormattingUtils.escapeHtml(task.currentStep)}</div>`
        : '';

    return `
        <div class="task-card${isLocal ? ' local-task' : ''}" data-task-id="${task.taskId}">
            <div class="task-card-header">
                <div class="task-card-header-main">
                    <div class="state-badge-container">
                        ${localBadgeHtml}
                        <span class="state-badge ${stateClass}">${FormattingUtils.formatState(task.state)}</span>
                        ${stepHtml}
                    </div>
                    <div class="task-card-title" title="${FormattingUtils.escapeHtml(task.taskName || 'Untitled Task')}">
                        ${FormattingUtils.escapeHtml(task.taskName || 'Untitled Task')}
                    </div>
                </div>
                <button class="delete-task-btn" data-task-id="${task.taskId}" data-task-name="${FormattingUtils.escapeHtml(task.taskName || task.taskId)}" title="Delete task">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
            
            <div class="task-card-description">
                ${FormattingUtils.escapeHtml(truncatedDescription)}
            </div>
            
            <div class="task-card-meta">
                <div class="meta-item" title="Task ID">
                    <i data-lucide="hash"></i>
                    <span>${FormattingUtils.escapeHtml(task.taskId)}</span>
                </div>
                <div class="meta-item" title="Last Updated">
                    <i data-lucide="clock"></i>
                    <span>${updatedAt}</span>
                </div>
                ${task.clientName ? `
                <div class="meta-item" title="Client">
                    <i data-lucide="user"></i>
                    <span>${FormattingUtils.escapeHtml(task.clientName)}</span>
                </div>` : ''}
                ${task.branchName ? `
                <div class="meta-item" title="Git Branch">
                    <i data-lucide="git-branch"></i>
                    <code>${FormattingUtils.escapeHtml(task.branchName)}</code>
                </div>` : ''}
            </div>
        </div>
    `;
}

// Load all tasks grouped by client (usually called from loadTasks)
async function loadAllTasksGrouped() {
    try {
        // If data is already loaded in allTasks, we can use it
        if (allTasks && allTasks.length > 0) {
            allTasksGrouped = allTasks;
        } else {
            const data = await api.get('/tasks');
            allTasksGrouped = data;
        }
        renderAllTasksGrouped();
    } catch (err) {
        console.error('Error loading all tasks:', err);
    }
}

// Render all tasks grouped by client
function renderAllTasksGrouped() {
    const allTasksList = document.getElementById('allTasksList');
    const allTasksSection = document.getElementById('allTasksSection');
    const allTasksEmptyState = document.getElementById('allTasksEmptyState');
    
    if (!allTasksList || !allTasksSection || !allTasksEmptyState) return;
    
    // Filter out completed tasks AND demo step tasks (keep base demos)
    const incompleteTasks = allTasksGrouped.filter(task => 
        task.state !== 'completed' && !isDemoStepTask(task.taskId)
    );
    
    if (incompleteTasks.length === 0) {
        allTasksList.classList.add('hidden');
        allTasksSection.classList.add('hidden');
        allTasksEmptyState.classList.remove('hidden');
        return;
    }
    
    // Group tasks by client
    const tasksByClient = {};
    incompleteTasks.forEach(task => {
        const clientName = task.clientName || 'Unknown Client';
        if (!tasksByClient[clientName]) {
            tasksByClient[clientName] = [];
        }
        tasksByClient[clientName].push(task);
    });
    
    // Sort clients alphabetically
    const sortedClients = Object.keys(tasksByClient).sort();
    
    // Render grouped tasks
    let html = '';
    sortedClients.forEach(clientName => {
        const clientTasks = tasksByClient[clientName];
        // Sort tasks by updated date (most recent first)
        clientTasks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        
        html += `
            <div class="client-group">
                <div class="client-group-header" data-client="${FormattingUtils.escapeHtml(clientName)}">
                    <div class="client-name">
                        <span class="client-group-toggle">
                            <i data-lucide="chevron-down"></i>
                        </span>
                        <span>${FormattingUtils.escapeHtml(clientName)}</span>
                    </div>
                    <span class="client-task-count">${clientTasks.length} task${clientTasks.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="client-tasks-grid">
                    ${clientTasks.map(task => createTaskCard(task)).join('')}
                </div>
            </div>
        `;
    });
    
    allTasksList.innerHTML = html;
    
    // Initialize icons for grouped tasks
    if (window.lucide) lucide.createIcons();

    allTasksList.classList.remove('hidden');
    allTasksSection.classList.remove('hidden');
    allTasksEmptyState.classList.add('hidden');
    
    // Add click handlers for task cards (route demos to demo.html)
    document.querySelectorAll('#allTasksList .task-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't navigate if clicking on a button or link
            if (e.target.closest('button') || e.target.closest('a')) {
                return;
            }
            const taskId = card.dataset.taskId;
            // Route demos to demo.html, regular tasks to task.html
            if (isBaseDemoTask(taskId)) {
                const slug = card.dataset.slug || extractSlugFromDemoTaskId(taskId);
                window.location.href = `/demo.html?slug=${slug}`;
            } else {
                window.location.href = `/task.html?taskId=${taskId}`;
            }
        });
    });
    
    // Add click handlers for collapsible client groups
    document.querySelectorAll('#allTasksList .client-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.client-group');
            group.classList.toggle('collapsed');
        });
    });
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
});

// Pause auto-refresh when page is hidden
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        // Keep interval but it won't refresh when hidden
    } else if (document.visibilityState === 'visible' && !isAutoRefreshPaused) {
        // Refresh when page becomes visible again
        loadTasks({ showNotification: false });
    }
});

// --- Connection Polling ---

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
    
    // Clear any existing connect button
    const existingBtn = text.querySelector('.connect-link');
    if (existingBtn) existingBtn.remove();
    
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

// --- Failed Imports ---

async function fetchFailedImports() {
    try {
        const data = await api.get('/tasks/failed-imports');
        return data.failures || [];
    } catch (error) {
        console.error('Error fetching failed imports:', error);
        return [];
    }
}

async function loadFailedImports() {
    const failures = await fetchFailedImports();
    renderFailedImports(failures);
    
    const badge = document.getElementById('failedImportsCount');
    if (badge) {
        badge.textContent = failures.length;
        if (failures.length > 0) {
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

function renderFailedImports(failures) {
    const list = document.getElementById('failedImportsList');
    const emptyState = document.getElementById('failedImportsEmptyState');
    
    if (!list || !emptyState) return;
    
    if (failures.length === 0) {
        list.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }
    
    emptyState.classList.add('hidden');
    list.innerHTML = failures.map(failure => `
        <div class="failed-import-card">
            <div class="failed-import-header">
                <div class="failed-import-title">${FormattingUtils.escapeHtml(failure.taskName)}</div>
                <div class="failed-import-meta">
                    <span title="Task ID"><i data-lucide="hash"></i> ${FormattingUtils.escapeHtml(failure.taskId)}</span>
                    <span title="Time"><i data-lucide="calendar"></i> ${FormattingUtils.formatRelativeTime(failure.timestamp)}</span>
                </div>
            </div>
            <div class="failed-import-error">
                <i data-lucide="alert-triangle"></i>
                <span>${FormattingUtils.escapeHtml(failure.error)}</span>
            </div>
            ${failure.suggestions && failure.suggestions.length > 0 ? `
                <div class="preview-suggestions">
                    <i data-lucide="lightbulb"></i>
                    <strong>Suggested Clients:</strong> ${failure.suggestions.join(', ')}
                </div>
            ` : ''}
            <div class="failed-import-actions">
                <button class="btn btn-sm btn-primary retry-single-btn" data-task-id="${failure.taskId}">
                    <i data-lucide="refresh-cw"></i> Retry
                </button>
                ${failure.clickUpUrl ? `<a href="${failure.clickUpUrl}" target="_blank" class="btn btn-sm btn-secondary">
                    <i data-lucide="external-link"></i> View in ClickUp
                </a>` : ''}
            </div>
        </div>
    `).join('');
    
    // Initialize icons
    if (window.lucide) lucide.createIcons();

    // Add retry handlers
    list.querySelectorAll('.retry-single-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const taskId = btn.dataset.taskId;
            btn.disabled = true;
            btn.textContent = 'Retrying...';
            
            try {
                const results = await api.post('/tasks/retry-import', { taskIds: [taskId] });
                if (results.imported > 0) {
                    notifications.success(`Successfully imported task ${taskId}`);
                    await loadFailedImports();
                    await loadTasks({ showNotification: false });
                } else {
                    notifications.error(`Failed to import task ${taskId}: ${results.errors[0]?.error || 'Unknown error'}`);
                    await loadFailedImports();
                }
            } catch (error) {
                notifications.error(`Retry failed: ${error.message}`);
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="refresh-cw"></i> Retry';
                if (window.lucide) lucide.createIcons();
            }
        });
    });
}

// --- Webhook Toggle Functionality ---

async function loadWebhookStatus() {
    try {
        const status = await api.get('/webhook/status');
        updateWebhookUI(status.enabled);
    } catch (error) {
        console.error('Error loading webhook status:', error);
        updateWebhookUI(false); // Default to disabled on error
    }
}

async function toggleWebhook() {
    const btn = document.getElementById('webhookToggleBtn');
    if (!btn) return;
    
    // Disable button during toggle
    btn.disabled = true;
    
    try {
        const result = await api.post('/webhook/toggle');
        updateWebhookUI(result.enabled);
        
        notifications.success(
            result.enabled 
                ? '✅ Webhook enabled - ClickUp tasks will now be processed' 
                : '⏸️ Webhook disabled - ClickUp tasks will be ignored'
        );
    } catch (error) {
        notifications.error(`Failed to toggle webhook: ${error.message}`);
        // Reload status in case of error
        await loadWebhookStatus();
    } finally {
        btn.disabled = false;
    }
}

function updateWebhookUI(enabled) {
    const btn = document.getElementById('webhookToggleBtn');
    const playIcon = document.getElementById('webhookPlayIcon');
    const pauseIcon = document.getElementById('webhookPauseIcon');
    const statusText = document.getElementById('webhookStatusText');
    const container = document.querySelector('.webhook-status-container');
    
    if (!btn || !playIcon || !pauseIcon || !statusText || !container) return;
    
    if (enabled) {
        // Show pause icon, hide play icon
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
        
        // Update text and styling
        statusText.textContent = 'Webhook On';
        btn.classList.add('enabled');
        btn.classList.remove('disabled');
        container.classList.add('enabled');
        btn.title = 'Webhook is enabled - Click to disable';
    } else {
        // Show play icon, hide pause icon
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        
        // Update text and styling
        statusText.textContent = 'Webhook Off';
        btn.classList.add('disabled');
        btn.classList.remove('enabled');
        container.classList.remove('enabled');
        btn.title = 'Webhook is disabled - Click to enable';
    }
    
    // Refresh Lucide icons
    if (window.lucide) lucide.createIcons();
}

function startWebhookStatusPolling() {
    if (webhookPollingInterval) return;
    
    // Poll webhook status every 10 seconds
    webhookPollingInterval = setInterval(async () => {
        if (document.visibilityState === 'visible') {
            await loadWebhookStatus();
        }
    }, 10000);
}

// --- Model Selection for Import ---

async function loadAvailableModelsForImport() {
    const importModelSelect = document.getElementById('importModelSelect');
    if (!importModelSelect) return;
    
    try {
        const modelsData = await api.get('/models');
        const availableModels = modelsData.availableModels || ['gpt-4', 'gpt-4-turbo', 'claude-3.5-sonnet'];
        
        // Keep the "Use Default" option and add models
        importModelSelect.innerHTML = '<option value="">Use Default</option>';
        availableModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            importModelSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Failed to load available models:', error);
        // Use fallback defaults
        const fallbackModels = ['gpt-4', 'gpt-4-turbo', 'claude-3.5-sonnet', 'claude-3-haiku'];
        importModelSelect.innerHTML = '<option value="">Use Default</option>';
        fallbackModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            importModelSelect.appendChild(option);
        });
    }
}

// --- Queue Status Functions ---

async function loadQueueStatus() {
    try {
        const data = await api.get('/cursor/queue/overview');
        if (data.success) {
            lastQueueOverview = data;
            // Could update a mini status indicator in the header here
        }
    } catch (error) {
        console.error('Error loading queue status:', error);
    }
}

async function loadQueueOverview() {
    try {
        const data = await api.get('/cursor/queue/overview');
        if (!data.success) {
            throw new Error(data.error || 'Failed to load queue overview');
        }
        
        lastQueueOverview = data;
        renderQueueOverview(data);
    } catch (error) {
        console.error('Error loading queue overview:', error);
        notifications.error(`Failed to load queue overview: ${error.message}`);
    }
}

function renderQueueOverview(data) {
    const { queued, running, done, failed, currentStatus, healthCheck } = data;
    
    // Update health banner
    const healthBanner = document.getElementById('queueHealthBanner');
    const healthIcon = document.getElementById('queueHealthIcon');
    const healthText = document.getElementById('queueHealthText');
    const lastActivity = document.getElementById('queueLastActivity');
    
    if (healthCheck.isHealthy) {
        healthBanner.className = 'queue-health-banner healthy';
        healthIcon.setAttribute('data-lucide', 'check-circle');
        healthText.textContent = 'Queue is healthy';
    } else {
        healthBanner.className = 'queue-health-banner unhealthy';
        healthIcon.setAttribute('data-lucide', 'alert-triangle');
        healthText.textContent = 'Queue has issues';
    }
    
    if (healthCheck.lastActivity) {
        lastActivity.textContent = `Last activity: ${FormattingUtils.formatRelativeTime(healthCheck.lastActivity)}`;
    } else {
        lastActivity.textContent = 'No recent activity';
    }
    
    // Update issues section
    const issuesSection = document.getElementById('queueIssues');
    const issuesList = document.getElementById('queueIssuesList');
    
    if (healthCheck.issues && healthCheck.issues.length > 0) {
        issuesSection.classList.remove('hidden');
        issuesList.innerHTML = healthCheck.issues.map(issue => `<li>${FormattingUtils.escapeHtml(issue)}</li>`).join('');
    } else {
        issuesSection.classList.add('hidden');
    }
    
    // Update counts
    document.getElementById('runningCount').textContent = running.length;
    document.getElementById('queuedCount').textContent = queued.length;
    document.getElementById('doneCount').textContent = done.length;
    document.getElementById('failedCount').textContent = failed.length;
    
    // Render running tasks
    const runningTasks = document.getElementById('runningTasks');
    if (running.length > 0) {
        runningTasks.innerHTML = running.map(task => `
            <div class="queue-task-item ${task.isStale ? 'stale' : ''}">
                <div class="task-id">
                    <code>${FormattingUtils.escapeHtml(task.taskId)}</code>
                    ${task.isStale ? '<span class="badge badge-danger">STALE</span>' : '<span class="badge badge-info">Running</span>'}
                </div>
                <div class="task-meta">
                    <span><i data-lucide="folder"></i> ${FormattingUtils.escapeHtml(task.clientFolder?.split(/[/\\]/).pop() || 'unknown')}</span>
                    <span><i data-lucide="clock"></i> ${formatDuration(task.runTime)}</span>
                </div>
            </div>
        `).join('');
    } else {
        runningTasks.innerHTML = '<p class="queue-empty">No tasks running</p>';
    }
    
    // Render queued tasks
    const queuedTasks = document.getElementById('queuedTasks');
    if (queued.length > 0) {
        queuedTasks.innerHTML = queued.map(task => `
            <div class="queue-task-item">
                <div class="task-id">
                    <code>${FormattingUtils.escapeHtml(task.taskId)}</code>
                </div>
                <div class="task-meta">
                    <span><i data-lucide="folder"></i> ${FormattingUtils.escapeHtml(task.clientFolder?.split(/[/\\]/).pop() || 'unknown')}</span>
                    <span><i data-lucide="clock"></i> Waiting ${formatDuration(task.waitTime)}</span>
                </div>
            </div>
        `).join('');
    } else {
        queuedTasks.innerHTML = '<p class="queue-empty">No tasks queued</p>';
    }
    
    // Render done tasks
    const doneTasks = document.getElementById('doneTasks');
    if (done.length > 0) {
        doneTasks.innerHTML = done.map(task => `
            <div class="queue-task-item">
                <div class="task-id">
                    <code>${FormattingUtils.escapeHtml(task.taskId)}</code>
                </div>
                <div class="task-meta">
                    <span><i data-lucide="check-circle"></i> ${FormattingUtils.formatRelativeTime(task.completedAt)}</span>
                </div>
            </div>
        `).join('');
    } else {
        doneTasks.innerHTML = '<p class="queue-empty">No recent completions</p>';
    }
    
    // Render failed tasks
    const failedTasksEl = document.getElementById('failedTasks');
    if (failed.length > 0) {
        failedTasksEl.innerHTML = failed.map(task => `
            <div class="queue-task-item">
                <div class="task-id">
                    <code>${FormattingUtils.escapeHtml(task.taskId)}</code>
                </div>
                <div class="task-meta">
                    <span><i data-lucide="x-circle"></i> ${FormattingUtils.formatRelativeTime(task.failedAt)}</span>
                </div>
            </div>
        `).join('');
    } else {
        failedTasksEl.innerHTML = '<p class="queue-empty">No recent failures</p>';
    }
    
    // Render current status
    const currentStatusSection = document.getElementById('currentStatusSection');
    const currentStatusDetails = document.getElementById('currentStatusDetails');
    
    if (currentStatus && currentStatus.task) {
        currentStatusSection.classList.remove('hidden');
        currentStatusDetails.innerHTML = `
            <div class="status-row">
                <span class="status-label">Task ID</span>
                <span class="status-value"><code>${FormattingUtils.escapeHtml(currentStatus.task.taskId)}</code></span>
            </div>
            <div class="status-row">
                <span class="status-label">State</span>
                <span class="status-value ${currentStatus.state}">${FormattingUtils.escapeHtml(currentStatus.state)}</span>
            </div>
            <div class="status-row">
                <span class="status-label">Progress</span>
                <span class="status-value">${currentStatus.percent}%</span>
            </div>
            <div class="status-row">
                <span class="status-label">Step</span>
                <span class="status-value">${FormattingUtils.escapeHtml(currentStatus.step || 'Unknown')}</span>
            </div>
            <div class="status-row">
                <span class="status-label">Last Update</span>
                <span class="status-value">${FormattingUtils.formatRelativeTime(currentStatus.lastUpdate)}</span>
            </div>
        `;
    } else {
        currentStatusSection.classList.add('hidden');
    }
    
    // Refresh icons
    if (window.lucide) lucide.createIcons();
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 * Handles edge cases: negative values, NaN, and extremely large values.
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Human-readable duration string
 */
function formatDuration(ms) {
    // Handle invalid input: NaN, null, undefined
    if (ms == null || isNaN(ms)) {
        return 'unknown';
    }
    
    // Handle negative durations (clock skew, future start times)
    if (ms < 0) {
        return 'just now';
    }
    
    if (ms < 1000) return 'just now';
    
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    
    const hours = Math.floor(minutes / 60);
    
    // Cap display at 99 hours to prevent extremely long strings
    if (hours > 99) {
        return '99h+';
    }
    
    return `${hours}h ${minutes % 60}m`;
}

function startQueuePolling() {
    if (queuePollingInterval) return;
    
    // Poll queue status every 10 seconds
    queuePollingInterval = setInterval(async () => {
        if (document.visibilityState === 'visible') {
            await loadQueueStatus();
        }
    }, 10000);
}

function stopQueuePolling() {
    if (queuePollingInterval) {
        clearInterval(queuePollingInterval);
        queuePollingInterval = null;
    }
}

// Cleanup webhook and queue polling on page unload
const originalBeforeUnload = window.onbeforeunload;
window.addEventListener('beforeunload', () => {
    if (webhookPollingInterval) {
        clearInterval(webhookPollingInterval);
        webhookPollingInterval = null;
    }
    if (queuePollingInterval) {
        clearInterval(queuePollingInterval);
        queuePollingInterval = null;
    }
    if (originalBeforeUnload) {
        originalBeforeUnload();
    }
});

