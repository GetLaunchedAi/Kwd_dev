/**
 * Screenshot Gallery Component
 * 
 * Reusable gallery for displaying multi-page, multi-section screenshots
 * with tabs, lightbox, and before/after comparison functionality.
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
    
    this.init();
  }
  
  // Normalize path by stripping 'public/' prefix if present (for backwards compatibility)
  normalizePath(p) {
    if (!p) return p;
    return p.startsWith('public/') ? p.slice(7) : p;
  }
  
  init() {
    // Create gallery structure
    this.container.innerHTML = `
      <div class="screenshot-gallery">
        <div class="gallery-header">
          <div class="gallery-tabs" id="galleryTabs"></div>
          <div class="gallery-view-controls">
            <button class="view-btn" data-view="before" title="View Before">Before</button>
            <button class="view-btn active" data-view="after" title="View After">After</button>
            <button class="view-btn" data-view="comparison" title="Compare">Compare</button>
          </div>
        </div>
        <div class="gallery-content">
          <div class="gallery-main" id="galleryMain">
            <div class="gallery-loading">
              <div class="spinner"></div>
              <p>Loading screenshots...</p>
            </div>
          </div>
          <div class="gallery-sections" id="gallerySections"></div>
        </div>
        <div class="gallery-footer">
          <span class="gallery-info" id="galleryInfo"></span>
        </div>
      </div>
    `;
    
    // Create lightbox
    this.createLightbox();
    
    // Bind events
    this.bindEvents();
  }
  
  createLightbox() {
    const lightbox = document.createElement('div');
    lightbox.className = 'screenshot-lightbox hidden';
    lightbox.id = 'screenshotLightbox';
    lightbox.innerHTML = `
      <div class="lightbox-backdrop"></div>
      <div class="lightbox-content">
        <button class="lightbox-close" title="Close (Esc)">&times;</button>
        <button class="lightbox-prev" title="Previous (←)">‹</button>
        <button class="lightbox-next" title="Next (→)">›</button>
        <div class="lightbox-image-wrapper">
          <img class="lightbox-image" id="lightboxImage" src="" alt="Screenshot">
        </div>
        <div class="lightbox-info" id="lightboxInfo"></div>
      </div>
    `;
    document.body.appendChild(lightbox);
    this.lightbox = lightbox;
  }
  
  bindEvents() {
    // View toggle buttons
    this.container.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.setView(e.target.dataset.view);
      });
    });
    
    // Lightbox events
    if (this.lightbox) {
      this.lightbox.querySelector('.lightbox-backdrop').addEventListener('click', () => this.closeLightbox());
      this.lightbox.querySelector('.lightbox-close').addEventListener('click', () => this.closeLightbox());
      this.lightbox.querySelector('.lightbox-prev').addEventListener('click', () => this.lightboxNav(-1));
      this.lightbox.querySelector('.lightbox-next').addEventListener('click', () => this.lightboxNav(1));
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!this.lightboxOpen) return;
      
      if (e.key === 'Escape') this.closeLightbox();
      if (e.key === 'ArrowLeft') this.lightboxNav(-1);
      if (e.key === 'ArrowRight') this.lightboxNav(1);
    });
  }
  
  async loadScreenshots(taskId) {
    this.taskId = taskId;
    
    try {
      const response = await fetch(`/api/tasks/${taskId}/screenshots`);
      if (!response.ok) {
        throw new Error('Failed to load screenshots');
      }
      
      this.data = await response.json();
      this.render();
    } catch (error) {
      console.error('Error loading screenshots:', error);
      this.showError('Failed to load screenshots');
    }
  }
  
  setData(data) {
    this.data = data;
    this.render();
  }
  
  render() {
    if (!this.data) {
      this.showError('No screenshot data available');
      return;
    }
    
    // Check for manifests (new format)
    const hasManifests = this.data.hasManifests;
    const hasLegacy = this.data.hasLegacy;
    
    if (!hasManifests && !hasLegacy) {
      this.showEmpty();
      return;
    }
    
    // If we have manifests, render the full gallery
    if (hasManifests) {
      this.renderPageTabs();
      this.renderMainImage();
      this.renderSections();
      this.updateInfo();
    } else {
      // Fallback to legacy simple view
      this.renderLegacy();
    }
  }
  
  renderPageTabs() {
    const tabsContainer = document.getElementById('galleryTabs');
    if (!tabsContainer || !this.options.showPageTabs) return;
    
    // Get pages from the manifest (prefer after, fallback to before)
    const manifests = this.data.manifests;
    const afterIterations = Object.keys(manifests.after);
    const beforeIterations = Object.keys(manifests.before);
    
    // Use the highest iteration number
    const iteration = afterIterations.length > 0 
      ? Math.max(...afterIterations.map(Number))
      : (beforeIterations.length > 0 ? Math.max(...beforeIterations.map(Number)) : 0);
    
    const manifest = manifests.after[iteration] || manifests.before[iteration];
    if (!manifest || !manifest.pages) {
      tabsContainer.innerHTML = '';
      return;
    }
    
    // Build tabs
    const pages = manifest.pages;
    tabsContainer.innerHTML = pages.map(page => `
      <button class="page-tab ${page.pageSlug === this.currentPage ? 'active' : ''}" 
              data-page="${page.pageSlug}"
              title="${page.url}">
        ${this.formatPageName(page.pageSlug)}
        ${page.sectionCount > 0 ? `<span class="tab-badge">${page.sectionCount}</span>` : ''}
      </button>
    `).join('');
    
    // Bind tab click events
    tabsContainer.querySelectorAll('.page-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.setCurrentPage(e.target.closest('.page-tab').dataset.page);
      });
    });
  }
  
  renderMainImage() {
    const mainContainer = document.getElementById('galleryMain');
    if (!mainContainer) return;
    
    const manifests = this.data.manifests;
    
    // Find the current page's full-page screenshot
    let beforeImage = null;
    let afterImage = null;
    
    // Get before image
    const beforeIterations = Object.keys(manifests.before);
    if (beforeIterations.length > 0) {
      const iteration = Math.max(...beforeIterations.map(Number));
      const manifest = manifests.before[iteration];
      const page = manifest?.pages?.find(p => p.pageSlug === this.currentPage);
      if (page && page.fullPage) {
        beforeImage = '/' + this.normalizePath(page.fullPage);
      }
    }
    
    // Get after image
    const afterIterations = Object.keys(manifests.after);
    if (afterIterations.length > 0) {
      const iteration = Math.max(...afterIterations.map(Number));
      const manifest = manifests.after[iteration];
      const page = manifest?.pages?.find(p => p.pageSlug === this.currentPage);
      if (page && page.fullPage) {
        afterImage = '/' + this.normalizePath(page.fullPage);
      }
    }
    
    // Render based on current view
    if (this.currentView === 'comparison' && beforeImage && afterImage) {
      this.renderComparisonView(mainContainer, beforeImage, afterImage);
    } else if (this.currentView === 'before' && beforeImage) {
      this.renderSingleImage(mainContainer, beforeImage, 'Before');
    } else if (afterImage) {
      this.renderSingleImage(mainContainer, afterImage, 'After');
    } else if (beforeImage) {
      this.renderSingleImage(mainContainer, beforeImage, 'Before');
    } else {
      mainContainer.innerHTML = '<div class="no-screenshot">No screenshot available for this page</div>';
    }
  }
  
  renderSingleImage(container, src, label) {
    container.innerHTML = `
      <div class="gallery-image-container">
        <img src="${src}" 
             alt="${label} screenshot" 
             class="gallery-main-image"
             onclick="screenshotGallery.openLightbox('${src}', '${label}')"
             onerror="this.parentElement.innerHTML='<div class=\\'no-screenshot\\'>Screenshot not available</div>'">
        <span class="image-label">${label}</span>
      </div>
    `;
  }
  
  renderComparisonView(container, beforeSrc, afterSrc) {
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
      this.initComparisonSlider();
    } else {
      container.innerHTML = `
        <div class="comparison-side-by-side">
          <div class="comparison-panel">
            <img src="${beforeSrc}" 
                 alt="Before" 
                 onclick="screenshotGallery.openLightbox('${beforeSrc}', 'Before')"
                 onerror="this.parentElement.innerHTML='<div class=\\'no-screenshot\\'>Not available</div>'">
            <span class="comparison-label">Before</span>
          </div>
          <div class="comparison-panel">
            <img src="${afterSrc}" 
                 alt="After" 
                 onclick="screenshotGallery.openLightbox('${afterSrc}', 'After')"
                 onerror="this.parentElement.innerHTML='<div class=\\'no-screenshot\\'>Not available</div>'">
            <span class="comparison-label">After</span>
          </div>
        </div>
      `;
    }
  }
  
  initComparisonSlider() {
    const slider = this.container.querySelector('.comparison-slider');
    if (!slider) return;
    
    const handle = slider.querySelector('.comparison-handle');
    const afterPanel = slider.querySelector('.comparison-after');
    
    let isDragging = false;
    
    const updatePosition = (e) => {
      if (!isDragging) return;
      
      const rect = slider.getBoundingClientRect();
      let x = (e.clientX || e.touches[0].clientX) - rect.left;
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
    
    // Set initial position
    handle.style.left = '50%';
    afterPanel.style.clipPath = 'inset(0 0 0 50%)';
  }
  
  renderSections() {
    const sectionsContainer = document.getElementById('gallerySections');
    if (!sectionsContainer || !this.options.showSectionThumbnails) {
      if (sectionsContainer) sectionsContainer.innerHTML = '';
      return;
    }
    
    const manifests = this.data.manifests;
    const afterIterations = Object.keys(manifests.after);
    const beforeIterations = Object.keys(manifests.before);
    
    // Prefer after manifest
    let manifest = null;
    if (afterIterations.length > 0) {
      const iteration = Math.max(...afterIterations.map(Number));
      manifest = manifests.after[iteration];
    } else if (beforeIterations.length > 0) {
      const iteration = Math.max(...beforeIterations.map(Number));
      manifest = manifests.before[iteration];
    }
    
    if (!manifest) {
      sectionsContainer.innerHTML = '';
      return;
    }
    
    const page = manifest.pages?.find(p => p.pageSlug === this.currentPage);
    if (!page || !page.sections || page.sections.length === 0) {
      sectionsContainer.innerHTML = '<p class="no-sections">No section screenshots for this page</p>';
      return;
    }
    
    const normalizedSections = page.sections.map(section => ({
      ...section,
      path: this.normalizePath(section.path)
    }));
    sectionsContainer.innerHTML = `
      <h4 class="sections-title">Page Sections (${page.sections.length})</h4>
      <div class="sections-grid">
        ${normalizedSections.map((section, idx) => `
          <div class="section-thumbnail" onclick="screenshotGallery.openLightbox('/${section.path}', '${this.escapeHtml(section.name)}')">
            <img src="/${section.path}" 
                 alt="${this.escapeHtml(section.tag)}"
                 loading="lazy"
                 onerror="this.parentElement.classList.add('error')">
            <span class="section-info">${section.tag}${section.id ? '#' + section.id : ''}</span>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  renderLegacy() {
    // Render simple before/after for legacy screenshots
    const legacy = this.data.legacyScreenshots || {};
    const tabsContainer = document.getElementById('galleryTabs');
    const mainContainer = document.getElementById('galleryMain');
    const sectionsContainer = document.getElementById('gallerySections');
    
    if (tabsContainer) tabsContainer.innerHTML = '';
    if (sectionsContainer) sectionsContainer.innerHTML = '';
    
    if (!legacy.before && !legacy.after) {
      this.showEmpty();
      return;
    }
    
    if (this.currentView === 'comparison' && legacy.before && legacy.after) {
      this.renderComparisonView(mainContainer, legacy.before, legacy.after);
    } else if (this.currentView === 'before' && legacy.before) {
      this.renderSingleImage(mainContainer, legacy.before, 'Before');
    } else if (legacy.after) {
      this.renderSingleImage(mainContainer, legacy.after, 'After');
    } else if (legacy.before) {
      this.renderSingleImage(mainContainer, legacy.before, 'Before');
    }
    
    this.updateInfo();
  }
  
  setView(view) {
    this.currentView = view;
    
    // Update button states
    this.container.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    this.renderMainImage();
  }
  
  setCurrentPage(pageSlug) {
    this.currentPage = pageSlug;
    
    // Update tab states
    this.container.querySelectorAll('.page-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.page === pageSlug);
    });
    
    this.renderMainImage();
    this.renderSections();
    this.updateInfo();
  }
  
  updateInfo() {
    const infoEl = document.getElementById('galleryInfo');
    if (!infoEl || !this.data) return;
    
    const manifests = this.data.manifests;
    let totalPages = 0;
    let totalSections = 0;
    
    // Count from after manifest, fallback to before
    const afterIterations = Object.keys(manifests?.after || {});
    const beforeIterations = Object.keys(manifests?.before || {});
    
    if (afterIterations.length > 0) {
      const iteration = Math.max(...afterIterations.map(Number));
      const manifest = manifests.after[iteration];
      totalPages = manifest?.totalPages || 0;
      totalSections = manifest?.totalSections || 0;
    } else if (beforeIterations.length > 0) {
      const iteration = Math.max(...beforeIterations.map(Number));
      const manifest = manifests.before[iteration];
      totalPages = manifest?.totalPages || 0;
      totalSections = manifest?.totalSections || 0;
    }
    
    if (totalPages > 0) {
      infoEl.textContent = `${totalPages} page${totalPages !== 1 ? 's' : ''}, ${totalSections} section${totalSections !== 1 ? 's' : ''} captured`;
    } else if (this.data.hasLegacy) {
      infoEl.textContent = 'Simple screenshots (legacy mode)';
    } else {
      infoEl.textContent = '';
    }
  }
  
  showError(message) {
    const mainContainer = document.getElementById('galleryMain');
    if (mainContainer) {
      mainContainer.innerHTML = `<div class="gallery-error"><i data-lucide="alert-circle"></i>${this.escapeHtml(message)}</div>`;
    }
    if (window.lucide) lucide.createIcons();
  }
  
  showEmpty() {
    const mainContainer = document.getElementById('galleryMain');
    if (mainContainer) {
      mainContainer.innerHTML = `
        <div class="gallery-empty">
          <i data-lucide="image-off"></i>
          <p>No screenshots available yet</p>
          <p class="text-hint">Screenshots will appear here after the workflow captures them</p>
        </div>
      `;
    }
    const tabsContainer = document.getElementById('galleryTabs');
    const sectionsContainer = document.getElementById('gallerySections');
    if (tabsContainer) tabsContainer.innerHTML = '';
    if (sectionsContainer) sectionsContainer.innerHTML = '';
    
    if (window.lucide) lucide.createIcons();
  }
  
  openLightbox(src, label) {
    if (!this.options.enableLightbox || !this.lightbox) return;
    
    this.lightboxOpen = true;
    this.lightboxCurrentSrc = src;
    
    const img = document.getElementById('lightboxImage');
    const info = document.getElementById('lightboxInfo');
    
    img.src = src;
    info.textContent = label || '';
    
    this.lightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  
  closeLightbox() {
    if (!this.lightbox) return;
    
    this.lightboxOpen = false;
    this.lightbox.classList.add('hidden');
    document.body.style.overflow = '';
  }
  
  lightboxNav(direction) {
    // Navigation through all images (to be implemented based on current page/sections)
    // For now, just close - can be extended to navigate through sections
  }
  
  formatPageName(slug) {
    if (slug === 'home') return 'Home';
    return slug
      .replace(/__/g, ' / ')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
  
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Global instance for inline onclick handlers
let screenshotGallery = null;

// Factory function for creating gallery
function createScreenshotGallery(containerId, options) {
  screenshotGallery = new ScreenshotGallery(containerId, options);
  return screenshotGallery;
}
