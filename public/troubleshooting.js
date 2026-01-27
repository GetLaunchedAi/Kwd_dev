document.addEventListener('DOMContentLoaded', async () => {
    // Initialize icons
    if (window.lucide) lucide.createIcons();
    
    // Theme toggle
    initTheme();

    // Theme toggle button
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

    // Initial connection check
    startConnectionPolling();

    // Reset session button
    const resetBtn = document.getElementById('resetSessionBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to clear the local progress state? This will stop the "Resuming progress" state on the Create Demo page and clear any active task statuses.')) {
                try {
                    // Clear local storage
                    localStorage.removeItem('activeDemoSlug');
                    
                    // Clear server status files
                    await api.post('/cursor/reset');
                    
                    notifications.show('Local session and task statuses cleared. You can now start a new demo build.', 'success');
                } catch (error) {
                    console.error('Error resetting session:', error);
                    notifications.show('Local session cleared, but failed to reset server-side status.', 'warning');
                }
            }
        });
    }
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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (connectionPollingInterval) {
        clearInterval(connectionPollingInterval);
        connectionPollingInterval = null;
    }
});

// Theme Management - Using centralized ThemeUtils from theme.js





