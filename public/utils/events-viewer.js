/**
 * EventsViewer - Live events.ndjson viewer with formatted and raw JSON views
 * 
 * Features:
 * - SSE streaming for real-time updates
 * - Formatted view with collapsible thinking blocks and tool calls
 * - Raw JSON view with syntax highlighting
 * - Event type filtering
 * - Auto-scroll with toggle
 * - Connection status indicator
 */

class EventsViewer {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            showControls: true,
            autoScroll: true,
            maxEvents: 1000,
            defaultView: 'formatted', // 'formatted' | 'raw'
            ...options
        };
        
        this.events = [];
        this.eventSource = null;
        this.taskId = null;
        this.viewMode = this.options.defaultView;
        this.filterType = 'all';
        this.autoScroll = this.options.autoScroll;
        this.lastLineNumber = 0;
        this.isConnected = false;
        
        this._init();
    }
    
    _init() {
        if (!this.container) {
            console.error('EventsViewer: Container not found');
            return;
        }
        
        // Create the viewer structure
        this.container.innerHTML = `
            <div class="events-viewer">
                <div class="events-viewer-controls">
                    <div class="events-viewer-left">
                        <div class="connection-status">
                            <span class="connection-dot disconnected"></span>
                            <span class="connection-text">Disconnected</span>
                        </div>
                        <span class="event-counter">0 events</span>
                    </div>
                    <div class="events-viewer-right">
                        <div class="view-toggle">
                            <button class="view-btn active" data-view="formatted">Formatted</button>
                            <button class="view-btn" data-view="raw">Raw JSON</button>
                        </div>
                        <select class="event-filter">
                            <option value="all">All Events</option>
                            <option value="thinking">Thinking</option>
                            <option value="tool_call">Tool Calls</option>
                            <option value="tool_result">Tool Results</option>
                            <option value="system">System</option>
                            <option value="user">User</option>
                            <option value="error">Errors</option>
                        </select>
                        <label class="auto-scroll-toggle">
                            <input type="checkbox" checked>
                            <span>Auto-scroll</span>
                        </label>
                    </div>
                </div>
                <div class="events-content">
                    <div class="events-list"></div>
                </div>
            </div>
        `;
        
        // Cache DOM references
        this.connectionDot = this.container.querySelector('.connection-dot');
        this.connectionText = this.container.querySelector('.connection-text');
        this.eventCounter = this.container.querySelector('.event-counter');
        this.eventsList = this.container.querySelector('.events-list');
        this.eventsContent = this.container.querySelector('.events-content');
        
        // Setup event listeners
        this._setupEventListeners();
    }
    
    _setupEventListeners() {
        // View mode toggle
        this.container.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setViewMode(btn.dataset.view);
            });
        });
        
        // Filter dropdown
        const filterSelect = this.container.querySelector('.event-filter');
        filterSelect?.addEventListener('change', (e) => {
            this.setFilter(e.target.value);
        });
        
        // Auto-scroll toggle
        const autoScrollCheckbox = this.container.querySelector('.auto-scroll-toggle input');
        autoScrollCheckbox?.addEventListener('change', (e) => {
            this.autoScroll = e.target.checked;
        });
        
        // Manual scroll detection - disable auto-scroll if user scrolls up
        this.eventsContent?.addEventListener('scroll', () => {
            if (!this.autoScroll) return;
            const { scrollTop, scrollHeight, clientHeight } = this.eventsContent;
            // If user scrolled up more than 100px from bottom, disable auto-scroll
            if (scrollHeight - scrollTop - clientHeight > 100) {
                this.autoScroll = false;
                const checkbox = this.container.querySelector('.auto-scroll-toggle input');
                if (checkbox) checkbox.checked = false;
            }
        });
    }
    
    /**
     * Connect to a task's event stream
     */
    connect(taskId, fromLine = 0) {
        if (this.eventSource) {
            this.disconnect();
        }
        
        this.taskId = taskId;
        this.lastLineNumber = fromLine;
        this.events = [];
        this._updateUI();
        
        const url = `/api/tasks/${taskId}/events/stream?from=${fromLine}`;
        
        this._setConnectionStatus('connecting');
        
        this.eventSource = new EventSource(url);
        
        this.eventSource.addEventListener('connected', (e) => {
            const data = JSON.parse(e.data);
            this._setConnectionStatus('connected');
            console.log('EventsViewer: Connected to', taskId, data);
        });
        
        this.eventSource.addEventListener('batch', (e) => {
            const data = JSON.parse(e.data);
            if (data.events && data.events.length > 0) {
                this._addEvents(data.events);
                this.lastLineNumber = data.totalLines;
            }
        });
        
        this.eventSource.addEventListener('status', (e) => {
            const status = JSON.parse(e.data);
            this._updateStatus(status);
        });
        
        this.eventSource.addEventListener('complete', (e) => {
            const data = JSON.parse(e.data);
            this._onComplete(data);
        });
        
        this.eventSource.addEventListener('error', (e) => {
            console.error('EventsViewer: SSE error', e);
            this._setConnectionStatus('error');
            
            // Try to reconnect after 3 seconds
            setTimeout(() => {
                if (this.taskId === taskId) {
                    this.connect(taskId, this.lastLineNumber);
                }
            }, 3000);
        });
        
        this.eventSource.onerror = () => {
            this._setConnectionStatus('disconnected');
        };
    }
    
    /**
     * Disconnect from the event stream
     */
    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.taskId = null;
        this._setConnectionStatus('disconnected');
    }
    
    /**
     * Set view mode (formatted or raw)
     */
    setViewMode(mode) {
        this.viewMode = mode;
        
        // Update button states
        this.container.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === mode);
        });
        
        // Re-render all events
        this._renderEvents();
    }
    
    /**
     * Set event type filter
     */
    setFilter(type) {
        this.filterType = type;
        this._renderEvents();
    }
    
    /**
     * Clear all events
     */
    clear() {
        this.events = [];
        this.lastLineNumber = 0;
        this._updateUI();
    }
    
    /**
     * Get current events
     */
    getEvents() {
        return this.events;
    }
    
    // ============================================
    // Private Methods
    // ============================================
    
    _addEvents(newEvents) {
        // Add new events
        this.events.push(...newEvents);
        
        // Trim if exceeding max
        if (this.events.length > this.options.maxEvents) {
            this.events = this.events.slice(-this.options.maxEvents);
        }
        
        // Render and update
        this._renderEvents();
        this._updateEventCounter();
        
        // Auto-scroll
        if (this.autoScroll) {
            this._scrollToBottom();
        }
    }
    
    _renderEvents() {
        if (!this.eventsList) return;
        
        // Filter events
        const filtered = this.filterType === 'all' 
            ? this.events 
            : this.events.filter(e => this._getEventType(e) === this.filterType);
        
        // Render based on view mode
        if (this.viewMode === 'raw') {
            this.eventsList.innerHTML = filtered.map(e => this._renderRawEvent(e)).join('');
        } else {
            this.eventsList.innerHTML = filtered.map(e => this._renderFormattedEvent(e)).join('');
        }
        
        // Re-initialize collapsible sections
        this._setupCollapsibles();
    }
    
    _renderFormattedEvent(event) {
        const type = this._getEventType(event);
        const time = this._formatTime(event.timestamp);
        const typeClass = `event-type-${type}`;
        
        let content = '';
        
        switch (type) {
            case 'thinking':
                content = this._renderThinkingEvent(event);
                break;
            case 'tool_call':
                content = this._renderToolCallEvent(event);
                break;
            case 'tool_result':
                content = this._renderToolResultEvent(event);
                break;
            case 'system':
                content = this._renderSystemEvent(event);
                break;
            case 'user':
                content = this._renderUserEvent(event);
                break;
            case 'error':
                content = this._renderErrorEvent(event);
                break;
            default:
                content = this._renderGenericEvent(event);
        }
        
        return `
            <div class="event-item ${typeClass}" data-line="${event.lineNumber}">
                <div class="event-header">
                    <span class="event-badge ${type}">${this._formatTypeBadge(type)}</span>
                    <span class="event-time">${time}</span>
                </div>
                <div class="event-body">
                    ${content}
                </div>
            </div>
        `;
    }
    
    _renderThinkingEvent(event) {
        const text = event.thinking || event.content || event.line || '';
        const preview = this._truncate(text, 100);
        const isLong = text.length > 100;
        
        return `
            <div class="thinking-content ${isLong ? 'collapsible collapsed' : ''}">
                ${isLong ? `<div class="thinking-preview">${this._escapeHtml(preview)}</div>` : ''}
                <div class="thinking-full ${isLong ? 'hidden' : ''}">${this._escapeHtml(text)}</div>
                ${isLong ? '<button class="collapse-toggle">Show more</button>' : ''}
            </div>
        `;
    }
    
    _renderToolCallEvent(event) {
        const name = event.tool || event.name || 'Unknown Tool';
        const args = event.args || event.parameters || event.input || {};
        
        return `
            <div class="tool-call-content">
                <div class="tool-name">${this._escapeHtml(name)}</div>
                ${Object.keys(args).length > 0 ? `
                    <div class="tool-args collapsible collapsed">
                        <button class="collapse-toggle">Show arguments</button>
                        <pre class="tool-args-code hidden">${this._syntaxHighlight(JSON.stringify(args, null, 2))}</pre>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    _renderToolResultEvent(event) {
        const success = event.success !== false && !event.error;
        const result = event.result || event.output || event.content || '';
        const preview = this._truncate(String(result), 200);
        const isLong = String(result).length > 200;
        
        return `
            <div class="tool-result-content ${success ? 'success' : 'failure'}">
                <span class="result-indicator">${success ? '✓' : '✗'}</span>
                <div class="result-body ${isLong ? 'collapsible collapsed' : ''}">
                    ${isLong ? `<div class="result-preview">${this._escapeHtml(preview)}</div>` : ''}
                    <div class="result-full ${isLong ? 'hidden' : ''}">${this._escapeHtml(String(result))}</div>
                    ${isLong ? '<button class="collapse-toggle">Show full result</button>' : ''}
                </div>
            </div>
        `;
    }
    
    _renderSystemEvent(event) {
        const message = event.message || event.content || event.line || '';
        return `<div class="system-message">${this._escapeHtml(message)}</div>`;
    }
    
    _renderUserEvent(event) {
        const message = event.message || event.content || event.line || '';
        return `<div class="user-message">${this._escapeHtml(message)}</div>`;
    }
    
    _renderErrorEvent(event) {
        const error = event.error || event.message || event.content || event.line || 'Unknown error';
        return `<div class="error-message">${this._escapeHtml(error)}</div>`;
    }
    
    _renderGenericEvent(event) {
        const line = event.line || event.content || event.message || '';
        return `<div class="generic-message">${this._escapeHtml(line)}</div>`;
    }
    
    _renderRawEvent(event) {
        const json = JSON.stringify(event, null, 2);
        return `
            <div class="event-item raw-event" data-line="${event.lineNumber}">
                <pre class="raw-json">${this._syntaxHighlight(json)}</pre>
            </div>
        `;
    }
    
    _setupCollapsibles() {
        this.eventsList.querySelectorAll('.collapse-toggle').forEach(btn => {
            if (btn.hasListener) return;
            btn.hasListener = true;
            
            btn.addEventListener('click', (e) => {
                const container = e.target.closest('.collapsible');
                if (!container) return;
                
                const isCollapsed = container.classList.contains('collapsed');
                container.classList.toggle('collapsed', !isCollapsed);
                
                const hiddenEl = container.querySelector('.hidden, .thinking-full, .tool-args-code, .result-full');
                if (hiddenEl) {
                    hiddenEl.classList.toggle('hidden', isCollapsed);
                }
                
                const previewEl = container.querySelector('.thinking-preview, .result-preview');
                if (previewEl) {
                    previewEl.classList.toggle('hidden', !isCollapsed);
                }
                
                btn.textContent = isCollapsed ? 'Show less' : (btn.textContent.includes('argument') ? 'Show arguments' : 'Show more');
            });
        });
    }
    
    _getEventType(event) {
        // Try to infer event type from various properties
        if (event.type) return event.type;
        if (event.thinking) return 'thinking';
        if (event.tool || event.tool_call) return 'tool_call';
        if (event.tool_result || event.result !== undefined) return 'tool_result';
        if (event.error) return 'error';
        if (event.system) return 'system';
        if (event.user) return 'user';
        
        // Check content for clues
        const content = event.line || event.content || event.message || '';
        if (typeof content === 'string') {
            const lower = content.toLowerCase();
            if (lower.includes('error') || lower.includes('failed') || lower.includes('exception')) return 'error';
            if (lower.includes('thinking') || lower.includes('analyzing')) return 'thinking';
        }
        
        return 'system';
    }
    
    _formatTypeBadge(type) {
        const badges = {
            'thinking': '💭 Thinking',
            'tool_call': '🔧 Tool Call',
            'tool_result': '📤 Result',
            'system': '⚙️ System',
            'user': '👤 User',
            'error': '❌ Error'
        };
        return badges[type] || type;
    }
    
    _formatTime(timestamp) {
        if (!timestamp) return '';
        try {
            const date = new Date(timestamp);
            return date.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit',
                hour12: false 
            });
        } catch {
            return '';
        }
    }
    
    _truncate(str, maxLen) {
        if (!str || str.length <= maxLen) return str;
        return str.substring(0, maxLen) + '...';
    }
    
    _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    _syntaxHighlight(json) {
        if (!json) return '';
        return json
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
                let cls = 'json-number';
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'json-key';
                    } else {
                        cls = 'json-string';
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'json-boolean';
                } else if (/null/.test(match)) {
                    cls = 'json-null';
                }
                return `<span class="${cls}">${match}</span>`;
            });
    }
    
    _setConnectionStatus(status) {
        this.isConnected = status === 'connected';
        
        if (this.connectionDot) {
            this.connectionDot.className = `connection-dot ${status}`;
        }
        if (this.connectionText) {
            const texts = {
                'connected': 'Live',
                'connecting': 'Connecting...',
                'disconnected': 'Disconnected',
                'error': 'Connection Error'
            };
            this.connectionText.textContent = texts[status] || status;
        }
    }
    
    _updateEventCounter() {
        if (this.eventCounter) {
            const count = this.events.length;
            this.eventCounter.textContent = `${count} event${count !== 1 ? 's' : ''}`;
        }
    }
    
    _updateUI() {
        this._renderEvents();
        this._updateEventCounter();
    }
    
    _updateStatus(status) {
        // Could emit an event or update UI based on task status
        if (this.options.onStatusUpdate) {
            this.options.onStatusUpdate(status);
        }
    }
    
    _onComplete(data) {
        this._setConnectionStatus('disconnected');
        if (this.options.onComplete) {
            this.options.onComplete(data);
        }
    }
    
    _scrollToBottom() {
        if (this.eventsContent) {
            this.eventsContent.scrollTop = this.eventsContent.scrollHeight;
        }
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.EventsViewer = EventsViewer;
}
