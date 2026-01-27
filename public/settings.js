document.addEventListener('DOMContentLoaded', async () => {
    // Initialize icons
    if (window.lucide) lucide.createIcons();
    
    // Theme toggle
    initTheme();

    const form = document.getElementById('settingsForm');
    const sessionDurationInput = document.getElementById('sessionDuration');
    const enableEmailNotificationsInput = document.getElementById('enableEmailNotifications');
    const gitUserNameInput = document.getElementById('gitUserName');
    const gitUserEmailInput = document.getElementById('gitUserEmail');
    const saveBtn = document.getElementById('saveBtn');
    const defaultModelSelect = document.getElementById('defaultModel');
    const modelList = document.getElementById('modelList');
    const newModelInput = document.getElementById('newModelInput');
    const addModelBtn = document.getElementById('addModelBtn');
    const resetModelsBtn = document.getElementById('resetModelsBtn');
    const refreshModelsBtn = document.getElementById('refreshModelsBtn');
    const modelSuggestionsDropdown = document.getElementById('modelSuggestionsDropdown');
    const modelValidation = document.getElementById('modelValidation');
    const knownModelsCount = document.getElementById('knownModelsCount');
    
    // GitHub Org elements
    const githubOrgInput = document.getElementById('githubOrg');
    const githubOrgValidation = document.getElementById('githubOrgValidation');
    const githubServerWarning = document.getElementById('githubServerWarning');

    // Netlify elements
    const netlifyAccountSlugInput = document.getElementById('netlifyAccountSlug');
    const netlifyBuildCommandInput = document.getElementById('netlifyBuildCommand');
    const netlifyPublishDirInput = document.getElementById('netlifyPublishDir');
    const netlifyOauthConfiguredInput = document.getElementById('netlifyOauthConfigured');
    const netlifyTokenStatus = document.getElementById('netlifyTokenStatus');
    const netlifyOauthWarning = document.getElementById('netlifyOauthWarning');
    const testNetlifyBtn = document.getElementById('testNetlifyBtn');
    const netlifyTestResult = document.getElementById('netlifyTestResult');

    let availableModels = [];
    let defaultModels = [];
    let knownModels = []; // All known Cursor-supported models for autocomplete
    let selectedSuggestionIndex = -1; // For keyboard navigation

    startConnectionPolling();

    // Theme toggle button
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

    // Load known models for autocomplete
    await loadKnownModels();

    const smtpWarning = document.getElementById('smtpWarning');
    let smtpConfigured = false;

    // Load current settings and models (no authentication required)
    try {
        const settings = await api.get('/settings');
        sessionDurationInput.value = settings.sessionDuration;
        smtpConfigured = settings.smtpConfigured || false;
        
        if (enableEmailNotificationsInput) {
            enableEmailNotificationsInput.checked = settings.enableEmailNotifications;
            // Show warning if email notifications enabled but SMTP not configured
            updateSmtpWarning(settings.enableEmailNotifications, smtpConfigured);
        }
        if (gitUserNameInput) {
            gitUserNameInput.value = settings.gitUserName || '';
        }
        if (gitUserEmailInput) {
            gitUserEmailInput.value = settings.gitUserEmail || '';
        }
        
        // Load GitHub Org setting
        if (githubOrgInput) {
            githubOrgInput.value = settings.githubOrg || '';
        }
        
        // Show warning if GitHub token not configured
        const githubTokenConfigured = settings.githubTokenConfigured || false;
        if (githubServerWarning) {
            githubServerWarning.classList.toggle('hidden', githubTokenConfigured);
            if (window.lucide) lucide.createIcons();
        }
        
        // Load model configuration
        availableModels = settings.availableModels || [];
        defaultModels = settings.defaultModels || ['gpt-4', 'gpt-4-turbo', 'claude-3.5-sonnet', 'claude-3-haiku', 'gpt-3.5-turbo'];
        
        renderModelList();
        populateDefaultModelSelect(settings.defaultModel);
        
        // Load Netlify settings
        if (netlifyAccountSlugInput) {
            netlifyAccountSlugInput.value = settings.netlifyAccountSlug || '';
        }
        if (netlifyBuildCommandInput) {
            netlifyBuildCommandInput.value = settings.netlifyBuildCommand || '';
        }
        if (netlifyPublishDirInput) {
            netlifyPublishDirInput.value = settings.netlifyPublishDir || 'public';
        }
        if (netlifyOauthConfiguredInput) {
            netlifyOauthConfiguredInput.checked = settings.netlifyOauthConfigured || false;
            updateNetlifyOauthWarning(settings.netlifyOauthConfigured);
        }
        
        // Update Netlify token status and verification info
        updateNetlifyTokenStatus(settings.netlifyTokenConfigured, settings.netlifyConnectionVerifiedAt);
    } catch (error) {
        notifications.error(`Failed to load settings: ${error.message}`);
    }
    
    // Netlify OAuth warning toggle
    function updateNetlifyOauthWarning(isConfigured) {
        if (netlifyOauthWarning) {
            netlifyOauthWarning.style.display = isConfigured ? 'none' : 'flex';
        }
    }
    
    // Netlify token status display
    function updateNetlifyTokenStatus(isConfigured, verifiedAt = null) {
        if (!netlifyTokenStatus) return;
        
        const verifiedText = verifiedAt 
            ? ` (last verified: ${new Date(verifiedAt).toLocaleString()})`
            : ' (not yet tested - click "Test Connection")';
        
        if (isConfigured) {
            netlifyTokenStatus.style.background = 'var(--color-success-soft, #d4edda)';
            netlifyTokenStatus.style.color = 'var(--color-success, #155724)';
            netlifyTokenStatus.style.border = '1px solid var(--color-success-light, #c3e6cb)';
            netlifyTokenStatus.innerHTML = `
                <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i>
                <span>API token configured (NETLIFY_API_TOKEN)${verifiedAt ? verifiedText : ''}</span>
            `;
            
            // Show suggestion to test if not yet verified
            if (!verifiedAt) {
                netlifyTokenStatus.innerHTML += `
                    <div style="margin-top: 4px; font-size: 0.85em; opacity: 0.8;">
                        <i data-lucide="info" style="width: 12px; height: 12px;"></i>
                        Click "Test Connection" to verify the token is valid
                    </div>
                `;
            }
        } else {
            netlifyTokenStatus.style.background = 'var(--color-danger-soft, #f8d7da)';
            netlifyTokenStatus.style.color = 'var(--color-danger, #721c24)';
            netlifyTokenStatus.style.border = '1px solid var(--color-danger-light, #f5c6cb)';
            netlifyTokenStatus.innerHTML = `
                <i data-lucide="x-circle" style="width: 14px; height: 14px;"></i>
                <span>API token not configured. Set NETLIFY_API_TOKEN in environment.</span>
            `;
        }
        if (window.lucide) lucide.createIcons();
    }
    
    // Netlify OAuth checkbox change handler
    netlifyOauthConfiguredInput?.addEventListener('change', () => {
        updateNetlifyOauthWarning(netlifyOauthConfiguredInput.checked);
    });
    
    // Test Netlify connection
    testNetlifyBtn?.addEventListener('click', async () => {
        testNetlifyBtn.disabled = true;
        const originalContent = testNetlifyBtn.innerHTML;
        testNetlifyBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Testing...';
        if (window.lucide) lucide.createIcons();
        netlifyTestResult.innerHTML = '';
        
        try {
            const result = await api.get('/netlify/test');
            
            if (result.success) {
                const verifiedAt = result.connectionVerifiedAt 
                    ? new Date(result.connectionVerifiedAt).toLocaleString() 
                    : 'just now';
                netlifyTestResult.innerHTML = `
                    <i data-lucide="check-circle" style="color: var(--color-success); width: 16px; height: 16px;"></i>
                    <span style="color: var(--color-success);">Connected: ${result.accountName || 'Success'} (verified: ${verifiedAt})</span>
                `;
                notifications.success('Netlify connection successful!');
                
                // Show warnings if any
                if (result.warnings?.length > 0) {
                    netlifyTestResult.innerHTML += `
                        <div style="margin-top: 8px; color: var(--color-warning);">
                            <i data-lucide="alert-triangle" style="width: 14px; height: 14px;"></i>
                            <span style="font-size: 0.85em;">${result.warnings.join('; ')}</span>
                        </div>
                    `;
                }
            } else if (!result.configured) {
                netlifyTestResult.innerHTML = `
                    <i data-lucide="x-circle" style="color: var(--color-danger); width: 16px; height: 16px;"></i>
                    <span style="color: var(--color-danger);">${result.errors?.join('; ') || 'Not configured'}</span>
                `;
            } else {
                netlifyTestResult.innerHTML = `
                    <i data-lucide="x-circle" style="color: var(--color-danger); width: 16px; height: 16px;"></i>
                    <span style="color: var(--color-danger);">${result.error || 'Connection failed'}</span>
                `;
            }
            
            // Show OAuth warning if needed
            if (result.oauthWarning) {
                updateNetlifyOauthWarning(false);
            }
            
            if (window.lucide) lucide.createIcons();
        } catch (error) {
            netlifyTestResult.innerHTML = `
                <i data-lucide="x-circle" style="color: var(--color-danger); width: 16px; height: 16px;"></i>
                <span style="color: var(--color-danger);">Error: ${error.message}</span>
            `;
            notifications.error(`Netlify test failed: ${error.message}`);
        } finally {
            testNetlifyBtn.disabled = false;
            testNetlifyBtn.innerHTML = originalContent;
            if (window.lucide) lucide.createIcons();
        }
    });
    
    // GitHub Org validation
    const githubOrgPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
    
    function validateGitHubOrg(value) {
        if (!githubOrgValidation) return true;
        
        if (!value) {
            githubOrgValidation.classList.add('hidden');
            return true;
        }
        
        if (value.includes(' ')) {
            githubOrgValidation.textContent = '✗ Spaces are not allowed';
            githubOrgValidation.className = 'github-validation invalid';
            return false;
        }
        
        if (!githubOrgPattern.test(value)) {
            githubOrgValidation.textContent = '✗ Invalid format. Use letters, numbers, and single hyphens.';
            githubOrgValidation.className = 'github-validation invalid';
            return false;
        }
        
        githubOrgValidation.textContent = '✓ Valid GitHub organization/username format';
        githubOrgValidation.className = 'github-validation valid';
        return true;
    }
    
    githubOrgInput?.addEventListener('input', (e) => {
        validateGitHubOrg(e.target.value);
    });
    
    // Update SMTP warning visibility when checkbox changes
    if (enableEmailNotificationsInput) {
        enableEmailNotificationsInput.addEventListener('change', () => {
            updateSmtpWarning(enableEmailNotificationsInput.checked, smtpConfigured);
        });
    }
    
    function updateSmtpWarning(emailEnabled, isSmtpConfigured) {
        if (smtpWarning) {
            if (emailEnabled && !isSmtpConfigured) {
                smtpWarning.classList.remove('hidden');
                // Re-initialize icons for the warning
                if (window.lucide) lucide.createIcons();
            } else {
                smtpWarning.classList.add('hidden');
            }
        }
    }

    // Also try to load models from the models endpoint
    try {
        const modelsData = await api.get('/models');
        if (modelsData.availableModels && modelsData.availableModels.length > 0) {
            availableModels = modelsData.availableModels;
            defaultModels = modelsData.defaultModels || defaultModels;
            // Update known models if available
            if (modelsData.knownModels) {
                knownModels = [...new Set([...knownModels, ...modelsData.knownModels])].sort();
            }
            renderModelList();
            populateDefaultModelSelect(modelsData.defaultModel);
        }
    } catch (error) {
        console.log('Models endpoint not available, using settings data');
    }

    // Load known models from the backend
    async function loadKnownModels() {
        try {
            const data = await api.get('/cursor/known-models');
            knownModels = data.models || [];
            if (knownModelsCount) {
                knownModelsCount.textContent = knownModels.length;
            }
        } catch (error) {
            console.error('Failed to load known models:', error);
            // Fallback to hardcoded defaults
            knownModels = [
                'claude-sonnet-4-20250514', 'claude-3.5-sonnet', 'claude-3-opus', 
                'gpt-4.1', 'gpt-4o', 'gpt-4-turbo', 'gemini-2.5-pro'
            ];
        }
    }

    // Show filtered suggestions in custom dropdown
    function showModelSuggestions(query) {
        if (!modelSuggestionsDropdown || !query) {
            hideModelSuggestions();
            return;
        }
        
        // Filter models that match the query
        const filtered = knownModels.filter(model => 
            model.toLowerCase().includes(query.toLowerCase()) &&
            !availableModels.some(m => m.toLowerCase() === model.toLowerCase())
        ).slice(0, 10); // Show max 10 suggestions
        
        if (filtered.length === 0) {
            hideModelSuggestions();
            return;
        }
        
        // Render suggestions
        modelSuggestionsDropdown.innerHTML = filtered.map((model, index) => `
            <div class="model-suggestion-item" data-model="${model}" data-index="${index}">
                <span class="model-suggestion-name">${model}</span>
                <span class="model-suggestion-badge">Known</span>
            </div>
        `).join('');
        
        // Add click handlers
        modelSuggestionsDropdown.querySelectorAll('.model-suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                selectSuggestion(item.dataset.model);
            });
            
            // Hover handlers for keyboard + mouse interaction
            item.addEventListener('mouseenter', () => {
                selectedSuggestionIndex = parseInt(item.dataset.index);
                updateSelectedSuggestion();
            });
        });
        
        modelSuggestionsDropdown.classList.remove('hidden');
        selectedSuggestionIndex = -1; // Reset selection
    }
    
    function hideModelSuggestions() {
        if (modelSuggestionsDropdown) {
            modelSuggestionsDropdown.classList.add('hidden');
            selectedSuggestionIndex = -1;
        }
    }
    
    function selectSuggestion(model) {
        newModelInput.value = model;
        hideModelSuggestions();
        newModelInput.focus();
        validateModelInput(model);
    }
    
    function updateSelectedSuggestion() {
        const items = modelSuggestionsDropdown.querySelectorAll('.model-suggestion-item');
        items.forEach((item, index) => {
            if (index === selectedSuggestionIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }

    // Real-time suggestions and validation as user types
    let validationTimeout;
    newModelInput?.addEventListener('input', (e) => {
        clearTimeout(validationTimeout);
        const value = e.target.value.trim();
        
        if (!value) {
            hideValidation();
            hideModelSuggestions();
            return;
        }
        
        // Show suggestions immediately
        showModelSuggestions(value);
        
        // Debounce validation
        validationTimeout = setTimeout(() => validateModelInput(value), 300);
    });
    
    // Keyboard navigation for suggestions
    newModelInput?.addEventListener('keydown', (e) => {
        const dropdown = modelSuggestionsDropdown;
        if (!dropdown || dropdown.classList.contains('hidden')) return;
        
        const items = dropdown.querySelectorAll('.model-suggestion-item');
        if (items.length === 0) return;
        
        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
                updateSelectedSuggestion();
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
                updateSelectedSuggestion();
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedSuggestionIndex >= 0) {
                    const selectedModel = items[selectedSuggestionIndex].dataset.model;
                    selectSuggestion(selectedModel);
                } else {
                    addModel();
                }
                break;
            case 'Escape':
                hideModelSuggestions();
                break;
        }
    });
    
    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!newModelInput?.contains(e.target) && !modelSuggestionsDropdown?.contains(e.target)) {
            hideModelSuggestions();
        }
    });
    
    // Focus input on label click
    newModelInput?.addEventListener('focus', () => {
        if (newModelInput.value.trim()) {
            showModelSuggestions(newModelInput.value.trim());
        }
    });

    async function validateModelInput(modelName) {
        if (!modelName) {
            hideValidation();
            return;
        }

        // Check locally first
        const isKnown = knownModels.some(m => m.toLowerCase() === modelName.toLowerCase());
        const isDuplicate = availableModels.some(m => m.toLowerCase() === modelName.toLowerCase());
        const isValidPattern = /^[a-zA-Z0-9][\w\-\.]*[a-zA-Z0-9]$/.test(modelName) && modelName.length >= 2;

        if (isDuplicate) {
            showValidation('This model is already in your list', 'warning');
            return;
        }

        if (isKnown) {
            showValidation('✓ Known Cursor model', 'success');
            return;
        }

        if (!isValidPattern) {
            showValidation('Invalid model name format', 'error');
            return;
        }

        // If not known but valid pattern, show warning
        const suggestions = knownModels.filter(m => 
            m.toLowerCase().includes(modelName.toLowerCase())
        ).slice(0, 3);

        if (suggestions.length > 0) {
            showValidation(`Unknown model. Did you mean: ${suggestions.join(', ')}?`, 'warning');
        } else {
            showValidation('⚠ This model may not be available in Cursor', 'warning');
        }
    }

    function showValidation(message, type) {
        if (!modelValidation) return;
        modelValidation.classList.remove('hidden', 'warning', 'error', 'success');
        modelValidation.classList.add(type);
        modelValidation.querySelector('.validation-message').textContent = message;
    }

    function hideValidation() {
        if (!modelValidation) return;
        modelValidation.classList.add('hidden');
    }

    // Refresh models from server
    refreshModelsBtn?.addEventListener('click', async () => {
        refreshModelsBtn.disabled = true;
        const originalContent = refreshModelsBtn.innerHTML;
        refreshModelsBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Refreshing...';
        if (window.lucide) lucide.createIcons();

        try {
            // Call the refresh endpoint
            const result = await api.post('/cursor/refresh-models', {
                customModels: availableModels // Include current models to preserve them
            });
            
            if (result.success) {
                knownModels = result.models;
                if (knownModelsCount) {
                    knownModelsCount.textContent = knownModels.length;
                }
                notifications.success(`Models refreshed! ${result.count} models available.`);
            }
        } catch (error) {
            notifications.error(`Failed to refresh models: ${error.message}`);
        } finally {
            refreshModelsBtn.disabled = false;
            refreshModelsBtn.innerHTML = originalContent;
            if (window.lucide) lucide.createIcons();
        }
    });

    function populateDefaultModelSelect(selectedModel) {
        defaultModelSelect.innerHTML = '';
        availableModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === selectedModel) {
                option.selected = true;
            }
            defaultModelSelect.appendChild(option);
        });
        if (window.lucide) lucide.createIcons();
    }

    function renderModelList() {
        modelList.innerHTML = '';
        availableModels.forEach(model => {
            const isKnown = knownModels.some(m => m.toLowerCase() === model.toLowerCase());
            const li = document.createElement('li');
            li.className = 'model-list-item';
            li.innerHTML = `
                <span class="model-name">
                    ${model}
                    ${isKnown 
                        ? '<span class="model-badge known" title="Known Cursor model">✓</span>' 
                        : '<span class="model-badge custom" title="Custom model - may not be available">?</span>'
                    }
                </span>
                <button type="button" class="model-remove-btn" data-model="${model}" title="Remove model">
                    <i data-lucide="x"></i>
                </button>
            `;
            modelList.appendChild(li);
        });
        if (window.lucide) lucide.createIcons();
        
        // Add click handlers for remove buttons
        modelList.querySelectorAll('.model-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const modelToRemove = btn.dataset.model;
                removeModel(modelToRemove);
            });
        });
    }

    function addModel() {
        const newModel = newModelInput.value.trim();
        
        // Empty check
        if (!newModel) {
            notifications.warning('Please enter a model name');
            return;
        }
        
        // Format validation
        const isValidPattern = /^[a-zA-Z0-9][\w\-\.]*[a-zA-Z0-9]$/.test(newModel) && newModel.length >= 2 && newModel.length <= 50;
        if (!isValidPattern) {
            notifications.error('Invalid model name. Use letters, numbers, hyphens, and dots. Must be 2-50 characters.');
            return;
        }
        
        // Duplicate check (case-insensitive)
        if (availableModels.some(m => m.toLowerCase() === newModel.toLowerCase())) {
            notifications.warning('This model already exists in your list');
            return;
        }
        
        // Check if known model
        const isKnown = knownModels.some(m => m.toLowerCase() === newModel.toLowerCase());
        
        // Find exact match from known models (for proper casing)
        const exactMatch = knownModels.find(m => m.toLowerCase() === newModel.toLowerCase());
        const modelToAdd = exactMatch || newModel;
        
        availableModels.push(modelToAdd);
        newModelInput.value = '';
        hideValidation();
        hideModelSuggestions();
        renderModelList();
        populateDefaultModelSelect(defaultModelSelect.value);
        
        if (isKnown) {
            notifications.success(`Added known model: ${modelToAdd}`);
        } else {
            notifications.warning(`Added custom model: ${modelToAdd} (may not be available in Cursor)`);
        }
    }

    function removeModel(modelName) {
        if (availableModels.length <= 1) {
            notifications.warning('You must have at least one model');
            return;
        }
        availableModels = availableModels.filter(m => m !== modelName);
        renderModelList();
        
        // If removed model was the default, select the first available
        if (defaultModelSelect.value === modelName) {
            defaultModelSelect.value = availableModels[0];
        }
        populateDefaultModelSelect(defaultModelSelect.value);
        notifications.success(`Removed model: ${modelName}`);
    }

    function resetModelsToDefaults() {
        availableModels = [...defaultModels];
        renderModelList();
        populateDefaultModelSelect(defaultModels[0]);
        notifications.success('Models reset to defaults');
    }

    // Event listeners for model management
    addModelBtn?.addEventListener('click', addModel);
    newModelInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addModel();
        }
    });
    resetModelsBtn?.addEventListener('click', resetModelsToDefaults);

    // Handle form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const sessionDuration = parseInt(sessionDurationInput.value);
        const enableEmailNotifications = enableEmailNotificationsInput ? enableEmailNotificationsInput.checked : true;
        const gitUserName = gitUserNameInput ? gitUserNameInput.value.trim() : '';
        const gitUserEmail = gitUserEmailInput ? gitUserEmailInput.value.trim() : '';
        const githubOrg = githubOrgInput ? githubOrgInput.value.trim() : '';
        const defaultModel = defaultModelSelect.value;
        
        // Netlify settings
        const netlifyAccountSlug = netlifyAccountSlugInput ? netlifyAccountSlugInput.value.trim() : '';
        const netlifyBuildCommand = netlifyBuildCommandInput ? netlifyBuildCommandInput.value.trim() : '';
        const netlifyPublishDir = netlifyPublishDirInput ? netlifyPublishDirInput.value.trim() || 'public' : 'public';
        const netlifyOauthConfigured = netlifyOauthConfiguredInput ? netlifyOauthConfiguredInput.checked : false;
        
        if (isNaN(sessionDuration) || sessionDuration <= 0) {
            notifications.error('Please enter a valid session duration');
            return;
        }

        if (availableModels.length === 0) {
            notifications.error('You must have at least one available model');
            return;
        }
        
        // Validate GitHub Org if provided
        if (githubOrg && !validateGitHubOrg(githubOrg)) {
            notifications.error('Please fix the GitHub Organization format');
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            await api.post('/settings', { 
                sessionDuration, 
                enableEmailNotifications,
                gitUserName,
                gitUserEmail,
                githubOrg,
                defaultModel,
                availableModels,
                // Netlify settings
                netlifyAccountSlug,
                netlifyBuildCommand,
                netlifyPublishDir,
                netlifyOauthConfigured
            });
            notifications.success('Settings saved successfully');
        } catch (error) {
            notifications.error(`Failed to save settings: ${error.message}`);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Settings';
        }
    });
});

// Theme Management - Using centralized ThemeUtils from theme.js

// Session expiry handler (no longer needed but kept for compatibility)
window.addEventListener('clickup-session-expired', () => {
    // Settings page no longer requires authentication
    console.log('Session expired event received but ignored - settings page is public');
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


