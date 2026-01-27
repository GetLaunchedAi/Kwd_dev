/**
 * Clients Dashboard Logic
 * Handles fetching, filtering, and displaying the list of client websites
 */

let allClients = [];
let filteredClients = [];
let activePreviews = [];
let currentSearch = '';
let currentSort = 'name_asc';
let connectionPollingInterval = null;
let previewPollingInterval = null;
let isLoadingClients = false; // Prevents concurrent loadClients() calls
let terminalModalOpen = false; // Tracks terminal modal state
let addClientModalListenersSetup = false; // Prevents duplicate event listeners

/**
 * Gets the appropriate URL for viewing a client preview.
 * Uses environment-aware config to determine local vs production URL.
 * 
 * @param {string} folder - The client folder path or slug
 * @param {number|null} port - The preview server port (if running locally)
 * @returns {string} The URL to access the preview
 */
function getPreviewUrl(folder, port) {
    // Validate folder parameter - check for null, undefined, non-string, or whitespace-only
    if (!folder || typeof folder !== 'string' || !folder.trim()) {
        console.warn('getPreviewUrl called with invalid folder:', folder);
        return '/client-websites/';
    }
    
    // Validate port if provided - must be a valid port number (1-65535)
    if (port !== null && port !== undefined) {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            console.warn('getPreviewUrl called with invalid port:', port);
            port = null; // Fall back to static URL
        }
    }
    
    // Extract just the slug from the folder path
    // folder could be a full path like "/home/.../client-websites/aimai" or just "aimai"
    // Handle both forward slashes and backslashes (Windows paths)
    const pathParts = folder.split(/[/\\]/).filter(Boolean);
    let slug = pathParts.pop() || '';
    
    // Trim whitespace and validate we have a usable slug
    slug = slug.trim();
    if (!slug) {
        console.warn('getPreviewUrl: Could not extract valid slug from folder:', folder);
        return '/client-websites/';
    }
    
    // URL-encode the slug to handle special characters (spaces, etc.)
    const encodedSlug = encodeURIComponent(slug);
    
    if (window.APP_CONFIG) {
        // In production, always use static URL regardless of port
        // Preview servers don't work in production (they run on the server, not user's machine)
        if (window.APP_CONFIG.isProduction) {
            return `/client-websites/${encodedSlug}/`;
        }
        return window.APP_CONFIG.getDemoUrl(slug, port);
    }
    // Fallback if config not loaded - use static URL (works everywhere)
    return `/client-websites/${encodedSlug}/`;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize icons
    if (window.lucide) lucide.createIcons();
    
    // Theme initialization
    initTheme();
    
    // Load data
    loadClients();
    
    // Start polling
    startConnectionPolling();
    startPreviewPolling();
    
    // Event Listeners
    document.getElementById('refreshClientsBtn')?.addEventListener('click', () => {
        loadClients({ showNotification: true });
    });
    
    document.getElementById('clientSearchInput')?.addEventListener('input', (e) => {
        currentSearch = e.target.value.toLowerCase().trim();
        applyFiltersAndRender();
    });
    
    document.getElementById('clientSortSelect')?.addEventListener('change', (e) => {
        currentSort = e.target.value;
        applyFiltersAndRender();
    });
    
    document.getElementById('retryBtn')?.addEventListener('click', () => {
        loadClients();
    });
    
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
    
    // Add Client Button
    document.getElementById('addClientBtn')?.addEventListener('click', openAddClientModal);

    // Event Delegation for all actions in the clients list
    const clientsList = document.getElementById('clientsList');
    if (clientsList) {
        clientsList.addEventListener('click', (e) => {
            console.log('Click detected in clientsList', e.target);
            // 1. Handle Preview Actions (Start/Stop)
            const startBtn = e.target.closest('.start-preview-btn');
            const stopBtn = e.target.closest('.stop-preview-btn');
            const terminalBtn = e.target.closest('.open-terminal-btn');
            
            if (startBtn || stopBtn) {
                console.log('Preview button clicked');
                handlePreviewAction(e);
                return;
            }

            if (terminalBtn) {
                console.log('Terminal button clicked');
                openTerminal(terminalBtn.dataset.clientFolder, terminalBtn.dataset.clientName);
                return;
            }

            // 2. Handle Delete Client
            const deleteBtn = e.target.closest('.delete-client-btn');
            if (deleteBtn) {
                console.log('Delete button clicked');
                handleDeleteClient(deleteBtn.dataset.clientFolder, deleteBtn.dataset.clientName);
                return;
            }

            // 4. Handle Git Status Check
            const checkGitBtn = e.target.closest('.check-git-btn');
            if (checkGitBtn) {
                console.log('Check Git button clicked');
                handleCheckGit(checkGitBtn);
                return;
            }

            // 5. Handle Navigation to Reports
            const reportsBtn = e.target.closest('.view-reports-btn');
            if (reportsBtn) {
                console.log('Reports button clicked');
                const siteSlug = reportsBtn.dataset.clientFolder;
                window.location.href = `/reports.html?site=${encodeURIComponent(siteSlug)}`;
                return;
            }

            // 6. Handle Navigation to Client Tasks
            const card = e.target.closest('.client-card');
            if (card && !e.target.closest('.preview-section')) {
                console.log('Card clicked, navigating');
                const clientName = card.dataset.clientName;
                window.location.href = `/index.html?client=${encodeURIComponent(clientName)}`;
            }
        });
    }
});

/**
 * Loads client data from the API
 * Includes debounce protection against concurrent calls
 */
