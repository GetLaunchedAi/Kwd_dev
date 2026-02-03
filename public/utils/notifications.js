// Toast notification system

class NotificationManager {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        // Create notification container if it doesn't exist
        if (!document.getElementById('notification-container')) {
            this.container = document.createElement('div');
            this.container.id = 'notification-container';
            this.container.className = 'notification-container';
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('notification-container');
        }
    }

    show(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        const icon = this.getIcon(type);
        notification.innerHTML = `
            <span class="notification-icon">${icon}</span>
            <span class="notification-message">${this.escapeHtml(message)}</span>
            <button class="notification-close" aria-label="Close">&times;</button>
        `;

        this.container.appendChild(notification);

        // Trigger animation
        setTimeout(() => {
            notification.classList.add('show');
            // Add auto-dismiss class for progress bar animation
            if (duration > 0) {
                notification.classList.add('auto-dismiss');
            }
        }, 10);

        // Close button handler
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => {
            this.remove(notification);
        });

        // Auto-remove after duration
        if (duration > 0) {
            setTimeout(() => {
                this.remove(notification);
            }, duration);
        }

        return notification;
    }

    success(message, duration = 5000) {
        return this.show(message, 'success', duration);
    }

    error(message, duration = 7000) {
        return this.show(message, 'error', duration);
    }

    info(message, duration = 5000) {
        return this.show(message, 'info', duration);
    }

    warning(message, duration = 6000) {
        return this.show(message, 'warning', duration);
    }

    /**
     * Shows a recoverable error notification with action buttons.
     * Does not auto-dismiss - requires user action.
     * @param {string} message - The error message
     * @param {Array} actions - Array of action objects: { label, onClick, className }
     * @param {string} type - Notification type (default: 'error')
     * @returns {HTMLElement} The notification element
     */
    recoverable(message, actions = [], type = 'error') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type} notification-recoverable`;
        
        const icon = this.getIcon(type);
        
        // Build actions HTML
        const actionsHtml = actions.map(action => {
            const className = action.className || 'notification-action-btn';
            return `<button class="${className}" data-action="${action.label}">${this.escapeHtml(action.label)}</button>`;
        }).join('');
        
        notification.innerHTML = `
            <span class="notification-icon">${icon}</span>
            <div class="notification-content">
                <span class="notification-message">${this.escapeHtml(message)}</span>
                ${actions.length > 0 ? `<div class="notification-actions">${actionsHtml}</div>` : ''}
            </div>
            <button class="notification-close" aria-label="Close">&times;</button>
        `;

        this.container.appendChild(notification);

        // Trigger animation
        setTimeout(() => {
            notification.classList.add('show');
            // No auto-dismiss class - requires user action
        }, 10);

        // Close button handler
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => {
            this.remove(notification);
        });

        // Action button handlers
        actions.forEach(action => {
            const btn = notification.querySelector(`[data-action="${action.label}"]`);
            if (btn && action.onClick) {
                btn.addEventListener('click', () => {
                    action.onClick();
                    if (!action.keepOpen) {
                        this.remove(notification);
                    }
                });
            }
        });

        return notification;
    }

    /**
     * Shows a credit error notification with retry options
     */
    creditError(message, onRetry, onWait) {
        return this.recoverable(message, [
            { label: 'Retry Now', onClick: onRetry, className: 'notification-action-btn primary' },
            { label: 'Wait', onClick: onWait, className: 'notification-action-btn secondary' }
        ], 'error');
    }

    /**
     * Shows a network error notification with auto-retry option
     */
    networkError(message, onRetry) {
        return this.recoverable(message, [
            { label: 'Retry', onClick: onRetry, className: 'notification-action-btn primary' }
        ], 'warning');
    }

    remove(notification) {
        notification.classList.remove('show');
        notification.classList.add('hide');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }

    getIcon(type) {
        const icons = {
            success: '✓',
            error: '✗',
            warning: '⚠',
            info: 'ℹ',
        };
        return icons[type] || icons.info;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    clear() {
        const notifications = this.container.querySelectorAll('.notification');
        notifications.forEach(notification => this.remove(notification));
    }
}

// Export singleton instance
const notifications = new NotificationManager();










