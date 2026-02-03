/**
 * Environment Configuration for KWD Dev Dashboard
 * 
 * Provides environment-aware URLs for:
 * - API calls
 * - Demo/preview URLs (local preview servers vs production static serving)
 */

(function() {
  'use strict';

  // Environment detection based on hostname
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isProduction = !isLocalhost;

  // Production domain (Cloudways)
  const PRODUCTION_DOMAIN = 'phpstack-1518311-6128748.cloudwaysapps.com';

  const config = {
    // Environment info
    environment: isProduction ? 'production' : 'development',
    isProduction: isProduction,
    isLocalhost: isLocalhost,

    // Base URLs
    // API base is relative in production (same domain), full URL in dev
    apiBase: isProduction ? '' : '',

    // Production URL for demos (static file serving)
    productionBase: `https://${PRODUCTION_DOMAIN}`,

    /**
     * Gets the URL for viewing a demo/preview site.
     * 
     * @param {string} slug - The demo/client folder slug
     * @param {number|null} localPort - If provided, use this port for local preview
     * @returns {string} The URL to access the demo
     */
    getDemoUrl: function(slug, localPort) {
      if (isProduction) {
        // Production: serve from /client-websites/{slug}/
        return `/client-websites/${slug}/`;
      } else if (localPort) {
        // Local with known port: use preview server
        return `http://localhost:${localPort}`;
      } else {
        // Local without port: use static serving (for built demos)
        return `/client-websites/${slug}/`;
      }
    },

    /**
     * Gets the URL for the preview server (only for local development).
     * Returns null in production since we use static serving.
     * 
     * @param {number} port - The preview server port
     * @returns {string|null} The preview server URL or null in production
     */
    getPreviewServerUrl: function(port) {
      if (isProduction) {
        return null; // No preview servers in production
      }
      return `http://localhost:${port}`;
    },

    /**
     * Determines if local preview servers are available.
     * Preview servers only work in development (localhost).
     * 
     * @returns {boolean} True if preview servers can be used
     */
    canUsePreviewServers: function() {
      return isLocalhost;
    },

    /**
     * Gets the static demo URL (always available, both dev and prod).
     * This uses the built /public/ folder served via Express.
     * 
     * @param {string} slug - The demo/client folder slug
     * @returns {string} The static demo URL
     */
    getStaticDemoUrl: function(slug) {
      return `/client-websites/${slug}/`;
    }
  };

  // Expose globally
  window.APP_CONFIG = config;
  
  // Expose API_BASE_URL for scripts that use it directly
  // This is empty string since API is on the same origin
  window.API_BASE_URL = '';

  // Log environment on load (for debugging)
  console.log(`[KWD Dev] Environment: ${config.environment}, Host: ${hostname}`);
})();

