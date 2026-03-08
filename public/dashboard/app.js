/* ── Config ──────────────────────────────────────────────────────────────── */
const API = '/api';

/* ── State ───────────────────────────────────────────────────────────────── */
let allUsers = [];

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function getToken() { return localStorage.getItem('fed_token'); }
function setToken(t) { localStorage.setItem('fed_token', t); }
function clearToken() { localStorage.removeItem('fed_token'); }

function parseJWT(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch { return null; }
}

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { ok: res.ok, status: res.status, data };
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(el) { el.classList.add('hidden'); }

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ── Auth ────────────────────────────────────────────────────────────────── */
async function attemptLogin(email, password) {
  const { ok, data } = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!ok) {
    throw new Error(data.errors?.[0]?.msg || data.error || 'Login failed.');
  }

  // Verify the token belongs to the admin UUID (server will reject non-admin
  // requests to /api/admin/*, but we can show a friendlier message here)
  setToken(data.token);
  const payload = parseJWT(data.token);
  if (!payload) throw new Error('Invalid token received.');

  // Quick probe: try to fetch stats; if 403 it's not an admin account
  const probe = await apiFetch('/admin/stats');
  if (probe.status === 403) {
    clearToken();
    throw new Error('This account does not have admin access.');
  }
  if (!probe.ok) {
    clearToken();
    throw new Error('Could not verify admin access. Try again.');
  }

  return data.user;
}

/* ── Login Form ──────────────────────────────────────────────────────────── */
const loginForm     = document.getElementById('login-form');
const loginBtn      = document.getElementById('login-btn');
const loginError    = document.getElementById('login-error');
const loginView     = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(loginError);
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const user = await attemptLogin(email, password);
    document.getElementById('admin-username').textContent = user?.username || 'Admin';
    showDashboard();
  } catch (err) {
    showError(loginError, err.message);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
});

/* ── View Switching ──────────────────────────────────────────────────────── */
function showLogin() {
  loginView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
  document.body.classList.add('login-page');
}

function showDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  document.body.classList.remove('login-page');
  loadUsers();
  navigateTo('users');
}

/* ── Sidebar Nav ─────────────────────────────────────────────────────────── */
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const section = link.dataset.section;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    navigateTo(section);
  });
});

function navigateTo(section) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`section-${section}`);
  if (el) el.classList.add('active');
  if (section === 'stats') loadStats();
}

/* ── Logout ──────────────────────────────────────────────────────────────── */
document.getElementById('logout-btn').addEventListener('click', () => {
  clearToken();
  showLogin();
});

/* ── Users ───────────────────────────────────────────────────────────────── */
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr id="users-loading-row"><td colspan="7" class="loading-cell">Loading…</td></tr>';

  const { ok, data } = await apiFetch('/admin/users');
  if (!ok) {
    tbody.innerHTML = `<tr><td colspan="9" class="loading-cell" style="color:var(--danger)">Failed to load users.</td></tr>`;
    return;
  }

  allUsers = data.users;
  renderUsers(allUsers);
}

const STATUS_DOT = {
  online:    '#3ba55d',
  idle:      '#faa81a',
  dnd:       '#ed4245',
  invisible: '#747f8d',
  offline:   '#747f8d',
};

function statusBadge(status) {
  const s = status || 'offline';
  const color = STATUS_DOT[s] || STATUS_DOT.offline;
  const label = { online: 'Online', idle: 'Idle', dnd: 'DND', invisible: 'Invisible', offline: 'Offline' }[s] || s;
  return `<span class="status-badge" style="--dot:${color}">${escHtml(label)}</span>`;
}

function renderUsers(users) {
  const tbody = document.getElementById('users-tbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${escHtml(u.username)}</td>
      <td>${escHtml(u.email)}</td>
      <td>${escHtml(u.display_name || '—')}</td>
      <td>${statusBadge(u.status)}</td>
      <td>${escHtml(u.theme || 'dark')}</td>
      <td>${u.server_count}</td>
      <td>${formatDate(u.last_seen)}</td>
      <td>${formatDate(u.created_at)}</td>
      <td><button class="edit-btn" data-id="${escHtml(u.id)}">Edit</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });
}

/* Search */
document.getElementById('user-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allUsers.filter(u =>
    u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  );
  renderUsers(filtered);
});

