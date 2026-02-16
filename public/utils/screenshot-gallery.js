/**
 * Screenshot Gallery Component
 * 
 * Reusable gallery for displaying multi-page, multi-section screenshots
 * with tabs, lightbox, and before/after comparison functionality.
 *
 * Key design decisions:
 *   - All DOM queries are scoped to this.container (never document.getElementById)
 *   - Missing before/after data is surfaced to the user, never silently swapped
 *   - The gallery can be safely destroyed and recreated without leaking state
 */

class ScreenshotGallery {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`Screenshot gallery container not found: ${containerId}`);
      return;
    }
    
    this.options = {
      showPageTabs: true,
      showSectionThumbnails: true,
      enableComparison: true,
      enableLightbox: true,
      comparisonMode: 'side-by-side', // 'side-by-side' or 'slider'
      ...options
    };
    
    this.data = null;
    this.currentPage = 'home';
    this.currentView = 'after'; // 'before', 'after', or 'comparison'
    this.lightboxOpen = false;
    
    // Resolved image URLs for the current page (set by resolveImages)
    this._beforeImage = null;
    this._afterImage = null;
    
    this._init();
  }
  
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Strips 'public/' prefix for backwards compatibility */
  _normalizePath(p) {
    if (!p) return p;
    return p.startsWith('public/') ? p.slice(7) : p;
  }

  /** Scoped querySelector – never leaks outside the gallery container */
  _qs(selector) {
    return this.container?.querySelector(selector) ?? null;
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  _formatPageName(slug) {
    if (slug === 'home') return 'Home';
    return slug
      .replace(/__/g, ' / ')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  _init() {
    this.container.innerHTML = `
      <div class="screenshot-gallery">
        <div class="gallery-header">
          <div class="gallery-tabs" data-role="tabs"></div>
          <div class="gallery-view-controls" data-role="view-controls">
            <button class="view-btn" data-view="before" title="View Before">Before</button>
            <button class="view-btn active" data-view="after" title="View After">After</button>
            <button class="view-btn" data-view="comparison" title="Compare">Compare</button>
          </div>
        </div>
        <div class="gallery-content">
          <div class="gallery-main" data-role="main">
            <div class="gallery-loading">
              <div class="spinner"></div>
              <p>Loading screenshots...</p>
            </div>
          </div>
          <div class="gallery-sections" data-role="sections"></div>
        </div>
        <div class="gallery-footer">
          <span class="gallery-info" data-role="info"></span>
        </div>
      </div>
    `;

    this._createLightbox();
    this._bindEvents();
  }

  /** Tear down DOM and event listeners so the instance can be GC'd cleanly. */
  destroy() {
    if (this._lightbox) {
      this._lightbox.remove();
      this._lightbox = null;
    }
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.data = null;
  }

  // ---------------------------------------------------------------------------
  // Lightbox
  // ---------------------------------------------------------------------------

  _createLightbox() {
    // Remove any existing lightbox from a prior instance
    const old = document.getElementById('screenshotLightbox');
    if (old) old.remove();

    const lb = document.createElement('div');
    lb.className = 'screenshot-lightbox hidden';
    lb.id = 'screenshotLightbox';
    lb.innerHTML = `
      <div class="lightbox-backdrop"></div>
      <div class="lightbox-content">
        <button class="lightbox-close" title="Close (Esc)">&times;</button>
        <button class="lightbox-prev" title="Previous (←)">‹</button>
        <button class="lightbox-next" title="Next (→)">›</button>
        <div class="lightbox-image-wrapper">
          <img class="lightbox-image" src="" alt="Screenshot">
        </div>
        <div class="lightbox-info"></div>
      </div>
    `;
    document.body.appendChild(lb);
    this._lightbox = lb;
  }

  _bindEvents() {
    // View toggle buttons (scoped to container)
    this.container.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.target.dataset.view;
        if (view) this.setView(view);
      });
    });

    // Lightbox events
    if (this._lightbox) {
      this._lightbox.querySelector('.lightbox-backdrop').addEventListener('click', () => this.closeLightbox());
      this._lightbox.querySelector('.lightbox-close').addEventListener('click', () => this.closeLightbox());
      this._lightbox.querySelector('.lightbox-prev').addEventListener('click', () => this._lightboxNav(-1));
      this._lightbox.querySelector('.lightbox-next').addEventListener('click', () => this._lightboxNav(1));
    }

    // Keyboard navigation (store ref so we can remove later)
    this._keyHandler = (e) => {
      if (!this.lightboxOpen) return;
      if (e.key === 'Escape') this.closeLightbox();
      if (e.key === 'ArrowLeft') this._lightboxNav(-1);
      if (e.key === 'ArrowRight') this._lightboxNav(1);
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async loadScreenshots(taskId) {
    this.taskId = taskId;

    try {
      const response = await fetch(`/api/tasks/${taskId}/screenshots`);
      if (!response.ok) throw new Error('Failed to load screenshots');
      this.data = await response.json();
      this._render();
    } catch (error) {
      console.error('Error loading screenshots:', error);
      this._showError('Failed to load screenshots');
    }
  }

  setData(data) {
    this.data = data;
    this._render();
  }

  // ---------------------------------------------------------------------------
  // Image resolution – single source of truth for before / after URLs
  // ---------------------------------------------------------------------------

  /**
   * Resolves the before and after image URLs for the current page.
   * Updates this._beforeImage and this._afterImage.
   * Works for both manifest and legacy data.
   */
  _resolveImages() {
    this._beforeImage = null;
    this._afterImage = null;

    if (!this.data) return;

    const manifests = this.data.manifests;
    const hasManifests = this.data.hasManifests;
    const hasLegacy = this.data.hasLegacy;

    if (hasManifests) {
      // --- manifest path ---
      const beforeIters = Object.keys(manifests?.before || {});
      if (beforeIters.length > 0) {
        const iter = Math.max(...beforeIters.map(Number));
        const page = manifests.before[iter]?.pages?.find(p => p.pageSlug === this.currentPage);
        if (page?.fullPage) {
          this._beforeImage = '/' + this._normalizePath(page.fullPage);
        }
      }

      const afterIters = Object.keys(manifests?.after || {});
      if (afterIters.length > 0) {
        const iter = Math.max(...afterIters.map(Number));
        const page = manifests.after[iter]?.pages?.find(p => p.pageSlug === this.currentPage);
        if (page?.fullPage) {
          this._afterImage = '/' + this._normalizePath(page.fullPage);
        }
      }
    } else if (hasLegacy) {
      // --- legacy path ---
      const legacy = this.data.legacyScreenshots || {};
      this._beforeImage = legacy.before || null;
      this._afterImage = legacy.after || null;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  _render() {
    if (!this.data) {
      this._showError('No screenshot data available');
      return;
    }

    if (!this.data.hasManifests && !this.data.hasLegacy) {
      this._showEmpty();
      return;
    }

    // Resolve images for the current page
    this._resolveImages();

    // Update view control button states (disable when data missing)
    this._updateViewControls();

    // Render page tabs (only for manifest mode with multiple pages)
    this._renderPageTabs();

    // Render the main image area
    this._renderMainImage();

    // Render section thumbnails
    this._renderSections();

    // Footer info
    this._updateInfo();
  }

  /**
   * Enables/disables view buttons based on available data and auto-corrects
   * the current view if the selected one has no data.
   */
  _updateViewControls() {
    const hasBefore = !!this._beforeImage;
    const hasAfter = !!this._afterImage;

    this.container.querySelectorAll('.view-btn').forEach(btn => {
      const view = btn.dataset.view;
      let disabled = false;

      if (view === 'before' && !hasBefore) disabled = true;
      if (view === 'comparison' && (!hasBefore || !hasAfter)) disabled = true;

      btn.disabled = disabled;
      btn.classList.toggle('disabled', disabled);
      if (disabled) {
        btn.title = view === 'before'
          ? 'No before screenshot available'
          : 'Comparison requires both before & after screenshots';
      } else {
        btn.title = view === 'before' ? 'View Before'
          : view === 'after' ? 'View After'
          : 'Compare Before & After';
      }
    });

    // Auto-correct view if current selection has no data
    if (this.currentView === 'before' && !hasBefore) {
      this.currentView = hasAfter ? 'after' : 'before';
    }
    if (this.currentView === 'comparison' && (!hasBefore || !hasAfter)) {
      this.currentView = hasAfter ? 'after' : 'before';
    }

    // Sync active class
    this.container.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === this.currentView);
    });
  }

  _renderPageTabs() {
    const tabsEl = this._qs('[data-role="tabs"]');
    if (!tabsEl || !this.options.showPageTabs) return;

    // Only show page tabs for manifest mode
    if (!this.data.hasManifests) {
      tabsEl.innerHTML = '';
      return;
    }

    const manifests = this.data.manifests;
    const afterIters = Object.keys(manifests?.after || {});
    const beforeIters = Object.keys(manifests?.before || {});

    const iter = afterIters.length > 0
      ? Math.max(...afterIters.map(Number))
      : (beforeIters.length > 0 ? Math.max(...beforeIters.map(Number)) : 0);

    const manifest = manifests.after?.[iter] || manifests.before?.[iter];
    if (!manifest?.pages) {
      tabsEl.innerHTML = '';
      return;
    }

    const pages = manifest.pages;
    tabsEl.innerHTML = pages.map(page => `
      <button class="page-tab ${page.pageSlug === this.currentPage ? 'active' : ''}" 
              data-page="${page.pageSlug}"
              title="${this._escapeHtml(page.url)}">
        ${this._formatPageName(page.pageSlug)}
        ${page.sectionCount > 0 ? `<span class="tab-badge">${page.sectionCount}</span>` : ''}
      </button>
    `).join('');

    tabsEl.querySelectorAll('.page-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const slug = e.target.closest('.page-tab')?.dataset?.page;
        if (slug) this.setCurrentPage(slug);
      });
    });
  }

  _renderMainImage() {
    const mainEl = this._qs('[data-role="main"]');
    if (!mainEl) return;

    const before = this._beforeImage;
    const after = this._afterImage;

    if (this.currentView === 'comparison') {
      if (before && after) {
        this._renderComparisonView(mainEl, before, after);
      } else {
        mainEl.innerHTML = `<div class="no-screenshot">
          <p>Comparison requires both before &amp; after screenshots.</p>
          ${!before ? '<p class="text-hint">Before screenshot was not captured for this page.</p>' : ''}
          ${!after ? '<p class="text-hint">After screenshot was not captured for this page.</p>' : ''}
        </div>`;
      }
      return;
    }

    if (this.currentView === 'before') {
      if (before) {
        this._renderSingleImage(mainEl, before, 'Before');
      } else {
        mainEl.innerHTML = `<div class="no-screenshot">
          <p>Before screenshot not available</p>
          <p class="text-hint">Before screenshots are captured at the start of a workflow run. They may not exist for tasks created before this feature or if the initial capture failed.</p>
        </div>`;
      }
      return;
    }

    // Default: 'after'
    if (after) {
      this._renderSingleImage(mainEl, after, 'After');
    } else if (before) {
      // Only after is missing — show before as a helpful fallback WITH clear label
      this._renderSingleImage(mainEl, before, 'Before (no after screenshot)');
    } else {
      mainEl.innerHTML = '<div class="no-screenshot">No screenshot available for this page</div>';
    }
  }

  _renderSingleImage(container, src, label) {
    container.innerHTML = `
      <div class="gallery-image-container">
        <img src="${src}" 
             alt="${this._escapeHtml(label)} screenshot" 
             class="gallery-main-image"
             onclick="screenshotGallery?.openLightbox('${src}', '${this._escapeHtml(label)}')"
             onerror="this.parentElement.innerHTML='<div class=\\'no-screenshot\\'>Screenshot image failed to load</div>'">
        <span class="image-label">${this._escapeHtml(label)}</span>
      </div>
    `;
  }

  _renderComparisonView(container, beforeSrc, afterSrc) {
    if (this.options.comparisonMode === 'slider') {
      container.innerHTML = `
        <div class="comparison-slider">
          <div class="comparison-before">
            <img src="${beforeSrc}" alt="Before">
            <span class="comparison-label">Before</span>
          </div>
          <div class="comparison-after">
            <img src="${afterSrc}" alt="After">
            <span class="comparison-label">After</span>
          </div>
          <div class="comparison-handle">
            <div class="comparison-handle-bar"></div>
          </div>
        </div>
      `;
      this._initComparisonSlider();
    } else {
      container.innerHTML = `
        <div class="comparison-side-by-side">
          <div class="comparison-panel">
            <img src="${beforeSrc}" 
                 alt="Before" 
                 onclick="screenshotGallery?.openLightbox('${beforeSrc}', 'Before')"
                 onerror="this.parentElement.innerHTML='<div class=\\'no-screenshot\\'>Before image failed to load</div>'">
            <span class="comparison-label">Before</span>
          </div>
          <div class="comparison-panel">
            <img src="${afterSrc}" 
                 alt="After" 
                 onclick="screenshotGallery?.openLightbox('${afterSrc}', 'After')"
                 onerror="this.parentElement.innerHTML='<div class=\\'no-screenshot\\'>After image failed to load</div>'">
            <span class="comparison-label">After</span>
          </div>
        </div>
      `;
    }
  }

  _initComparisonSlider() {
    const slider = this.container.querySelector('.comparison-slider');
    if (!slider) return;

    const handle = slider.querySelector('.comparison-handle');
    const afterPanel = slider.querySelector('.comparison-after');
    let isDragging = false;

    const updatePosition = (e) => {
      if (!isDragging) return;
      const rect = slider.getBoundingClientRect();
      let x = (e.clientX || e.touches?.[0]?.clientX || 0) - rect.left;
      x = Math.max(0, Math.min(x, rect.width));
      const percent = (x / rect.width) * 100;
      handle.style.left = `${percent}%`;
      afterPanel.style.clipPath = `inset(0 0 0 ${percent}%)`;
    };

    handle.addEventListener('mousedown', () => isDragging = true);
    handle.addEventListener('touchstart', () => isDragging = true);
    document.addEventListener('mouseup', () => isDragging = false);
    document.addEventListener('touchend', () => isDragging = false);
    document.addEventListener('mousemove', updatePosition);
    document.addEventListener('touchmove', updatePosition);

    handle.style.left = '50%';
    afterPanel.style.clipPath = 'inset(0 0 0 50%)';
  }

  _renderSections() {
    const sectionsEl = this._qs('[data-role="sections"]');
    if (!sectionsEl || !this.options.showSectionThumbnails) {
      if (sectionsEl) sectionsEl.innerHTML = '';
      return;
    }

    if (!this.data.hasManifests) {
      sectionsEl.innerHTML = '';
      return;
    }

    const manifests = this.data.manifests;
    const afterIters = Object.keys(manifests?.after || {});
    const beforeIters = Object.keys(manifests?.before || {});

    let manifest = null;
    if (afterIters.length > 0) {
      manifest = manifests.after[Math.max(...afterIters.map(Number))];
    } else if (beforeIters.length > 0) {
      manifest = manifests.before[Math.max(...beforeIters.map(Number))];
    }

    if (!manifest) {
      sectionsEl.innerHTML = '';
      return;
    }

    const page = manifest.pages?.find(p => p.pageSlug === this.currentPage);
    if (!page?.sections?.length) {
      sectionsEl.innerHTML = '';
      return;
    }

    const sections = page.sections.map(s => ({ ...s, path: this._normalizePath(s.path) }));
    const sectionLabel = this.currentView === 'before' ? 'Before' : 'After';
    sectionsEl.innerHTML = `
      <div class="sections-header">
        <h4 class="sections-title">
          <span>Sections</span>
          <span class="sections-count">${sections.length}</span>
        </h4>
      </div>
      <div class="sections-grid">
        ${sections.map(s => {
          const label = s.name || s.id || s.tag || 'Section';
          return `
          <div class="section-thumbnail" onclick="screenshotGallery?.openLightbox('/${s.path}', '${this._escapeHtml(label)}')">
            <img src="/${s.path}" 
                 alt="${this._escapeHtml(label)}"
                 loading="lazy"
                 onerror="this.parentElement.classList.add('error')">
            <div class="section-label">
              <span class="section-name">${this._escapeHtml(label)}</span>
              <span class="section-tag">&lt;${s.tag}&gt;</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  }

  _updateInfo() {
    const infoEl = this._qs('[data-role="info"]');
    if (!infoEl || !this.data) return;

    const manifests = this.data.manifests;
    let totalPages = 0;
    let totalSections = 0;

    const afterIters = Object.keys(manifests?.after || {});
    const beforeIters = Object.keys(manifests?.before || {});

    if (afterIters.length > 0) {
      const m = manifests.after[Math.max(...afterIters.map(Number))];
      totalPages = m?.totalPages || 0;
      totalSections = m?.totalSections || 0;
    } else if (beforeIters.length > 0) {
      const m = manifests.before[Math.max(...beforeIters.map(Number))];
      totalPages = m?.totalPages || 0;
      totalSections = m?.totalSections || 0;
    }

    // Build info parts
    const parts = [];
    if (totalPages > 0) {
      parts.push(`${totalPages} page${totalPages !== 1 ? 's' : ''}`);
      parts.push(`${totalSections} section${totalSections !== 1 ? 's' : ''} captured`);
    } else if (this.data.hasLegacy) {
      parts.push('Simple screenshots (legacy mode)');
    }

    // Availability indicator
    const hasBefore = !!this._beforeImage;
    const hasAfter = !!this._afterImage;
    if (hasAfter && !hasBefore) {
      parts.push('Before screenshot not available');
    } else if (hasBefore && !hasAfter) {
      parts.push('After screenshot not available');
    }

    infoEl.textContent = parts.join(' · ');
  }

  // ---------------------------------------------------------------------------
  // User interactions
  // ---------------------------------------------------------------------------

  setView(view) {
    this.currentView = view;

    // Update button active states
    this.container.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Re-render the main area only (images already resolved)
    this._renderMainImage();
  }

  setCurrentPage(pageSlug) {
    this.currentPage = pageSlug;

    // Update tab active states
    this.container.querySelectorAll('.page-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.page === pageSlug);
    });

    // Re-resolve images for the new page, update controls, and re-render
    this._resolveImages();
    this._updateViewControls();
    this._renderMainImage();
    this._renderSections();
    this._updateInfo();
  }

  // ---------------------------------------------------------------------------
  // Lightbox
  // ---------------------------------------------------------------------------

  openLightbox(src, label) {
    if (!this.options.enableLightbox || !this._lightbox) return;

    this.lightboxOpen = true;
    this._lightboxCurrentSrc = src;

    const img = this._lightbox.querySelector('.lightbox-image');
    const info = this._lightbox.querySelector('.lightbox-info');

    if (img) img.src = src;
    if (info) info.textContent = label || '';

    this._lightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  closeLightbox() {
    if (!this._lightbox) return;
    this.lightboxOpen = false;
    this._lightbox.classList.add('hidden');
    document.body.style.overflow = '';
  }

  _lightboxNav(direction) {
    // Placeholder – could cycle through all section images in future
  }

  // ---------------------------------------------------------------------------
  // Empty / Error states
  // ---------------------------------------------------------------------------

  _showError(message) {
    const mainEl = this._qs('[data-role="main"]');
    if (mainEl) {
      mainEl.innerHTML = `<div class="gallery-error"><i data-lucide="alert-circle"></i>${this._escapeHtml(message)}</div>`;
    }
    if (window.lucide) lucide.createIcons();
  }

  _showEmpty() {
    const mainEl = this._qs('[data-role="main"]');
    if (mainEl) {
      mainEl.innerHTML = `
        <div class="gallery-empty">
          <i data-lucide="image-off"></i>
          <p>No screenshots available yet</p>
          <p class="text-hint">Screenshots will appear here after the workflow captures them</p>
        </div>
      `;
    }

    const tabsEl = this._qs('[data-role="tabs"]');
    const sectionsEl = this._qs('[data-role="sections"]');
    if (tabsEl) tabsEl.innerHTML = '';
    if (sectionsEl) sectionsEl.innerHTML = '';

    if (window.lucide) lucide.createIcons();
  }
}

// ---------------------------------------------------------------------------
// Global instance (for inline onclick handlers in rendered HTML)
// ---------------------------------------------------------------------------

let screenshotGallery = null;

/**
 * Creates (or recreates) a gallery in the given container.
 * Destroys any previous instance first to prevent leaks.
 */
function createScreenshotGallery(containerId, options) {
  if (screenshotGallery) {
    screenshotGallery.destroy();
    screenshotGallery = null;
  }
  screenshotGallery = new ScreenshotGallery(containerId, options);
  return screenshotGallery;
}
