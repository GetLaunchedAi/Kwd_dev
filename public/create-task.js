// Create Task Page JavaScript

let clients = [];
let models = [];
let createdTaskId = null;
let createdClientFolder = null;

// Initialize the page
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize icons
    if (window.lucide) lucide.createIcons();
    
    // Theme toggle
    initTheme();
    
    // Load data
    await Promise.all([
        loadClients(),
        loadModels()
    ]);
    
    // Setup event listeners
    setupEventListeners();
    
    // Check form validity
    validateForm();
    
    // Check connection status
    checkConnectionStatus();
});

/**
 * Load available clients from the API
 */
async function loadClients() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/clients`);
        if (!response.ok) throw new Error('Failed to load clients');
        
        clients = await response.json();
        
        const clientSelect = document.getElementById('clientSelect');
        const noClientsMessage = document.getElementById('noClientsMessage');
        
        // Clear existing options (except the placeholder)
        clientSelect.innerHTML = '<option value="">Select a client...</option>';
        
        if (clients.length === 0) {
            noClientsMessage.classList.remove('hidden');
            return;
        }
        
        noClientsMessage.classList.add('hidden');
        
        // Sort clients alphabetically
        clients.sort((a, b) => (a.name || a.folderName || '').localeCompare(b.name || b.folderName || ''));
        
        // Add client options
        clients.forEach(client => {
            const option = document.createElement('option');
            option.value = client.folderName || client.name;
            option.textContent = client.name || client.folderName;
            clientSelect.appendChild(option);
        });
        
    } catch (error) {
        console.error('Error loading clients:', error);
        showNotification('Failed to load clients', 'error');
    }
}

/**
 * Load available AI models from the API
 */
async function loadModels() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/models`);
        if (!response.ok) throw new Error('Failed to load models');
        
        const data = await response.json();
        models = data.availableModels || [];
        
        const modelSelect = document.getElementById('modelSelect');
        
        // Clear existing options (except the placeholder)
        modelSelect.innerHTML = '<option value="">Use Default</option>';
        
        // Add model options
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            modelSelect.appendChild(option);
        });
        
    } catch (error) {
        console.error('Error loading models:', error);
        // Non-critical error, just log it
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    const form = document.getElementById('createTaskForm');
    const titleInput = document.getElementById('taskTitle');
    const descriptionInput = document.getElementById('taskDescription');
    const clientSelect = document.getElementById('clientSelect');
    const cancelBtn = document.getElementById('cancelBtn');
    const viewTaskBtn = document.getElementById('viewTaskBtn');
    const triggerAgentBtn = document.getElementById('triggerAgentBtn');
    const createAnotherBtn = document.getElementById('createAnotherBtn');
    
    // Form submission
    form.addEventListener('submit', handleSubmit);
    
    // Input validation
    titleInput.addEventListener('input', validateForm);
    descriptionInput.addEventListener('input', validateForm);
    clientSelect.addEventListener('change', validateForm);
    
    // Cancel button
    cancelBtn.addEventListener('click', () => {
        window.location.href = '/index.html';
    });
    
    // Success action buttons
    viewTaskBtn.addEventListener('click', () => {
        if (createdTaskId) {
            window.location.href = `/task.html?taskId=${encodeURIComponent(createdTaskId)}`;
        }
    });
    
    triggerAgentBtn.addEventListener('click', handleTriggerAgent);
    
    createAnotherBtn.addEventListener('click', () => {
        resetForm();
    });
}

/**
 * Validate form and enable/disable submit button
 */
function validateForm() {
    const titleInput = document.getElementById('taskTitle');
    const descriptionInput = document.getElementById('taskDescription');
    const clientSelect = document.getElementById('clientSelect');
    const submitBtn = document.getElementById('submitBtn');
    
    const isValid = titleInput.value.trim().length > 0 &&
                    descriptionInput.value.trim().length > 0 &&
                    clientSelect.value.length > 0;
    
    submitBtn.disabled = !isValid;
}