/* ── Edit Modal ──────────────────────────────────────────────────────────── */
const modalOverlay   = document.getElementById('modal-overlay');
const editForm       = document.getElementById('edit-form');
const editError      = document.getElementById('edit-error');
const deleteUserBtn  = document.getElementById('delete-user-btn');

function openEditModal(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('edit-user-id').value        = user.id;
  document.getElementById('edit-username').value       = user.username || '';
  document.getElementById('edit-email').value          = user.email || '';
  document.getElementById('edit-display-name').value  = user.display_name || '';
  document.getElementById('edit-avatar-url').value    = user.avatar_url || '';
  document.getElementById('edit-theme').value         = user.theme || 'dark';
  document.getElementById('edit-status').value        = user.status || 'offline';
  document.getElementById('modal-title').textContent  = `Edit — ${user.username}`;
  hideError(editError);

  modalOverlay.classList.remove('hidden');
}

function closeEditModal() { modalOverlay.classList.add('hidden'); }

document.getElementById('modal-close').addEventListener('click', closeEditModal);
document.getElementById('cancel-btn').addEventListener('click', closeEditModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeEditModal(); });

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(editError);
  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const id = document.getElementById('edit-user-id').value;
  const payload = {
    username:     document.getElementById('edit-username').value.trim()      || undefined,
    email:        document.getElementById('edit-email').value.trim()         || undefined,
    display_name: document.getElementById('edit-display-name').value.trim()  || undefined,
    avatar_url:   document.getElementById('edit-avatar-url').value.trim()    || undefined,
    theme:        document.getElementById('edit-theme').value,
    status:       document.getElementById('edit-status').value,
  };

  const { ok, data } = await apiFetch(`/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save Changes';

  if (!ok) {
    showError(editError, data.errors?.[0]?.msg || data.error || 'Update failed.');
    return;
  }

  closeEditModal();
  loadUsers();
});

/* ── Delete ──────────────────────────────────────────────────────────────── */
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmMessage = document.getElementById('confirm-message');
const confirmOk      = document.getElementById('confirm-ok');
const confirmCancel  = document.getElementById('confirm-cancel');
let pendingDeleteId  = null;

deleteUserBtn.addEventListener('click', () => {
  const id       = document.getElementById('edit-user-id').value;
  const username = document.getElementById('edit-username').value;
  pendingDeleteId = id;
  confirmMessage.textContent = `Permanently delete "${username}"? This cannot be undone.`;
  confirmOverlay.classList.remove('hidden');
});

confirmCancel.addEventListener('click', () => {
  confirmOverlay.classList.add('hidden');
  pendingDeleteId = null;
});

confirmOk.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  confirmOk.disabled = true;
  confirmOk.textContent = 'Deleting…';

  const { ok, data } = await apiFetch(`/admin/users/${pendingDeleteId}`, { method: 'DELETE' });

  confirmOk.disabled = false;
  confirmOk.textContent = 'Delete';
  confirmOverlay.classList.add('hidden');

  if (!ok) {
    alert(data.error || 'Delete failed.');
    return;
  }

  pendingDeleteId = null;
  closeEditModal();
  loadUsers();
});

/* ── Stats ───────────────────────────────────────────────────────────────── */
async function loadStats() {
  const { ok, data } = await apiFetch('/admin/stats');
  if (!ok) return;
  document.getElementById('stat-users').textContent   = data.stats.total_users;
  document.getElementById('stat-servers').textContent = data.stats.unique_servers;
  document.getElementById('stat-entries').textContent = data.stats.total_server_entries;
}

/* ── XSS Helper ──────────────────────────────────────────────────────────── */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Init ────────────────────────────────────────────────────────────────── */
(function init() {
  const token = getToken();
  if (!token) { showLogin(); return; }

  const payload = parseJWT(token);
  // If token is expired, go to login
  if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
    clearToken();
    showLogin();
    return;
  }

  // Re-probe admin access in case the UUID was changed
  apiFetch('/admin/stats').then(({ ok, status }) => {
    if (status === 401 || status === 403) { clearToken(); showLogin(); return; }
    // Resolve username from stored user list or fall back to token sub
    document.getElementById('admin-username').textContent = payload.username || 'Admin';
    showDashboard();
  });
})();