async function loadClients(options = {}) {
    const { showNotification = false, silent = false } = options;
    
    // Prevent concurrent calls - return early if already loading
    if (isLoadingClients) {
        console.log('loadClients: Already loading, skipping duplicate call');
        return;
    }
    
    isLoadingClients = true;
    
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const container = document.getElementById('clientsContainer');
    const refreshBtn = document.getElementById('refreshClientsBtn');
    
    if (!silent) {
        loading?.classList.remove('hidden');
        error?.classList.add('hidden');
        container?.classList.add('hidden');
        
        if (refreshBtn) {
            refreshBtn.disabled = true;
            const btnSpan = refreshBtn.querySelector('span');
            if (btnSpan) btnSpan.textContent = 'Loading...';
        }
    }
    
    let previewsFetchFailed = false;
    let clientsData = [];
    let previewsData = [];
    
    try {
        // Fetch clients and previews in parallel with individual error handling
        const results = await Promise.allSettled([
            api.get('/clients'),
            api.get('/previews')
        ]);
        
        // Handle clients result
        if (results[0].status === 'fulfilled') {
            clientsData = results[0].value || [];
        } else {
            console.error('Failed to fetch clients:', results[0].reason);
            throw new Error('Failed to load clients data');
        }
        
        // Handle previews result (non-critical, can continue without it)
        if (results[1].status === 'fulfilled') {
            previewsData = results[1].value || [];
        } else {
            console.warn('Failed to fetch previews:', results[1].reason);
            previewsFetchFailed = true;
            previewsData = []; // Use empty array as fallback
        }
        
        // Validate data structure before assigning
        if (!Array.isArray(clientsData)) {
            console.error('Invalid clients data format:', clientsData);
            throw new Error('Invalid data format received from server');
        }
        
        allClients = clientsData;
        activePreviews = Array.isArray(previewsData) ? previewsData : [];
        
        if (!silent) {
            loading?.classList.add('hidden');
            container?.classList.remove('hidden');
        }
        
        applyFiltersAndRender();
        
        if (showNotification) {
            notifications.success('Clients list refreshed');
        }
        
        // Notify user if previews failed to load (but clients succeeded)
        if (previewsFetchFailed && !silent) {
            notifications.warning('Preview status unavailable - some data may be outdated');
        }
    } catch (err) {
        if (!silent) {
            loading?.classList.add('hidden');
            error?.classList.remove('hidden');
            const errorMessage = document.getElementById('errorMessage');
            if (errorMessage) {
                errorMessage.textContent = err.message || 'Unable to load clients. Please check your connection and try again.';
            }
            console.error('Error loading clients:', err);
        }
        
        if (showNotification) {
            notifications.error(`Failed to load clients: ${err.message || 'Unknown error'}`);
        }
    } finally {
        isLoadingClients = false;
        
        if (!silent && refreshBtn) {
            refreshBtn.disabled = false;
            const btnSpan = refreshBtn.querySelector('span');
            if (btnSpan) btnSpan.textContent = 'Refresh';
        }
    }
}

/**
 * Filters and sorts the clients list then triggers render
 */
function applyFiltersAndRender() {
    // Filter
    filteredClients = allClients.filter(client => {
        const name = (client.name || '').toLowerCase();
        const folder = (client.folder || '').toLowerCase();
        return name.includes(currentSearch) || folder.includes(currentSearch);
    });
    
    // Sort
    filteredClients.sort((a, b) => {
        let comparison = 0;
        switch (currentSort) {
            case 'name_asc':
                comparison = (a.name || '').localeCompare(b.name || '');
                break;
            case 'name_desc':
                comparison = (b.name || '').localeCompare(a.name || '');
                break;
            case 'tasks_desc':
                comparison = (b.taskCount || 0) - (a.taskCount || 0);
                break;
            case 'tasks_asc':
                comparison = (a.taskCount || 0) - (b.taskCount || 0);
                break;
            case 'active_desc':
                comparison = (b.activeTasks || 0) - (a.activeTasks || 0);
                break;
            case 'activity_desc':
                comparison = new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime();
                break;
        }
        return comparison;
    });
    
    renderClients();
}

/**
 * Renders the filtered clients list to the DOM
 */
function renderClients() {
    const list = document.getElementById('clientsList');
    const emptyState = document.getElementById('emptyState');
    
    if (!list || !emptyState) return;
    
    if (filteredClients.length === 0) {
        list.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }
    
    list.classList.remove('hidden');
    emptyState.classList.add('hidden');
    
    list.innerHTML = filteredClients.map(client => createClientCard(client)).join('');
    
    // Initialize icons for new cards
    if (window.lucide) lucide.createIcons();
}

/**
 * Formats client name by replacing dashes with spaces and capitalizing each word
 */