/**
 * Handle form submission
 */
async function handleSubmit(e) {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submitBtn');
    const form = document.getElementById('createTaskForm');
    
    // Get form values
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const clientName = document.getElementById('clientSelect').value;
    const model = document.getElementById('modelSelect').value;
    
    // Validate again
    if (!title || !description || !clientName) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }
    
    // Show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner-small"></div><span>Creating...</span>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/tasks/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title,
                description,
                clientName,
                model: model || undefined
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create task');
        }
        
        // Store created task info
        createdTaskId = data.taskId;
        createdClientFolder = data.clientFolder;
        
        // Show success
        showSuccess(data);
        
    } catch (error) {
        console.error('Error creating task:', error);
        showNotification(error.message || 'Failed to create task', 'error');
        
        // Reset button state
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="plus"></i><span>Create Task</span>';
        if (window.lucide) lucide.createIcons();
    }
}

/**
 * Show success state
 */
function showSuccess(data) {
    const formContainer = document.querySelector('.form-container');
    const successContainer = document.getElementById('successContainer');
    const successMessage = document.getElementById('successMessage');
    
    // Hide form
    formContainer.classList.add('hidden');
    
    // Update success message
    successMessage.textContent = `Task "${data.taskName || 'Untitled'}" has been created for client "${data.clientName || 'Unknown'}".`;
    
    // Show success container
    successContainer.classList.remove('hidden');
    
    // Reinitialize icons
    if (window.lucide) lucide.createIcons();
    
    showNotification('Task created successfully!', 'success');
}

/**
 * Handle trigger agent button
 */
async function handleTriggerAgent() {
    if (!createdTaskId) return;
    
    const triggerBtn = document.getElementById('triggerAgentBtn');
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '<div class="spinner-small"></div><span>Starting Agent...</span>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/tasks/${encodeURIComponent(createdTaskId)}/trigger-agent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to trigger agent');
        }
        
        showNotification('Agent started successfully!', 'success');
        
        // Redirect to task page
        setTimeout(() => {
            window.location.href = `/task.html?taskId=${encodeURIComponent(createdTaskId)}`;
        }, 1000);
        
    } catch (error) {
        console.error('Error triggering agent:', error);
        showNotification(error.message || 'Failed to start agent', 'error');
        
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = '<i data-lucide="bot"></i><span>Run Agent Now</span>';
        if (window.lucide) lucide.createIcons();
    }
}

/**
 * Reset form to create another task
 */
function resetForm() {
    const formContainer = document.querySelector('.form-container');
    const successContainer = document.getElementById('successContainer');
    const form = document.getElementById('createTaskForm');
    const submitBtn = document.getElementById('submitBtn');
    
    // Reset form fields
    form.reset();
    
    // Reset button state
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="plus"></i><span>Create Task</span>';
    
    // Reset stored data
    createdTaskId = null;
    createdClientFolder = null;
    
    // Show form, hide success
    successContainer.classList.add('hidden');
    formContainer.classList.remove('hidden');
    
    // Reinitialize icons
    if (window.lucide) lucide.createIcons();
    
    // Validate form
    validateForm();
}

/**
 * Check connection status
 */
async function checkConnectionStatus() {
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/health`);
        if (response.ok) {
            statusIndicator.className = 'status-indicator status-online';
            statusText.textContent = 'Online';
        } else {
            throw new Error('Health check failed');
        }
    } catch (error) {
        statusIndicator.className = 'status-indicator status-offline';
        statusText.textContent = 'Offline';
    }
}

/**
 * Show notification (uses global notification system if available)
 */
function showNotification(message, type = 'info') {
    // Use global notification system if available
    if (window.NotificationUtils && typeof window.NotificationUtils.show === 'function') {
        window.NotificationUtils.show(message, type);
        return;
    }
    
    // Fallback to alert
    alert(message);
}
