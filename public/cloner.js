const form = document.getElementById('cloneForm');
const submitBtn = document.getElementById('submitBtn');
const testTokenBtn = document.getElementById('testTokenBtn');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const progressLog = document.getElementById('progressLog');
const resultSection = document.getElementById('resultSection');
const resultContent = document.getElementById('resultContent');
const tokenTestResult = document.getElementById('tokenTestResult');
const directoryInput = document.getElementById('directory');
const resolvedPathDisplay = document.getElementById('resolvedPath');
const timerText = document.getElementById('timerText');
const etcText = document.getElementById('etcText');

let currentOperationId = null;
let progressInterval = null;
let startTime = null;
let timerInterval = null;

// Update resolved path display
async function updateResolvedPath() {
    const targetPath = directoryInput.value || './repos';
    try {
        const data = await api.post('/git/resolve-path', { targetPath });
        resolvedPathDisplay.textContent = `📁 Full path: ${data.resolvedPath}`;
        resolvedPathDisplay.style.display = 'block';
    } catch (error) {
        resolvedPathDisplay.style.display = 'none';
    }
}

// Update path when directory input changes
directoryInput.addEventListener('input', updateResolvedPath);
directoryInput.addEventListener('blur', updateResolvedPath);

// Initial path update
const hasSession = !!localStorage.getItem('clickup_session_token');
if (hasSession) {
    updateResolvedPath();
}

startConnectionPolling();

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

// Test token functionality
testTokenBtn.addEventListener('click', async () => {
    const token = document.getElementById('token').value;
    
    if (!token) {
        showTokenTestResult('Please enter a token first', false);
        return;
    }

    testTokenBtn.disabled = true;
    testTokenBtn.textContent = 'Testing...';

    try {
        const data = await api.post('/git/test-token', { token });

        if (data.success) {
            showTokenTestResult(`✓ Token valid! Logged in as: ${data.username}${data.name ? ` (${data.name})` : ''}`, true);
        } else {
            showTokenTestResult(`✗ ${data.error || 'Invalid token'}`, false);
        }
    } catch (error) {
        showTokenTestResult(`✗ Error: ${error.message}`, false);
    } finally {
        testTokenBtn.disabled = false;
        testTokenBtn.textContent = 'Test Token';
    }
});

function showTokenTestResult(message, success) {
    tokenTestResult.textContent = message;
    tokenTestResult.className = `token-test-result ${success ? 'success' : 'error'}`;
    tokenTestResult.classList.remove('hidden');

    setTimeout(() => {
        tokenTestResult.classList.add('hidden');
    }, 5000);
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [hrs, mins, secs].map(v => v.toString().padStart(2, '0')).join(':');
}

function updateTimer() {
    if (!startTime) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    timerText.textContent = formatTime(elapsed);
}

// Form submission
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = {
        username: document.getElementById('username').value,
        token: document.getElementById('token').value,
        targetDir: document.getElementById('directory').value || './repos',
        options: {
            filter: document.getElementById('filter').value || undefined,
            includePrivate: document.getElementById('includePrivate').checked,
            useSSH: document.getElementById('useSSH').checked,
            updateExisting: document.getElementById('updateExisting').checked,
        }
    };

    // Reset UI
    submitBtn.disabled = true;
    submitBtn.textContent = 'Starting...';
    progressSection.classList.remove('hidden');
    resultSection.classList.add('hidden');
    progressLog.innerHTML = '';
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    
    // Reset Timer & ETC
    startTime = Date.now();
    timerText.textContent = '00:00:00';
    etcText.textContent = 'Calculating...';
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);

    try {
        const data = await api.post('/git/clone', formData);
        currentOperationId = data.operationId;

        // Start polling for progress
        startProgressPolling();
    } catch (error) {
        showError(error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Start Cloning';
    }
});

function startProgressPolling() {
    if (progressInterval) {
        clearInterval(progressInterval);
    }

    progressInterval = setInterval(async () => {
        try {
            const data = await api.get(`/git/progress/${currentOperationId}`);
            updateProgress(data);

            // Check if operation is complete
            if (data.status === 'completed' || data.status === 'error') {
                clearInterval(progressInterval);
                if (timerInterval) clearInterval(timerInterval);
                showResults(data);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Start Cloning';
                
                if (data.status === 'completed') {
                    etcText.textContent = 'Finished!';
                }
            }
        } catch (error) {
            console.error('Error fetching progress:', error);
        }
    }, 1000);
}

const progressHistory = [];

function updateProgress(progress) {
    if (!progress) return;

    // Store in history if it's a new repo or status change
    if (progressHistory.length === 0 || 
        progressHistory[progressHistory.length - 1].repoName !== progress.repoName || 
        progressHistory[progressHistory.length - 1].status !== progress.status) {
        
        // If the last one was "cloning" and now it's "success" for same repo, replace it
        if (progressHistory.length > 0 && 
            progressHistory[progressHistory.length - 1].repoName === progress.repoName && 
            progressHistory[progressHistory.length - 1].status === 'cloning' && 
            progress.status === 'success') {
            progressHistory[progressHistory.length - 1] = { ...progress };
        } else {
            progressHistory.push({ ...progress });
        }
    } else {
        // Just update the latest message
        progressHistory[progressHistory.length - 1].message = progress.message;
    }

    const total = progress.total || 1;
    const current = progress.current || 0;
    const percentage = Math.round((current / total) * 100);

    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `${percentage}%`;

    // Calculate ETC
    if (startTime && current > 0 && total > current) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = current / elapsed; // items per second
        const remaining = total - current;
        const etcSeconds = Math.round(remaining / rate);
        etcText.textContent = formatTime(etcSeconds);
    } else if (current > 0 && current === total) {
        etcText.textContent = 'Finished!';
    }

    // Update log
    progressLog.innerHTML = '';
    progressHistory.forEach((item) => {
        const logItem = document.createElement('div');
        logItem.className = `progress-log-item ${item.status}`;

        let icon = '⟳';
        if (item.status === 'success' || item.status === 'completed') icon = '✓';
        if (item.status === 'error') icon = '✗';

        logItem.innerHTML = `
            <span class="log-icon">${icon}</span>
            <span>[${item.current}/${item.total}]</span>
            <span><strong>${item.repoName}</strong></span>
            <span>${item.message || ''}</span>
        `;

        progressLog.appendChild(logItem);
    });

    // Scroll to bottom
    progressLog.scrollTop = progressLog.scrollHeight;
}

function showResults(lastProgress) {
    resultSection.classList.remove('hidden');
    
    if (lastProgress.status === 'error') {
        resultContent.className = 'result-content error';
        resultContent.textContent = `Error: ${lastProgress.message}`;
    } else {
        resultContent.className = 'result-content success';
        resultContent.innerHTML = `
            <strong>Operation Complete!</strong><br>
            ${lastProgress.message}
        `;
    }
}

function showError(message) {
    resultSection.classList.remove('hidden');
    resultContent.className = 'result-content error';
    resultContent.textContent = `Error: ${message}`;
}