function formatClientName(name) {
    if (!name) return '';
    return name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Creates a client card HTML string
 */
function createClientCard(client) {
    const lastActivity = client.lastActivity 
        ? FormattingUtils.formatRelativeTime(client.lastActivity)
        : 'No recent activity';
    
    const activeTasks = client.activeTasks || 0;
    const totalTasks = client.taskCount || 0;
    const displayName = formatClientName(client.name);
    
    // Check if this client has an active preview
    const preview = activePreviews.find(p => p.clientName === client.name);
    const isRunning = preview && (preview.status === 'running' || preview.status === 'starting');
    const isError = preview && preview.status === 'error';
    
    let statusText = 'Preview Inactive';
    let dotClass = '';
    if (isRunning) {
        statusText = preview.status === 'running' ? 'Preview Live' : 'Starting...';
        dotClass = preview.status === 'running' ? 'online' : 'starting';
    } else if (isError) {
        statusText = 'Start Failed';
        dotClass = 'error';
    }
    
    // Use task-card class for consistent styling with dashboard
    return `
        <div class="task-card client-card" data-client-name="${FormattingUtils.escapeHtml(client.name)}">
            <div class="task-card-header">
                <div class="task-card-header-main">
                    <div class="state-badge-container">
                        ${activeTasks > 0 ? `
                            <span class="state-badge in-progress">
                                ${activeTasks} Active
                            </span>
                        ` : ''}
                    </div>
                    <div class="task-card-title" title="${FormattingUtils.escapeHtml(displayName)}">
                        ${FormattingUtils.escapeHtml(displayName)}
                    </div>
                </div>
                <div class="client-card-actions">
                    <button class="btn btn-ghost btn-xs open-terminal-btn" 
                        data-client-folder="${FormattingUtils.escapeHtml(client.folder)}" 
                        data-client-name="${FormattingUtils.escapeHtml(client.name)}" 
                        title="Open Terminal"
                        aria-label="Open terminal for ${FormattingUtils.escapeHtml(displayName)}">
                        <i data-lucide="terminal" aria-hidden="true"></i>
                    </button>
                    <button class="btn btn-ghost btn-xs check-git-btn" 
                        data-client-folder="${FormattingUtils.escapeHtml(client.folder)}" 
                        data-client-name="${FormattingUtils.escapeHtml(client.name)}" 
                        title="Check Git Status"
                        aria-label="Check git status for ${FormattingUtils.escapeHtml(displayName)}">
                        <i data-lucide="git-branch" aria-hidden="true"></i>
                    </button>
                    <button class="btn btn-ghost btn-xs delete-client-btn text-danger" 
                        data-client-folder="${FormattingUtils.escapeHtml(client.folder)}" 
                        data-client-name="${FormattingUtils.escapeHtml(client.name)}" 
                        title="Delete Client"
                        aria-label="Delete ${FormattingUtils.escapeHtml(displayName)}">
                        <i data-lucide="trash-2" aria-hidden="true"></i>
                    </button>
                    <div class="client-icon" aria-hidden="true">
                        <i data-lucide="globe"></i>
                    </div>
                </div>
            </div>
            
            <div class="task-card-meta">
                <div class="meta-item" title="Folder Path">
                    <i data-lucide="folder"></i>
                    <span>${FormattingUtils.escapeHtml(client.folder)}</span>
                </div>
                <div class="meta-item" title="Last Activity">
                    <i data-lucide="clock"></i>
                    <span>${lastActivity}</span>
                </div>
                <div class="meta-item" title="Total Tasks">
                    <i data-lucide="clipboard-list"></i>
                    <span>${totalTasks} Total Tasks</span>
                </div>
                <div class="flex gap-md mt-xs pt-xs border-t border-main">
                    <div class="flex items-center gap-xs ${client.hasNodeModules ? 'text-success' : (client.isNodeProject ? 'text-danger' : 'text-hint')}" title="${client.hasNodeModules ? 'node_modules exists' : (client.isNodeProject ? 'node_modules missing' : 'Not a Node project')}">
                        <i data-lucide="package" class="size-xs"></i>
                        <span style="font-size: 11px; font-weight: 600;">${client.hasNodeModules ? 'NODE' : 'NO NODE'}</span>
                    </div>
                </div>
            </div>

            <!-- Preview Section -->
            <div class="preview-section ${isRunning ? 'running' : ''} ${isError ? 'error-bg' : ''}">
                <div class="preview-header">
                    <span class="preview-status ${dotClass}">
                        <span class="status-dot ${dotClass}"></span>
                        ${statusText}
                    </span>
                    ${isRunning && preview.port ? `<span class="preview-port">Port: ${preview.port}</span>` : ''}
                </div>
                
                <div class="preview-actions">
                    ${isRunning ? `
                        <button class="btn btn-secondary btn-sm open-preview-btn" 
                            onclick="window.open('${getPreviewUrl(client.folder, preview.port)}', '_blank')"
                            aria-label="Open preview for ${FormattingUtils.escapeHtml(displayName)} in new tab">
                            <i data-lucide="external-link" aria-hidden="true"></i> Open
                        </button>
                        <button class="btn btn-danger btn-sm stop-preview-btn" 
                            data-client-folder="${FormattingUtils.escapeHtml(client.folder)}"
                            aria-label="Stop preview for ${FormattingUtils.escapeHtml(displayName)}">
                            <i data-lucide="square" aria-hidden="true"></i> Stop
                        </button>
                    ` : `
                        <button class="btn btn-secondary btn-sm start-preview-btn" 
                            data-client-folder="${FormattingUtils.escapeHtml(client.folder)}"
                            aria-label="Start preview for ${FormattingUtils.escapeHtml(displayName)}">
                            <i data-lucide="play" aria-hidden="true"></i> Start Preview
                        </button>
                        ${window.APP_CONFIG?.isProduction ? `
                            <button class="btn btn-ghost btn-sm open-preview-btn" 
                                onclick="window.open('${getPreviewUrl(client.folder, null)}', '_blank')" 
                                title="View built demo (may be outdated)"
                                aria-label="View static demo for ${FormattingUtils.escapeHtml(displayName)}">
                                <i data-lucide="external-link" aria-hidden="true"></i> View Static
                            </button>
                        ` : ''}
                    `}
                </div>
                
                <div class="git-status-container hidden" id="git-status-${FormattingUtils.escapeHtml(client.folder).replace(/[^a-z0-9]/gi, '-')}">
                </div>
            </div>
            
            <div class="client-card-footer">
                <button class="btn btn-ghost btn-sm view-reports-btn" 
                    data-client-folder="${FormattingUtils.escapeHtml(client.folder)}"
                    aria-label="View reports for ${FormattingUtils.escapeHtml(displayName)}">
                    <i data-lucide="bar-chart-2" aria-hidden="true"></i> Reports
                </button>
                <button class="btn btn-ghost btn-sm view-tasks-btn"
                    aria-label="View tasks for ${FormattingUtils.escapeHtml(displayName)}">
                    View Tasks <i data-lucide="chevron-right" aria-hidden="true"></i>
                </button>
            </div>
        </div>
    `;
}

// --- Theme Utilities ---
// Theme logic is now in utils/theme.js (loaded via script tag)
// initTheme(), toggleTheme(), and updateThemeToggleUI() are available globally

function startConnectionPolling() {
    if (connectionPollingInterval) return;
    
    const checkConnection = async () => {
        try {
            const data = await api.get('/health');
            updateConnectionStatus(data.clickup?.status || 'disconnected', data.clickup?.user);
        } catch (error) {
            updateConnectionStatus('offline');
        }
    };

    checkConnection();
    connectionPollingInterval = setInterval(checkConnection, 30000);
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

/**
 * Terminal Modal Logic
 */
let currentTerminalFolder = null;
let terminalUpdateInterval = null;

function openTerminal(folder, name) {
    // Prevent opening multiple terminal modals
    if (terminalModalOpen) {
        console.log('Terminal modal already open, ignoring duplicate request');
        return;
    }
    
    currentTerminalFolder = folder;
    terminalModalOpen = true;
    
    const modal = document.getElementById('terminalModal');
    const nameSpan = document.getElementById('terminalClientName');
    const pathSpan = document.getElementById('terminalPath');
    const output = document.getElementById('terminalOutput');
    const input = document.getElementById('terminalInput');
    
    if (!modal || !nameSpan || !pathSpan || !output) {
        terminalModalOpen = false;
        currentTerminalFolder = null;
        return;
    }
    
    nameSpan.textContent = name;
    pathSpan.textContent = folder;
    output.innerHTML = '<div class="text-hint">Opening session...</div>';
    
    // Update Node indicator
    const client = allClients.find(c => c.folder === folder);
    const nodeStatus = document.getElementById('terminalNodeStatus');
    
    if (client && nodeStatus) {
        // Node Status - safely get the text element with fallback
        const nodeText = nodeStatus.querySelector('.status-text');
        if (!nodeText) {
            console.warn('Node status text element not found in terminal modal');
        } else {
            if (client.hasNodeModules) {
                nodeStatus.className = 'flex items-center gap-xs text-success';
                nodeText.textContent = 'Modules Installed';
                nodeStatus.dataset.tooltip = 'Node modules are ready';
            } else if (client.isNodeProject) {
                nodeStatus.className = 'flex items-center gap-xs text-danger';
                nodeText.textContent = 'Modules Missing';
                nodeStatus.dataset.tooltip = 'node_modules folder is missing. Run npm install.';
            } else {
                nodeStatus.className = 'flex items-center gap-xs text-hint';
                nodeText.textContent = 'No package.json';
                nodeStatus.dataset.tooltip = 'This does not appear to be a Node.js project';
            }
        }
        
        // Re-initialize icons for the status bar
        if (window.lucide) lucide.createIcons();
    }
    
    modal.classList.add('show');
    modal.classList.remove('hidden');
    
    // Focus input
    setTimeout(() => input?.focus(), 100);
    
    // Start updating logs
    updateTerminalLogs();
    terminalUpdateInterval = setInterval(updateTerminalLogs, 2000);
    
    // Setup modal close
    const closeBtn = document.getElementById('closeTerminalModal');
    const closeBtn2 = document.getElementById('closeTerminalBtn');
    const clearBtn = document.getElementById('clearTerminalBtn');
    
    const closeModal = () => {
        modal.classList.remove('show');
        setTimeout(() => modal.classList.add('hidden'), 300);
        
        // Clear interval and reset state
        if (terminalUpdateInterval) {
            clearInterval(terminalUpdateInterval);
            terminalUpdateInterval = null;
        }
        currentTerminalFolder = null;
        terminalModalOpen = false;
    };
    
    if (closeBtn) closeBtn.onclick = closeModal;
    if (closeBtn2) closeBtn2.onclick = closeModal;
    
    if (clearBtn) clearBtn.onclick = () => {
        output.innerHTML = '';
    };

    // Setup command execution
    const runBtn = document.getElementById('runCommandBtn');
    const MAX_COMMAND_LENGTH = 2000; // Reasonable limit for shell commands
    let isCommandRunning = false; // Prevent double-execution
    
    // Dangerous command patterns to warn about (but not block - server handles security)
    const DANGEROUS_PATTERNS = [
        /rm\s+-rf\s+\//, // rm -rf /
        />\s*\/dev\/sd/, // writing to disk devices
        /:\(\)\{.*\}.*;/,  // fork bombs
        /sudo\s+rm/,  // sudo rm
        /mkfs\./  // formatting filesystems
    ];
    
    const runCmd = async () => {
        const cmd = input.value.trim();
        
        // Validate: empty command
        if (!cmd) {
            appendTerminalLog('No command entered', 'error');
            return;
        }
        
        // Validate: command too long (potential abuse or paste error)
        if (cmd.length > MAX_COMMAND_LENGTH) {
            appendTerminalLog(`Error: Command too long (${cmd.length} chars, max ${MAX_COMMAND_LENGTH})`, 'error');
            return;
        }
        
        // Validate: Check for dangerous patterns and warn user
        for (const pattern of DANGEROUS_PATTERNS) {
            if (pattern.test(cmd)) {
                const confirmed = confirm(`⚠️ WARNING: This command looks potentially dangerous:\n"${cmd}"\n\nAre you sure you want to run it?`);
                if (!confirmed) {
                    appendTerminalLog('Command cancelled by user', 'error');
                    return;
                }
                break;
            }
        }
        
        // Prevent double-execution if command is already running
        if (isCommandRunning) {
            appendTerminalLog('Please wait for the current command to finish', 'error');
            return;
        }
        
        isCommandRunning = true;
        input.value = '';
        input.disabled = true;
        runBtn.disabled = true;
        
        appendTerminalLog(`$ ${cmd}`, 'cmd');
        
        try {
            const result = await api.post('/previews/command', { 
                clientFolder: currentTerminalFolder, 
                command: cmd 
            });
            
            if (result.output) {
                appendTerminalLog(result.output);
                
                // Refresh client data if command might have changed something
                const cmdLower = cmd.toLowerCase();
                if (cmdLower.includes('npm') || cmdLower.includes('git') || cmdLower.includes('rm ') || cmdLower.includes('mkdir')) {
                    setTimeout(() => loadClients({ silent: true }), 1000);
                }
            }
            if (!result.success) {
                appendTerminalLog(`Error: Command failed`, 'error');
            }
        } catch (error) {
            appendTerminalLog(`Error: ${error.message}`, 'error');
        } finally {
            isCommandRunning = false;
            input.disabled = false;
            runBtn.disabled = false;
            input.focus();
        }
    };
    
    if (runBtn) runBtn.onclick = runCmd;
    if (input) input.onkeydown = (e) => {
        if (e.key === 'Enter') runCmd();
    };

    // Setup quick commands (descriptions are in the title attributes in HTML)
    document.querySelectorAll('.quick-cmd').forEach(btn => {
        btn.onclick = () => {
            input.value = btn.dataset.cmd;
            runCmd();
        };
    });
}

async function updateTerminalLogs() {
    if (!currentTerminalFolder) return;
    
    try {
        const previews = await api.get('/previews');
        const preview = previews.find(p => p.folderPath === currentTerminalFolder);
        
        const statusDot = document.querySelector('#terminalStatus .status-dot');
        const statusText = document.getElementById('terminalStatusText');
        const output = document.getElementById('terminalOutput');
        
        if (preview) {
            // Update status
            if (statusDot) {
                statusDot.className = `status-dot ${preview.status}`;
            }
            if (statusText) {
                statusText.textContent = preview.status.charAt(0).toUpperCase() + preview.status.slice(1);
                statusText.className = `preview-status ${preview.status}`;
            }
        } else {
            if (statusDot) statusDot.className = 'status-dot';
            if (statusText) statusText.textContent = 'Inactive';
        }

        // Also update Node indicator if it exists in the modal
        const client = allClients.find(c => c.folder === currentTerminalFolder);
        const nodeStatus = document.getElementById('terminalNodeStatus');
        
        if (client && nodeStatus) {
            const nodeText = nodeStatus.querySelector('.status-text');
            if (!nodeText) return; // Guard against missing element
            
            let currentNodeClass = `flex items-center gap-xs text-hint`;
            let nodeStatusText = 'No package.json';
            let nodeTooltip = 'This does not appear to be a Node.js project';

            if (client.hasNodeModules) {
                currentNodeClass = `flex items-center gap-xs text-success`;
                nodeStatusText = 'Modules Installed';
                nodeTooltip = 'Node modules are ready';
            } else if (client.isNodeProject) {
                currentNodeClass = `flex items-center gap-xs text-danger`;
                nodeStatusText = 'Modules Missing';
                nodeTooltip = 'node_modules folder is missing. Run npm install.';
            }

            if (nodeStatus.className !== currentNodeClass) {
                nodeStatus.className = currentNodeClass;
                nodeText.textContent = nodeStatusText;
                nodeStatus.dataset.tooltip = nodeTooltip;
            }
        }
        
        // Update logs if they changed
        if (preview && preview.logs && preview.logs.length > 0) {
                const logsHtml = preview.logs.map(log => {
                    const isError = log.includes('ERROR') || log.includes('Failed');
                    return `<div class="${isError ? 'text-danger' : ''}">${FormattingUtils.escapeHtml(log)}</div>`;
                }).join('');
                
                // Only update if content is different to avoid scroll jumping
                if (output.innerHTML !== logsHtml) {
                    const shouldScroll = output.scrollTop + output.clientHeight >= output.scrollHeight - 50;
                    output.innerHTML = logsHtml;
                    if (shouldScroll) {
                    output.scrollTop = output.scrollHeight;
                }
            }
        }
    } catch (error) {
        console.error('Error updating terminal logs:', error);
    }
}

function appendTerminalLog(text, type = '') {
    const output = document.getElementById('terminalOutput');
    if (!output) return;
    
    const div = document.createElement('div');
    if (type === 'cmd') div.style.color = '#4ec9b0';
    if (type === 'error') div.style.color = '#f44336';
    div.textContent = text;
    
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
}

/**
 * Appends formatted content to terminal output.
 * Only allows safe HTML elements for formatting (spans with classes).
 * All text content is escaped to prevent XSS.
 * @param {string} text - The text content (will be escaped)
 * @param {string} className - Optional CSS class for styling
 */
function appendTerminalFormatted(text, className = '') {
    const output = document.getElementById('terminalOutput');
    if (!output) return;
    
    const div = document.createElement('div');
    if (className) {
        div.className = className;
    }
    // Use textContent for safety - no HTML injection possible
    div.textContent = text;
    
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
}
function startPreviewPolling() {
    if (previewPollingInterval) return;
    
    const poll = async () => {
        // Skip polling if loadClients is in progress to avoid race conditions
        // This prevents UI flickering and inconsistent state
        if (isLoadingClients) {
            return;
        }
        
        // Check if page is being unloaded or hidden - stop polling
        if (document.visibilityState === 'hidden') {
            return;
        }
        
        try {
            const previews = await api.get('/previews');
            
            // Double-check loading state after async call completes
            // loadClients may have started while we were fetching
            if (isLoadingClients) {
                return;
            }
            
            // Additional check: verify the interval still exists (not cleaned up)
            if (!previewPollingInterval) {
                return;
            }
            
            // Check if anything changed before re-rendering
            const changed = JSON.stringify(previews) !== JSON.stringify(activePreviews);
            if (changed) {
                activePreviews = previews || [];
                applyFiltersAndRender();
            }
        } catch (error) {
            // Silently fail if server is unavailable (avoid console spam)
            // Only log if it's not a network error
            if (!error.message?.includes('Failed to fetch')) {
                console.warn('Preview polling failed:', error);
            }
        }
    };

    poll(); // Run immediately
    previewPollingInterval = setInterval(poll, 10000);
}

// Stop preview polling when page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && previewPollingInterval) {
        clearInterval(previewPollingInterval);
        previewPollingInterval = null;
    } else if (document.visibilityState === 'visible' && !previewPollingInterval) {
        startPreviewPolling();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (connectionPollingInterval) {
        clearInterval(connectionPollingInterval);
        connectionPollingInterval = null;
    }
    if (previewPollingInterval) {
        clearInterval(previewPollingInterval);
        previewPollingInterval = null;
    }
    if (terminalUpdateInterval) {
        clearInterval(terminalUpdateInterval);
        terminalUpdateInterval = null;
    }
});

