// Mappings Management JavaScript

document.addEventListener('DOMContentLoaded', () => {
    loadMappings();
    setupTabHandlers();
    setupFormHandlers();
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
                <button class="btn btn-sm btn-danger delete-pattern-btn" data-pattern="${FormattingUtils.escapeHtml(pm.pattern)}">Delete</button>
            </td>
        `;
        tableBody.appendChild(tr);
    });

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
                <button class="btn btn-sm btn-danger delete-task-mapping-btn" data-task-id="${FormattingUtils.escapeHtml(taskId)}">Delete</button>
            </td>
        `;
        tableBody.appendChild(tr);
    });

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
    // Pattern form
    const addPatternForm = document.getElementById('addPatternForm');
    addPatternForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pattern = document.getElementById('patternInput').value.trim();
        const clientName = document.getElementById('patternClientInput').value.trim();
        
        try {
            await api.post('/mappings/pattern', { pattern, clientName });
            notifications.success(`Pattern mapping added: ${pattern} -> ${clientName}`);
            addPatternForm.reset();
            loadMappings();
        } catch (error) {
            notifications.error(`Failed to add pattern mapping: ${error.message}`);
        }
    });

    // Task form
    const addTaskMappingForm = document.getElementById('addTaskMappingForm');
    addTaskMappingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const taskId = document.getElementById('taskIdMappingInput').value.trim();
        const clientName = document.getElementById('taskClientMappingInput').value.trim();
        
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


