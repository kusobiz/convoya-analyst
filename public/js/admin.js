// ── User Management (Admin only) ──
// Mirrors the rest of the app's per-tab conventions: attributes.js's onXTabActivated
// lazy-load-once pattern, dashboard.js's LOT_RESULTS_PAGE_SIZES 10/25 page-nav pattern for
// the Login Activity table, and attributes.js's Add/Edit modal shape for Add User.
//
// The Admin tab button/panel are hidden by default in index.html (style="display:none") —
// initCurrentUser() below is what reveals them, based on the session's role reported by
// GET /api/me. That's a UX convenience only, not the security boundary: every /api/admin/*
// route re-checks the session role server-side (requireAdmin in src/auth.js), so a
// Manager poking the DOM back open still gets 403s from every request.

let currentUserRole = null;

async function initCurrentUser() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    const me = await res.json();
    currentUserRole = me.role || null;

    const badge = document.getElementById('currentUserBadge');
    if (badge && me.username) {
      badge.textContent = `${me.displayName || me.username} · ${me.role}`;
      badge.hidden = false;
    }

    const adminTabBtn = document.getElementById('tabBtnAdmin');
    if (adminTabBtn) adminTabBtn.style.display = currentUserRole === 'Admin' ? '' : 'none';
  } catch (e) {
    console.error('[admin] initCurrentUser failed:', e);
  }
}

// `res.url.includes('/login')` (the pattern used elsewhere, e.g. attributes.js) false-positives
// here — /api/admin/login-activity's own path contains "/login" as a substring. Compare the
// exact pathname of wherever the fetch actually landed instead.
function isLoginRedirect(res) {
  if (res.status === 401) return true;
  try { return new URL(res.url).pathname === '/login'; } catch { return false; }
}

function adminStatusBadge(isActive) {
  return isActive ? `<span class="badge badge--green">Active</span>` : `<span class="badge badge--red">Inactive</span>`;
}

function adminFormatDateTime(s) {
  if (!s) return '—';
  // SQLite datetime('now') is UTC "YYYY-MM-DD HH:MM:SS" with no timezone marker — append one
  // so the browser renders it in local time instead of misreading it as already-local.
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d) ? s : d.toLocaleString();
}

// ── Users ──
let lastAdminUsers = [];

