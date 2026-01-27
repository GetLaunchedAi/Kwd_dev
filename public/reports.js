/**
 * Site Reports Dashboard Logic
 */

let allSites = [];
let selectedSite = null;
let schedules = [];
let jobPollingIntervals = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize icons
    if (window.lucide) lucide.createIcons();
    
    // Theme initialization
    initTheme();
    
    // Load sites for the selector
    loadSites();
    
    // Event Listeners
    document.getElementById('siteSelector')?.addEventListener('change', (e) => {
        handleSiteChange(e.target.value);
    });

    document.getElementById('refreshDataBtn')?.addEventListener('click', () => {
        if (selectedSite) {
            refreshSiteData(selectedSite);
        } else {
            loadSites();
        }
    });

    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

    // Performance Run
    document.getElementById('runPerfBtn')?.addEventListener('click', () => {
        runReport('performance');
    });

    // Security Run
    document.getElementById('runSecBtn')?.addEventListener('click', () => {
        runReport('security');
    });

    // Scheduling
    document.getElementById('perfCadence')?.addEventListener('change', (e) => {
        updateSchedule('performance', e.target.value);
    });

    document.getElementById('secCadence')?.addEventListener('change', (e) => {
        updateSchedule('security', e.target.value);
    });

    // Share Link Modal
    const shareModal = document.getElementById('shareModal');
    const closeShareModal = document.getElementById('closeShareModal');
    const cancelShareBtn = document.getElementById('cancelShareBtn');
    
    const closeShareModalFn = () => {
        shareModal.classList.remove('show');
        setTimeout(() => shareModal.classList.add('hidden'), 300);
    };

    closeShareModal?.addEventListener('click', closeShareModalFn);
    cancelShareBtn?.addEventListener('click', closeShareModalFn);

    // Check for site in URL
    const urlParams = new URLSearchParams(window.location.search);
    const siteParam = urlParams.get('site');
    if (siteParam) {
        // We'll handle this once sites are loaded
    }
});

/**
 * Loads the list of sites for the selector
 */
async function loadSites() {
    try {
        const sites = await api.get('/clients');
        allSites = sites || [];
        
        const selector = document.getElementById('siteSelector');
        if (!selector) return;
        
        // Save current selection
        const currentVal = selector.value;
        
        // Clear except first option
        selector.innerHTML = '<option value="">Select a Site...</option>';
        
        allSites.forEach(site => {
            const option = document.createElement('option');
            option.value = site.folder; // siteSlug
            option.textContent = site.name;
            selector.appendChild(option);
        });

        // Restore selection or use URL param
        const urlParams = new URLSearchParams(window.location.search);
        const siteParam = urlParams.get('site');
        
        if (siteParam && allSites.some(s => s.folder === siteParam)) {
            selector.value = siteParam;
            handleSiteChange(siteParam);
        } else if (currentVal && allSites.some(s => s.folder === currentVal)) {
            selector.value = currentVal;
        }
    } catch (error) {
        console.error('Error loading sites:', error);
        notifications.error('Failed to load sites list');
    }
}

/**
 * Handles site selection change
 */
function handleSiteChange(siteSlug) {
    if (!siteSlug) {
        document.getElementById('noSiteSelected').classList.remove('hidden');
        document.getElementById('reportsContent').classList.add('hidden');
        selectedSite = null;
        return;
    }

    selectedSite = siteSlug;
    document.getElementById('noSiteSelected').classList.add('hidden');
    document.getElementById('reportsContent').classList.remove('hidden');
    
    // Update URL without reloading
    const url = new URL(window.location);
    url.searchParams.set('site', siteSlug);
    window.history.pushState({}, '', url);

    const site = allSites.find(s => s.folder === siteSlug);
    if (site) {
        document.getElementById('pageTitle').textContent = `Reports: ${site.name}`;
    }

    refreshSiteData(siteSlug);
}

/**
 * Refreshes all data for a specific site
 */
