/**
 * Theme Management Utility
 * Shared theme initialization and toggling across all pages
 */

const ThemeUtils = {
    LIGHT_THEME: 'light-theme',
    DARK_THEME: 'dark-theme',
    STORAGE_KEY: 'theme',

    /**
     * Gets the currently active theme
     * @returns {string} The current theme class name
     */
    getCurrentTheme() {
        return document.body.classList.contains(this.DARK_THEME) 
            ? this.DARK_THEME 
            : this.LIGHT_THEME;
    },

    /**
     * Gets the saved theme from localStorage, or returns default
     * Handles migration from old 'dark'/'light' format to new format
     * @returns {string} The saved or default theme
     */
    getSavedTheme() {
        let saved = localStorage.getItem(this.STORAGE_KEY);
        
        // Migrate old format ('dark'/'light') to new format ('dark-theme'/'light-theme')
        if (saved === 'dark') {
            saved = this.DARK_THEME;
            localStorage.setItem(this.STORAGE_KEY, saved);
        } else if (saved === 'light') {
            saved = this.LIGHT_THEME;
            localStorage.setItem(this.STORAGE_KEY, saved);
        }
        
        return saved || this.LIGHT_THEME;
    },

    /**
     * Initializes the theme based on saved preference
     * Should be called on DOMContentLoaded
     */
    init() {
        const savedTheme = this.getSavedTheme();
        document.body.className = savedTheme;
        this.updateToggleUI(savedTheme);
    },

    /**
     * Toggles between light and dark theme
     */
    toggle() {
        const currentTheme = this.getCurrentTheme();
        const newTheme = currentTheme === this.LIGHT_THEME 
            ? this.DARK_THEME 
            : this.LIGHT_THEME;
        
        document.body.className = newTheme;
        localStorage.setItem(this.STORAGE_KEY, newTheme);
        this.updateToggleUI(newTheme);
    },

    /**
     * Updates the theme toggle button UI to reflect current state
     * @param {string} theme - The current theme
     */
    updateToggleUI(theme) {
        const sunIcon = document.getElementById('sunIcon');
        const moonIcon = document.getElementById('moonIcon');
        const themeText = document.querySelector('#themeToggle span');
        
        if (theme === this.DARK_THEME) {
            sunIcon?.classList.add('hidden');
            moonIcon?.classList.remove('hidden');
            if (themeText) themeText.textContent = 'Dark Mode';
        } else {
            sunIcon?.classList.remove('hidden');
            moonIcon?.classList.add('hidden');
            if (themeText) themeText.textContent = 'Light Mode';
        }
    },

    /**
     * Sets up event listener for the theme toggle button
     * @param {string} buttonId - The ID of the toggle button (default: 'themeToggle')
     */
    setupToggleListener(buttonId = 'themeToggle') {
        const toggleBtn = document.getElementById(buttonId);
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggle());
        }
    }
};

// For backwards compatibility, expose functions at window level
// This allows existing code to work while transitioning to ThemeUtils
window.initTheme = () => ThemeUtils.init();
window.toggleTheme = () => ThemeUtils.toggle();
window.updateThemeToggleUI = (theme) => ThemeUtils.updateToggleUI(theme);

// Export for module usage if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThemeUtils;
}

