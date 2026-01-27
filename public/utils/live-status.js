/**
 * LiveStatusManager - Unified live updates + status header component
 * 
 * Shared contract for demo status states:
 * - idle: No activity
 * - starting: Reserving project
 * - cloning: Cloning template
 * - installing: Installing dependencies  
 * - organizing: Organizing assets
 * - prompting: Preparing AI prompts
 * - triggering: Initializing AI agent
 * - running: AI agent actively working
 * - testing: Running tests
 * - awaiting_approval: Step complete, waiting for user review
 * - completed: All steps done
 * - failed: Error occurred
 * - publishing: Creating repo, setting remote, pushing (new)
 * - published: Repo created + push success (new)
 * - rejected: Demo rejected (brief, before deletion) (new)
 * - revision_queued: Revision task queued (new)
 * - revision_running: Revision agent running (new)
 * 
 * API Endpoints used:
 * - GET /api/demo/status/:slug - Demo status polling
 * - GET /api/tasks/:taskId/events/stream - SSE event stream
 * - GET /api/health - Server health check
 */

class LiveStatusManager {
    constructor(options = {}) {
        this.options = {
            pollInterval: 5000,         // Polling interval in ms
            staleThreshold: 30000,      // Consider data stale after 30s
            sseReconnectDelay: 3000,    // SSE reconnect delay
            maxRetries: 3,              // Max polling retries
            preferSSE: true,            // Prefer SSE over polling
            ...options
        };
        
        this.eventSource = null;
        this.pollInterval = null;
        this.lastUpdate = null;
        this.isConnected = false;
        this.connectionMode = 'none'; // 'sse' | 'polling' | 'none'
        this.statusCallbacks = new Set();
        this.connectionCallbacks = new Set();
        this.staleCheckInterval = null;
        this.retryCount = 0;
        this.currentTarget = null; // { type: 'demo'|'task', id: string }
    }

    /**
     * Register a status update callback
     */
    onStatusUpdate(callback) {
        this.statusCallbacks.add(callback);
        return () => this.statusCallbacks.delete(callback);
    }

    /**
     * Register a connection status callback
     */
    onConnectionChange(callback) {
        this.connectionCallbacks.add(callback);
        return () => this.connectionCallbacks.delete(callback);
    }

    /**
     * Start monitoring a demo
     */
    connectToDemo(slug) {
        this.disconnect();
        this.currentTarget = { type: 'demo', id: slug };
        
        if (this.options.preferSSE) {
            this._trySSE(`demo-${slug}`);
        } else {
            this._startPolling();
        }
        
        this._startStaleCheck();
    }

    /**
     * Start monitoring a task
     */
    connectToTask(taskId) {
        this.disconnect();
        this.currentTarget = { type: 'task', id: taskId };
        
        if (this.options.preferSSE) {
            this._trySSE(taskId);
        } else {
            this._startPolling();
        }
        
        this._startStaleCheck();
    }

    /**
     * Disconnect from all streams
     */
    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        if (this.staleCheckInterval) {
            clearInterval(this.staleCheckInterval);
            this.staleCheckInterval = null;
        }
        
