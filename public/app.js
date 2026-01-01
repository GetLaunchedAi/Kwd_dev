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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadTasks();
    startConnectionPolling();
    loadFailedImports();
    
    // Refresh button
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
        loadTasks({ showNotification: true });
    });

    // Pause/resume auto-refresh
    const pauseBtn = document.getElementById('pauseRefreshBtn');
    pauseBtn?.addEventListener('click', () => {
        isAutoRefreshPaused = !isAutoRefreshPaused;
        pauseBtn.textContent = isAutoRefreshPaused ? 'Resume' : 'Pause';
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
            const results = await api.post('/tasks/import-incomplete');
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
        const originalText = retryAllFailedBtn.textContent;
        retryAllFailedBtn.textContent = 'Retrying...';

        try {
            const results = await api.post('/tasks/retry-import', { taskIds });
            notifications.success(`Retry completed: ${results.imported} tasks imported, ${results.errors.length} errors.`);
            
            await loadFailedImports();
            await loadTasks({ showNotification: false });
        } catch (error) {
            notifications.error(`Retry failed: ${error.message}`);
        } finally {
            retryAllFailedBtn.disabled = false;
            retryAllFailedBtn.textContent = originalText;
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
            
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'public/app.js:preview',message:'Calling preview API',data:{taskId,queryParams},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
            // #endregion

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
            
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'public/app.js:import',message:'Calling import API',data:{taskId,clientName,triggerWorkflow},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
            // #endregion

            const result = await api.post('/tasks/import', { 
                taskId,
                clientName,
                triggerWorkflow 
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
        // R key for refresh (when not typing in input)
        if (e.key === 'r' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            loadTasks({ showNotification: true });
        }
        // / key to focus search
        if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            searchInput.focus();
        }
    });
});

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
        const hasChanged = JSON.stringify(data) !== JSON.stringify(allTasks);
        
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
    
    indicator.classList.remove('hidden');
    pauseBtn.classList.remove('hidden');
    
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
    
    indicator.classList.add('hidden');
    pauseBtn.classList.add('hidden');
}

function updateFilterBadges() {
    const filterSelect = document.getElementById('filterSelect');
    if (!filterSelect) return;
    
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
            count = allTasks.length;
        } else {
            count = allTasks.filter(task => task.state === value).length;
        }
        
        // Update option text with count
        option.textContent = `${label} (${count})`;
    });
}

function renderTasks() {
    const tasksList = document.getElementById('tasksList');
    const emptyState = document.getElementById('emptyState');
    
    // Filter tasks
    let filteredTasks = allTasks;
    
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
        
        // Add click handlers
        document.querySelectorAll('.task-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // Don't navigate if clicking on a button or link
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') {
                    return;
                }
                const taskId = card.dataset.taskId;
                window.location.href = `/task.html?taskId=${taskId}`;
            });
        });
    }, 10);
}

function sortTasks(tasks, sortBy) {
    const [field, direction] = sortBy.split('_');
    const sorted = [...tasks];
    
    sorted.sort((a, b) => {
        let aVal, bVal;
        
        switch (field) {
            case 'updated':
                aVal = new Date(a.updatedAt || 0);
                bVal = new Date(b.updatedAt || 0);
                break;
            case 'created':
                aVal = new Date(a.createdAt || 0);
                bVal = new Date(b.createdAt || 0);
                break;
            case 'name':
                aVal = (a.taskName || '').toLowerCase();
                bVal = (b.taskName || '').toLowerCase();
                break;
            case 'client':
                aVal = (a.clientName || '').toLowerCase();
                bVal = (b.clientName || '').toLowerCase();
                break;
            case 'state':
                aVal = a.state || '';
                bVal = b.state || '';
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
    const stateClass = task.state.replace(/_/g, '-');
    const updatedAt = FormattingUtils.formatRelativeTime(task.updatedAt);
    const createdAt = FormattingUtils.formatDateShort(task.createdAt);
    const description = task.description || 'No description provided';
    // Truncate description if too long (max 200 characters)
    const truncatedDescription = description.length > 200 
        ? description.substring(0, 200) + '...' 
        : description;
    
    return `
        <div class="task-card" data-task-id="${task.taskId}">
            <div class="task-card-header">
                <div>
                    <div class="task-card-title">${FormattingUtils.escapeHtml(task.taskName || 'Untitled Task')}</div>
                    <span class="state-badge ${stateClass}">${FormattingUtils.formatState(task.state)}</span>
                </div>
                <button class="delete-task-btn" data-task-id="${task.taskId}" data-task-name="${FormattingUtils.escapeHtml(task.taskName || task.taskId)}" title="Delete task">🗑️</button>
            </div>
            <div class="task-card-description">
                ${FormattingUtils.escapeHtml(truncatedDescription)}
            </div>
            <div class="task-card-meta">
                <span><strong>ID:</strong> ${FormattingUtils.escapeHtml(task.taskId)}</span>
                ${task.clientName ? `<span><strong>Client:</strong> ${FormattingUtils.escapeHtml(task.clientName)}</span>` : ''}
                ${task.branchName ? `<span><strong>Branch:</strong> <code>${FormattingUtils.escapeHtml(task.branchName)}</code></span>` : ''}
                <span><strong>Updated:</strong> ${updatedAt}</span>
                <span><strong>Created:</strong> ${createdAt}</span>
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
    
    // Filter out completed tasks
    const incompleteTasks = allTasksGrouped.filter(task => task.state !== 'completed');
    
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
                        <span class="client-group-toggle">▼</span>
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
    allTasksList.classList.remove('hidden');
    allTasksSection.classList.remove('hidden');
    allTasksEmptyState.classList.add('hidden');
    
    // Add click handlers for task cards
    document.querySelectorAll('#allTasksList .task-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't navigate if clicking on a button or link
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') {
                return;
            }
            const taskId = card.dataset.taskId;
            window.location.href = `/task.html?taskId=${taskId}`;
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
        const data = await api.get('/api/health');
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
            text.textContent = 'ClickUp Token Expired';
            break;
        case 'disconnected':
            indicator.classList.add('status-offline');
            text.textContent = 'ClickUp Disconnected';
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
                    <span>ID: ${FormattingUtils.escapeHtml(failure.taskId)}</span>
                    <span>${FormattingUtils.formatRelativeTime(failure.timestamp)}</span>
                </div>
            </div>
            <div class="failed-import-error">
                <strong>Error:</strong> ${FormattingUtils.escapeHtml(failure.error)}
            </div>
            ${failure.suggestions && failure.suggestions.length > 0 ? `
                <div class="preview-suggestions">
                    <strong>Suggested Clients:</strong> ${failure.suggestions.join(', ')}
                </div>
            ` : ''}
            <div class="failed-import-actions">
                <button class="btn btn-sm btn-primary retry-single-btn" data-task-id="${failure.taskId}">Retry</button>
                ${failure.clickUpUrl ? `<a href="${failure.clickUpUrl}" target="_blank" class="btn btn-sm btn-secondary">View in ClickUp</a>` : ''}
            </div>
        </div>
    `).join('');
    
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
                btn.textContent = 'Retry';
            }
        });
    });
}

