/* ── Config ──────────────────────────────────────────────────────────────── */
const API = '/api';

/* ── State ───────────────────────────────────────────────────────────────── */
let allUsers          = [];
let metricsTimer      = null; // kept for legacy reference safety
let adminSocket       = null;
let sessionsTickTimer = null;

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
  connectAdminSocket();
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
  if (section === 'stats')   loadStats();
  if (section === 'metrics') loadMetrics();
}

/* ── Logout ──────────────────────────────────────────────────────────────── */
document.getElementById('logout-btn').addEventListener('click', () => {
  disconnectAdminSocket();
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
}/* ── Admin Real-time Socket ─────────────────────────────────────────────────── */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function connectAdminSocket() {
  if (adminSocket) return;
  const token = getToken();
  if (!token || typeof io === 'undefined') return;

  adminSocket = io({ auth: { token } });

  adminSocket.on('connect', () => {
    console.log('[Admin] real-time socket connected');
  });

  adminSocket.on('admin_presence_update', ({ active_sessions, stats }) => {
    setText('m-connections',   stats.total_sockets ?? '—');
    setText('m-unique-online', stats.unique_users  ?? '—');
    const plat = stats.by_platform || {};
    setText('plat-desktop', plat.desktop    ?? '—');
    setText('plat-web',     plat.web        ?? '—');
    setText('plat-mobile',  plat.mobile_web ?? '—');
    renderActiveSessions(active_sessions);
  });

  adminSocket.on('admin_system_update', ({ uptime_seconds, memory_mb, db_pool }) => {
    setText('m-uptime',     uptime_seconds  != null   ? formatUptime(uptime_seconds)         : '—');
    setText('m-memory',     memory_mb?.rss  != null   ? `${memory_mb.rss} MB`                : '—');
    setText('pool-total',   db_pool?.total   ?? '—');
    setText('pool-idle',    db_pool?.idle    ?? '—');
    setText('pool-waiting', db_pool?.waiting ?? '—');
    setText('heap-used',    memory_mb?.heap_used  != null ? `${memory_mb.heap_used} MB`  : '—');
    setText('heap-total',   memory_mb?.heap_total != null ? `${memory_mb.heap_total} MB` : '—');
  });

  adminSocket.on('disconnect', () => {
    console.log('[Admin] real-time socket disconnected (auto-reconnect pending)');
  });
}

function disconnectAdminSocket() {
  clearInterval(sessionsTickTimer);
  sessionsTickTimer = null;
  if (adminSocket) {
    adminSocket.disconnect();
    adminSocket = null;
  }
}

/* ── Active Sessions ───────────────────────────────────────────────────────── */
const PLAT_LABEL = { desktop: 'Desktop', web: 'Web', mobile_web: 'Mobile Web' };

function renderActiveSessions(sessions) {
  clearInterval(sessionsTickTimer);
  sessionsTickTimer = null;
  const tbody = document.getElementById('sessions-tbody');
  if (!tbody) return;

  if (!sessions || sessions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading-cell" style="color:var(--text-muted)">No active connections.</td></tr>';
    return;
  }

  tbody.innerHTML = sessions.map(s =>
    `<tr>
      <td>${escHtml(s.username)}</td>
      <td><span class="platform-badge platform-${escHtml(s.platform)}">${escHtml(PLAT_LABEL[s.platform] || s.platform)}</span></td>
      <td class="socket-id" title="${escHtml(s.socketId)}">${escHtml(s.socketId.slice(0, 8))}…</td>
      <td class="duration-cell" data-connected-at="${escHtml(s.connectedAt)}"></td>
    </tr>`
  ).join('');

  function tick() {
    document.querySelectorAll('#sessions-tbody .duration-cell').forEach(cell => {
      const ms   = Date.now() - new Date(cell.dataset.connectedAt).getTime();
      const secs = Math.floor(ms / 1000);
      const mins = Math.floor(secs / 60);
      const hrs  = Math.floor(mins / 60);
      cell.textContent = hrs  > 0 ? `${hrs}h ${mins % 60}m`
                       : mins > 0 ? `${mins}m ${secs % 60}s`
                                  : `${secs}s`;
    });
  }
  tick();
  sessionsTickTimer = setInterval(tick, 1000);
}
/* ── Metrics ───────────────────────────────────────────────────────────────────────── */
async function loadMetrics() {
  const [snapRes, histRes] = await Promise.all([
    apiFetch('/admin/metrics'),
    apiFetch('/admin/metrics/history?days=7'),
  ]);
  if (snapRes.ok) renderMetricsSnapshot(snapRes.data.metrics);
  if (histRes.ok) renderMetricsHistory(histRes.data.history);
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function renderMetricsSnapshot(m) {
  document.getElementById('m-connections').textContent   = m.active_connections    ?? '—';
  document.getElementById('m-unique-online').textContent = m.unique_users_online   ?? '—';
  document.getElementById('m-dau').textContent           = m.dau                  ?? '—';
  document.getElementById('m-wau').textContent           = m.wau                  ?? '—';
  document.getElementById('m-avg-servers').textContent   = m.avg_servers_per_user ?? '—';
  document.getElementById('m-uptime').textContent        = m.uptime_seconds != null ? formatUptime(m.uptime_seconds) : '—';
  document.getElementById('m-memory').textContent        = m.memory_mb?.rss != null ? `${m.memory_mb.rss} MB` : '—';

  // Platform breakdown
  const plat = m.sessions_by_platform || {};
  document.getElementById('plat-desktop').textContent = plat.desktop    ?? '—';
  document.getElementById('plat-web').textContent     = plat.web        ?? '—';
  document.getElementById('plat-mobile').textContent  = plat.mobile_web ?? '—';

  document.getElementById('m-lt-logins').textContent = m.lifetime?.login_success   ?? '—';
  document.getElementById('m-lt-fails').textContent  = m.lifetime?.login_fail       ?? '—';
  document.getElementById('m-lt-reg').textContent    = m.lifetime?.user_registered  ?? '—';

  document.getElementById('pool-total').textContent   = m.db_pool?.total   ?? '—';
  document.getElementById('pool-idle').textContent    = m.db_pool?.idle    ?? '—';
  document.getElementById('pool-waiting').textContent = m.db_pool?.waiting ?? '—';
  document.getElementById('heap-used').textContent    = m.memory_mb?.heap_used  != null ? `${m.memory_mb.heap_used} MB`  : '—';
  document.getElementById('heap-total').textContent   = m.memory_mb?.heap_total != null ? `${m.memory_mb.heap_total} MB` : '—';

  // Response time table
  const tbody = document.getElementById('response-tbody');
  const rt = m.avg_response_ms || {};
  const routes = Object.keys(rt);
  if (routes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="loading-cell" style="color:var(--text-muted)">No data yet — make some API requests first.</td></tr>';
  } else {
    tbody.innerHTML = routes.map(r =>
      `<tr><td>${escHtml(r)}</td><td>${rt[r] != null ? rt[r] + ' ms' : '—'}</td></tr>`
    ).join('');
  }

  renderStatusBar(m.status_distribution || {});
}

const STATUS_COLORS = {
  online: '#3ba55d', idle: '#faa81a', dnd: '#ed4245', invisible: '#747f8d', offline: '#5c5f66',
};
const STATUS_LABELS = {
  online: 'Online', idle: 'Idle', dnd: 'DND', invisible: 'Invisible', offline: 'Offline',
};

function renderStatusBar(dist) {
  const total = Object.values(dist).reduce((a, b) => a + Number(b), 0);
  const track  = document.getElementById('status-bar');
  const legend = document.getElementById('status-legend');

  if (total === 0) {
    track.innerHTML  = '<div style="width:100%;background:var(--bg-tertiary);border-radius:4px;height:100%"></div>';
    legend.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem">No users online</span>';
    return;
  }

  const order = ['online', 'idle', 'dnd', 'invisible', 'offline'];
  track.innerHTML = order.map(s => {
    const count = Number(dist[s] || 0);
    if (count === 0) return '';
    const pct = (count / total * 100).toFixed(1);
    return `<div class="status-bar-seg" style="width:${pct}%;background:${STATUS_COLORS[s]}" title="${STATUS_LABELS[s]}: ${count}"></div>`;
  }).join('');

  legend.innerHTML = order
    .filter(s => Number(dist[s] || 0) > 0)
    .map(s => `<span class="status-legend-item"><span class="status-dot" style="background:${STATUS_COLORS[s]}"></span>${escHtml(STATUS_LABELS[s])} <strong>${dist[s]}</strong></span>`)
    .join('');
}

function renderMetricsHistory(history) {
  const maxLogin = Math.max(...history.map(d => d.login_success),   1);
  const maxFail  = Math.max(...history.map(d => d.login_fail),      1);
  const maxReg   = Math.max(...history.map(d => d.user_registered), 1);
  renderBarChart('chart-logins', history, 'login_success',   maxLogin, '#5865f2');
  renderBarChart('chart-fails',  history, 'login_fail',      maxFail,  '#ed4245');
  renderBarChart('chart-regs',   history, 'user_registered', maxReg,   '#3ba55d');
}

function renderBarChart(elId, history, key, maxVal, color) {
  const el = document.getElementById(elId);
  el.innerHTML = history.map(d => {
    const val = d[key] || 0;
    const pct = maxVal > 0 ? Math.max((val / maxVal) * 100, val > 0 ? 3 : 0) : 0;
    const date = new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `<div class="bar-row">
      <span class="bar-date">${escHtml(date)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="bar-val">${val}</span>
    </div>`;
  }).join('');
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