/**
 * Handles delete client action
 * Validates that client has no active tasks or running previews before deletion
 */
async function handleDeleteClient(folder, name) {
    // Find the client to check for active tasks/previews
    const client = allClients.find(c => c.folder === folder);
    const activePreview = activePreviews.find(p => p.clientName === name);
    const isPreviewRunning = activePreview && (activePreview.status === 'running' || activePreview.status === 'starting');
    
    // Validate: Block deletion if preview is running
    if (isPreviewRunning) {
        notifications.error(`Cannot delete "${formatClientName(name)}" while preview is running. Please stop the preview first.`);
        return;
    }
    
    // Validate: Warn if client has active tasks
    if (client && client.activeTasks > 0) {
        const proceedAnyway = await showDeleteConfirmation(name, {
            warning: `This client has ${client.activeTasks} active task(s). Deleting will orphan these tasks.`,
            confirmText: 'Delete Anyway'
        });
        if (!proceedAnyway) return;
    } else {
        // Show standard confirmation modal
        const confirmed = await showDeleteConfirmation(name);
        if (!confirmed) return;
    }
    
    try {
        const response = await api.delete(`/clients/${encodeURIComponent(folder)}`);
        
        if (response.success) {
            notifications.success(`Successfully deleted ${formatClientName(name)}`);
            // Remove from local array and re-render
            allClients = allClients.filter(c => c.folder !== folder);
            applyFiltersAndRender();
        } else {
            notifications.error(response.error || `Failed to delete ${formatClientName(name)}`);
        }
    } catch (error) {
        console.error('Delete client error:', error);
        notifications.error(`Failed to delete client. Please try again.`);
    }
}

