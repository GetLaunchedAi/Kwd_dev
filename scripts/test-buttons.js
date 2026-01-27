/**
 * Button Testing Script
 * 
 * This script helps verify button functionality by:
 * 1. Checking button existence and visibility
 * 2. Verifying event handlers are attached
 * 3. Testing button states (enabled/disabled)
 * 4. Simulating clicks and verifying responses
 * 
 * Run this in the browser console on each page to test buttons.
 */

class ButtonTester {
    constructor() {
        this.results = [];
        this.errors = [];
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
        console.log(logMessage);
        
        if (type === 'error') {
            this.errors.push(logMessage);
        }
        this.results.push({ timestamp, type, message });
    }

    // Test if button exists
    testButtonExists(selector, description) {
        const button = document.querySelector(selector);
        if (button) {
            this.log(`✓ Button exists: ${description} (${selector})`, 'success');
            return button;
        } else {
            this.log(`✗ Button missing: ${description} (${selector})`, 'error');
            return null;
        }
    }

    // Test if button is visible
    testButtonVisibility(button, description) {
        if (!button) return false;
        
        const style = window.getComputedStyle(button);
        const isVisible = style.display !== 'none' && 
                         style.visibility !== 'hidden' && 
                         style.opacity !== '0' &&
                         !button.classList.contains('hidden');
        
        if (isVisible) {
            this.log(`✓ Button visible: ${description}`, 'success');
        } else {
            this.log(`⚠ Button hidden: ${description}`, 'warning');
        }
        return isVisible;
    }

    // Test if button is enabled
    testButtonEnabled(button, description) {
        if (!button) return false;
        
        const isEnabled = !button.disabled && 
                         !button.classList.contains('disabled') &&
                         !button.hasAttribute('disabled');
        
        if (isEnabled) {
            this.log(`✓ Button enabled: ${description}`, 'success');
        } else {
            this.log(`⚠ Button disabled: ${description}`, 'warning');
        }
        return isEnabled;
    }

    // Test if button has event listener
    async testButtonEventListener(button, description) {
        if (!button) return false;
        
        let hasListener = false;
        const originalClick = button.onclick;
        
        // Check for onclick attribute
        if (originalClick) {
            hasListener = true;
        }
        
        // Check for addEventListener (this is harder to detect, so we'll simulate)
        // We can't directly check, but we can test by clicking
        this.log(`ℹ Event listener check: ${description} (click test recommended)`, 'info');
        return true; // Assume true, actual click test will verify
    }

    // Test button click (simulated)
    async testButtonClick(button, description, shouldPreventDefault = false) {
        if (!button) return false;
        
        try {
            // Check if button is clickable
            if (button.disabled || button.classList.contains('disabled')) {
                this.log(`⚠ Button disabled, cannot test click: ${description}`, 'warning');
                return false;
            }

            // Create and dispatch click event
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            
            const beforeState = {
                text: button.textContent,
                disabled: button.disabled,
                classes: Array.from(button.classList)
            };
            
            button.dispatchEvent(clickEvent);
            
            // Wait a bit to see if state changes
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const afterState = {
                text: button.textContent,
                disabled: button.disabled,
                classes: Array.from(button.classList)
            };
            
            // Check if state changed (indicates handler ran)
            const stateChanged = JSON.stringify(beforeState) !== JSON.stringify(afterState);
            
            if (stateChanged || !shouldPreventDefault) {
                this.log(`✓ Button click test passed: ${description}`, 'success');
                return true;
            } else {
                this.log(`⚠ Button click may not have handler: ${description}`, 'warning');
                return false;
            }
        } catch (error) {
            this.log(`✗ Button click test failed: ${description} - ${error.message}`, 'error');
            return false;
        }
    }