async function renderAdminUsersSection() {
  const tbody = document.getElementById('adminUsersBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const res = await fetch('/api/admin/users');
    if (isLoginRedirect(res)) throw new Error('SESSION_EXPIRED');
    if (res.status === 403) throw new Error('Admin access required.');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

    lastAdminUsers = body.users || [];
    renderAdminUsersBody();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

function renderAdminUsersBody() {
  const tbody = document.getElementById('adminUsersBody');
  if (!tbody) return;
  if (!lastAdminUsers.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted)">No users found.</td></tr>`;
    return;
  }
  tbody.innerHTML = lastAdminUsers.map(u => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.display_name || '—')}</td>
      <td>
        <select class="branch-select" style="width:auto;" data-action="admin-role" data-id="${u.id}">
          <option value="Manager" ${u.role === 'Manager' ? 'selected' : ''}>Manager</option>
          <option value="Admin" ${u.role === 'Admin' ? 'selected' : ''}>Admin</option>
        </select>
      </td>
      <td>${adminStatusBadge(!!u.is_active)}</td>
      <td>${adminFormatDateTime(u.created_at)}</td>
      <td>${adminFormatDateTime(u.last_login_at)}</td>
      <td>
        <button class="btn-report" style="padding:0.3rem 0.7rem;" data-action="admin-toggle-active" data-id="${u.id}" data-active="${u.is_active ? 1 : 0}">
          ${u.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>`).join('');
}

async function patchAdminUser(id, payload) {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.user;
}

async function toggleAdminUserActive(id, currentlyActive) {
  try {
    await patchAdminUser(id, { isActive: !currentlyActive });
    await renderAdminUsersSection();
  } catch (err) {
    alert('Failed to update user: ' + err.message);
  }
}

async function changeAdminUserRole(id, role) {
  try {
    await patchAdminUser(id, { role });
  } catch (err) {
    alert('Failed to update role: ' + err.message);
    renderAdminUsersBody(); // revert the <select> to the last known-good value
  }
}

// ── Add User modal ──
function openAdminUserModal() {
  document.getElementById('adminUserUsername').value = '';
  document.getElementById('adminUserDisplayName').value = '';
  document.getElementById('adminUserPassword').value = '';
  document.getElementById('adminUserRole').value = 'Manager';
  const warnEl = document.getElementById('adminUserWarning');
  if (warnEl) { warnEl.style.display = 'none'; warnEl.textContent = ''; }
  document.getElementById('adminUserModal')?.removeAttribute('hidden');
}

function closeAdminUserModal() {
  document.getElementById('adminUserModal')?.setAttribute('hidden', '');
}

async function saveAdminUser() {
  const username = document.getElementById('adminUserUsername').value.trim();
  const displayName = document.getElementById('adminUserDisplayName').value.trim();
  const password = document.getElementById('adminUserPassword').value;
  const role = document.getElementById('adminUserRole').value;
  const warnEl = document.getElementById('adminUserWarning');

  if (!username || !password) {
    if (warnEl) { warnEl.textContent = 'Username and Temporary Password are required.'; warnEl.style.display = 'block'; }
    return;
  }

  const saveBtn = document.getElementById('btnAdminUserSave');
  if (saveBtn) saveBtn.disabled = true;
  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password, role }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    closeAdminUserModal();
    await renderAdminUsersSection();
  } catch (err) {
    if (warnEl) { warnEl.textContent = err.message; warnEl.style.display = 'block'; }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── Login Activity (10/25 page-nav, same pattern as Lot Results — dashboard.js's
// LOT_RESULTS_PAGE_SIZES/renderLotResultsToolbar) ──
const ADMIN_AUDIT_PAGE_SIZES = [10, 25];
let adminAuditPage = 1;
let adminAuditPageSize = 10;

function renderAdminAuditToolbar(totalCount, totalPages) {
  const el = document.getElementById('adminAuditToolbar');
  if (!el) return;
  if (!totalCount) { el.innerHTML = ''; return; }
  const rangeStart = (adminAuditPage - 1) * adminAuditPageSize + 1;
  const rangeEnd = Math.min(adminAuditPage * adminAuditPageSize, totalCount);
  el.innerHTML = `
    <div class="drilldown-toolbar-count">Showing ${fmt(rangeStart)}–${fmt(rangeEnd)} of ${fmt(totalCount)} entries</div>
    <div class="drilldown-toolbar-actions">
      <div class="drill-page-size">
        ${ADMIN_AUDIT_PAGE_SIZES.map(n => `<button type="button" class="drill-page-btn${adminAuditPageSize === n ? ' active' : ''}" data-admin-audit-page="${n}">${n}</button>`).join('')}
      </div>
      <div class="drill-page-nav">
        <button type="button" class="drill-page-nav-btn" data-admin-audit-nav="prev" ${adminAuditPage <= 1 ? 'disabled' : ''}>&laquo; Previous</button>
        <span class="drill-page-nav-indicator">Page ${adminAuditPage} of ${totalPages}</span>
        <button type="button" class="drill-page-nav-btn" data-admin-audit-nav="next" ${adminAuditPage >= totalPages ? 'disabled' : ''}>Next &raquo;</button>
      </div>
    </div>`;
}

async function renderAdminAuditSection() {
  const tbody = document.getElementById('adminAuditBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const res = await fetch(`/api/admin/login-activity?page=${adminAuditPage}&pageSize=${adminAuditPageSize}`);
    if (isLoginRedirect(res)) throw new Error('SESSION_EXPIRED');
    if (res.status === 403) throw new Error('Admin access required.');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

    const totalPages = Math.max(1, Math.ceil(body.total / adminAuditPageSize));
    if (adminAuditPage > totalPages) { adminAuditPage = totalPages; return renderAdminAuditSection(); }
    renderAdminAuditToolbar(body.total, totalPages);

    if (!body.rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted)">No login attempts recorded yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = body.rows.map(r => `
      <tr>
        <td>${escapeHtml(r.username)}</td>
        <td>${r.success ? '<span class="badge badge--green">Success</span>' : '<span class="badge badge--red">Failed</span>'}</td>
        <td>${escapeHtml(r.ip_address || '—')}</td>
        <td>${adminFormatDateTime(r.attempted_at)}</td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

// ── Events ──
let adminTabEventsInit = false;
function initAdminTabEvents() {
  if (adminTabEventsInit) return;
  adminTabEventsInit = true;

  document.getElementById('adminUsersBody')?.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('button[data-action="admin-toggle-active"]');
    if (toggleBtn) { toggleAdminUserActive(toggleBtn.dataset.id, toggleBtn.dataset.active === '1'); return; }
  });
  document.getElementById('adminUsersBody')?.addEventListener('change', (e) => {
    const roleSelect = e.target.closest('select[data-action="admin-role"]');
    if (roleSelect) { changeAdminUserRole(roleSelect.dataset.id, roleSelect.value); return; }
  });

  document.getElementById('adminAuditBody')?.closest('.table-card')?.addEventListener('click', (e) => {
    const pageBtn = e.target.closest('button[data-admin-audit-page]');
    if (pageBtn) {
      adminAuditPageSize = Number(pageBtn.dataset.adminAuditPage);
      adminAuditPage = 1;
      renderAdminAuditSection();
      return;
    }
    const navBtn = e.target.closest('button[data-admin-audit-nav]');
    if (navBtn) {
      adminAuditPage += navBtn.dataset.adminAuditNav === 'prev' ? -1 : 1;
      renderAdminAuditSection();
      return;
    }
  });

  document.getElementById('btnAdminUserCancel')?.addEventListener('click', closeAdminUserModal);
  document.getElementById('btnAdminUserSave')?.addEventListener('click', saveAdminUser);
}

let adminTabLoaded = false;
async function onAdminTabActivated() {
  initAdminTabEvents();
  if (adminTabLoaded) return;
  adminTabLoaded = true;
  await Promise.all([renderAdminUsersSection(), renderAdminAuditSection()]);
}

initCurrentUser();

window.onAdminTabActivated = onAdminTabActivated;
window.openAdminUserModal = openAdminUserModal;
window.renderAdminUsersSection = renderAdminUsersSection;
