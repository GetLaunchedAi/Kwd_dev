# System Prompts Editor Implementation

## Overview

This document outlines the implementation of a system prompts editor for the KWD Dev demo creation system. The editor allows users to view and modify the 4 system prompts used by the AI agents during demo site customization.

## Current System Architecture

### System Prompts Structure

The system uses 4 sequential AI agents, each with their own system prompt:

1. **demo_step1_branding.md** - Branding & Identity Agent
2. **demo_step2_copywriting.md** - Copywriting & Content Agent
3. **demo_step3_imagery.md** - Imagery & Visuals Agent
4. **demo_step4_review.md** - Final Review & QA Agent

### Critical Dependencies

The system prompts are deeply integrated with multiple components:

#### Backend Dependencies
- `src/handlers/demoHandler.ts` - Loads initial prompt (step 1)
- `src/workflow/workflowOrchestrator.ts` - Loads subsequent prompts (steps 2-4)
- `getStepName()` function maps step numbers to filenames
- Placeholder replacement system (`{{variable}}` syntax)

#### Frontend Dependencies
- Completion detection via ASCII banner patterns
- Step transition logic depends on specific banner text
- UI state management tied to completion signals

#### Agent Behavior Dependencies
- Agents output specific completion banners for detection
- Workflow history format expected by subsequent steps
- ImageRetriever CLI command formatting (step 3)

## Implementation Plan

### Phase 1: Backend API and Data Layer

#### 1.1 Create System Prompts Handler (`src/handlers/systemPromptsHandler.ts`)

```typescript
import { Request, Response } from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';

export async function getSystemPrompts(req: Request, res: Response) {
    try {
        const promptsDir = path.join(process.cwd(), 'prompts');
        const promptFiles = [
            'demo_step1_branding.md',
            'demo_step2_copywriting.md',
            'demo_step3_imagery.md',
            'demo_step4_review.md'
        ];

        const prompts: { [key: number]: string } = {};

        for (let i = 0; i < promptFiles.length; i++) {
            const filePath = path.join(promptsDir, promptFiles[i]);
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                prompts[i + 1] = content;
            } catch (err) {
                console.warn(`Failed to read ${filePath}:`, err);
                prompts[i + 1] = `# ${promptFiles[i]}\n\nPrompt file not found.`;
            }
        }

        res.json(prompts);
    } catch (err) {
        console.error('Error loading system prompts:', err);
        res.status(500).json({ error: 'Failed to load system prompts' });
    }
}