async function refreshSiteData(siteSlug) {
    // 1. Uptime
    loadUptime(siteSlug);
    
    // 2. Latest Runs
    loadLatestRun(siteSlug, 'performance');
    loadLatestRun(siteSlug, 'security');
    
    // 3. Schedules
    loadSchedules(siteSlug);
}

/**
 * Loads uptime data
 */
async function loadUptime(siteSlug) {
    try {
        const data = await api.get(`/uptime/${siteSlug}`);
        
        const uptimeStats = document.getElementById('uptimeStats');
        const unconfigured = document.getElementById('uptimeUnconfigured');
        
        if (data.status === 'UNCONFIGURED') {
            uptimeStats.classList.add('hidden');
            unconfigured.classList.remove('hidden');
            return;
        }

        uptimeStats.classList.remove('hidden');
        unconfigured.classList.add('hidden');

        document.getElementById('uptime24h').textContent = data.window24h !== null ? `${data.window24h.toFixed(2)}%` : '--%';
        document.getElementById('uptime7d').textContent = data.window7d !== null ? `${data.window7d.toFixed(2)}%` : '--%';
        document.getElementById('unknown24h').textContent = `Unknown: ${data.unknown24h || 0}`;
        document.getElementById('unknown7d').textContent = `Unknown: ${data.unknown7d || 0}`;
        document.getElementById('avgLatency').textContent = data.avgLatencyMs24h ? `${Math.round(data.avgLatencyMs24h)}ms` : '--ms';
        
        if (data.lastCheckedAt) {
            document.getElementById('lastChecked').textContent = `Last checked: ${FormattingUtils.formatRelativeTime(data.lastCheckedAt)}`;
        }

        // Color coding
        const updateColor = (id, value) => {
            const el = document.getElementById(id);
            if (value === null) return;
            if (value >= 99) el.style.color = 'var(--color-success)';
            else if (value >= 95) el.style.color = 'var(--color-warning)';
            else el.style.color = 'var(--color-danger)';
        };

        updateColor('uptime24h', data.window24h);
        updateColor('uptime7d', data.window7d);
    } catch (error) {
        console.error('Error loading uptime:', error);
    }
}

/**
 * Loads the latest run for a site/type
 */
async function loadLatestRun(siteSlug, type) {
    const container = document.getElementById(type === 'performance' ? 'latestPerfRun' : 'latestSecRun');
    
    try {
        const run = await api.get(`/reports/${siteSlug}/latest?type=${type}`);
        
        if (!run) {
            container.innerHTML = '<div class="text-hint">No reports generated yet.</div>';
            return;
        }

        let summaryHtml = '';
        if (type === 'performance' && run.summary) {
            const score = run.summary.performance || 0;
            const scoreClass = score >= 90 ? 'score-good' : (score >= 50 ? 'score-average' : 'score-poor');
            summaryHtml = `<span class="score-badge ${scoreClass}">${Math.round(score)}</span>`;
        } else if (type === 'security' && run.summary) {
            const high = run.summary.high || 0;
            const med = run.summary.moderate || 0;
            if (high > 0) summaryHtml = `<span class="score-badge score-poor">${high} High</span>`;
            else if (med > 0) summaryHtml = `<span class="score-badge score-average">${med} Med</span>`;
            else summaryHtml = `<span class="score-badge score-good">Clean</span>`;
        }

        container.innerHTML = `
            <div class="run-item">
                <div class="run-info">
                    <div class="run-date">${FormattingUtils.formatDateShort(run.finishedAt)}</div>
                    <div class="run-summary">
                        ${summaryHtml}
                        <span class="ml-sm">Run ID: ${run.runId.substring(0, 8)}</span>
                    </div>
                </div>
                <div class="run-actions">
                    <button class="btn btn-ghost btn-xs share-btn" data-run-id="${run.runId}" data-type="${type}" title="Share Report">
                        <i data-lucide="share-2"></i>
                    </button>
                    <button class="btn btn-ghost btn-xs view-report-btn" data-run-id="${run.runId}" data-type="${type}" title="View Report">
                        <i data-lucide="external-link"></i>
                    </button>
                </div>
            </div>
        `;

        if (window.lucide) lucide.createIcons();

        // Add listeners
        container.querySelector('.share-btn')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            openShareModal(siteSlug, btn.dataset.runId, btn.dataset.type);
        });

        container.querySelector('.view-report-btn')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            // For view, we can generate a temporary share link and navigate
            generateViewUrl(siteSlug, btn.dataset.runId, btn.dataset.type);
        });

    } catch (error) {
        if (error.status !== 404) {
            console.error(`Error loading latest ${type} run:`, error);
        }
        container.innerHTML = '<div class="text-hint">No reports generated yet.</div>';
    }
}