/**
 * Shows delete confirmation modal
 * @param {string} clientName - Name of the client to delete
 * @param {Object} options - Optional configuration
 * @param {string} options.warning - Additional warning message to display
 * @param {string} options.confirmText - Custom text for confirm button
 */
function showDeleteConfirmation(clientName, options = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('deleteConfirmModal');
        const clientNameSpan = document.getElementById('deleteClientName');
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const cancelBtn = document.getElementById('cancelDeleteBtn');
        const closeBtn = document.getElementById('closeDeleteModal');
        const warningContainer = document.getElementById('deleteWarningMessage');
        
        if (!modal) {
            // Fallback to native confirm if modal doesn't exist
            const msg = options.warning 
                ? `${options.warning}\n\nAre you sure you want to delete "${clientName}"?`
                : `Are you sure you want to delete "${clientName}"? This will permanently remove all files.`;
            resolve(confirm(msg));
            return;
        }
        
        // Set client name
        if (clientNameSpan) {
            clientNameSpan.textContent = formatClientName(clientName);
        }
        
        // Show warning if provided
        if (warningContainer) {
            if (options.warning) {
                warningContainer.textContent = options.warning;
                warningContainer.classList.remove('hidden');
            } else {
                warningContainer.classList.add('hidden');
            }
        }
        
        // Update confirm button text if custom text provided
        if (confirmBtn && options.confirmText) {
            confirmBtn.textContent = options.confirmText;
        }
        
        modal.classList.add('show');
        modal.classList.remove('hidden');
        
        const cleanup = () => {
            modal.classList.remove('show');
            setTimeout(() => modal.classList.add('hidden'), 300);
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
            // Reset confirm button text
            if (confirmBtn) confirmBtn.textContent = 'Delete';
            // Hide warning
            if (warningContainer) warningContainer.classList.add('hidden');
        };
        
        const handleConfirm = () => {
            cleanup();
            resolve(true);
        };
        
        const handleCancel = () => {
            cleanup();
            resolve(false);
        };
        
        if (confirmBtn) confirmBtn.onclick = handleConfirm;
        if (cancelBtn) cancelBtn.onclick = handleCancel;
        if (closeBtn) closeBtn.onclick = handleCancel;
    });
}

