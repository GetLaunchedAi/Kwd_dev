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

let currentOperationId = null;
let progressInterval = null;

// Update resolved path display
async function updateResolvedPath() {
    const directory = directoryInput.value || './repos';
    try {
        const response = await fetch('/api/resolve-path', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ directory }),
        });
        const data = await response.json();
        resolvedPathDisplay.textContent = `📁 Full path: ${data.path}`;
        resolvedPathDisplay.style.display = 'block';
    } catch (error) {
        resolvedPathDisplay.style.display = 'none';
    }
}

// Update path when directory input changes
directoryInput.addEventListener('input', updateResolvedPath);
directoryInput.addEventListener('blur', updateResolvedPath);

// Initial path update
updateResolvedPath();

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
        const response = await fetch('/api/test-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (data.valid) {
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

// Form submission
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = {
        username: document.getElementById('username').value,
        token: document.getElementById('token').value,
        directory: document.getElementById('directory').value || './repos',
        filter: document.getElementById('filter').value || undefined,
        includePrivate: document.getElementById('includePrivate').checked,
        useSSH: document.getElementById('useSSH').checked,
        updateExisting: document.getElementById('updateExisting').checked,
    };

    // Reset UI
    submitBtn.disabled = true;
    submitBtn.textContent = 'Starting...';
    progressSection.classList.remove('hidden');
    resultSection.classList.add('hidden');
    progressLog.innerHTML = '';
    progressBar.style.width = '0%';
    progressText.textContent = '0%';

    try {

        const response = await fetch('/api/clone', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData),
        });


        if (!response.ok) {
            throw new Error('Failed to start cloning operation');
        }

        const data = await response.json();
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
            const response = await fetch(`/api/progress/${currentOperationId}`);
            const data = await response.json();

            updateProgress(data.progress);

            // Check if operation is complete
            const lastProgress = data.progress[data.progress.length - 1];
            if (lastProgress && (lastProgress.repoName === 'Complete' || lastProgress.repoName === 'Error')) {
                clearInterval(progressInterval);
                showResults(data.progress);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Start Cloning';
            }
        } catch (error) {
            console.error('Error fetching progress:', error);
        }
    }, 1000);
}

function updateProgress(progressArray) {
    if (!progressArray || progressArray.length === 0) return;

    const lastProgress = progressArray[progressArray.length - 1];
    const total = lastProgress.total || 1;
    const current = lastProgress.current || 0;
    const percentage = Math.round((current / total) * 100);

    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `${percentage}%`;

    // Update log
    progressLog.innerHTML = '';
    progressArray.forEach((item) => {
        const logItem = document.createElement('div');
        logItem.className = `progress-log-item ${item.status}`;

        let icon = '⟳';
        if (item.status === 'success') icon = '✓';
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

function showResults(progressArray) {
    resultSection.classList.remove('hidden');

    const lastProgress = progressArray[progressArray.length - 1];
    
    if (lastProgress.status === 'error' && lastProgress.repoName === 'Error') {
        resultContent.className = 'result-content error';
        resultContent.textContent = `Error: ${lastProgress.message}`;
    } else {
        const successCount = progressArray.filter(p => p.status === 'success' && p.repoName !== 'Complete').length;
        const errorCount = progressArray.filter(p => p.status === 'error').length;
        const total = lastProgress.total;

        resultContent.className = 'result-content success';
        resultContent.innerHTML = `
            <strong>Operation Complete!</strong><br>
            Total repositories: ${total}<br>
            Successfully cloned/updated: ${successCount}<br>
            ${errorCount > 0 ? `Failed: ${errorCount}` : 'All repositories processed successfully!'}
        `;
    }
}

function showError(message) {
    resultSection.classList.remove('hidden');
    resultContent.className = 'result-content error';
    resultContent.textContent = `Error: ${message}`;
}


