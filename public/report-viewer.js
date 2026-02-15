(function() {
    async function init() {
        const pathParts = window.location.pathname.split('/');
        const token = pathParts[pathParts.length - 1];

        if (!token) {
            showError('Invalid Link', 'No share token provided in the URL.');
            return;
        }

        try {
            const response = await fetch(`/api/reports/share/data/${token}`);
            if (!response.ok) {
                if (response.status === 404) {
                    showError('Report Not Found', 'This share link may have expired or the report was deleted.');
                } else {
                    showError('Error', 'An unexpected error occurred while loading the report.');
                }
                return;
            }

            const data = await response.json();
            renderReport(data, token);
        } catch (error) {
            console.error('Error loading report:', error);
            showError('Connection Error', 'Failed to connect to the reporting server.');
        }
    }

    function renderReport(data, token) {
        const { siteSlug, reportType, summary, meta, performanceHtml, expiresAt } = data;
        
        // Update Header
        const typeLabel = reportType.charAt(0).toUpperCase() + reportType.slice(1);
        document.getElementById('reportTitle').textContent = `${typeLabel} Report: ${siteSlug}`;
        
        const date = new Date(meta.finishedAt || meta.startedAt).toLocaleString();
        const expiryDate = new Date(expiresAt).toLocaleDateString();
        document.getElementById('reportMeta').innerHTML = `
            Run on ${date} &bull; Shared view expires on ${expiryDate}
        `;

        const contentArea = document.getElementById('reportContent');
        document.getElementById('loading').classList.add('hidden');

        if (reportType === 'performance') {
            if (performanceHtml) {
                const iframe = document.createElement('iframe');
                iframe.src = performanceHtml;
                iframe.className = 'report-iframe';
                contentArea.appendChild(iframe);
            } else {
                renderPerformanceSummary(summary, contentArea);
            }
        } else if (reportType === 'security') {
            renderSecurityReport(summary, contentArea);
        }

        // Initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    function renderPerformanceSummary(summary, container) {
        // Fallback if full Lighthouse HTML isn't available
        const div = document.createElement('div');
        div.className = 'security-report';
        div.innerHTML = `
            <h2>Performance Summary</h2>
            <div class="security-grid">
                <div class="security-card">
                    <h3>Performance Score</h3>
                    <div class="security-value ${getScoreClass(summary.performance)}">${summary.performance || 'N/A'}</div>
                </div>
                <div class="security-card">
                    <h3>Accessibility</h3>
                    <div class="security-value ${getScoreClass(summary.accessibility)}">${summary.accessibility || 'N/A'}</div>
                </div>
                <div class="security-card">
                    <h3>Best Practices</h3>
                    <div class="security-value ${getScoreClass(summary.bestPractices)}">${summary.bestPractices || 'N/A'}</div>
                </div>
                <div class="security-card">
                    <h3>SEO</h3>
                    <div class="security-value ${getScoreClass(summary.seo)}">${summary.seo || 'N/A'}</div>
                </div>
            </div>
        `;
        container.appendChild(div);
    }

    function renderSecurityReport(summary, container) {
        const div = document.createElement('div');
        div.className = 'security-report';
        
        const vulnerabilities = summary.vulnerabilities || { high: 0, moderate: 0, low: 0 };
        
        div.innerHTML = `
            <h2>Security Audit Summary</h2>
            <p>Dependency vulnerabilities found in the latest build:</p>
            <div class="security-grid">
                <div class="security-card">
                    <h3>High Severity</h3>
                    <div class="security-value severity-high">${vulnerabilities.high || 0}</div>
                </div>
                <div class="security-card">
                    <h3>Moderate Severity</h3>
                    <div class="security-value severity-medium">${vulnerabilities.moderate || 0}</div>
                </div>
                <div class="security-card">
                    <h3>Low Severity</h3>
                    <div class="security-value severity-low">${vulnerabilities.low || 0}</div>
                </div>
            </div>
            
            <div style="margin-top: 3rem;">
                <h3>Audit Details</h3>
                <p>${summary.message || 'No additional details available for this public view.'}</p>
            </div>
        `;
        container.appendChild(div);
    }

    function getScoreClass(score) {
        if (!score && score !== 0) return '';
        const n = parseInt(score);
        if (n >= 90) return 'severity-low';
        if (n >= 50) return 'severity-medium';
        return 'severity-high';
    }

    function showError(title, message) {
        document.getElementById('loading').classList.add('hidden');
        const errorEl = document.getElementById('error');
        errorEl.classList.remove('hidden');
        document.getElementById('errorTitle').textContent = title;
        document.getElementById('errorMessage').textContent = message;
        
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();





