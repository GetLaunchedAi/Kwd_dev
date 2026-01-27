// Mappings Management JavaScript

document.addEventListener('DOMContentLoaded', () => {
    // Initialize icons
    if (window.lucide) lucide.createIcons();
    
    // Theme toggle
    initTheme();

    loadMappings();
    setupTabHandlers();
    setupFormHandlers();
    startConnectionPolling();

    // Theme toggle button
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
});

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

// Theme Management - Using centralized ThemeUtils from theme.js

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (connectionPollingInterval) {
        clearInterval(connectionPollingInterval);
        connectionPollingInterval = null;
    }
});

async function loadMappings() {
    try {
        const mappings = await api.get('/mappings');
        renderPatternMappings(mappings.patternMappings || []);
        renderTaskMappings(mappings.mappings || {});
    } catch (error) {
        notifications.error(`Failed to load mappings: ${error.message}`);
    }
}

function renderPatternMappings(patterns) {
    const tableBody = document.getElementById('patternMappingsTableBody');
    const noMessage = document.getElementById('noPatternsMessage');
    
    tableBody.innerHTML = '';
    
    if (patterns.length === 0) {
        noMessage.classList.remove('hidden');
        return;
    }
    
    noMessage.classList.add('hidden');
    patterns.forEach(pm => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="regex-badge">${FormattingUtils.escapeHtml(pm.pattern)}</span></td>
            <td>${FormattingUtils.escapeHtml(pm.client)}</td>
            <td class="mapping-actions">
                <button class="btn btn-sm btn-danger delete-pattern-btn" data-pattern="${FormattingUtils.escapeHtml(pm.pattern)}">
                    <i data-lucide="trash-2"></i> Delete
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();

    // Add delete handlers
    document.querySelectorAll('.delete-pattern-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const pattern = btn.dataset.pattern;
            if (confirm(`Are you sure you want to delete the mapping for pattern "${pattern}"?`)) {
                try {
                    await api.delete('/mappings/pattern', { pattern });
                    notifications.success(`Pattern mapping removed: ${pattern}`);
                    loadMappings();
                } catch (error) {
                    notifications.error(`Failed to remove mapping: ${error.message}`);
                }
            }
        });
    });
}

function renderTaskMappings(mappings) {
    const tableBody = document.getElementById('taskMappingsTableBody');
    const noMessage = document.getElementById('noTaskMappingsMessage');
    
    tableBody.innerHTML = '';
    
    const taskIds = Object.keys(mappings);
    if (taskIds.length === 0) {
        noMessage.classList.remove('hidden');
        return;
    }
    
    noMessage.classList.add('hidden');
    taskIds.forEach(taskId => {
        const clientName = mappings[taskId];
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${FormattingUtils.escapeHtml(taskId)}</code></td>
            <td>${FormattingUtils.escapeHtml(clientName)}</td>
            <td class="mapping-actions">
                <button class="btn btn-sm btn-danger delete-task-mapping-btn" data-task-id="${FormattingUtils.escapeHtml(taskId)}">
                    <i data-lucide="trash-2"></i> Delete
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();

    // Add delete handlers
    document.querySelectorAll('.delete-task-mapping-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const taskId = btn.dataset.taskId;
            if (confirm(`Are you sure you want to delete the mapping for task ID "${taskId}"?`)) {
                try {
                    await api.delete(`/mappings/task/${taskId}`);
                    notifications.success(`Task mapping removed for: ${taskId}`);
                    loadMappings();
                } catch (error) {
                    notifications.error(`Failed to remove mapping: ${error.message}`);
                }
            }
        });
    });
}

function setupTabHandlers() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            tabContents.forEach(content => {
                if (content.id === `${tabId}Tab`) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });
}

function setupFormHandlers() {
    // Pattern form - with input validation
    const addPatternForm = document.getElementById('addPatternForm');
    const patternInput = document.getElementById('patternInput');
    
    // Real-time regex validation as user types
    if (patternInput) {
        patternInput.addEventListener('input', (e) => {
            const pattern = e.target.value.trim();
            if (!pattern) {
                patternInput.setCustomValidity('');
                return;
            }
            
            // Try to validate regex in real-time
            try {
                new RegExp(pattern);
                patternInput.setCustomValidity(''); // Valid regex
                patternInput.style.borderColor = ''; // Reset border
            } catch (regexError) {
                patternInput.setCustomValidity(`Invalid regex: ${regexError.message}`);
                patternInput.style.borderColor = 'var(--color-danger, #f44336)';
            }
        });
    }
    
    addPatternForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pattern = document.getElementById('patternInput')?.value?.trim();
        const clientName = document.getElementById('patternClientInput')?.value?.trim();
        
        // Validate inputs before submission
        if (!pattern || pattern.length < 1) {
            notifications.warning('Please enter a valid pattern');
            return;
        }
        if (!clientName || clientName.length < 1) {
            notifications.warning('Please enter a client name');
            return;
        }
        
        // Validate regex pattern syntax
        try {
            new RegExp(pattern);
        } catch (regexError) {
            notifications.error(`Invalid regex pattern: ${regexError.message}`);
            return;
        }
        
        try {
            await api.post('/mappings/pattern', { pattern, clientName });
            notifications.success(`Pattern mapping added: ${pattern} -> ${clientName}`);
            addPatternForm.reset();
            patternInput.style.borderColor = ''; // Reset border on success
            loadMappings();
        } catch (error) {
            notifications.error(`Failed to add pattern mapping: ${error.message}`);
        }
    });

    // Task form - with input validation
    const addTaskMappingForm = document.getElementById('addTaskMappingForm');
    addTaskMappingForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const taskId = document.getElementById('taskIdMappingInput')?.value?.trim();
        const clientName = document.getElementById('taskClientMappingInput')?.value?.trim();
        
        // Validate inputs before submission
        if (!taskId || taskId.length < 1) {
            notifications.warning('Please enter a valid task ID');
            return;
        }
        if (!clientName || clientName.length < 1) {
            notifications.warning('Please enter a client name');
            return;
        }
        
        try {
            await api.post(`/mappings/task/${taskId}`, { clientName });
            notifications.success(`Task mapping added: ${taskId} -> ${clientName}`);
            addTaskMappingForm.reset();
            loadMappings();
        } catch (error) {
            notifications.error(`Failed to add task mapping: ${error.message}`);
        }
    });
}