        this.currentTarget = null;
        this.connectionMode = 'none';
        this._notifyConnectionChange('disconnected');
    }

    /**
     * Toggle live updates on/off
     */
    setLiveUpdates(enabled) {
        if (enabled && this.currentTarget) {
            if (this.currentTarget.type === 'demo') {
                this.connectToDemo(this.currentTarget.id);
            } else {
                this.connectToTask(this.currentTarget.id);
            }
        } else {
            this.disconnect();
        }
    }

    /**
     * Force refresh current status
     */
    async refresh() {
        if (!this.currentTarget) return null;
        
        try {
            const status = await this._fetchStatus();
            this._notifyStatus(status);
            return status;
        } catch (err) {
            console.error('LiveStatusManager: refresh failed', err);
            return null;
        }
    }

    /**
     * Check if data is stale
     */
    isStale() {
        if (!this.lastUpdate) return true;
        return Date.now() - this.lastUpdate > this.options.staleThreshold;
    }

    /**
     * Get current connection info
     */
    getConnectionInfo() {
        return {
            isConnected: this.isConnected,
            mode: this.connectionMode,
            isStale: this.isStale(),
            lastUpdate: this.lastUpdate,
            target: this.currentTarget
        };
    }

    // ============================================
    // Private Methods
    // ============================================

    _trySSE(taskId) {
        this._notifyConnectionChange('connecting');
        
        const url = `/api/tasks/${taskId}/events/stream`;
        this.eventSource = new EventSource(url);
        
        this.eventSource.addEventListener('connected', (e) => {
            this.isConnected = true;
            this.connectionMode = 'sse';
            this.retryCount = 0;
            this._notifyConnectionChange('connected');
        });
        
        this.eventSource.addEventListener('batch', (e) => {
            try {
                const data = JSON.parse(e.data);
                this.lastUpdate = Date.now();
                if (data.events?.length > 0) {
                    this._notifyStatus({ events: data.events, totalLines: data.totalLines });
                }
            } catch (err) {
                console.error('LiveStatusManager: SSE batch parse error', err);
            }
        });
        
        this.eventSource.addEventListener('status', (e) => {
            try {
                const status = JSON.parse(e.data);
                this.lastUpdate = Date.now();
                this._notifyStatus(status);
            } catch (err) {
                console.error('LiveStatusManager: SSE status parse error', err);
            }
        });
        
        this.eventSource.addEventListener('complete', (e) => {
            try {
                const data = JSON.parse(e.data);
                this._notifyStatus({ ...data, complete: true });
            } catch (err) {
                console.error('LiveStatusManager: SSE complete parse error', err);
            }
        });
        
        this.eventSource.onerror = () => {
            console.warn('LiveStatusManager: SSE error, falling back to polling');
            this.eventSource?.close();
            this.eventSource = null;
            this._notifyConnectionChange('disconnected');
            
            // Fall back to polling
            setTimeout(() => {
                if (this.currentTarget) {
                    this._startPolling();
                }
            }, this.options.sseReconnectDelay);
        };
    }

    _startPolling() {
        if (this.pollInterval) return;
        
        this.connectionMode = 'polling';
        this._notifyConnectionChange('connecting');
        
        // Initial fetch
        this._pollOnce();
        
        // Setup interval
        this.pollInterval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                this._pollOnce();
            }
        }, this.options.pollInterval);
    }

    async _pollOnce() {
        try {
            const status = await this._fetchStatus();
            this.isConnected = true;
            this.lastUpdate = Date.now();
            this.retryCount = 0;
            this._notifyConnectionChange('connected');
            this._notifyStatus(status);
        } catch (err) {
            this.retryCount++;
            console.error('LiveStatusManager: poll error', err);
            
            if (this.retryCount >= this.options.maxRetries) {
                this._notifyConnectionChange('error');
            }
        }
    }

    async _fetchStatus() {
        if (!this.currentTarget) throw new Error('No target set');
        
        const { type, id } = this.currentTarget;
        const endpoint = type === 'demo' 
            ? `/api/demo/status/${id}`
            : `/api/tasks/${id}/status`;
        
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    }

    _startStaleCheck() {
        if (this.staleCheckInterval) return;
        
        this.staleCheckInterval = setInterval(() => {
            if (this.isStale() && this.isConnected) {
                this._notifyConnectionChange('stale');
            }
        }, 5000);
    }

    _notifyStatus(status) {
        this.statusCallbacks.forEach(cb => {
            try {
                cb(status);
            } catch (err) {
                console.error('LiveStatusManager: status callback error', err);
            }
        });
    }

    _notifyConnectionChange(status) {
        const info = {
            status,
            mode: this.connectionMode,
            isStale: this.isStale(),
            lastUpdate: this.lastUpdate
        };
        
        this.connectionCallbacks.forEach(cb => {
            try {
                cb(info);
            } catch (err) {
                console.error('LiveStatusManager: connection callback error', err);
            }
        });
    }
}

/**
 * StatusHeader - Renders a unified status header component
 * 
 * Usage:
 *   const header = new StatusHeader('statusHeaderContainer', {
 *       onToggleLive: (enabled) => { ... },
 *       onRefresh: () => { ... }
 *   });
 *   header.update({ state: 'running', lastUpdate: Date.now() });
 */