export async function saveSystemPrompts(req: Request, res: Response) {
    try {
        const prompts = req.body;
        const promptsDir = path.join(process.cwd(), 'prompts');

        // Validate input
        if (typeof prompts !== 'object' || !prompts) {
            return res.status(400).json({ error: 'Invalid prompts data' });
        }

        const promptFiles = {
            1: 'demo_step1_branding.md',
            2: 'demo_step2_copywriting.md',
            3: 'demo_step3_imagery.md',
            4: 'demo_step4_review.md'
        };

        // Save each prompt
        for (const [step, filename] of Object.entries(promptFiles)) {
            const stepNum = parseInt(step);
            if (prompts[stepNum]) {
                const filePath = path.join(promptsDir, filename);
                await fs.writeFile(filePath, prompts[stepNum], 'utf-8');
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error saving system prompts:', err);
        res.status(500).json({ error: 'Failed to save system prompts' });
    }
}
```

#### 1.2 Add Routes to Server (`src/server.ts`)

```typescript
import { getSystemPrompts, saveSystemPrompts } from './handlers/systemPromptsHandler';

// Add these routes
app.get('/api/system-prompts', getSystemPrompts);
app.post('/api/system-prompts', saveSystemPrompts);
```

#### 1.3 Add Input Validation

```typescript
// In systemPromptsHandler.ts
function validatePrompt(prompt: string, step: number): { valid: boolean; error?: string } {
    // Check for required completion banner
    const bannerPatterns = {
        1: /STEP 1 COMPLETE.*BRANDING.*IDENTITY/i,
        2: /STEP 2 COMPLETE.*COPYWRITING.*CONTENT/i,
        3: /STEP 3 COMPLETE.*IMAGERY.*VISUALS/i,
        4: /STEP 4 COMPLETE.*FINAL REVIEW.*QA/i
    };

    if (!bannerPatterns[step].test(prompt)) {
        return {
            valid: false,
            error: `Prompt must contain completion banner for Step ${step}`
        };
    }

    // Check for required placeholders
    const requiredPlaceholders = ['{{taskId}}', '{{businessName}}'];
    for (const placeholder of requiredPlaceholders) {
        if (!prompt.includes(placeholder)) {
            return {
                valid: false,
                error: `Prompt must contain required placeholder: ${placeholder}`
            };
        }
    }

    return { valid: true };
}
```

### Phase 2: Frontend UI Components

#### 2.1 Add Button to Create Demo Page (`public/create-demo.html`)

**Header Actions Section:**
```html
<div class="header-actions">
    <button type="button" id="editPromptsBtn" class="btn btn-secondary btn-sm">
        <i data-lucide="file-text"></i>
        <span>Edit System Prompts</span>
    </button>
    <button type="button" id="fillSampleBtn" class="btn btn-secondary btn-sm">
        <i data-lucide="sparkles"></i>
        <span>Fill Sample Data</span>
    </button>
</div>
```

**Modal Structure:**
```html
<!-- System Prompts Editor Modal -->
<div id="systemPromptsModal" class="modal-overlay hidden">
    <div class="modal modal-lg">
        <div class="modal-header">
            <h3 class="modal-title">Edit System Prompts</h3>
            <button class="modal-close" id="closePromptsModal">&times;</button>
        </div>
        <div class="modal-body">
            <div class="prompts-nav">
                <div class="prompt-tabs">
                    <button class="prompt-tab active" data-step="1">
                        <span>Step 1: Branding</span>
                    </button>
                    <button class="prompt-tab" data-step="2">
                        <span>Step 2: Copywriting</span>
                    </button>
                    <button class="prompt-tab" data-step="3">
                        <span>Step 3: Imagery</span>
                    </button>
                    <button class="prompt-tab" data-step="4">
                        <span>Step 4: Review</span>
                    </button>
                </div>
            </div>
            <div class="prompt-editor">
                <div class="prompt-header">
                    <h4 id="currentPromptTitle">Step 1: Branding & Identity</h4>
                    <div class="prompt-actions">
                        <button id="resetPromptBtn" class="btn btn-sm btn-secondary">
                            <i data-lucide="rotate-ccw"></i>
                            Reset to Default
                        </button>
                    </div>
                </div>
                <textarea id="promptEditor" class="prompt-textarea" placeholder="Loading prompt..."></textarea>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" id="cancelPromptsBtn">Cancel</button>
            <button class="btn btn-primary" id="savePromptsBtn">
                <i data-lucide="save"></i>
                <span>Save Changes</span>
            </button>
        </div>
    </div>
</div>
```

#### 2.2 Add CSS Styling (`public/create-demo.html`)

```html
<style>
    .modal-lg { max-width: 90vw; width: 1200px; }
    .prompts-nav { margin-bottom: 20px; }
    .prompt-tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--color-border); }
    .prompt-tab { padding: 12px 16px; border: none; background: none; border-bottom: 2px solid transparent; cursor: pointer; font-weight: 500; color: var(--color-text-secondary); transition: all 0.2s; }
    .prompt-tab.active { color: var(--color-primary); border-bottom-color: var(--color-primary); }
    .prompt-tab:hover { color: var(--color-text); }
    .prompt-editor { display: flex; flex-direction: column; gap: 16px; }
    .prompt-header { display: flex; justify-content: space-between; align-items: center; }
    .prompt-actions { display: flex; gap: 8px; }
    .prompt-textarea { width: 100%; min-height: 500px; padding: 16px; border: 1px solid var(--color-border); border-radius: 8px; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 14px; line-height: 1.5; resize: vertical; }
    .prompt-textarea:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1); }
</style>
```

#### 2.3 Add JavaScript Functionality (`public/create-demo.js`)

**System Prompts Editor Functions:**
```javascript
// System Prompts Editor Functions
let systemPrompts = {};
let currentPromptStep = 1;
let originalPrompts = {};

async function loadSystemPrompts() {
    try {
        const response = await fetch('/api/system-prompts');
        if (response.ok) {
            systemPrompts = await response.json();
            originalPrompts = JSON.parse(JSON.stringify(systemPrompts)); // Deep copy
        } else {
            // Fallback to loading from prompts directory
            const prompts = ['demo_step1_branding.md', 'demo_step2_copywriting.md', 'demo_step3_imagery.md', 'demo_step4_review.md'];
            for (let i = 0; i < prompts.length; i++) {
                try {
                    const response = await fetch(`/prompts/${prompts[i]}`);
                    if (response.ok) {
                        systemPrompts[i + 1] = await response.text();
                    }
                } catch (err) {
                    console.warn(`Failed to load ${prompts[i]}:`, err);
                }
            }
            originalPrompts = JSON.parse(JSON.stringify(systemPrompts));
        }
    } catch (err) {
        console.error('Failed to load system prompts:', err);
        if (window.showNotification) {
            window.showNotification('Failed to load system prompts', 'error');
        }
    }
}

