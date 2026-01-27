// Formatting utilities for dates, text, etc.

const FormattingUtils = {
    /**
     * Format date to relative time (e.g., "2 hours ago", "3 days ago")
     * Handles edge cases: null, invalid dates, and future dates
     */
    formatRelativeTime(date) {
        if (!date) return 'Unknown';
        
        const now = new Date();
        const then = new Date(date);
        
        // Handle invalid dates (NaN check)
        if (isNaN(then.getTime())) {
            return 'Unknown';
        }
        
        const diffMs = now - then;
        
        // Handle future dates gracefully
        if (diffMs < 0) {
            return 'just now';
        }
        
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 60) {
            return 'just now';
        } else if (diffMins < 60) {
            return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
        } else if (diffHours < 24) {
            return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
        } else if (diffDays < 7) {
            return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
        } else {
            return this.formatDate(date);
        }
    },

    /**
     * Format date to readable string
     */
    formatDate(date) {
        if (!date) return 'Unknown';
        
        const d = new Date(date);
        return d.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    },

    /**
     * Format date to short string
     */
    formatDateShort(date) {
        if (!date) return 'Unknown';
        
        const d = new Date(date);
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Truncate text with ellipsis
     */
    truncate(text, maxLength = 100) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    },

    /**
     * Format file size
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    },

    /**
     * Format number with commas
     */
    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    /**
     * Capitalize first letter
     */
    capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    },

    /**
     * Format state name (replace underscores with spaces, capitalize)
     */
    formatState(state) {
        if (!state) return '';
        return state.replace(/_/g, ' ').split(' ').map(this.capitalize).join(' ');
    },
};