/**
 * Handles preview action button clicks via delegation
 */
async function handleCheckGit(btn) {
    const folder = btn.dataset.clientFolder;
    const clientName = btn.dataset.clientName;
    const safeFolder = folder.replace(/[^a-z0-9]/gi, '-');
    const statusContainer = document.getElementById(`git-status-${safeFolder}`);
    
    if (!statusContainer) return;
    
    try {
        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-sm"></span>';
        
        statusContainer.classList.remove('hidden');
        statusContainer.className = 'git-status-container loading';
        statusContainer.innerHTML = '<div class="spinner-sm"></div> Checking git status...';
        
        const response = await fetch(`/api/git/status?folder=${encodeURIComponent(folder)}`);
        const data = await response.json();
        
        statusContainer.classList.remove('loading');
        
        if (response.ok && data.success) {
            statusContainer.className = 'git-status-container success';
            statusContainer.innerHTML = `
                <div class="git-status-header">
                    <i data-lucide="check-circle"></i>
                    <span>Git is working correctly</span>
                </div>
                <pre class="git-status-output">${FormattingUtils.escapeHtml(data.status || '')}</pre>
            `;
            notifications.success(`Git status check passed for ${formatClientName(clientName)}`);
        } else {
            statusContainer.className = 'git-status-container error';
            statusContainer.innerHTML = `
                <div class="git-status-header">
                    <i data-lucide="alert-circle"></i>
                    <span>Git error</span>
                </div>
                <div class="git-status-message">${FormattingUtils.escapeHtml(data.error || 'Unknown error occurred')}</div>
            `;
            notifications.error(`Git status check failed for ${formatClientName(clientName)}`);
        }
        
        // Re-initialize icons in the status container
        if (window.lucide) lucide.createIcons();
        
        // Reset button
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        
    } catch (error) {
        console.error('Git status check error:', error);
        statusContainer.className = 'git-status-container error';
        statusContainer.innerHTML = `
            <div class="git-status-header">
                <i data-lucide="alert-circle"></i>
                <span>Connection error</span>
            </div>
            <div class="git-status-message">${FormattingUtils.escapeHtml(error.message || 'Unknown error')}</div>
        `;
        notifications.error('Failed to check git status. Please try again.');
        
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="git-branch"></i>';
        if (window.lucide) lucide.createIcons();
    }
}