/**
 * Loads schedules for the site
 */
async function loadSchedules(siteSlug) {
    try {
        const siteSchedules = await api.get(`/schedules?siteSlug=${siteSlug}`);
        schedules = siteSchedules || [];
        
        // Update UI
        const perfSchedule = schedules.find(s => s.reportTypes.includes('performance'));
        const secSchedule = schedules.find(s => s.reportTypes.includes('security'));
        
        const perfSelect = document.getElementById('perfCadence');
        const secSelect = document.getElementById('secCadence');
        
        if (perfSelect) {
            perfSelect.value = perfSchedule ? perfSchedule.cadence : 'off';
            document.getElementById('perfNextRun').textContent = perfSchedule 
                ? `Next run: ${FormattingUtils.formatDateShort(perfSchedule.nextRunAt)}`
                : 'Next run: Not scheduled';
        }
        
        if (secSelect) {
            secSelect.value = secSchedule ? secSchedule.cadence : 'off';
            document.getElementById('secNextRun').textContent = secSchedule 
                ? `Next run: ${FormattingUtils.formatDateShort(secSchedule.nextRunAt)}`
                : 'Next run: Not scheduled';
        }
    } catch (error) {
        console.error('Error loading schedules:', error);
    }
}

/**
 * Starts a manual report run
 */
async function runReport(type) {
    if (!selectedSite) return;
    
    const overlay = document.getElementById(type === 'performance' ? 'perfJobOverlay' : 'secJobOverlay');
    const statusText = document.getElementById(type === 'performance' ? 'perfJobStatus' : 'secJobStatus');
    const runBtn = document.getElementById(type === 'performance' ? 'runPerfBtn' : 'runSecBtn');

    try {
        runBtn.disabled = true;
        overlay.classList.remove('hidden');
        statusText.textContent = `Initializing ${type} scan...`;
        
        const { jobId } = await api.post('/reports/run', { siteSlug: selectedSite, reportType: type });
        
        pollJobStatus(jobId, type);
    } catch (error) {
        notifications.error(`Failed to start ${type} report: ${error.message}`);
        overlay.classList.add('hidden');
        runBtn.disabled = false;
    }
}

/**
 * Polls the status of a report job
 */
function pollJobStatus(jobId, type) {
    const overlay = document.getElementById(type === 'performance' ? 'perfJobOverlay' : 'secJobOverlay');
    const statusText = document.getElementById(type === 'performance' ? 'perfJobStatus' : 'secJobStatus');
    const runBtn = document.getElementById(type === 'performance' ? 'runPerfBtn' : 'runSecBtn');

    const checkStatus = async () => {
        try {
            const job = await api.get(`/reports/jobs/${jobId}`);
            
            if (job.status === 'done') {
                clearInterval(jobPollingIntervals[jobId]);
                delete jobPollingIntervals[jobId];
                
                overlay.classList.add('hidden');
                runBtn.disabled = false;
                notifications.success(`${type.charAt(0).toUpperCase() + type.slice(1)} report completed!`);
                loadLatestRun(selectedSite, type);
            } else if (job.status === 'failed') {
                clearInterval(jobPollingIntervals[jobId]);
                delete jobPollingIntervals[jobId];
                
                overlay.classList.add('hidden');
                runBtn.disabled = false;
                notifications.error(`${type.charAt(0).toUpperCase() + type.slice(1)} report failed: ${job.error || 'Unknown error'}`);
            } else {
                statusText.textContent = `Status: ${job.status}...`;
            }
        } catch (error) {
            console.error('Error polling job status:', error);
            clearInterval(jobPollingIntervals[jobId]);
            delete jobPollingIntervals[jobId];
            overlay.classList.add('hidden');
            runBtn.disabled = false;
        }
    };

    jobPollingIntervals[jobId] = setInterval(checkStatus, 2000);
}