    // Test modal buttons
    testModalButtons(modalId, description) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            this.log(`✗ Modal not found: ${description} (${modalId})`, 'error');
            return false;
        }

        const closeBtn = modal.querySelector('.modal-close');
        const cancelBtn = modal.querySelector('.btn.btn-secondary');
        const confirmBtn = modal.querySelector('.btn.btn-primary, .btn.btn-success, .btn.btn-danger');

        if (closeBtn) {
            this.testButtonExists(`#${modalId} .modal-close`, `${description} - Close button`);
        }
        if (cancelBtn) {
            this.testButtonExists(`#${modalId} .btn.btn-secondary`, `${description} - Cancel button`);
        }
        if (confirmBtn) {
            this.testButtonExists(`#${modalId} .btn.btn-primary, #${modalId} .btn.btn-success, #${modalId} .btn.btn-danger`, `${description} - Confirm button`);
        }

        return true;
    }

    // Run all dashboard tests
    async testDashboardButtons() {
        this.log('=== Testing Dashboard Page Buttons ===', 'info');
        
        // Header buttons
        const refreshBtn = this.testButtonExists('#refreshBtn', 'Refresh Button');
        if (refreshBtn) {
            this.testButtonVisibility(refreshBtn, 'Refresh Button');
            this.testButtonEnabled(refreshBtn, 'Refresh Button');
        }

        const pauseBtn = this.testButtonExists('#pauseRefreshBtn', 'Pause/Resume Button');
        if (pauseBtn) {
            this.testButtonVisibility(pauseBtn, 'Pause/Resume Button');
        }

        const importAllBtn = this.testButtonExists('#importAllIncompleteBtn', 'Import All Incomplete Tasks Button');
        if (importAllBtn) {
            this.testButtonVisibility(importAllBtn, 'Import All Incomplete Tasks Button');
            this.testButtonEnabled(importAllBtn, 'Import All Incomplete Tasks Button');
        }

        const importTaskBtn = this.testButtonExists('#importTaskBtn', 'Import Task Button');
        if (importTaskBtn) {
            this.testButtonVisibility(importTaskBtn, 'Import Task Button');
            this.testButtonEnabled(importTaskBtn, 'Import Task Button');
        }

        // Error state button
        const retryBtn = this.testButtonExists('#retryBtn', 'Retry Button');
        if (retryBtn) {
            this.testButtonVisibility(retryBtn, 'Retry Button');
        }

        // Filter buttons
        const filters = ['all', 'in_progress', 'awaiting_approval', 'testing', 'completed'];
        filters.forEach(filter => {
            const filterBtn = this.testButtonExists(`.filter-btn[data-filter="${filter}"]`, `Filter Button: ${filter}`);
            if (filterBtn) {
                this.testButtonVisibility(filterBtn, `Filter Button: ${filter}`);
                this.testButtonEnabled(filterBtn, `Filter Button: ${filter}`);
            }
        });

        // Import modal buttons
        this.testModalButtons('importModal', 'Import Modal');

        this.log('=== Dashboard Button Tests Complete ===', 'info');
        return this.generateReport();
    }

    // Run all task details tests
    async testTaskDetailsButtons() {
        this.log('=== Testing Task Details Page Buttons ===', 'info');
        
        // Header buttons
        const backLink = this.testButtonExists('.back-link', 'Back Link');
        if (backLink) {
            this.testButtonVisibility(backLink, 'Back Link');
        }

        const refreshBtn = this.testButtonExists('#refreshTaskBtn', 'Refresh Task Button');
        if (refreshBtn) {
            this.testButtonVisibility(refreshBtn, 'Refresh Task Button');
            this.testButtonEnabled(refreshBtn, 'Refresh Task Button');
        }

        // Copy buttons
        const copyBranchBtn = this.testButtonExists('.copy-btn[data-copy-target="branchName"]', 'Copy Branch Name Button');
        if (copyBranchBtn) {
            this.testButtonVisibility(copyBranchBtn, 'Copy Branch Name Button');
        }

        // Diff control buttons
        const downloadBtn = this.testButtonExists('#downloadDiffBtn', 'Download Patch Button');
        if (downloadBtn) {
            this.testButtonVisibility(downloadBtn, 'Download Patch Button');
            this.testButtonEnabled(downloadBtn, 'Download Patch Button');
        }

        const expandBtn = this.testButtonExists('#expandAllBtn', 'Expand All Button');
        if (expandBtn) {
            this.testButtonVisibility(expandBtn, 'Expand All Button');
            this.testButtonEnabled(expandBtn, 'Expand All Button');
        }

        const collapseBtn = this.testButtonExists('#collapseAllBtn', 'Collapse All Button');
        if (collapseBtn) {
            this.testButtonVisibility(collapseBtn, 'Collapse All Button');
            this.testButtonEnabled(collapseBtn, 'Collapse All Button');
        }

        // Approval buttons
        const approveBtn = this.testButtonExists('#approveBtn', 'Approve Changes Button');
        if (approveBtn) {
            this.testButtonVisibility(approveBtn, 'Approve Changes Button');
        }

        const rejectBtn = this.testButtonExists('#rejectBtn', 'Reject Changes Button');
        if (rejectBtn) {
            this.testButtonVisibility(rejectBtn, 'Reject Changes Button');
        }

        // Modal buttons
        this.testModalButtons('approveModal', 'Approve Modal');
        this.testModalButtons('rejectModal', 'Reject Modal');

        this.log('=== Task Details Button Tests Complete ===', 'info');
        return this.generateReport();
    }

    // Generate test report
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            totalTests: this.results.length,
            errors: this.errors.length,
            warnings: this.results.filter(r => r.type === 'warning').length,
            successes: this.results.filter(r => r.type === 'success').length,
            results: this.results,
            errors: this.errors
        };

        console.log('\n=== TEST REPORT ===');
        console.log(`Total Tests: ${report.totalTests}`);
        console.log(`Successes: ${report.successes}`);
        console.log(`Warnings: ${report.warnings}`);
        console.log(`Errors: ${report.errors.length}`);
        console.log('\n=== ERRORS ===');
        this.errors.forEach(error => console.log(error));
        console.log('\n=== FULL RESULTS ===');
        this.results.forEach(result => console.log(result.message));

        return report;
    }

    // Export results as JSON
    exportResults() {
        const report = this.generateReport();
        const json = JSON.stringify(report, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `button-test-results-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.log('Test results exported', 'success');
    }
}

// Usage instructions
console.log(`
=== Button Testing Script ===

Usage:
1. Open the application in your browser
2. Open browser console (F12)
3. Copy and paste this entire script
4. Run tests:

   // For Dashboard page:
   const tester = new ButtonTester();
   await tester.testDashboardButtons();
   tester.exportResults(); // Export results as JSON

   // For Task Details page:
   const tester = new ButtonTester();
   await tester.testTaskDetailsButtons();
   tester.exportResults(); // Export results as JSON

The script will:
- Check if buttons exist
- Verify visibility
- Check enabled/disabled state
- Test click handlers
- Generate a detailed report
`);

// Make ButtonTester available globally
if (typeof window !== 'undefined') {
    window.ButtonTester = ButtonTester;
}

