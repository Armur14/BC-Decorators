/**
 * BC Decorators - Interactive Reviews & Client Moderation System
 * Features:
 * - Empty by default (pristine for authentic client submissions)
 * - Dual persistence (REST API with seamless localStorage fallback)
 * - Dynamic review submission with live star picker (no e.g. placeholders)
 * - Clean rating breakdown analytics and star filtering
 * - Discreet Client Admin Portal (in footer / Ctrl+Shift+A) with passcode moderation (Approve, Reject, Feature, Delete)
 */

(function () {
  'use strict';

  // Seed data is completely empty so site begins with real reviews only
  const SEED_DATA = {
    settings: { requireApproval: true },
    reviews: []
  };

  const STORAGE_KEY = 'bc_decorators_reviews_v2';
  // Clear any older dummy data from browser cache
  try {
    localStorage.removeItem('bc_decorators_reviews_v1');
  } catch (e) {}

  let isApiAvailable = null;
  let adminToken = sessionStorage.getItem('bc_admin_token') || null;

  // State
  let allPublicReviews = [];
  let currentFilterRating = 'all';
  let currentSort = 'newest';
  let visibleCount = 6;
  let selectedRating = 5;

  // Star label helpers
  const STAR_DESCRIPTIONS = {
    1: '1 Star — Disappointing',
    2: '2 Stars — Needs Improvement',
    3: '3 Stars — Average Service',
    4: '4 Stars — Very Good Quality',
    5: '5 Stars — Exceptional Finishes!'
  };

  // Local storage helpers
  function getLocalData() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.warn('localStorage read error:', e);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_DATA));
    return JSON.parse(JSON.stringify(SEED_DATA));
  }

  function saveLocalData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('localStorage write error:', e);
    }
  }

  // Check API availability
  async function checkBackend() {
    if (isApiAvailable !== null) return isApiAvailable;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch('/api/reviews', { signal: controller.signal });
      clearTimeout(timeoutId);
      isApiAvailable = res.ok;
    } catch (e) {
      isApiAvailable = false;
    }
    return isApiAvailable;
  }

  // Load public reviews
  async function fetchPublicReviews() {
    const hasApi = await checkBackend();
    if (hasApi) {
      try {
        const res = await fetch('/api/reviews');
        const data = await res.json();
        if (data.success) {
          allPublicReviews = data.reviews || [];
          return { reviews: data.reviews || [], stats: data.stats };
        }
      } catch (err) {
        console.warn('API error, falling back to local data', err);
      }
    }

    // Fallback: localStorage
    const local = getLocalData();
    const approved = (local.reviews || []).filter(r => r.status === 'approved');
    approved.sort((a, b) => {
      if (b.featured && !a.featured) return 1;
      if (!b.featured && a.featured) return -1;
      return new Date(b.date) - new Date(a.date);
    });
    allPublicReviews = approved;

    // Calculate stats
    const total = approved.length;
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let sum = 0;
    approved.forEach(r => {
      const star = Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5)));
      distribution[star] = (distribution[star] || 0) + 1;
      sum += star;
    });
    const average = total > 0 ? Number((sum / total).toFixed(1)) : 0;

    return {
      reviews: approved,
      stats: { average, total, distribution }
    };
  }

  // Render Stats & Analytics Header
  function renderStats(stats) {
    const avgScoreEl = document.getElementById('reviews-average-score');
    const avgStarsEl = document.getElementById('reviews-average-stars');
    const totalCountEl = document.getElementById('reviews-total-count');
    const barsContainer = document.getElementById('reviews-distribution-bars');

    const hasReviews = stats && stats.total > 0;

    if (avgScoreEl) {
      avgScoreEl.textContent = hasReviews ? stats.average.toFixed(1) : '—';
    }

    if (totalCountEl) {
      totalCountEl.textContent = hasReviews
        ? `Based on ${stats.total} verified review${stats.total === 1 ? '' : 's'}`
        : 'Be the first to share your experience!';
    }

    if (avgStarsEl) {
      avgStarsEl.innerHTML = renderStarsHtml(hasReviews ? stats.average : 0);
    }

    if (barsContainer) {
      barsContainer.innerHTML = '';
      for (let star = 5; star >= 1; star--) {
        const count = (stats && stats.distribution && stats.distribution[star]) || 0;
        const pct = hasReviews ? Math.round((count / stats.total) * 100) : 0;
        const barItem = document.createElement('div');
        barItem.className = 'dist-row';
        barItem.innerHTML = `
          <div class="dist-label">${star} <i class="fa-solid fa-star gold-star"></i></div>
          <div class="dist-track">
            <div class="dist-fill" style="width: ${pct}%;"></div>
          </div>
          <div class="dist-count">${count} (${pct}%)</div>
        `;
        barsContainer.appendChild(barItem);
      }
    }
  }

  // Star HTML helper
  function renderStarsHtml(rating) {
    if (!rating || rating === 0) {
      return `
        <i class="fa-regular fa-star gold-star empty-star"></i>
        <i class="fa-regular fa-star gold-star empty-star"></i>
        <i class="fa-regular fa-star gold-star empty-star"></i>
        <i class="fa-regular fa-star gold-star empty-star"></i>
        <i class="fa-regular fa-star gold-star empty-star"></i>
      `;
    }

    let html = '';
    const full = Math.floor(rating);
    const hasHalf = rating - full >= 0.4 && rating - full < 0.8;
    const roundedFull = rating - full >= 0.8 ? full + 1 : full;

    for (let i = 1; i <= 5; i++) {
      if (i <= (hasHalf ? full : roundedFull)) {
        html += '<i class="fa-solid fa-star gold-star"></i>';
      } else if (hasHalf && i === full + 1) {
        html += '<i class="fa-solid fa-star-half-stroke gold-star"></i>';
      } else {
        html += '<i class="fa-regular fa-star gold-star empty-star"></i>';
      }
    }
    return html;
  }

  // Format date helper
  function formatDate(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch (e) {
      return '';
    }
  }

  // Get filtered and sorted reviews
  function getFilteredReviews() {
    let list = [...allPublicReviews];

    if (currentFilterRating !== 'all') {
      const star = parseInt(currentFilterRating, 10);
      list = list.filter(r => Math.round(Number(r.rating)) === star);
    }

    // Sort
    list.sort((a, b) => {
      if (currentSort === 'newest') {
        if (b.featured && !a.featured) return 1;
        if (!b.featured && a.featured) return -1;
        return new Date(b.date) - new Date(a.date);
      }
      if (currentSort === 'highest') {
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      }
      if (currentSort === 'lowest') {
        return (Number(a.rating) || 0) - (Number(b.rating) || 0);
      }
      if (currentSort === 'helpful') {
        return (Number(b.helpful) || 0) - (Number(a.helpful) || 0);
      }
      return 0;
    });

    return list;
  }

  // Render review cards
  function renderReviewsGrid() {
    const grid = document.getElementById('reviews-grid');
    const emptyState = document.getElementById('reviews-empty');
    const loadMoreBtn = document.getElementById('reviews-load-more');

    if (!grid) return;
    grid.innerHTML = '';

    const list = getFilteredReviews();

    if (list.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const visibleItems = list.slice(0, visibleCount);

    visibleItems.forEach(rev => {
      const card = document.createElement('article');
      card.className = 'review-card painting-frame';
      if (rev.featured) card.classList.add('featured-review');

      const initials = (rev.name || 'C')
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

      card.innerHTML = `
        <div class="review-card-top">
          <div class="reviewer-meta">
            <div class="reviewer-avatar">${initials}</div>
            <div>
              <h4 class="reviewer-name">
                ${escapeHtml(rev.name)}
                ${rev.verified ? '<span class="verified-badge" title="Verified Client"><i class="fa-solid fa-circle-check"></i> Verified</span>' : ''}
              </h4>
              ${
                rev.location
                  ? `<p class="reviewer-location"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(rev.location)}</p>`
                  : ''
              }
            </div>
          </div>
          ${rev.featured ? '<span class="featured-badge"><i class="fa-solid fa-award"></i> Featured</span>' : ''}
        </div>

        <div class="review-rating-row">
          <div class="stars">${renderStarsHtml(rev.rating)}</div>
          <span class="review-date">${formatDate(rev.date)}</span>
        </div>

        <h3 class="review-title">"${escapeHtml(rev.title)}"</h3>
        <p class="review-body">${escapeHtml(rev.body)}</p>

        <div class="review-card-footer">
          <button type="button" class="helpful-btn" data-id="${rev.id}">
            <i class="fa-regular fa-thumbs-up"></i> Helpful (<span class="helpful-count">${rev.helpful || 0}</span>)
          </button>
        </div>
      `;

      grid.appendChild(card);
    });

    if (loadMoreBtn) {
      loadMoreBtn.style.display = list.length > visibleCount ? 'inline-flex' : 'none';
    }

    // Attach helpful button listeners
    grid.querySelectorAll('.helpful-btn').forEach(btn => {
      btn.addEventListener('click', handleHelpfulClick);
    });
  }

  // Handle helpful vote
  async function handleHelpfulClick(e) {
    const btn = e.currentTarget;
    const id = btn.getAttribute('data-id');
    if (!id || btn.classList.contains('voted')) return;

    btn.classList.add('voted');
    btn.disabled = true;

    const countEl = btn.querySelector('.helpful-count');
    const current = parseInt(countEl.textContent, 10) || 0;
    countEl.textContent = current + 1;

    const hasApi = await checkBackend();
    if (hasApi) {
      try {
        await fetch(`/api/reviews/${id}/helpful`, { method: 'POST' });
      } catch (err) {
        console.warn('API error during helpful vote:', err);
      }
    }

    // Update local copy
    const local = getLocalData();
    const found = local.reviews.find(r => r.id === id);
    if (found) {
      found.helpful = (found.helpful || 0) + 1;
      saveLocalData(local);
    }

    showToast('Thank you for your feedback!', 'success');
  }

  // Escape HTML to prevent XSS
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Toast notification
  function showToast(message, type = 'info') {
    let container = document.getElementById('bc-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'bc-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `bc-toast bc-toast-${type}`;
    toast.innerHTML = `
      <div class="bc-toast-icon">
        <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i>
      </div>
      <div class="bc-toast-msg">${escapeHtml(message)}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  // Setup Star Picker in Leave a Review Form
  function setupStarPicker() {
    const starContainer = document.getElementById('star-picker');
    const labelEl = document.getElementById('star-picker-label');
    const inputEl = document.getElementById('review-rating-input');
    if (!starContainer || !inputEl) return;

    const stars = starContainer.querySelectorAll('.star-option');

    function updateStars(val) {
      stars.forEach(s => {
        const starVal = parseInt(s.getAttribute('data-value'), 10);
        if (starVal <= val) {
          s.classList.add('selected');
          s.classList.remove('empty');
          s.innerHTML = '<i class="fa-solid fa-star"></i>';
        } else {
          s.classList.remove('selected');
          s.classList.add('empty');
          s.innerHTML = '<i class="fa-regular fa-star"></i>';
        }
      });
      if (labelEl) {
        labelEl.textContent = STAR_DESCRIPTIONS[val] || `${val} Stars`;
      }
      inputEl.value = val;
      selectedRating = val;
    }

    stars.forEach(star => {
      star.addEventListener('mouseenter', () => {
        const hoverVal = parseInt(star.getAttribute('data-value'), 10);
        stars.forEach(s => {
          const val = parseInt(s.getAttribute('data-value'), 10);
          if (val <= hoverVal) {
            s.classList.add('hovered');
            s.innerHTML = '<i class="fa-solid fa-star"></i>';
          } else {
            s.classList.remove('hovered');
            if (val > selectedRating) {
              s.innerHTML = '<i class="fa-regular fa-star"></i>';
            }
          }
        });
        if (labelEl) labelEl.textContent = STAR_DESCRIPTIONS[hoverVal];
      });

      star.addEventListener('mouseleave', () => {
        stars.forEach(s => s.classList.remove('hovered'));
        updateStars(selectedRating);
      });

      star.addEventListener('click', () => {
        const val = parseInt(star.getAttribute('data-value'), 10);
        updateStars(val);
      });
    });

    // Default 5 stars
    updateStars(5);
  }

  // Setup Review Submission Form
  function setupReviewForm() {
    const form = document.getElementById('leave-review-form');
    if (!form) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();

      // Honeypot check
      const honeypot = form.querySelector('[name="website"]');
      if (honeypot && honeypot.value.trim() !== '') {
        return; // Bot detected
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const origBtnText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';

      const payload = {
        name: form.querySelector('#review-name').value.trim(),
        location: form.querySelector('#review-location')?.value.trim() || '',
        rating: selectedRating,
        title: form.querySelector('#review-title').value.trim(),
        body: form.querySelector('#review-body').value.trim()
      };

      if (!payload.name || !payload.title || !payload.body) {
        showToast('Please fill in all required fields.', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = origBtnText;
        return;
      }

      try {
        const hasApi = await checkBackend();
        let result = null;

        if (hasApi) {
          const res = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          result = await res.json();
        } else {
          // Local fallback
          const local = getLocalData();
          const requireApproval = local.settings.requireApproval !== false;
          const newRev = {
            id: 'rev_' + Date.now(),
            ...payload,
            date: new Date().toISOString(),
            verified: true,
            status: requireApproval ? 'pending' : 'approved',
            featured: false,
            helpful: 0
          };
          local.reviews = local.reviews || [];
          local.reviews.unshift(newRev);
          saveLocalData(local);
          result = {
            success: true,
            isPending: requireApproval,
            message: requireApproval
              ? 'Thank you! Your review has been submitted and is awaiting client approval.'
              : 'Thank you! Your review has been posted live on the website.'
          };
        }

        if (result.success) {
          showToast(result.message, 'success');
          form.reset();
          setupStarPicker(); // Reset star picker to 5
          closeModal('modal-leave-review');

          // Refresh public reviews
          const fresh = await fetchPublicReviews();
          renderStats(fresh.stats);
          renderReviewsGrid();
        } else {
          showToast(result.error || 'Failed to submit review.', 'error');
        }
      } catch (err) {
        console.error('Submission error:', err);
        showToast('Something went wrong. Please try again.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origBtnText;
      }
    });
  }

  // ==================== ADMIN DASHBOARD LOGIC ====================

  let currentAdminTab = 'all';
  let adminReviewsList = [];

  function setupAdminPortal() {
    const loginForm = document.getElementById('admin-login-form');
    const adminLogoutBtn = document.getElementById('admin-logout-btn');
    const autoPublishToggle = document.getElementById('admin-auto-publish-toggle');
    const exportBtn = document.getElementById('admin-export-btn');

    if (loginForm) {
      loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        const passInput = document.getElementById('admin-passcode');
        const pass = passInput.value.trim();
        const submitBtn = loginForm.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

        const hasApi = await checkBackend();
        let authed = false;

        if (hasApi) {
          try {
            const res = await fetch('/api/admin/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ passcode: pass })
            });
            const data = await res.json();
            if (data.success && data.token) {
              adminToken = data.token;
              sessionStorage.setItem('bc_admin_token', adminToken);
              authed = true;
            }
          } catch (err) {
            console.error(err);
          }
        } else {
          // Fallback static passkey check
          if (pass === 'bcdecor2026') {
            adminToken = 'local_admin_token';
            sessionStorage.setItem('bc_admin_token', adminToken);
            authed = true;
          }
        }

        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Unlock Moderation Panel';

        if (authed) {
          passInput.value = '';
          showAdminView();
          await loadAdminReviews();
          showToast('Welcome Barney & Connor! Admin portal unlocked.', 'success');
        } else {
          passInput.value = '';
          showToast('Invalid passcode. Access denied.', 'error');
        }
      });
    }

    if (adminLogoutBtn) {
      adminLogoutBtn.addEventListener('click', () => {
        adminToken = null;
        sessionStorage.removeItem('bc_admin_token');
        showAdminLogin();
        showToast('Logged out of Admin Portal.', 'info');
      });
    }

    // Auto publish toggle
    if (autoPublishToggle) {
      autoPublishToggle.addEventListener('change', async () => {
        const requireApproval = autoPublishToggle.checked;
        const hasApi = await checkBackend();
        if (hasApi) {
          try {
            await fetch('/api/admin/settings', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`
              },
              body: JSON.stringify({ requireApproval })
            });
          } catch (e) {
            console.warn(e);
          }
        }

        const local = getLocalData();
        local.settings = local.settings || {};
        local.settings.requireApproval = requireApproval;
        saveLocalData(local);

        showToast(
          requireApproval
            ? 'Moderation mode: All new reviews require approval.'
            : 'Live mode: New reviews will publish immediately.',
          'info'
        );
      });
    }

    // Export reviews to JSON
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(adminReviewsList, null, 2)], {
          type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bc_reviews_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Reviews exported successfully!', 'success');
      });
    }

    // Admin Tabs
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentAdminTab = btn.getAttribute('data-tab');
        renderAdminReviewsList();
      });
    });

    // Admin Search Filter
    const searchInput = document.getElementById('admin-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderAdminReviewsList();
      });
    }
  }

  function showAdminLogin() {
    const loginSection = document.getElementById('admin-login-section');
    const dashSection = document.getElementById('admin-dashboard-section');
    const passInput = document.getElementById('admin-passcode');
    if (passInput) passInput.value = '';
    if (loginSection) loginSection.style.display = 'block';
    if (dashSection) dashSection.style.display = 'none';
  }

  function showAdminView() {
    const loginSection = document.getElementById('admin-login-section');
    const dashSection = document.getElementById('admin-dashboard-section');
    if (loginSection) loginSection.style.display = 'none';
    if (dashSection) dashSection.style.display = 'block';
  }

  // Load all reviews for admin
  async function loadAdminReviews() {
    const hasApi = await checkBackend();
    if (hasApi && adminToken) {
      try {
        const res = await fetch('/api/admin/reviews', {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        const data = await res.json();
        if (data.success) {
          adminReviewsList = data.reviews || [];
          const autoPublishToggle = document.getElementById('admin-auto-publish-toggle');
          if (autoPublishToggle && data.settings) {
            autoPublishToggle.checked = data.settings.requireApproval !== false;
          }
          updateAdminBadges();
          renderAdminReviewsList();
          return;
        }
      } catch (e) {
        console.warn(e);
      }
    }

    // Fallback local
    const local = getLocalData();
    adminReviewsList = local.reviews || [];
    const autoPublishToggle = document.getElementById('admin-auto-publish-toggle');
    if (autoPublishToggle && local.settings) {
      autoPublishToggle.checked = local.settings.requireApproval !== false;
    }
    updateAdminBadges();
    renderAdminReviewsList();
  }

  // Update badge counters on tabs
  function updateAdminBadges() {
    const pendingCount = adminReviewsList.filter(r => r.status === 'pending').length;
    const approvedCount = adminReviewsList.filter(r => r.status === 'approved').length;
    const hiddenCount = adminReviewsList.filter(r => r.status === 'rejected').length;

    const allBadge = document.getElementById('badge-count-all');
    const pendingBadge = document.getElementById('badge-count-pending');
    const approvedBadge = document.getElementById('badge-count-approved');
    const hiddenBadge = document.getElementById('badge-count-hidden');

    if (allBadge) allBadge.textContent = adminReviewsList.length;
    if (pendingBadge) {
      pendingBadge.textContent = pendingCount;
      pendingBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
    }
    if (approvedBadge) approvedBadge.textContent = approvedCount;
    if (hiddenBadge) hiddenBadge.textContent = hiddenCount;
  }

  // Render Admin Review Items
  function renderAdminReviewsList() {
    const container = document.getElementById('admin-reviews-table-body');
    const emptyEl = document.getElementById('admin-empty-state');
    const searchVal = (document.getElementById('admin-search-input')?.value || '').toLowerCase().trim();

    if (!container) return;
    container.innerHTML = '';

    let list = [...adminReviewsList];

    // Filter by tab
    if (currentAdminTab === 'pending') {
      list = list.filter(r => r.status === 'pending');
    } else if (currentAdminTab === 'approved') {
      list = list.filter(r => r.status === 'approved');
    } else if (currentAdminTab === 'hidden') {
      list = list.filter(r => r.status === 'rejected');
    }

    // Filter by search
    if (searchVal) {
      list = list.filter(
        r =>
          (r.name && r.name.toLowerCase().includes(searchVal)) ||
          (r.title && r.title.toLowerCase().includes(searchVal)) ||
          (r.body && r.body.toLowerCase().includes(searchVal)) ||
          (r.location && r.location.toLowerCase().includes(searchVal))
      );
    }

    if (list.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    list.forEach(rev => {
      const item = document.createElement('div');
      item.className = `admin-review-item status-${rev.status}`;

      const statusBadge =
        rev.status === 'approved'
          ? '<span class="status-badge approved"><i class="fa-solid fa-check"></i> Approved</span>'
          : rev.status === 'pending'
          ? '<span class="status-badge pending"><i class="fa-solid fa-clock"></i> Pending Moderation</span>'
          : '<span class="status-badge rejected"><i class="fa-solid fa-eye-slash"></i> Hidden</span>';

      item.innerHTML = `
        <div class="admin-review-header">
          <div>
            <strong>${escapeHtml(rev.name)}</strong> 
            ${rev.location ? `<span class="admin-review-loc">• ${escapeHtml(rev.location)}</span>` : ''}
            <div class="admin-stars">${renderStarsHtml(rev.rating)}</div>
          </div>
          <div class="admin-header-right">
            ${statusBadge}
            ${rev.featured ? '<span class="admin-featured-badge"><i class="fa-solid fa-star"></i> Featured</span>' : ''}
            <span class="admin-date">${formatDate(rev.date)}</span>
          </div>
        </div>

        <h4 class="admin-review-title">"${escapeHtml(rev.title)}"</h4>
        <p class="admin-review-body">${escapeHtml(rev.body)}</p>

        <div class="admin-actions-bar">
          ${
            rev.status !== 'approved'
              ? `<button type="button" class="btn-admin-action approve" data-id="${rev.id}" data-action="approve">
                   <i class="fa-solid fa-check"></i> Approve & Publish
                 </button>`
              : `<button type="button" class="btn-admin-action hide" data-id="${rev.id}" data-action="hide">
                   <i class="fa-solid fa-eye-slash"></i> Hide from Public
                 </button>`
          }

          <button type="button" class="btn-admin-action feature ${rev.featured ? 'active' : ''}" data-id="${rev.id}" data-action="toggle-feature">
            <i class="fa-solid fa-award"></i> ${rev.featured ? 'Remove Featured' : 'Feature on Top'}
          </button>

          <button type="button" class="btn-admin-action delete" data-id="${rev.id}" data-action="delete">
            <i class="fa-solid fa-trash"></i> Delete
          </button>
        </div>
      `;

      container.appendChild(item);
    });

    // Attach button actions
    container.querySelectorAll('.btn-admin-action').forEach(btn => {
      btn.addEventListener('click', handleAdminAction);
    });
  }

  // Handle Admin Action Buttons
  async function handleAdminAction(e) {
    const btn = e.currentTarget;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');
    if (!id || !action) return;

    const hasApi = await checkBackend();

    if (action === 'delete') {
      if (!confirm('Are you sure you want to permanently delete this review?')) return;

      if (hasApi && adminToken) {
        try {
          await fetch(`/api/admin/reviews/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${adminToken}` }
          });
        } catch (err) {
          console.warn(err);
        }
      }

      // Update local storage
      const local = getLocalData();
      local.reviews = (local.reviews || []).filter(r => r.id !== id);
      saveLocalData(local);

      adminReviewsList = adminReviewsList.filter(r => r.id !== id);
      updateAdminBadges();
      renderAdminReviewsList();

      // Refresh public
      const fresh = await fetchPublicReviews();
      renderStats(fresh.stats);
      renderReviewsGrid();

      showToast('Review permanently deleted.', 'info');
      return;
    }

    let updatePayload = {};
    if (action === 'approve') {
      updatePayload = { status: 'approved' };
    } else if (action === 'hide') {
      updatePayload = { status: 'rejected' };
    } else if (action === 'toggle-feature') {
      const currentRev = adminReviewsList.find(r => r.id === id);
      updatePayload = { featured: !currentRev?.featured };
    }

    if (hasApi && adminToken) {
      try {
        await fetch(`/api/admin/reviews/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`
          },
          body: JSON.stringify(updatePayload)
        });
      } catch (err) {
        console.warn(err);
      }
    }

    // Update local data
    const local = getLocalData();
    const foundLocal = (local.reviews || []).find(r => r.id === id);
    if (foundLocal) {
      Object.assign(foundLocal, updatePayload);
      saveLocalData(local);
    }

    const foundAdmin = adminReviewsList.find(r => r.id === id);
    if (foundAdmin) {
      Object.assign(foundAdmin, updatePayload);
    }

    updateAdminBadges();
    renderAdminReviewsList();

    // Refresh public view
    const fresh = await fetchPublicReviews();
    renderStats(fresh.stats);
    renderReviewsGrid();

    showToast(`Review updated successfully.`, 'success');
  }

  // ==================== MODAL HELPERS ====================

  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      document.body.classList.add('modal-open');
    }
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
    }
  }

  function setupModals() {
    // Open Leave Review Modal
    document.querySelectorAll('[data-open-modal="modal-leave-review"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        openModal('modal-leave-review');
      });
    });

    // Open Admin Modal (Discreet lock in footer, or key shortcut)
    document.querySelectorAll('[data-open-modal="modal-admin-portal"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        openModal('modal-admin-portal');
        if (adminToken) {
          showAdminView();
          loadAdminReviews();
        } else {
          showAdminLogin();
        }
      });
    });

    // Keyboard shortcut for client: Ctrl + Shift + A (or Cmd + Shift + A)
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        openModal('modal-admin-portal');
        if (adminToken) {
          showAdminView();
          loadAdminReviews();
        } else {
          showAdminLogin();
        }
      }
    });

    // Close buttons
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', e => {
        const modal = el.closest('.bc-modal');
        if (modal) closeModal(modal.id);
      });
    });

    // Escape key
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.bc-modal.active').forEach(m => closeModal(m.id));
      }
    });
  }

  // ==================== FILTERING & SORTING ====================

  function setupFilters() {
    const ratingFilter = document.getElementById('filter-rating');
    const sortFilter = document.getElementById('filter-sort');
    const loadMoreBtn = document.getElementById('reviews-load-more');

    if (ratingFilter) {
      ratingFilter.addEventListener('change', e => {
        currentFilterRating = e.target.value;
        visibleCount = 6;
        renderReviewsGrid();
      });
    }

    if (sortFilter) {
      sortFilter.addEventListener('change', e => {
        currentSort = e.target.value;
        visibleCount = 6;
        renderReviewsGrid();
      });
    }

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        visibleCount += 6;
        renderReviewsGrid();
      });
    }
  }

  // ==================== INITIALIZATION ====================

  async function init() {
    setupModals();
    setupStarPicker();
    setupReviewForm();
    setupAdminPortal();
    setupFilters();

    const data = await fetchPublicReviews();
    renderStats(data.stats);
    renderReviewsGrid();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