/**
 * Updates or creates a schedule
 */
async function updateSchedule(type, cadence) {
    if (!selectedSite) return;
    
    try {
        const existing = schedules.find(s => s.reportTypes.includes(type));
        
        if (cadence === 'off') {
            if (existing) {
                // If this schedule only has this type, delete it
                if (existing.reportTypes.length === 1) {
                    await api.delete(`/schedules/${existing.id}`);
                } else {
                    // Otherwise just remove this type
                    const newTypes = existing.reportTypes.filter(t => t !== type);
                    await api.patch(`/schedules/${existing.id}`, { reportTypes: newTypes });
                }
            }
        } else {
            if (existing) {
                await api.patch(`/schedules/${existing.id}`, { cadence });
            } else {
                await api.post('/schedules', {
                    siteSlug: selectedSite,
                    cadence,
                    reportTypes: [type]
                });
            }
        }
        
        notifications.success(`Schedule for ${type} updated to ${cadence}`);
        loadSchedules(selectedSite);
    } catch (error) {
        notifications.error(`Failed to update schedule: ${error.message}`);
        loadSchedules(selectedSite); // Reset UI
    }
}

/**
 * Share Link Logic
 */
async function openShareModal(siteSlug, runId, reportType) {
    const modal = document.getElementById('shareModal');
    const genBtn = document.getElementById('generateShareBtn');
    const shareLinkContainer = document.getElementById('shareLinkContainer');
    
    shareLinkContainer.classList.add('hidden');
    genBtn.disabled = false;
    
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('show'), 10);
    
    genBtn.onclick = async () => {
        const expiry = parseInt(document.getElementById('shareExpiry').value);
        genBtn.disabled = true;
        
        try {
            const data = await api.post('/reports/share', {
                siteSlug,
                runId,
                reportType,
                expiresInDays: expiry === 0 ? null : expiry,
                publicView: true
            });
            
            document.getElementById('shareUrlInput').value = data.shareUrl;
            document.getElementById('shareExpiresAt').textContent = data.expiresAt 
                ? `Expires: ${FormattingUtils.formatDateShort(data.expiresAt)}`
                : 'Link does not expire';
            
            shareLinkContainer.classList.remove('hidden');
            
            document.getElementById('copyShareUrlBtn').onclick = () => {
                navigator.clipboard.writeText(data.shareUrl);
                notifications.success('Link copied to clipboard');
            };
        } catch (error) {
            notifications.error(`Failed to generate share link: ${error.message}`);
            genBtn.disabled = false;
        }
    };
}

async function generateViewUrl(siteSlug, runId, reportType) {
    try {
        const data = await api.post('/reports/share', {
            siteSlug,
            runId,
            reportType,
            expiresInDays: 1,
            publicView: true
        });
        window.open(data.shareUrl, '_blank');
    } catch (error) {
        notifications.error(`Failed to open report: ${error.message}`);
    }
}

// --- Shared Utilities ---
// Theme Management - Using centralized ThemeUtils from theme.js

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    // Clear all job polling intervals
    Object.keys(jobPollingIntervals).forEach(jobId => {
        clearInterval(jobPollingIntervals[jobId]);
    });
    jobPollingIntervals = {};
});