function displayCurrentPrompt() {
    const promptEditor = document.getElementById('promptEditor');
    const promptTitle = document.getElementById('currentPromptTitle');

    if (systemPrompts[currentPromptStep]) {
        promptEditor.value = systemPrompts[currentPromptStep];
        const titles = {
            1: 'Step 1: Branding & Identity',
            2: 'Step 2: Copywriting & Content',
            3: 'Step 3: Imagery & Visuals',
            4: 'Step 4: Final Review & QA'
        };
        promptTitle.textContent = titles[currentPromptStep];
    }
}

function openSystemPromptsModal() {
    loadSystemPrompts().then(() => {
        currentPromptStep = 1;
        updateTabStates();
        displayCurrentPrompt();
        showModal('systemPromptsModal');
    });
}

function updateTabStates() {
    document.querySelectorAll('.prompt-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`.prompt-tab[data-step="${currentPromptStep}"]`).classList.add('active');
}

async function saveSystemPrompts() {
    try {
        // Update current prompt from textarea
        systemPrompts[currentPromptStep] = document.getElementById('promptEditor').value;

        const response = await fetch('/api/system-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(systemPrompts)
        });

        if (response.ok) {
            originalPrompts = JSON.parse(JSON.stringify(systemPrompts));
            if (window.showNotification) {
                window.showNotification('System prompts saved successfully', 'success');
            }
            hideModal('systemPromptsModal');
        } else {
            throw new Error('Failed to save prompts');
        }
    } catch (err) {
        console.error('Failed to save system prompts:', err);
        if (window.showNotification) {
            window.showNotification('Failed to save system prompts', 'error');
        }
    }
}

function resetCurrentPrompt() {
    if (originalPrompts[currentPromptStep]) {
        systemPrompts[currentPromptStep] = originalPrompts[currentPromptStep];
        displayCurrentPrompt();
        if (window.showNotification) {
            window.showNotification('Prompt reset to original', 'info');
        }
    }
}

// Event Listeners for System Prompts Modal
document.getElementById('editPromptsBtn').addEventListener('click', openSystemPromptsModal);
document.getElementById('closePromptsModal').addEventListener('click', () => hideModal('systemPromptsModal'));
document.getElementById('cancelPromptsBtn').addEventListener('click', () => hideModal('systemPromptsModal'));

document.getElementById('savePromptsBtn').addEventListener('click', saveSystemPrompts);
document.getElementById('resetPromptBtn').addEventListener('click', resetCurrentPrompt);

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

// Close modal when clicking overlay
document.getElementById('systemPromptsModal').addEventListener('click', (e) => {
    if (e.target.id === 'systemPromptsModal') {
        hideModal('systemPromptsModal');
    }
});
```

### Phase 3: Testing and Safety Measures

#### 3.1 Add Comprehensive Testing

**Create Integration Tests:**
```typescript
// tests/systemPrompts.test.ts
describe('System Prompts Editor', () => {
    test('should load all system prompts', async () => {
        const response = await request(app).get('/api/system-prompts');
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('1');
        expect(response.body).toHaveProperty('2');
        expect(response.body).toHaveProperty('3');
        expect(response.body).toHaveProperty('4');
    });

    test('should validate required placeholders', async () => {
        const invalidPrompt = 'Invalid prompt without placeholders';
        const response = await request(app)
            .post('/api/system-prompts')
            .send({ 1: invalidPrompt });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('required placeholder');
    });

    test('should validate completion banners', async () => {
        const invalidPrompt = 'Prompt without completion banner {{taskId}} {{businessName}}';
        const response = await request(app)
            .post('/api/system-prompts')
            .send({ 1: invalidPrompt });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('completion banner');
    });

    test('should save valid prompts', async () => {
        const validPrompt = `# Test Prompt
You are the Test Agent.
{{taskId}} {{businessName}}

echo "========================================"
echo "✅ STEP 1 COMPLETE: TEST"
echo "========================================"
`;

        const response = await request(app)
            .post('/api/system-prompts')
            .send({ 1: validPrompt });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });
});
```

#### 3.2 Add Backup and Recovery Mechanisms

**Automatic Backup System:**
```typescript
// In systemPromptsHandler.ts
async function createPromptBackup(prompts: { [key: number]: string }): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(process.cwd(), 'backups', 'prompts');
    await fs.ensureDir(backupDir);

    const backupPath = path.join(backupDir, `prompts-${timestamp}.json`);
    await fs.writeJson(backupPath, {
        timestamp: new Date().toISOString(),
        prompts: prompts
    }, { spaces: 2 });

    return backupPath;
}