class StatusHeader {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            showLiveToggle: true,
            showRefreshButton: true,
            showLastUpdate: true,
            ...options
        };
        
        this.isLive = true;
        this._render();
        this._setupEventListeners();
    }

    _render() {
        if (!this.container) return;
        
        this.container.innerHTML = `
            <div class="status-header-component">
                <div class="status-header-left">
                    <div class="connection-indicator">
                        <span class="connection-dot" data-status="disconnected"></span>
                        <span class="connection-label">Offline</span>
                    </div>
                    <div class="state-badge-wrapper">
                        <span class="state-badge" data-state="unknown">Unknown</span>
                    </div>
                </div>
                <div class="status-header-right">
                    ${this.options.showLastUpdate ? `
                        <div class="last-update-wrapper">
                            <span class="last-update-label">Updated:</span>
                            <span class="last-update-time">-</span>
                            <span class="stale-indicator hidden" title="Data may be outdated">⚠️</span>
                        </div>
                    ` : ''}
                    ${this.options.showLiveToggle ? `
                        <label class="live-toggle">
                            <input type="checkbox" checked class="live-toggle-input">
                            <span class="live-toggle-slider"></span>
                            <span class="live-toggle-label">Live</span>
                        </label>
                    ` : ''}
                    ${this.options.showRefreshButton ? `
                        <button class="status-refresh-btn btn btn-secondary btn-sm" title="Refresh">
                            <i data-lucide="refresh-cw"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        
        // Initialize Lucide icons if available
        if (window.lucide) lucide.createIcons();
    }

    _setupEventListeners() {
        const liveToggle = this.container?.querySelector('.live-toggle-input');
        const refreshBtn = this.container?.querySelector('.status-refresh-btn');
        
        liveToggle?.addEventListener('change', (e) => {
            this.isLive = e.target.checked;
            this._updateLiveToggleUI();
            if (this.options.onToggleLive) {
                this.options.onToggleLive(this.isLive);
            }
        });
        
        refreshBtn?.addEventListener('click', () => {
            if (this.options.onRefresh) {
                this.options.onRefresh();
            }
        });
    }

    /**
     * Update the header with new status data
     */
    update(data) {
        if (!this.container) return;
        
        // Update connection indicator
        const connDot = this.container.querySelector('.connection-dot');
        const connLabel = this.container.querySelector('.connection-label');
        if (connDot && data.connectionStatus) {
            connDot.dataset.status = data.connectionStatus;
            const labels = {
                connected: 'Live',
                connecting: 'Connecting...',
                disconnected: 'Offline',
                error: 'Error',
                stale: 'Stale'
            };
            if (connLabel) connLabel.textContent = labels[data.connectionStatus] || 'Unknown';
        }
        
        // Update state badge
        const stateBadge = this.container.querySelector('.state-badge');
        if (stateBadge && data.state) {
            stateBadge.dataset.state = data.state;
            stateBadge.textContent = this._formatState(data.state);
        }
        
        // Update last update time
        const lastUpdateTime = this.container.querySelector('.last-update-time');
        const staleIndicator = this.container.querySelector('.stale-indicator');
        if (lastUpdateTime && data.lastUpdate) {
            lastUpdateTime.textContent = this._formatRelativeTime(data.lastUpdate);
        }
        if (staleIndicator) {
            staleIndicator.classList.toggle('hidden', !data.isStale);
        }
    }

    /**
     * Set live toggle state
     */
    setLive(enabled) {
        this.isLive = enabled;
        const toggle = this.container?.querySelector('.live-toggle-input');
        if (toggle) toggle.checked = enabled;
        this._updateLiveToggleUI();
    }

    _updateLiveToggleUI() {
        const label = this.container?.querySelector('.live-toggle-label');
        if (label) {
            label.textContent = this.isLive ? 'Live' : 'Paused';
        }
    }

    _formatState(state) {
        const stateLabels = {
            idle: 'Idle',
            starting: 'Starting',
            cloning: 'Cloning',
            installing: 'Installing',
            organizing: 'Organizing',
            prompting: 'Preparing',
            triggering: 'Triggering',
            running: 'Running',
            testing: 'Testing',
            awaiting_approval: 'Awaiting Approval',
            completed: 'Completed',
            failed: 'Failed',
            publishing: 'Publishing',
            published: 'Published',
            rejected: 'Rejected',
            revision_queued: 'Revision Queued',
            revision_running: 'Revision Running'
        };
        return stateLabels[state] || state.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    _formatRelativeTime(timestamp) {
        if (!timestamp) return '-';
        const now = Date.now();
        const diff = now - timestamp;
        
        if (diff < 5000) return 'Just now';
        if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        return new Date(timestamp).toLocaleTimeString();
    }
}

// Export to window for global access
if (typeof window !== 'undefined') {
    window.LiveStatusManager = LiveStatusManager;
    window.StatusHeader = StatusHeader;
}