/**
 * Handles preview action button clicks via delegation
 */
async function handlePreviewAction(e) {
    console.log('Preview action clicked', e.target);
    const startBtn = e.target.closest('.start-preview-btn');
    const stopBtn = e.target.closest('.stop-preview-btn');
    
    if (!startBtn && !stopBtn) {
        console.log('No start or stop button found in click path');
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const btn = startBtn || stopBtn;
    const clientFolder = btn.dataset.clientFolder;
    const clientCard = btn.closest('.client-card');
    const clientName = clientCard ? clientCard.dataset.clientName : 'Unknown';
    
    console.log(`Action: ${startBtn ? 'Start' : 'Stop'}, Client: ${clientName}, Folder: ${clientFolder}`);
    
    try {
        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<span class="spinner-sm"></span> ${startBtn ? 'Starting...' : 'Stopping...'}`;
        
        if (startBtn) {
            await api.post('/previews/start', { clientFolder });
            notifications.success(`Started preview for ${clientName}`);
        } else {
            await api.post('/previews/stop', { clientFolder });
            notifications.success(`Stopped preview for ${clientName}`);
        }
        
        // Immediate refresh of previews
        const previews = await api.get('/previews');
        activePreviews = previews || [];
        applyFiltersAndRender();
        
    } catch (error) {
        notifications.error(`Failed to ${startBtn ? 'start' : 'stop'} preview: ${error.message}`);
        console.error('Preview action error:', error);
        
        // Reset button state on error
        btn.disabled = false;
        btn.innerHTML = startBtn ? `<i data-lucide="play"></i> Start Preview` : `<i data-lucide="square"></i> Stop`;
        if (window.lucide) lucide.createIcons();
    }
}

// ============================================
// ADD CLIENT MODAL
// ============================================

let selectedFiles = [];
let currentAddTab = 'github';

function openAddClientModal() {
    const modal = document.getElementById('addClientModal');
    if (!modal) return;
    
    // Reset form
    document.getElementById('githubRepoUrl').value = '';
    document.getElementById('clientFolderName').value = '';
    document.getElementById('githubToken').value = '';
    document.getElementById('uploadFolderName').value = '';
    selectedFiles = [];
    updateSelectedFilesDisplay();
    
    // Reset to github tab
    switchAddClientTab('github');
    
    modal.classList.add('show');
    modal.classList.remove('hidden');
    
    // Initialize icons
    if (window.lucide) lucide.createIcons();
    
    // Setup event listeners
    setupAddClientModalListeners();
}

function closeAddClientModal() {
    const modal = document.getElementById('addClientModal');
    if (!modal) return;
    
    modal.classList.remove('show');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function setupAddClientModalListeners() {
    // Prevent duplicate listener registration
    if (addClientModalListenersSetup) {
        return;
    }
    addClientModalListenersSetup = true;
    
    // Close buttons
    document.getElementById('closeAddClientModal')?.addEventListener('click', closeAddClientModal);
    document.getElementById('cancelAddClientBtn')?.addEventListener('click', closeAddClientModal);
    
    // Tab switching - use onclick (single handler) instead of addEventListener
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.onclick = () => switchAddClientTab(tab.dataset.tab);
    });
    
    // Upload zone
    const uploadZone = document.getElementById('uploadZone');
    const folderInput = document.getElementById('folderInput');
    
    if (uploadZone && folderInput) {
        uploadZone.onclick = () => folderInput.click();
        
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });
        
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('drag-over');
        });
        
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            handleFileSelection(e.dataTransfer.files);
        });
        
        folderInput.onchange = (e) => {
            handleFileSelection(e.target.files);
        };
    }
    
    // Submit button
    document.getElementById('submitAddClientBtn')?.addEventListener('click', submitAddClient);
}

function switchAddClientTab(tabName) {
    currentAddTab = tabName;
    
    // Update tab buttons
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    
    // Update tab content
    document.getElementById('githubTab')?.classList.toggle('active', tabName === 'github');
    document.getElementById('uploadTab')?.classList.toggle('active', tabName === 'upload');
}

function handleFileSelection(files) {
    selectedFiles = Array.from(files);
    updateSelectedFilesDisplay();
    
    // Try to extract folder name from first file path
    if (selectedFiles.length > 0) {
        const firstPath = selectedFiles[0].webkitRelativePath || selectedFiles[0].name;
        const folderName = firstPath.split('/')[0];
        const uploadFolderInput = document.getElementById('uploadFolderName');
        if (uploadFolderInput && !uploadFolderInput.value) {
            uploadFolderInput.value = folderName;
        }
    }
}

function updateSelectedFilesDisplay() {
    const container = document.getElementById('selectedFiles');
    const list = document.getElementById('fileList');
    
    if (!container || !list) return;
    
    if (selectedFiles.length === 0) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    
    // Show first 20 files
    const displayFiles = selectedFiles.slice(0, 20);
    list.innerHTML = displayFiles.map(file => {
        const path = file.webkitRelativePath || file.name;
        return `<li><i data-lucide="file"></i> ${FormattingUtils.escapeHtml(path)}</li>`;
    }).join('');
    
    if (selectedFiles.length > 20) {
        list.innerHTML += `<li style="color: var(--text-hint);">... and ${selectedFiles.length - 20} more files</li>`;
    }
    
    if (window.lucide) lucide.createIcons();
}

async function submitAddClient() {
    const submitBtn = document.getElementById('submitAddClientBtn');
    const originalHtml = submitBtn.innerHTML;
    
    try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-sm"></span> Adding...';
        
        if (currentAddTab === 'github') {
            await submitGitHubClone();
        } else {
            await submitFolderUpload();
        }
        
        closeAddClientModal();
        loadClients({ showNotification: true });
        
    } catch (error) {
        console.error('Add client error:', error);
        notifications.error(error.message || 'Failed to add client');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
        if (window.lucide) lucide.createIcons();
    }
}

async function submitGitHubClone() {
    const repoUrl = document.getElementById('githubRepoUrl').value.trim();
    const folderName = document.getElementById('clientFolderName').value.trim();
    const token = document.getElementById('githubToken').value.trim();
    
    if (!repoUrl) {
        throw new Error('Please enter a GitHub repository URL');
    }
    
    const response = await api.post('/clients', {
        type: 'github',
        repoUrl,
        folderName: folderName || undefined,
        token: token || undefined
    });
    
    if (!response.success) {
        throw new Error(response.error || 'Failed to clone repository');
    }
    
    notifications.success(`Successfully added ${response.clientName}`);
}

async function submitFolderUpload() {
    const folderName = document.getElementById('uploadFolderName').value.trim();
    
    if (!folderName) {
        throw new Error('Please enter a folder name');
    }
    
    if (selectedFiles.length === 0) {
        throw new Error('Please select files to upload');
    }
    
    // Create FormData and upload files
    const formData = new FormData();
    formData.append('folderName', folderName);
    
    selectedFiles.forEach((file, index) => {
        const relativePath = file.webkitRelativePath || file.name;
        formData.append('files', file);
        formData.append(`paths[${index}]`, relativePath);
    });
    
    // Show progress
    const progressContainer = document.getElementById('uploadProgress');
    const progressBar = document.getElementById('uploadProgressBar');
    const statusText = document.getElementById('uploadStatus');
    
    if (progressContainer) {
        progressContainer.classList.remove('hidden');
        progressBar.style.width = '0%';
        statusText.textContent = 'Uploading files...';
    }
    
    // Use XMLHttpRequest for progress tracking
    const response = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable && progressBar) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = `${percent}%`;
                statusText.textContent = `Uploading... ${percent}%`;
            }
        });
        
        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    resolve(JSON.parse(xhr.responseText));
                } catch (e) {
                    reject(new Error('Invalid response from server'));
                }
            } else {
                try {
                    const error = JSON.parse(xhr.responseText);
                    reject(new Error(error.error || 'Upload failed'));
                } catch (e) {
                    reject(new Error(`Upload failed: ${xhr.statusText}`));
                }
            }
        });
        
        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
        
        xhr.open('POST', '/api/clients/upload');
        xhr.send(formData);
    });
    
    if (!response.success) {
        throw new Error(response.error || 'Failed to upload files');
    }
    
    notifications.success(`Successfully added ${response.clientName}`);
}