export async function saveSystemPromptsWithBackup(req: Request, res: Response) {
    try {
        // Load current prompts for backup
        const currentPrompts = await loadCurrentPrompts();

        // Create backup
        const backupPath = await createPromptBackup(currentPrompts);
        logger.info(`Created prompt backup: ${backupPath}`);

        // Save new prompts
        await saveSystemPromptsInternal(req.body);

        res.json({
            success: true,
            backupPath: backupPath
        });
    } catch (err) {
        logger.error('Failed to save system prompts with backup:', err);
        res.status(500).json({ error: 'Failed to save system prompts' });
    }
}
```

#### 3.3 Add Change History and Audit Logging

**Audit Logging:**
```typescript
// In systemPromptsHandler.ts
async function logPromptChange(step: number, oldContent: string, newContent: string, userId?: string) {
    const auditEntry = {
        timestamp: new Date().toISOString(),
        step: step,
        userId: userId || 'system',
        action: 'prompt_modified',
        changes: {
            oldLength: oldContent.length,
            newLength: newContent.length,
            diff: generateDiff(oldContent, newContent)
        }
    };

    const auditPath = path.join(process.cwd(), 'logs', 'prompt-audit.jsonl');
    await fs.appendFile(auditPath, JSON.stringify(auditEntry) + '\n');
}

function generateDiff(oldStr: string, newStr: string): string {
    // Simple diff implementation - could use a proper diff library
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');

    // Basic line-by-line comparison
    const changes = [];
    const maxLines = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i] || '';
        const newLine = newLines[i] || '';

        if (oldLine !== newLine) {
            changes.push(`Line ${i + 1}: "${oldLine}" → "${newLine}"`);
        }
    }

    return changes.join('; ');
}
```

#### 3.4 Add User Permissions and Access Control

**Role-Based Access Control:**
```typescript
// In systemPromptsHandler.ts
function checkPromptEditPermission(user: any): boolean {
    // Only allow admin users to edit system prompts
    return user && user.role === 'admin';
}

export async function getSystemPrompts(req: Request, res: Response) {
    // Check permissions
    if (!checkPromptEditPermission(req.user)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // ... rest of function
}

export async function saveSystemPrompts(req: Request, res: Response) {
    // Check permissions
    if (!checkPromptEditPermission(req.user)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // ... rest of function
}
```

## Risk Mitigation Strategies

### 1. **Completion Detection Safety**
- Keep ASCII banner format consistent
- Add validation to ensure banners contain required text
- Test completion detection after any banner changes

### 2. **Template Placeholder Safety**
- Validate all required placeholders are present
- Add tests for placeholder replacement
- Document all available placeholders

### 3. **Agent Behavior Consistency**
- Maintain agent identity and role clarity
- Preserve workflow history format
- Keep ImageRetriever integration intact

### 4. **Deployment Safety**
- Create backups before changes
- Add rollback capability
- Test in staging environment first
- Implement gradual rollout

### 5. **Monitoring and Alerts**
- Log all prompt changes
- Monitor for completion detection failures
- Alert on unusual agent behavior
- Track prompt performance metrics

## Testing Strategy

### Unit Tests
- Validate prompt loading and saving
- Test placeholder replacement
- Verify completion banner validation
- Check file permissions

### Integration Tests
- End-to-end demo creation workflow
- Frontend modal functionality
- API endpoint validation
- Cross-browser compatibility

### Performance Tests
- Large prompt file handling
- Concurrent access
- Memory usage monitoring
- Response time validation

### Security Tests
- Access control validation
- Input sanitization
- XSS prevention
- SQL injection prevention (if applicable)

## Rollout Plan

### Phase 1 Rollout
1. Deploy backend API endpoints
2. Test API functionality
3. Validate prompt loading/saving
4. Monitor error rates

### Phase 2 Rollout
1. Deploy frontend UI components
2. Test modal functionality
3. Validate user workflows
4. Monitor user adoption

### Phase 3 Rollout
1. Deploy safety measures
2. Enable audit logging
3. Add monitoring alerts
4. Train administrators

## Monitoring and Maintenance

### Key Metrics to Monitor
- Prompt save success rate
- Completion detection accuracy
- Demo creation success rate
- User error rates
- System performance

### Maintenance Tasks
- Regular backup verification
- Audit log review
- Security updates
- Performance optimization
- User feedback review

## Conclusion

This implementation provides a comprehensive system for editing system prompts while maintaining system stability and reliability. The phased approach ensures thorough testing and risk mitigation at each stage.
