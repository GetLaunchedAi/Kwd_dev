document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons
    lucide.createIcons();

    const form = document.getElementById('createDemoForm');
    const submitBtn = document.getElementById('submitBtn');
    const progressContainer = document.getElementById('progressContainer');
    const formContainer = document.querySelector('.form-container');
    const progressMessage = document.getElementById('progressMessage');
    const statusBadge = document.getElementById('statusBadge');
    const successActions = document.getElementById('successActions');
    const viewDemoBtn = document.getElementById('viewDemoBtn');

    // Color sync
    const primaryColor = document.getElementById('primaryColor');
    const primaryColorHex = document.getElementById('primaryColorHex');
    const secondaryColor = document.getElementById('secondaryColor');
    const secondaryColorHex = document.getElementById('secondaryColorHex');

    function updateHex(picker, hexInput) {
        const hex = picker.value.replace('#', '');
        hexInput.value = hex;
    }

    function updatePicker(hexInput, picker) {
        let hex = hexInput.value;
        if (!hex.startsWith('#')) hex = '#' + hex;
        if (/^#[0-9A-F]{6}$/i.test(hex)) {
            picker.value = hex;
        }
    }

    // Safely attach color input listeners with null checks
    if (primaryColor && primaryColorHex) {
        primaryColor.addEventListener('input', () => updateHex(primaryColor, primaryColorHex));
        primaryColorHex.addEventListener('input', () => updatePicker(primaryColorHex, primaryColor));
        // Initialize hex input
        updateHex(primaryColor, primaryColorHex);
    }
    
    if (secondaryColor && secondaryColorHex) {
        secondaryColor.addEventListener('input', () => updateHex(secondaryColor, secondaryColorHex));
        secondaryColorHex.addEventListener('input', () => updatePicker(secondaryColorHex, secondaryColor));
        // Initialize hex input
        updateHex(secondaryColor, secondaryColorHex);
    }

    // File handling
    function setupFileZone(zoneId, inputId, previewId) {
        const zone = document.getElementById(zoneId);
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);

        if (!zone || !input || !preview) return;

        zone.addEventListener('click', () => input.click());

        input.addEventListener('change', () => {
            if (input.files && input.files[0]) {
                const file = input.files[0];
                
                // File size validation (5MB)
                if (file.size > 5 * 1024 * 1024) {
                    if (window.showNotification) {
                        window.showNotification('File is too large! Maximum size is 5MB.', 'error');
                    } else {
                        alert('File is too large! Maximum size is 5MB.');
                    }
                    input.value = '';
                    return;
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
                    preview.classList.remove('hidden');
                    zone.querySelector('span').textContent = file.name;
                };
                reader.readAsDataURL(file);
            }
        });

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        });

        ['dragleave', 'drop'].forEach(event => {
            zone.addEventListener(event, () => zone.classList.remove('dragover'));
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                input.files = e.dataTransfer.files;
                const changeEvent = new Event('change');
                input.dispatchEvent(changeEvent);
            }
        });
    }

    setupFileZone('logoDropZone', 'logo', 'logoPreview');
    setupFileZone('heroDropZone', 'heroImage', 'heroImagePreview');

    // Load available models for AI Model selection
    async function loadAvailableModels() {
        try {
            const modelsData = await api.get('/models');
            const aiModelSelect = document.getElementById('aiModel');
            const step1ModelSelect = document.getElementById('step1Model');
            const step2ModelSelect = document.getElementById('step2Model');
            const step3ModelSelect = document.getElementById('step3Model');
            const step4ModelSelect = document.getElementById('step4Model');
            
            const defaultModel = modelsData.defaultModel || 'gpt-4';
            const availableModels = modelsData.availableModels || ['gpt-4', 'gpt-4-turbo', 'claude-3.5-sonnet'];

            // Populate main AI model select
            if (aiModelSelect) {
                aiModelSelect.innerHTML = '';
                availableModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    if (model === defaultModel) option.selected = true;
                    aiModelSelect.appendChild(option);
                });
            }

            // Populate per-step model selects
            [step1ModelSelect, step2ModelSelect, step3ModelSelect, step4ModelSelect].forEach(select => {
                if (select) {
                    select.innerHTML = '<option value="">Use Default</option>';
                    availableModels.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model;
                        option.textContent = model;
                        select.appendChild(option);
                    });
                }
            });
        } catch (error) {
            console.error('Failed to load available models:', error);
            // Use fallback defaults if API fails
            const fallbackModels = ['gpt-4', 'gpt-4-turbo', 'claude-3.5-sonnet', 'claude-3-haiku'];
            const aiModelSelect = document.getElementById('aiModel');
            if (aiModelSelect) {
                aiModelSelect.innerHTML = '';
                fallbackModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    aiModelSelect.appendChild(option);
                });
            }
        }
    }

    // Load models on page load
    loadAvailableModels();

    // Advanced model selection toggle
    const toggleAdvancedModels = document.getElementById('toggleAdvancedModels');
    const advancedModelsSection = document.getElementById('advancedModelsSection');
    const advancedIcon = document.getElementById('advancedIcon');

    toggleAdvancedModels?.addEventListener('click', () => {
        const isHidden = advancedModelsSection.classList.contains('hidden');
        advancedModelsSection.classList.toggle('hidden');
        advancedIcon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    });

    // Template selection vs Custom Repo logic
    const templateSelect = document.getElementById('templateId');
    const customRepoContainer = document.getElementById('customRepoContainer');
    const githubRepoUrl = document.getElementById('githubRepoUrl');
    const testRepoBtn = document.getElementById('testRepoBtn');
    const repoTestResult = document.getElementById('repoTestResult');

    templateSelect.addEventListener('change', () => {
        if (templateSelect.value === "") {
            customRepoContainer.classList.remove('hidden');
            githubRepoUrl.required = true;
        } else {
            customRepoContainer.classList.add('hidden');
            githubRepoUrl.required = false;
        }
    });

    // Test Repository URL
    testRepoBtn.addEventListener('click', async () => {
        const url = githubRepoUrl.value.trim();
        if (!url) {
            showRepoTestResult('Please enter a repository URL first.', false);
            return;
        }

        testRepoBtn.disabled = true;
        const originalContent = testRepoBtn.innerHTML;
        testRepoBtn.innerHTML = '<span class="spinner-sm"></span> Testing...';
        repoTestResult.classList.add('hidden');

        try {
            const response = await fetch('/api/git/test-repo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await response.json();

            if (data.success) {
                showRepoTestResult(`✓ Repository is accessible! Found: ${data.repoName}`, true);
            } else {
                showRepoTestResult(`✗ ${data.error || 'Repository not found or inaccessible'}`, false);
            }
        } catch (error) {
            showRepoTestResult(`✗ Error: ${error.message}`, false);
        } finally {
            testRepoBtn.disabled = false;
            testRepoBtn.innerHTML = originalContent;
            lucide.createIcons();
        }
    });

    function showRepoTestResult(message, success) {
        repoTestResult.textContent = message;
        repoTestResult.className = `repo-test-result ${success ? 'success' : 'error'}`;
        repoTestResult.classList.remove('hidden');
    }

    // Slug auto-generation & Validation
    const businessNameInput = document.getElementById('businessName');
    const clientSlugInput = document.getElementById('clientSlug');
    const slugFeedback = document.getElementById('slugFeedback');

    async function validateSlug(slug) {
        if (!slug) {
            showSlugFeedback('This will be the folder name and URL component.', 'hint');
            return false;
        }

        const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
        if (!slugRegex.test(slug)) {
            showSlugFeedback('Invalid format: use only lowercase letters, numbers, and hyphens.', 'error');
            return false;
        }

        showSlugFeedback('Checking availability...', 'hint');

        try {
            const response = await fetch(`/api/demo/check-slug?slug=${slug}`);
            const data = await response.json();
            
            if (data.available) {
                showSlugFeedback('✓ Slug is available!', 'success');
                return true;
            } else {
                showSlugFeedback(`✗ ${data.reason || 'Slug is not available.'}`, 'error');
                return false;
            }
        } catch (error) {
            console.error('Slug check failed:', error);
            // FIX: Show warning on network error - server will validate, but user should be aware
            showSlugFeedback('⚠ Could not verify availability (network error). Server will validate on submit.', 'warning');
            return true;
        }
    }

    function showSlugFeedback(message, type) {
        if (!slugFeedback) return;
        slugFeedback.textContent = message;
        // FIX: Added 'warning' type support for network errors
        const typeClass = type === 'error' ? 'error-text' : 
                         type === 'success' ? 'success-text' : 
                         type === 'warning' ? 'warning-text' : '';
        slugFeedback.className = 'text-hint ' + typeClass;
    }

    let slugTimeout;
    // Safely attach slug auto-generation listeners with null checks
    if (businessNameInput && clientSlugInput) {
        businessNameInput.addEventListener('input', (e) => {
            if (!clientSlugInput.dataset.manual) {
                const generatedSlug = e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                clientSlugInput.value = generatedSlug;
                
                clearTimeout(slugTimeout);
                slugTimeout = setTimeout(() => validateSlug(generatedSlug), 500);
            }
        });

        clientSlugInput.addEventListener('input', () => {
            clientSlugInput.dataset.manual = 'true';
            clearTimeout(slugTimeout);
            slugTimeout = setTimeout(() => validateSlug(clientSlugInput.value), 500);
        });
    }

    let pollInterval = null;
    let currentClientSlug = null;
    let connectionPollingInterval = null;
    let lastProgressPercent = 0; // Track last progress to prevent jumping backwards
    let pollingStartTime = null; // Track when polling started for timeout
    let currentPollDelay = 2000; // Start with 2 second polling
    const MIN_POLL_DELAY = 2000; // Minimum 2 seconds
    const MAX_POLL_DELAY = 30000; // Maximum 30 seconds (exponential backoff cap)
    const POLLING_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours max polling time

    // Resumption Logic: Check if a demo was in progress
    const activeDemoSlug = localStorage.getItem('activeDemoSlug');
    if (activeDemoSlug) {
        console.log('Checking if demo still exists:', activeDemoSlug);
        
        // Restore progress from sessionStorage if available
        const savedProgress = sessionStorage.getItem(`demo-progress-${activeDemoSlug}`);
        if (savedProgress) {
            lastProgressPercent = parseFloat(savedProgress) || 0;
            console.log(`Restored progress for ${activeDemoSlug}: ${lastProgressPercent}%`);
        }
        
        // Perform immediate check before starting polling to avoid resurrection loops
        (async () => {
            try {
                const response = await fetch(`/api/demo/status/${activeDemoSlug}`);
                
                if (response.status === 404) {
                    console.warn(`Demo ${activeDemoSlug} no longer exists. Clearing resumption state.`);
                    localStorage.removeItem('activeDemoSlug');
                    sessionStorage.removeItem(`demo-progress-${activeDemoSlug}`);
                    // Keep form visible, don't show progress UI
                    return;
                }
                
                if (response.ok) {
                    const status = await response.json();
                    
                    // Handle completed demos
                    if (status.state === 'completed') {
                        console.log(`Demo ${activeDemoSlug} already completed. Clearing resumption state.`);
                        localStorage.removeItem('activeDemoSlug');
                        sessionStorage.removeItem(`demo-progress-${activeDemoSlug}`);
                        return;
                    }
                    
                    // FIX: Handle failed demos with error message
                    if (status.state === 'failed') {
                        console.log(`Demo ${activeDemoSlug} failed. Clearing resumption state.`);
                        localStorage.removeItem('activeDemoSlug');
                        sessionStorage.removeItem(`demo-progress-${activeDemoSlug}`);
                        // Show error notification with the failure message
                        if (window.notifications && status.message) {
                            notifications.error(`Previous demo creation failed: ${status.message}`);
                        }
                        return;
                    }
                    
                    // Demo exists and is in progress - resume polling
                    console.log('Resuming progress for:', activeDemoSlug);
                    currentClientSlug = activeDemoSlug;
                    formContainer.classList.add('hidden');
                    progressContainer.classList.remove('hidden');
                    startPolling(activeDemoSlug);
                } else {
                    // Other errors - clear and stay on form
                    console.warn(`Error checking demo status: ${response.status}`);
                    localStorage.removeItem('activeDemoSlug');
                    sessionStorage.removeItem(`demo-progress-${activeDemoSlug}`);
                }
            } catch (error) {
                console.error('Failed to check demo status on load:', error);
                // Network error - clear localStorage to avoid infinite loops
                localStorage.removeItem('activeDemoSlug');
                sessionStorage.removeItem(`demo-progress-${activeDemoSlug}`);
            }
        })();
    }

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

    // Initialize polling
    startConnectionPolling();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        currentClientSlug = formData.get('clientSlug');

        // Show progress UI
        formContainer.classList.add('hidden');
        progressContainer.classList.remove('hidden');
        
        // Reset progress tracking for new demo
        lastProgressPercent = 0;
        
        // Reset warnings and success actions
        const pushWarning = document.getElementById('pushWarning');
        if (pushWarning) {
            pushWarning.classList.add('hidden');
            delete pushWarning.dataset.triggered;
        }
        successActions.classList.add('hidden');
        
        updateStage('cloning', 'active');

        try {
            // We use fetch directly here because ApiClient.post stringifies the body
            // and sets JSON content-type, which we don't want for FormData
            const response = await fetch('/api/demo/create', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to create demo');
            }

            console.log('Demo creation initiated:', result);
            currentClientSlug = result.clientSlug || currentClientSlug;
            
            // Save for resumption
            localStorage.setItem('activeDemoSlug', currentClientSlug);
            
            // Reset polling start time for fresh timeout
            pollingStartTime = null;
            startPolling(currentClientSlug);

        } catch (error) {
            console.error('Error creating demo:', error);
            showError(error.message);
        }
    });

    function startPolling(slug) {
        if (pollInterval) clearTimeout(pollInterval);
        
        // Track polling start time for timeout detection
        if (!pollingStartTime) {
            pollingStartTime = Date.now();
            currentPollDelay = MIN_POLL_DELAY; // Reset to fast polling for new demo
        }

        async function poll() {
            try {
                // Check for polling timeout (2 hours)
                if (Date.now() - pollingStartTime > POLLING_TIMEOUT_MS) {
                    console.warn(`Polling timeout reached for ${slug}. Demo may be stuck.`);
                    pollInterval = null;
                    pollingStartTime = null;
                    localStorage.removeItem('activeDemoSlug');
                    showError('Demo creation timed out after 2 hours. The process may be stuck. Please try again or contact support.');
                    return;
                }
                
                const response = await fetch(`/api/demo/status/${slug}`);
                
                // If the demo status is not found (404), it means the build has been deleted or lost
                // We should stop polling and clear the resumption state
                if (response.status === 404) {
                    console.warn(`Demo status for ${slug} not found. Clearing resumption state.`);
                    pollInterval = null;
                    pollingStartTime = null;
                    localStorage.removeItem('activeDemoSlug');
                    // Clear sessionStorage for this demo
                    sessionStorage.removeItem(`demo-progress-${slug}`);
                    formContainer.classList.remove('hidden');
                    progressContainer.classList.add('hidden');
                    // FIX: Show notification to user that demo was not found
                    if (window.notifications) {
                        notifications.warning('Demo session not found. It may have been deleted or failed early. Please try creating a new demo.');
                    }
                    return;
                }

                if (!response.ok) {
                    // Transient error - use backoff but keep polling
                    currentPollDelay = Math.min(currentPollDelay * 1.5, MAX_POLL_DELAY);
                    pollInterval = setTimeout(poll, currentPollDelay);
                    return;
                }

                const status = await response.json();
                updateUIWithStatus(status);

                if (status.state === 'completed' || status.state === 'failed' || status.state === 'awaiting_approval') {
                    pollInterval = null;
                    pollingStartTime = null;
                    localStorage.removeItem('activeDemoSlug');
                    return;
                }
                
                // Exponential backoff: fast polling during active states, slower for 'running'
                // Active states (cloning, installing, etc.) change quickly - poll faster
                // Running state (AI working) takes longer - poll slower to reduce server load
                const fastStates = ['starting', 'cloning', 'installing', 'organizing', 'prompting', 'triggering'];
                if (fastStates.includes(status.state)) {
                    currentPollDelay = MIN_POLL_DELAY; // Fast polling (2s) during setup
                } else {
                    // Slow backoff during 'running' state - AI takes a while
                    currentPollDelay = Math.min(currentPollDelay * 1.2, MAX_POLL_DELAY);
                }
                
                pollInterval = setTimeout(poll, currentPollDelay);
            } catch (error) {
                console.error('Polling error:', error);
                // Network error - back off more aggressively
                currentPollDelay = Math.min(currentPollDelay * 2, MAX_POLL_DELAY);
                pollInterval = setTimeout(poll, currentPollDelay);
            }
        }
        
        // Start first poll immediately
        poll();
    }

    function updateUIWithStatus(status) {
        statusBadge.textContent = status.state.toUpperCase().replace(/_/g, ' ');
        const badgeClass = status.state === 'failed' ? 'danger' : 
                          (status.state === 'completed' || status.state === 'awaiting_approval') ? 'success' : 'info';
        statusBadge.className = `badge badge-${badgeClass}`;
        
        // Define stages for the progress bar - include 'starting' as first stage
        const stages = ['starting', 'cloning', 'installing', 'organizing', 'prompting', 'triggering', 'running', 'testing', 'awaiting_approval'];
        const displayStages = ['cloning', 'installing', 'organizing', 'prompting', 'triggering', 'running']; // For dot display
        const currentStageIdx = stages.indexOf(status.state);
        
        // Calculate progress percentage with weighted stages
        // Setup (cloning, installing, organizing) takes ~30% of time
        // AI stages (prompting, triggering, running) take ~70% of time with running being the longest
        let progressPercent = 0;
        
        if (status.state === 'starting') {
            progressPercent = 2;
        } else if (status.state === 'cloning') {
            progressPercent = 5;
        } else if (status.state === 'installing') {
            progressPercent = 15;
        } else if (status.state === 'organizing') {
            progressPercent = 25;
        } else if (status.state === 'prompting') {
            progressPercent = 30;
        } else if (status.state === 'triggering') {
            // Triggering should show progress appropriate for the step being prepared
            const currentStep = status.currentStep || 1;
            const totalSteps = status.totalSteps || 4;
            progressPercent = 30 + ((currentStep - 1) / totalSteps) * 63;
        } else if (status.state === 'running') {
            // Running stage spans most of the work - factor in currentStep/totalSteps with granular progress
            const currentStep = status.currentStep || 1;
            const totalSteps = status.totalSteps || 4;
            const currentStepProgress = status.currentStepProgress || 0;

            // Base progress for completed steps (32% + completed steps progress)
            const completedStepsProgress = ((currentStep - 1) / totalSteps) * 63;
            // Progress within current step (scaled to step size)
            const withinStepProgress = (currentStepProgress / 100) * (63 / totalSteps);
            // Total progress (32% base + step progress)
            progressPercent = 32 + completedStepsProgress + withinStepProgress;
        } else if (status.state === 'testing') {
            // Testing happens after all 4 AI steps complete
            progressPercent = 95;
        } else if (status.state === 'awaiting_approval' || status.state === 'completed') {
            // Demo is complete and awaiting user decision
            progressPercent = 100;
        } else if (status.state === 'failed') {
            // Keep progress where it was
            progressPercent = currentStageIdx >= 0 ? ((currentStageIdx + 1) / stages.length) * 50 : 10;
        }
        
        // Update unified progress bar - ensure it never goes backwards
        const progressFillEl = document.getElementById('unifiedProgressFill');
        const progressPercentEl = document.getElementById('progressPercent');
        const currentPhaseLabel = document.getElementById('currentPhaseLabel');
        
        // Clamp progress to only increase (except on completion/failure which resets)
        if (status.state !== 'completed' && status.state !== 'failed') {
            progressPercent = Math.max(progressPercent, lastProgressPercent);
        }
        lastProgressPercent = progressPercent;
        
        // Persist progress to sessionStorage for page refresh recovery
        if (currentClientSlug) {
            sessionStorage.setItem(`demo-progress-${currentClientSlug}`, String(lastProgressPercent));
        }
        
        if (progressFillEl) progressFillEl.style.width = `${Math.min(progressPercent, 100)}%`;
        if (progressPercentEl) progressPercentEl.textContent = `${Math.round(progressPercent)}%`;
        
        // Update phase label with more descriptive text
        const phaseLabels = {
            starting: 'Reserving project...',
            cloning: 'Cloning template...',
            installing: 'Installing dependencies...',
            organizing: 'Organizing assets...',
            prompting: 'Preparing AI prompts...',
            triggering: 'Initializing AI agent...',
            running: `AI customizing your site (Step ${status.currentStep || 1} of ${status.totalSteps || 4})...`,
            testing: 'Running tests...',
            awaiting_approval: 'Ready for your review!',
            completed: 'Complete!',
            failed: 'Error occurred'
        };
        if (currentPhaseLabel) {
            currentPhaseLabel.textContent = phaseLabels[status.state] || 'Processing...';
        }
        
        // Show/hide approval section based on state
        const approvalSection = document.getElementById('demoApprovalSection');
        if (approvalSection) {
            const showableStates = ['awaiting_approval', 'completed', 'awaiting_publish', 'publish_failed'];
            if (showableStates.includes(status.state)) {
                approvalSection.classList.remove('hidden');
            } else {
                approvalSection.classList.add('hidden');
            }
        }
        
        // Update stage dots (using displayStages which excludes 'starting')
        const displayStageIdx = displayStages.indexOf(status.state);
        // Mark all stages as completed for terminal/approval states
        const allStagesCompleted = ['testing', 'awaiting_approval', 'completed'].includes(status.state);
        displayStages.forEach((stage, idx) => {
            const dot = document.getElementById(`stage-${stage}`);
            if (dot) {
                dot.classList.remove('active', 'completed');
                if (allStagesCompleted) {
                    // All stages completed for terminal states
                    dot.classList.add('completed');
                } else if (idx < displayStageIdx) {
                    dot.classList.add('completed');
                } else if (idx === displayStageIdx) {
                    dot.classList.add('active');
                } else if (status.state === 'starting' && idx === 0) {
                    // When in 'starting' state, show first dot as active
                    dot.classList.add('active');
                }
            }
        });

        // Update Agent Sub-steps (only visible during running phase)
        const agentWorkflowContainer = document.getElementById('agentWorkflowContainer');
        if (status.state === 'running' && (status.currentStep > 0 || status.totalSteps)) {
            if (agentWorkflowContainer) {
                agentWorkflowContainer.classList.remove('hidden');
                
                const currentStep = status.currentStep || 1;
                
                // Update agent status text
                const agentStatusText = document.getElementById('agentStatusText');
                if (agentStatusText) {
                    const agentNames = ['Branding', 'Copywriting', 'Imagery', 'Review'];
                    agentStatusText.textContent = `Step ${currentStep}: ${agentNames[currentStep - 1] || 'Processing'}`;
                }
                
                // Update substep markers
                for (let i = 1; i <= 4; i++) {
                    const stepEl = document.getElementById(`agent-step-${i}`);
                    if (stepEl) {
                        stepEl.classList.remove('active', 'completed');
                        if (i < currentStep) stepEl.classList.add('completed');
                        else if (i === currentStep) stepEl.classList.add('active');
                    }
                }
            }
        } else if (agentWorkflowContainer) {
            agentWorkflowContainer.classList.add('hidden');
        }

        // Handle Streaming Logs - always show logs if available
        if (status.logs && Array.isArray(status.logs) && status.logs.length > 0) {
            const logHtml = status.logs.map((log, index) => {
                if (!log) return ''; // Skip null/empty entries
                const logStr = String(log);
                
                // Skip exact duplicates of the previous log entry
                if (index > 0 && logStr === String(status.logs[index - 1])) {
                    return '';
                }
                
                // Truncate very long lines for readability
                const displayStr = logStr.length > 200 ? logStr.substring(0, 197) + '...' : logStr;
                
                const isError = logStr.toLowerCase().includes('error') || logStr.toLowerCase().includes('failed');
                
                // Detect log entry types for styling
                let className = 'log-entry';
                if (logStr.includes('STEP') && logStr.includes('COMPLETE')) {
                    className += ' banner';
                } else if (logStr.includes('Task') && logStr.includes('complete')) {
                    className += ' task-complete';
                } else if (isError) {
                    className += ' error';
                } else if (logStr.includes('Updated') || logStr.includes('Created') || logStr.includes('Task completed')) {
                    className += ' success';
                }
                
                return `<div class="${className}">${FormattingUtils.escapeHtml(displayStr)}</div>`;
            }).filter(Boolean).join('');
            
            if (logHtml) {
                progressMessage.innerHTML = logHtml;
                progressMessage.scrollTop = progressMessage.scrollHeight;
            }
        } else if (status.message) {
            // Show current message if no logs yet
            progressMessage.innerHTML = `<div class="log-entry">${FormattingUtils.escapeHtml(status.message)}</div>`;
        }

        // Handle warnings
        const pushWarning = document.getElementById('pushWarning');
        const pushWarningMessage = document.getElementById('pushWarningMessage');
        
        if (status.message && status.message.includes('Warning')) {
            if (pushWarning && pushWarningMessage) {
                pushWarningMessage.textContent = status.message.replace('Warning:', '').trim();
                pushWarning.classList.remove('hidden');
                pushWarning.dataset.triggered = 'true';
                lucide.createIcons();
            }
        } else if (pushWarning && pushWarning.dataset.triggered !== 'true') {
            pushWarning.classList.add('hidden');
        }

        if (status.state === 'awaiting_approval') {
            // Demo AI work is done, show approval section but not success banner
            const progressFillEl = document.getElementById('unifiedProgressFill');
            const progressPercentEl = document.getElementById('progressPercent');
            if (progressFillEl) progressFillEl.style.width = '100%';
            if (progressPercentEl) progressPercentEl.textContent = '100%';
            
            // Mark all agent steps as completed
            for (let i = 1; i <= 4; i++) {
                const stepEl = document.getElementById(`agent-step-${i}`);
                if (stepEl) {
                    stepEl.classList.remove('active');
                    stepEl.classList.add('completed');
                }
            }
        }
        
        if (status.state === 'completed') {
            const progressFillEl = document.getElementById('unifiedProgressFill');
            const progressPercentEl = document.getElementById('progressPercent');
            if (progressFillEl) progressFillEl.style.width = '100%';
            if (progressPercentEl) progressPercentEl.textContent = '100%';
            
            // Mark all agent steps as completed
            for (let i = 1; i <= 4; i++) {
                const stepEl = document.getElementById(`agent-step-${i}`);
                if (stepEl) {
                    stepEl.classList.remove('active');
                    stepEl.classList.add('completed');
                }
            }
            
            successActions.classList.remove('hidden');
            lastProgressPercent = 0; // Reset for potential next demo
            // Clear sessionStorage on completion
            if (currentClientSlug) {
                sessionStorage.removeItem(`demo-progress-${currentClientSlug}`);
            }
            viewDemoBtn.onclick = () => {
                window.location.href = `/clients.html?client=${currentClientSlug}`;
            };
        }

        if (status.state === 'failed') {
            showError(status.message || 'An error occurred during customization.');
        }
        
        lucide.createIcons();
    }

    function updateStage(stageId, state) {
        const dot = document.getElementById(`stage-${stageId}`);
        if (!dot) return;

        dot.classList.remove('active', 'completed');
        if (state === 'completed') {
            dot.classList.add('completed');
        } else if (state === 'active') {
            dot.classList.add('active');
        }
        lucide.createIcons();
    }

    function showError(message) {
        localStorage.removeItem('activeDemoSlug');
        // Clear sessionStorage on failure
        if (currentClientSlug) {
            sessionStorage.removeItem(`demo-progress-${currentClientSlug}`);
        }
        progressMessage.innerHTML = `<div class="alert alert-danger">
            <div class="alert-icon"><i data-lucide="alert-circle"></i></div>
            <div class="alert-content">${message}</div>
        </div>`;
        
        // Hide push warning if showing a fatal error
        const pushWarning = document.getElementById('pushWarning');
        if (pushWarning) pushWarning.classList.add('hidden');
        
        statusBadge.textContent = 'FAILED';
        statusBadge.className = 'badge badge-danger';
        
        lucide.createIcons();

        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-secondary mt-2';
        retryBtn.textContent = 'Go Back to Form';
        retryBtn.onclick = () => {
            // Hide progress and show form again without reloading
            formContainer.classList.remove('hidden');
            progressContainer.classList.add('hidden');
            
            // Reset warnings
            const pushWarning = document.getElementById('pushWarning');
            if (pushWarning) {
                pushWarning.classList.add('hidden');
                delete pushWarning.dataset.triggered;
            }
            
            // Reset progress message for next time
            progressMessage.innerHTML = '<div class="log-entry">Preparing to build your modern business website...</div>';
            
            // Reset stages to pending state
            const displayStages = ['cloning', 'installing', 'organizing', 'prompting', 'triggering', 'running'];
            displayStages.forEach(stage => updateStage(stage, 'pending'));
            
            // Reset progress bar
            const progressFill = document.getElementById('unifiedProgressFill');
            const progressPercent = document.getElementById('progressPercent');
            const currentPhaseLabel = document.getElementById('currentPhaseLabel');
            if (progressFill) progressFill.style.width = '0%';
            if (progressPercent) progressPercent.textContent = '0%';
            if (currentPhaseLabel) currentPhaseLabel.textContent = 'Setting up...';
            lastProgressPercent = 0; // Reset progress tracking for next run
            
            // Re-enable the submit button
            submitBtn.disabled = false;
        };
        progressMessage.appendChild(retryBtn);
    }

    // Theme toggle - Using centralized ThemeUtils from theme.js
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

    // Fill Sample Data Logic
    const fillSampleBtn = document.getElementById('fillSampleBtn');
    if (fillSampleBtn) {
        fillSampleBtn.addEventListener('click', () => {
            const sampleData = {
                businessName: 'Apex Plumbing & Rooter',
                clientSlug: 'apex-plumbing',
                email: 'contact@apexplumbing.com',
                phone: '(555) 987-6543',
                address: '123 Service Way, Pipeline City, WA 98101',
                services: 'Professional plumbing services including 24/7 emergency repairs, comprehensive drain cleaning, water heater installation and maintenance, and precision leak detection for residential and commercial properties.',
                primaryColor: '#1d4ed8',
                secondaryColor: '#1e293b',
                fontFamily: "'Inter', sans-serif"
            };

            // Populate basic info
            document.getElementById('businessName').value = sampleData.businessName;
            
            // Set slug and mark as manual so auto-generation doesn't overwrite it if the user edits the name
            const slugInput = document.getElementById('clientSlug');
            slugInput.value = sampleData.clientSlug;
            slugInput.dataset.manual = 'true';
            
            document.getElementById('email').value = sampleData.email;
            document.getElementById('phone').value = sampleData.phone;
            document.getElementById('address').value = sampleData.address;
            document.getElementById('services').value = sampleData.services;

            // Populate colors
            const primaryPicker = document.getElementById('primaryColor');
            const secondaryPicker = document.getElementById('secondaryColor');
            primaryPicker.value = sampleData.primaryColor;
            secondaryPicker.value = sampleData.secondaryColor;

            // Sync the hex text inputs
            updateHex(primaryPicker, document.getElementById('primaryColorHex'));
            updateHex(secondaryPicker, document.getElementById('secondaryColorHex'));

            // Populate font family
            document.getElementById('fontFamily').value = sampleData.fontFamily;

            // Optional: Provide visual feedback
            if (window.showNotification) {
                window.showNotification('Sample data filled! Just choose a template.', 'success');
            } else {
                console.log('Sample data filled!');
            }
            
            // Re-initialize Lucide icons if any were added (though we only used sparkles in the button)
            if (window.lucide) {
                window.lucide.createIcons();
            }
        });
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (connectionPollingInterval) {
            clearInterval(connectionPollingInterval);
            connectionPollingInterval = null;
        }
        if (pollInterval) {
            clearTimeout(pollInterval);
            pollInterval = null;
            pollingStartTime = null;
        }
    });

    // ============== 3-Way Approval Functionality ==============
    
    // Enable/disable submit button based on feedback input
    const feedbackInput = document.getElementById('demoFeedbackInput');
    feedbackInput?.addEventListener('input', () => {
        const submitBtn = document.getElementById('submitChangesBtn');
        if (submitBtn) {
            submitBtn.disabled = feedbackInput.value.trim().length < 10;
        }
    });
    
    // Show/hide modals
    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.add('show'), 10);
        }
    }
    
    function hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }
    }
    
    // Set up preview link in approval section
    function updateApprovalPreviewLink() {
        const link = document.getElementById('approvalPreviewLink');
        if (link && currentClientSlug) {
            // Use environment-aware URL (production: static, dev: may use preview server)
            if (window.APP_CONFIG) {
                link.href = window.APP_CONFIG.getDemoUrl(currentClientSlug);
            } else {
                // Fallback to static URL
                link.href = `/client-websites/${currentClientSlug}/`;
            }
        }
    }
    
    // FIX: Add global flag to prevent double-clicks on approval actions
    let approvalInProgress = false;
    
    // 1. Approve & Publish - Accept the AI's work and publish to GitHub
    async function approveAndPublish() {
        const card = document.getElementById('approvePublishCard');
        if (!card || !currentClientSlug) return;
        
        // FIX: Prevent double-clicks with flag check
        if (approvalInProgress) {
            console.log('Approval already in progress, ignoring duplicate click');
            return;
        }
        approvalInProgress = true;
        
        // Store original content for restoration
        const actionTitle = card.querySelector('.action-title');
        const originalTitle = actionTitle ? actionTitle.textContent : '';
        
        card.style.pointerEvents = 'none';
        card.style.opacity = '0.7';
        card.classList.add('loading');
        if (actionTitle) actionTitle.textContent = 'Publishing...';
        
        try {
            const taskId = `demo-${currentClientSlug}`;
            const response = await fetch(`/api/tasks/${taskId}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publish: true })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to approve demo');
            }
            
            if (window.showNotification) {
                if (result.repoUrl) {
                    window.showNotification(`Demo published! Repo: ${result.repoUrl}`, 'success');
                } else if (result.completed) {
                    window.showNotification('Demo approved and completed! 🎉', 'success');
                } else {
                    window.showNotification(result.message || 'Demo approved successfully!', 'success');
                }
            }
            
            // Hide approval section
            const approvalSection = document.getElementById('demoApprovalSection');
            if (approvalSection) approvalSection.classList.add('hidden');
            
            // Show success actions
            successActions.classList.remove('hidden');
            viewDemoBtn.onclick = () => {
                window.location.href = `/clients.html?client=${currentClientSlug}`;
            };
            
        } catch (error) {
            console.error('Error approving demo:', error);
            if (window.showNotification) {
                window.showNotification(`Failed to approve: ${error.message}`, 'error');
            }
        } finally {
            approvalInProgress = false;
            card.style.pointerEvents = '';
            card.style.opacity = '';
            card.classList.remove('loading');
            if (actionTitle) actionTitle.textContent = originalTitle;
        }
    }
    
    // 2. Request Changes - Show modal for feedback
    function openRequestChangesModal() {
        const feedbackInput = document.getElementById('demoFeedbackInput');
        if (feedbackInput) feedbackInput.value = '';
        
        const submitBtn = document.getElementById('submitChangesBtn');
        if (submitBtn) submitBtn.disabled = true;
        
        showModal('requestChangesModal');
    }
    
    // Submit feedback and retry
    async function submitChangesAndRetry() {
        const feedbackInput = document.getElementById('demoFeedbackInput');
        const feedback = feedbackInput?.value?.trim();
        
        if (!feedback || feedback.length < 10) {
            if (window.showNotification) {
                window.showNotification('Please provide at least 10 characters of feedback.', 'warning');
            }
            return;
        }
        
        const btn = document.getElementById('submitChangesBtn');
        if (!btn || !currentClientSlug) return;
        
        // FIX: Prevent double-clicks across all approval actions
        if (approvalInProgress) {
            console.log('Approval action already in progress, ignoring');
            return;
        }
        approvalInProgress = true;
        
        btn.disabled = true;
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-sm"></span> Sending...';
        
        try {
            // Use the new request-changes endpoint
            const response = await fetch(`/api/demos/${currentClientSlug}/request-changes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ feedback })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to send feedback');
            }
            
            if (window.showNotification) {
                window.showNotification('Feedback sent! AI agent will retry with your changes.', 'success');
            }
            
            // Hide modal and approval section
            hideModal('requestChangesModal');
            const approvalSection = document.getElementById('demoApprovalSection');
            if (approvalSection) approvalSection.classList.add('hidden');
            
            // Reset progress for re-run
            lastProgressPercent = 0;
            const progressFillEl = document.getElementById('unifiedProgressFill');
            const progressPercentEl = document.getElementById('progressPercent');
            const currentPhaseLabel = document.getElementById('currentPhaseLabel');
            if (progressFillEl) progressFillEl.style.width = '90%';
            if (progressPercentEl) progressPercentEl.textContent = '90%';
            if (currentPhaseLabel) currentPhaseLabel.textContent = 'AI retrying with your feedback...';
            
            // Save for resumption and restart polling with fresh timeout
            localStorage.setItem('activeDemoSlug', currentClientSlug);
            pollingStartTime = null;
            startPolling(currentClientSlug);
            
        } catch (error) {
            console.error('Error requesting changes:', error);
            if (window.showNotification) {
                window.showNotification(`Failed to send feedback: ${error.message}`, 'error');
            }
        } finally {
            approvalInProgress = false;
            btn.disabled = false;
            btn.innerHTML = originalContent;
            lucide.createIcons();
        }
    }
    
    // 3. Reject Demo - Show confirmation modal
    function openRejectDemoModal() {
        showModal('rejectDemoModal');
    }
    
    // Confirm reject and delete demo
    async function confirmRejectDemo() {
        const btn = document.getElementById('confirmRejectBtn');
        if (!btn || !currentClientSlug) return;
        
        // FIX: Prevent double-clicks across all approval actions
        if (approvalInProgress) {
            console.log('Approval action already in progress, ignoring');
            return;
        }
        approvalInProgress = true;
        
        btn.disabled = true;
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-sm"></span> Deleting...';
        
        try {
            // Use the new reject endpoint
            const response = await fetch(`/api/demos/${currentClientSlug}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to reject demo');
            }
            
            if (window.showNotification) {
                window.showNotification('Demo rejected and deleted.', 'success');
            }
            
            // Clear localStorage
            localStorage.removeItem('activeDemoSlug');
            
            // Hide modal
            hideModal('rejectDemoModal');
            
            // Redirect to dashboard
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 1000);
            
        } catch (error) {
            console.error('Error rejecting demo:', error);
            if (window.showNotification) {
                window.showNotification(`Failed to reject demo: ${error.message}`, 'error');
            }
        } finally {
            approvalInProgress = false;
            btn.disabled = false;
            btn.innerHTML = originalContent;
            lucide.createIcons();
        }
    }
    
    // Wire up 3-way approval cards and buttons
    document.getElementById('approvePublishCard')?.addEventListener('click', approveAndPublish);
    document.getElementById('requestChangesCard')?.addEventListener('click', openRequestChangesModal);
    document.getElementById('rejectDemoCard')?.addEventListener('click', openRejectDemoModal);
    
    // Modal close buttons
    document.getElementById('closeChangesModal')?.addEventListener('click', () => hideModal('requestChangesModal'));
    document.getElementById('cancelChangesBtn')?.addEventListener('click', () => hideModal('requestChangesModal'));
    document.getElementById('submitChangesBtn')?.addEventListener('click', submitChangesAndRetry);
    
    document.getElementById('closeRejectModal')?.addEventListener('click', () => hideModal('rejectDemoModal'));
    document.getElementById('cancelRejectBtn')?.addEventListener('click', () => hideModal('rejectDemoModal'));
    document.getElementById('confirmRejectBtn')?.addEventListener('click', confirmRejectDemo);
    
    // Close modals on overlay click
    ['requestChangesModal', 'rejectDemoModal'].forEach(modalId => {
        document.getElementById(modalId)?.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                hideModal(modalId);
            }
        });
    });
    
    // Update preview link when approval section is shown
    const originalUpdateUIWithStatus = updateUIWithStatus;
    updateUIWithStatus = function(status) {
        originalUpdateUIWithStatus(status);
        if (status.state === 'awaiting_approval' || status.state === 'completed') {
            updateApprovalPreviewLink();
        }
    };

    // ============== System Prompts Editor ==============
    
    let systemPrompts = {};
    let originalPrompts = {};
    let promptMetadata = {};
    let currentPromptStep = 1;
    let hasUnsavedChanges = false;

    const promptTitles = {
        1: 'Step 1: Branding & Identity',
        2: 'Step 2: Copywriting & Content',
        3: 'Step 3: Imagery & Visuals',
        4: 'Step 4: Final Review & QA'
    };

    async function loadSystemPrompts() {
        try {
            const response = await fetch('/api/system-prompts');
            if (response.ok) {
                const data = await response.json();
                systemPrompts = data.prompts || {};
                promptMetadata = data.metadata || {};
                originalPrompts = JSON.parse(JSON.stringify(systemPrompts)); // Deep copy
                hasUnsavedChanges = false;
                updateSaveStatus('');
                return true;
            } else {
                throw new Error('Failed to load prompts');
            }
        } catch (err) {
            console.error('Failed to load system prompts:', err);
            if (window.showNotification) {
                window.showNotification('Failed to load system prompts', 'error');
            }
            return false;
        }
    }

    function displayCurrentPrompt() {
        const promptEditor = document.getElementById('promptEditor');
        const promptTitle = document.getElementById('currentPromptTitle');

        if (systemPrompts[currentPromptStep]) {
            promptEditor.value = systemPrompts[currentPromptStep];
        } else {
            promptEditor.value = '# Prompt not found\n\nThis prompt file could not be loaded.';
        }
        
        promptTitle.textContent = promptTitles[currentPromptStep] || `Step ${currentPromptStep}`;
    }

    function updateTabStates() {
        document.querySelectorAll('.prompt-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        const activeTab = document.querySelector(`.prompt-tab[data-step="${currentPromptStep}"]`);
        if (activeTab) {
            activeTab.classList.add('active');
        }
    }

    function updateSaveStatus(message, type = '') {
        const statusEl = document.getElementById('promptSaveStatus');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = 'text-hint';
            if (type === 'success') statusEl.classList.add('success-text');
            if (type === 'error') statusEl.classList.add('error-text');
        }
    }

    function markUnsaved() {
        if (!hasUnsavedChanges) {
            hasUnsavedChanges = true;
            updateSaveStatus('Unsaved changes');
        }
    }

    async function openSystemPromptsModal() {
        const success = await loadSystemPrompts();
        if (success) {
            currentPromptStep = 1;
            updateTabStates();
            displayCurrentPrompt();
            showModal('systemPromptsModal');
            lucide.createIcons();
        }
    }

    async function saveSystemPrompts() {
        try {
            // Update current prompt from textarea before saving
            systemPrompts[currentPromptStep] = document.getElementById('promptEditor').value;

            const saveBtn = document.getElementById('savePromptsBtn');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<span class="spinner-sm"></span> Saving...';
            }

            const response = await fetch('/api/system-prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompts: systemPrompts })
            });

            const result = await response.json();

            if (response.ok) {
                originalPrompts = JSON.parse(JSON.stringify(systemPrompts));
                hasUnsavedChanges = false;
                
                // Show warnings if any
                if (result.warnings && Object.keys(result.warnings).length > 0) {
                    const warningSteps = Object.keys(result.warnings).join(', ');
                    updateSaveStatus(`Saved with warnings (steps: ${warningSteps})`, 'warning');
                    if (window.showNotification) {
                        window.showNotification(`Prompts saved. Some steps have validation warnings.`, 'warning');
                    }
                } else {
                    updateSaveStatus('All changes saved', 'success');
                    if (window.showNotification) {
                        window.showNotification('System prompts saved successfully', 'success');
                    }
                }
                
                // Clear status after a delay
                setTimeout(() => {
                    if (!hasUnsavedChanges) {
                        updateSaveStatus('');
                    }
                }, 3000);
            } else {
                throw new Error(result.error || 'Failed to save prompts');
            }
        } catch (err) {
            console.error('Failed to save system prompts:', err);
            updateSaveStatus('Save failed', 'error');
            if (window.showNotification) {
                window.showNotification('Failed to save system prompts: ' + err.message, 'error');
            }
        } finally {
            const saveBtn = document.getElementById('savePromptsBtn');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i data-lucide="save"></i><span>Save Changes</span>';
                lucide.createIcons();
            }
        }
    }

    function resetCurrentPrompt() {
        if (originalPrompts[currentPromptStep]) {
            systemPrompts[currentPromptStep] = originalPrompts[currentPromptStep];
            displayCurrentPrompt();
            if (window.showNotification) {
                window.showNotification(`Step ${currentPromptStep} prompt reset to original`, 'info');
            }
            
            // Check if all prompts now match originals
            let allMatch = true;
            for (const step of Object.keys(systemPrompts)) {
                if (systemPrompts[step] !== originalPrompts[step]) {
                    allMatch = false;
                    break;
                }
            }
            if (allMatch) {
                hasUnsavedChanges = false;
                updateSaveStatus('');
            }
        }
    }

    function closePromptsModalWithCheck() {
        if (hasUnsavedChanges) {
            if (confirm('You have unsaved changes. Are you sure you want to close?')) {
                hideModal('systemPromptsModal');
                hasUnsavedChanges = false;
            }
        } else {
            hideModal('systemPromptsModal');
        }
    }

    // Event Listeners for System Prompts Modal
    document.getElementById('editPromptsBtn')?.addEventListener('click', openSystemPromptsModal);
    document.getElementById('closePromptsModal')?.addEventListener('click', closePromptsModalWithCheck);
    document.getElementById('cancelPromptsBtn')?.addEventListener('click', closePromptsModalWithCheck);
    document.getElementById('savePromptsBtn')?.addEventListener('click', saveSystemPrompts);
    document.getElementById('resetPromptBtn')?.addEventListener('click', resetCurrentPrompt);

    // Tab switching
    document.querySelectorAll('.prompt-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            // Save current prompt before switching
            systemPrompts[currentPromptStep] = document.getElementById('promptEditor').value;

            currentPromptStep = parseInt(e.currentTarget.dataset.step);
            updateTabStates();
            displayCurrentPrompt();
        });
    });

    // Track changes in textarea
    document.getElementById('promptEditor')?.addEventListener('input', () => {
        const currentValue = document.getElementById('promptEditor').value;
        systemPrompts[currentPromptStep] = currentValue;
        
        // Mark unsaved if different from original
        if (currentValue !== originalPrompts[currentPromptStep]) {
            markUnsaved();
        }
    });

    // Close modal when clicking overlay
    document.getElementById('systemPromptsModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'systemPromptsModal') {
            closePromptsModalWithCheck();
        }
    });

    // Keyboard shortcuts for the modal
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('systemPromptsModal');
        if (modal && !modal.classList.contains('hidden')) {
            // Ctrl/Cmd + S to save
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                saveSystemPrompts();
            }
            // Escape to close (with unsaved check)
            if (e.key === 'Escape') {
                e.preventDefault();
                closePromptsModalWithCheck();
            }
        }
    });
});

