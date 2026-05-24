'use strict';

// ── Auth Guard ─────────────────────────────────────────────────────────────────
const TOKEN      = () => sessionStorage.getItem('sa_token');
const SA_NAME    = () => sessionStorage.getItem('sa_name') || 'Super Admin';
const SA_PKID    = () => sessionStorage.getItem('sa_pkid') || '';
const LOGIN_TIME = () => parseInt(sessionStorage.getItem('sa_login_time') || '0', 10);
const SESSION_MS = 30 * 60 * 1000;

function checkAuth() {
  if (!TOKEN() || Date.now() - LOGIN_TIME() > SESSION_MS) {
    sessionStorage.clear();
    window.location.href = '/superadmin';
  }
}
checkAuth();

// ── Helpers ───────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const content = $('saContent');

function esc(v) {
  return String(v ?? '—').replace(/[&<>'"]/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}

function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return isNaN(d) ? esc(dt) : d.toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });
}

function badge(val, map) {
  const v = String(val || '').toLowerCase();
  for (const [k, cls] of Object.entries(map)) {
    if (v.includes(k)) return `<span class="badge ${cls}">${esc(val)}</span>`;
  }
  return `<span class="badge muted">${esc(val)}</span>`;
}

async function apiFetch(path, opts = {}) {
  const res = await fetch('/api/superadmin' + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) { sessionStorage.clear(); window.location.href = '/superadmin'; }
  return res.json();
}

function spin() {
  content.innerHTML = '<div class="sa-spinner-wrap"><span class="sa-spin"></span></div>';
}

let toastT;
function toast(msg, type = 'success') {
  const el = $('saToast');
  el.textContent = msg;
  el.className = `sa-toast ${type} show`;
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── Session timer ──────────────────────────────────────────────────────────────
$('saUserInfo').textContent = `${SA_NAME()} · ${SA_PKID()}`;

function tickTimer() {
  const remain = Math.max(0, SESSION_MS - (Date.now() - LOGIN_TIME()));
  const m = Math.floor(remain / 60000);
  const s = String(Math.floor((remain % 60000) / 1000)).padStart(2, '0');
  $('sessionTimer').textContent = remain > 0 ? `Expires in ${m}m ${s}s` : 'Session expired';
  if (remain === 0) { sessionStorage.clear(); window.location.href = '/superadmin'; }
}
setInterval(tickTimer, 1000);
tickTimer();

// ── Logout ────────────────────────────────────────────────────────────────────
$('saLogoutBtn').addEventListener('click', async () => {
  try { await apiFetch('/auth/logout', { method: 'POST' }); } catch {}
  sessionStorage.clear();
  window.location.href = '/superadmin';
});

// ── Mobile sidebar ────────────────────────────────────────────────────────────
$('mobileSidebarToggle').addEventListener('click', () =>
  $('saSidebar').classList.toggle('open'));

// ── Navigation ────────────────────────────────────────────────────────────────
const SECTIONS = {
  overview:        { label: 'Dashboard',           render: renderOverview },
  users:           { label: 'User Management',     render: renderUsers },
  applications:    { label: 'Applications',        render: renderApplications },
  certificates:    { label: 'Certificates',        render: renderCertificates },
  notices:         { label: 'Notices',             render: renderNotices },
  objections:      { label: 'Objections',          render: renderObjections },
  uploads:         { label: 'Upload Batches',      render: renderUploads },
  backups:         { label: 'Backup Logs',         render: renderBackups },
  audit:           { label: 'Audit Logs',          render: renderAuditLogs },
  'sa-activity':   { label: 'SA Activity',         render: renderSAActivity },
  'login-attempts':{ label: 'Login Attempts',      render: renderLoginAttempts },
  security:        { label: 'Security Monitor',    render: renderSecurity },
  'system-config': { label: 'System Config',       render: renderSystemConfig },
  features:        { label: 'Feature Flags',       render: renderFeatureFlags },
  'dashboard-ctrl':{ label: 'Dashboard Control',   render: renderDashboardCtrl },
  announcements:   { label: 'Announcements',       render: renderAnnouncements },
  activity:        { label: 'Activity Monitor',    render: renderActivity },
  system:          { label: 'System Info',         render: renderSystemInfo },
  env:             { label: 'Env Config',          render: renderEnvConfig },
};

function navigate(key) {
  if (!SECTIONS[key]) return;
  document.querySelectorAll('.sa-nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-section="${key}"]`);
  if (btn) btn.classList.add('active');
  $('sectionLabel').textContent = SECTIONS[key].label;
  $('sectionTitle').textContent  = SECTIONS[key].label;
  spin();
  SECTIONS[key].render();
}

$('saNav').addEventListener('click', e => {
  const btn = e.target.closest('[data-section]');
  if (btn) navigate(btn.dataset.section);
});

window.navigate = navigate;

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION RENDERERS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderOverview() {
  const d = await apiFetch('/stats');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  const s = d.stats;

  content.innerHTML = `
    <div class="sa-section-hdr"><h2>System Overview</h2></div>

    <div class="sa-stats">
      <div class="sa-stat"><div class="sa-stat-label">Total Users</div><div class="sa-stat-val blue">${s.users}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Applications</div><div class="sa-stat-val accent">${s.applications}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Pending</div><div class="sa-stat-val amber">${s.pending}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Approved</div><div class="sa-stat-val green">${s.approved}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Certificates</div><div class="sa-stat-val blue">${s.certificates}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Open Objections</div><div class="sa-stat-val red">${s.objections}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Notices</div><div class="sa-stat-val">${s.notices}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Upload Batches</div><div class="sa-stat-val">${s.uploadBatches}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Today Logins</div><div class="sa-stat-val blue">${s.todayLoginAttempts}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Today Failures</div><div class="sa-stat-val red">${s.todayFailedAttempts}</div></div>
    </div>

    <div class="sa-card">
      <div class="sa-card-head"><h3>Quick Navigation</h3></div>
      <div class="sa-card-body">
        <div class="sa-quick-grid">
          ${Object.entries(SECTIONS).filter(([k]) => k !== 'overview').map(([k, v]) =>
            `<button class="btn" onclick="navigate('${k}')">${v.label}</button>`
          ).join('')}
        </div>
      </div>
    </div>`;
}

function err(msg) {
  return `<div class="sa-empty">⚠ ${esc(msg || 'Failed to load data')}</div>`;
}

// ── Users ─────────────────────────────────────────────────────────────────────
async function renderUsers() {
  const d = await apiFetch('/users');
  if (!d.success) { content.innerHTML = err(d.message); return; }

  content.innerHTML = `
    <div class="sa-section-hdr"><h2>User Management</h2></div>
    <div class="sa-card" style="margin-bottom:18px">
      <div class="sa-card-head"><h3>Create New User</h3></div>
      <div class="sa-card-body">
        <div class="sa-form-grid">
          <div class="sa-form-group"><label>Username</label><input id="nu_user" placeholder="username"></div>
          <div class="sa-form-group"><label>Full Name</label><input id="nu_name" placeholder="Full name"></div>
          <div class="sa-form-group"><label>Password</label><input type="password" id="nu_pw" placeholder="Min 6 chars"></div>
          <div class="sa-form-group"><label>Role</label>
            <select id="nu_role">
              <option value="upload_staff">Upload Staff</option>
              <option value="objection_staff">Objection Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="sa-form-actions"><button class="btn primary" id="createUserBtn">Create User</button></div>
      </div>
    </div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>All Users (${d.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>Full Name</th><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${d.data.map(u => `<tr>
              <td>${u.id}</td>
              <td>${esc(u.full_name || u.username)}</td>
              <td><code>${esc(u.username)}</code></td>
              <td>${badge(u.role, { admin:'amber', upload:'blue', objection:'muted' })}</td>
              <td>${u.is_active ? '<span class="badge green">Active</span>' : '<span class="badge red">Inactive</span>'}</td>
              <td>${fmt(u.created_at)}</td>
              <td style="white-space:nowrap;display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn" onclick="toggleUser(${u.id})">${u.is_active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn" onclick="resetPw(${u.id},'${esc(u.username)}')">Reset PW</button>
                ${u.role !== 'admin' ? `<button class="btn danger" onclick="delUser(${u.id},'${esc(u.username)}')">Delete</button>` : ''}
              </td>
            </tr>`).join('') || noData(7)}
          </tbody>
        </table>
      </div>
    </div>`;

  $('createUserBtn').addEventListener('click', async () => {
    const body = { username: $('nu_user').value.trim(), full_name: $('nu_name').value.trim(), password: $('nu_pw').value, role: $('nu_role').value };
    if (!body.username || !body.password) return toast('Username and password required.', 'error');
    const r = await apiFetch('/users', { method: 'POST', body: JSON.stringify(body) });
    r.success ? (toast('User created.'), renderUsers()) : toast(r.message || 'Failed', 'error');
  });
}

window.toggleUser = async id => {
  const r = await apiFetch(`/users/${id}/toggle`, { method: 'PUT' });
  r.success ? (toast('Status updated.'), renderUsers()) : toast(r.message || 'Failed', 'error');
};
window.resetPw = async (id, username) => {
  const pw = prompt(`New password for "${username}" (min 6 chars):`);
  if (!pw) return;
  const r = await apiFetch(`/users/${id}/reset-password`, { method: 'PUT', body: JSON.stringify({ new_password: pw }) });
  r.success ? toast('Password reset.') : toast(r.message || 'Failed', 'error');
};
window.delUser = async (id, username) => {
  if (!confirm(`Delete user "${username}"? Cannot be undone.`)) return;
  const r = await apiFetch(`/users/${id}`, { method: 'DELETE' });
  r.success ? (toast('User deleted.'), renderUsers()) : toast(r.message || 'Failed', 'error');
};

// ── Applications ──────────────────────────────────────────────────────────────
let appQ = { search:'', status:'', page:1, limit:50 };

async function renderApplications() {
  const p = new URLSearchParams({ ...appQ });
  const d = await apiFetch(`/applications?${p}`);
  if (!d.success) { content.innerHTML = err(d.message); return; }
  const pg = d.pagination;

  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Application Control</h2></div>
    <div class="sa-search-bar">
      <input id="appQ" placeholder="Search name, app no, district, mobile…" value="${esc(appQ.search)}">
      <select id="appS">
        <option value="">All Status</option>
        ${['pending','verification','objection','approved','rejected','cop','renewal'].map(s =>
          `<option value="${s}" ${appQ.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <button class="btn primary" id="appSearch">Search</button>
      <button class="btn" id="appClear">Clear</button>
    </div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>${pg.total} Applications — Page ${pg.page}/${pg.totalPages}</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>App No</th><th>Name</th><th>Father/Husband</th><th>District</th><th>Mobile</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>
            ${d.data.map(a => `<tr>
              <td>${a.id}</td>
              <td style="font-weight:700;color:var(--accent)">${esc(a.application_no)}</td>
              <td>${esc(a.name)}</td>
              <td>${esc(a.father_name)}</td>
              <td>${esc(a.district)}</td>
              <td>${esc(a.mobile)}</td>
              <td>${badge(a.status,{pending:'amber',approved:'green',rejected:'red',verification:'blue',objection:'red',cop:'blue',renewal:'blue'})}</td>
              <td style="white-space:nowrap">${fmt(a.created_at)}</td>
              <td style="white-space:nowrap;display:flex;gap:6px">
                <button class="btn" onclick="editApp(${a.id},'${esc(a.application_no)}','${esc(a.name)}','${esc(a.father_name)}','${esc(a.district)}','${esc(a.mobile)}','${esc(a.status)}')">Edit</button>
                <button class="btn danger" onclick="delApp(${a.id},'${esc(a.application_no)}')">Delete</button>
              </td>
            </tr>`).join('') || noData(9)}
          </tbody>
        </table>
      </div>
      <div class="sa-pager">
        <span>${pg.total} records</span>
        <div class="sa-pager-btns">
          <button class="btn" id="appPrev" ${pg.page<=1?'disabled':''}>← Prev</button>
          <button class="btn" id="appNext" ${pg.page>=pg.totalPages?'disabled':''}>Next →</button>
        </div>
      </div>
    </div>`;

  $('appSearch').onclick = () => { appQ.search = $('appQ').value.trim(); appQ.status = $('appS').value; appQ.page = 1; spin(); renderApplications(); };
  $('appClear').onclick  = () => { appQ = { search:'', status:'', page:1, limit:50 }; spin(); renderApplications(); };
  $('appPrev') && ($('appPrev').onclick = () => { appQ.page--; spin(); renderApplications(); });
  $('appNext') && ($('appNext').onclick = () => { appQ.page++; spin(); renderApplications(); });
}

window.editApp = async (id, appNo, name, father, district, mobile, status) => {
  const n = prompt('Full Name:', name); if (n === null) return;
  const f = prompt('Father/Husband:', father); if (f === null) return;
  const di = prompt('District:', district); if (di === null) return;
  const m = prompt('Mobile:', mobile); if (m === null) return;
  const st = prompt('Status (pending|verification|objection|approved|rejected|cop|renewal):', status); if (st === null) return;
  const r = await apiFetch(`/applications/${id}`, { method:'PUT', body: JSON.stringify({ name:n, father_name:f, district:di, mobile:m, status:st }) });
  r.success ? (toast('Updated.'), renderApplications()) : toast(r.message || 'Failed', 'error');
};
window.delApp = async (id, appNo) => {
  if (!confirm(`Delete application "${appNo}"? Cannot be undone.`)) return;
  const r = await apiFetch(`/applications/${id}`, { method: 'DELETE' });
  r.success ? (toast('Deleted.'), renderApplications()) : toast(r.message || 'Failed', 'error');
};

// ── Certificates ──────────────────────────────────────────────────────────────
async function renderCertificates() {
  const d = await apiFetch('/certificates');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Certificates</h2></div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>All Certificates (${d.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>App No</th><th>Candidate</th><th>District</th><th>File</th><th>Status</th><th>Uploaded</th></tr></thead>
          <tbody>
            ${d.data.map(c => `<tr>
              <td>${c.id}</td>
              <td style="color:var(--accent);font-weight:700">${esc(c.application_no)}</td>
              <td>${esc(c.name)}</td>
              <td>${esc(c.district)}</td>
              <td><a href="/uploads/${esc(c.file_path)}" target="_blank" style="color:var(--blue)">View</a></td>
              <td>${badge(c.status,{pending:'amber',approved:'green',rejected:'red'})}</td>
              <td>${fmt(c.uploaded_at)}</td>
            </tr>`).join('') || noData(7)}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Notices ───────────────────────────────────────────────────────────────────
async function renderNotices() {
  const d = await apiFetch('/notices');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Notice Management</h2></div>
    <div class="sa-card" style="margin-bottom:18px">
      <div class="sa-card-head"><h3>Publish New Notice</h3></div>
      <div class="sa-card-body">
        <div class="sa-form-grid">
          <div class="sa-form-group"><label>Title</label><input id="nt_title" placeholder="Notice title"></div>
          <div class="sa-form-group"><label>Audience</label>
            <select id="nt_aud"><option value="public">Public</option><option value="staff">Staff</option></select>
          </div>
          <div class="sa-form-group sa-form-full"><label>Content</label><textarea id="nt_content" placeholder="Notice body…"></textarea></div>
        </div>
        <div class="sa-form-actions"><button class="btn primary" id="createNoticeBtn">Publish</button></div>
      </div>
    </div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>All Notices (${d.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>Title</th><th>Audience</th><th>Active</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            ${d.data.map(n => `<tr>
              <td>${n.id}</td><td>${esc(n.title)}</td>
              <td>${badge(n.target_audience||'public',{public:'blue',staff:'amber'})}</td>
              <td>${n.is_active?'<span class="badge green">Yes</span>':'<span class="badge muted">No</span>'}</td>
              <td>${fmt(n.created_at)}</td>
              <td><button class="btn danger" onclick="delNotice(${n.id})">Delete</button></td>
            </tr>`).join('') || noData(6)}
          </tbody>
        </table>
      </div>
    </div>`;

  $('createNoticeBtn').onclick = async () => {
    const body = { title: $('nt_title').value.trim(), content: $('nt_content').value.trim(), target_audience: $('nt_aud').value };
    if (!body.title) return toast('Title required.', 'error');
    const r = await apiFetch('/notices', { method:'POST', body: JSON.stringify(body) });
    r.success ? (toast('Notice published.'), renderNotices()) : toast(r.message || 'Failed', 'error');
  };
}
window.delNotice = async id => {
  if (!confirm('Delete this notice?')) return;
  const r = await apiFetch(`/notices/${id}`, { method:'DELETE' });
  r.success ? (toast('Deleted.'), renderNotices()) : toast(r.message || 'Failed', 'error');
};

// ── Objections ────────────────────────────────────────────────────────────────
async function renderObjections() {
  const d = await apiFetch('/objections');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Objections</h2></div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>All Objections (${d.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>App No</th><th>Candidate</th><th>Reason</th><th>Status</th><th>Raised</th><th>Resolved</th></tr></thead>
          <tbody>
            ${d.data.map(o => `<tr>
              <td>${o.id}</td>
              <td style="color:var(--accent);font-weight:700">${esc(o.application_no)}</td>
              <td>${esc(o.name)}</td>
              <td>${esc(o.reason)}</td>
              <td>${badge(o.status,{open:'red',resolved:'green',closed:'muted'})}</td>
              <td>${fmt(o.created_at)}</td>
              <td>${fmt(o.resolved_at)}</td>
            </tr>`).join('') || noData(7)}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Uploads ───────────────────────────────────────────────────────────────────
async function renderUploads() {
  const d = await apiFetch('/uploads');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Upload Batches</h2></div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>Excel Import History (${d.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>Filename</th><th>Total</th><th>Inserted</th><th>Errors</th><th>Skipped</th><th>Date</th></tr></thead>
          <tbody>
            ${d.data.map(u => `<tr>
              <td>${u.id}</td><td>${esc(u.filename)}</td>
              <td>${u.total_rows}</td>
              <td><span class="badge green">${u.inserted_rows}</span></td>
              <td><span class="badge ${u.error_rows>0?'red':'muted'}">${u.error_rows}</span></td>
              <td><span class="badge amber">${u.skipped_rows}</span></td>
              <td>${fmt(u.uploaded_at)}</td>
            </tr>`).join('') || noData(7)}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Backups ───────────────────────────────────────────────────────────────────
async function renderBackups() {
  const d = await apiFetch('/backups');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Backup Logs</h2></div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>Backup History (${d.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>Filename</th><th>Size (KB)</th><th>Type</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            ${d.data.map(b => `<tr>
              <td>${b.id}</td><td>${esc(b.filename)}</td>
              <td>${b.size_kb ?? '—'}</td>
              <td>${badge(b.type||'manual',{manual:'blue',auto:'muted'})}</td>
              <td>${badge(b.status,{success:'green',failed:'red'})}</td>
              <td>${fmt(b.created_at)}</td>
            </tr>`).join('') || noData(6)}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Audit Logs ────────────────────────────────────────────────────────────────
async function renderAuditLogs() {
  const d = await apiFetch('/audit-logs?limit=200');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  content.innerHTML = `
    <div class="sa-section-hdr"><h2>System Audit Logs</h2></div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>Recent Actions (${d.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>Date</th><th>Role</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            ${d.data.map(l => `<tr>
              <td>${l.id}</td>
              <td style="white-space:nowrap">${fmt(l.created_at)}</td>
              <td>${badge(l.role||'—',{admin:'amber',upload:'blue',objection:'muted',candidate:'green'})}</td>
              <td><code>${esc(l.action)}</code></td>
              <td>${esc(l.details)}</td>
              <td><code>${esc(l.ip_address)}</code></td>
            </tr>`).join('') || noData(6)}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── SA Activity ───────────────────────────────────────────────────────────────
async function renderSAActivity() {
  const d = await apiFetch('/sa-logs');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Super Admin Activity</h2></div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>SA Action Log (${d.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>Date</th><th>Passkey ID</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            ${d.data.map(l => `<tr>
              <td>${l.id}</td>
              <td style="white-space:nowrap">${fmt(l.created_at)}</td>
              <td><span class="badge amber">${esc(l.passkey_id)}</span></td>
              <td><code>${esc(l.action)}</code></td>
              <td>${esc(l.details)}</td>
              <td><code>${esc(l.ip)}</code></td>
            </tr>`).join('') || noData(6)}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Login Attempts ────────────────────────────────────────────────────────────
async function renderLoginAttempts() {
  const d = await apiFetch('/login-attempts');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  const ok = d.data.filter(r => r.success).length;
  const fail = d.data.length - ok;
  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Login Attempts</h2></div>
    <div class="sa-stats" style="margin-bottom:18px">
      <div class="sa-stat"><div class="sa-stat-label">Total</div><div class="sa-stat-val">${d.data.length}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Successful</div><div class="sa-stat-val green">${ok}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Failed</div><div class="sa-stat-val red">${fail}</div></div>
    </div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>Last 300 Attempts</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>Date</th><th>Passkey ID</th><th>Result</th><th>Reason</th><th>IP</th></tr></thead>
          <tbody>
            ${d.data.map(r => `<tr>
              <td>${r.id}</td>
              <td style="white-space:nowrap">${fmt(r.created_at)}</td>
              <td>${esc(r.passkey_id)}</td>
              <td>${r.success ? '<span class="badge green">Success</span>' : '<span class="badge red">Failed</span>'}</td>
              <td>${esc(r.failure_reason)}</td>
              <td><code>${esc(r.ip)}</code></td>
            </tr>`).join('') || noData(6)}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Security Monitor ──────────────────────────────────────────────────────────
async function renderSecurity() {
  const d = await apiFetch('/security-monitor');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Security Monitor</h2></div>
    ${d.currentlyLocked.length ? `
    <div class="sa-card" style="margin-bottom:18px;border-color:rgba(239,68,68,.3)">
      <div class="sa-card-head" style="border-color:rgba(239,68,68,.2)"><h3 style="color:var(--red)">⚠ Locked IPs (${d.currentlyLocked.length})</h3></div>
      <div class="sa-card-body" style="display:flex;flex-wrap:wrap;gap:8px">
        ${d.currentlyLocked.map(ip => `<span class="badge red">${esc(ip)}</span>`).join('')}
      </div>
    </div>` : ''}
    <div class="sa-card" style="margin-bottom:18px">
      <div class="sa-card-head"><h3>Recent Failures by IP (24h)</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>IP</th><th>Attempts</th><th>Last Attempt</th></tr></thead>
          <tbody>
            ${d.recentFailures.map(r => `<tr>
              <td><code>${esc(r.ip)}</code></td>
              <td><span class="badge ${r.attempts>=5?'red':'amber'}">${r.attempts}</span></td>
              <td>${fmt(r.last_attempt)}</td>
            </tr>`).join('') || noData(3)}
          </tbody>
        </table>
      </div>
    </div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>Recent Successful Logins</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>Passkey ID</th><th>IP</th><th>Time</th></tr></thead>
          <tbody>
            ${d.recentSuccessfulLogins.map(r => `<tr>
              <td><span class="badge amber">${esc(r.passkey_id)}</span></td>
              <td><code>${esc(r.ip)}</code></td>
              <td>${fmt(r.created_at)}</td>
            </tr>`).join('') || noData(3)}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── System Info ───────────────────────────────────────────────────────────────
async function renderSystemInfo() {
  const d = await apiFetch('/system-info');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  const s = d.system;
  const heapPct = ((s.memoryHeapUsed / s.memoryHeapTotal) * 100).toFixed(1);
  const osPct   = (((parseFloat(s.totalMemGB) - parseFloat(s.freeMemGB)) / parseFloat(s.totalMemGB)) * 100).toFixed(1);

  content.innerHTML = `
    <div class="sa-section-hdr"><h2>System Information</h2></div>
    <div class="sa-stats" style="margin-bottom:18px">
      <div class="sa-stat"><div class="sa-stat-label">Uptime</div><div class="sa-stat-val blue" style="font-size:18px">${esc(s.uptimeHuman)}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Node.js</div><div class="sa-stat-val" style="font-size:20px">${esc(s.nodeVersion)}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Heap Usage</div><div class="sa-stat-val ${parseFloat(heapPct)>80?'red':'green'}">${heapPct}%</div></div>
      <div class="sa-stat"><div class="sa-stat-label">RAM Usage</div><div class="sa-stat-val ${parseFloat(osPct)>85?'red':'green'}">${osPct}%</div></div>
      <div class="sa-stat"><div class="sa-stat-label">CPU Cores</div><div class="sa-stat-val">${s.cpuCores}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">PID / Port</div><div class="sa-stat-val" style="font-size:16px">${s.pid} / :${s.port}</div></div>
    </div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>Server Details</h3></div>
      <div class="sa-card-body">
        <div class="sa-info-grid">
          ${[
            ['Hostname', s.hostname], ['OS Platform', s.osPlatform], ['OS Release', s.osRelease],
            ['Total RAM', s.totalMemGB + ' GB'], ['Free RAM', s.freeMemGB + ' GB'],
            ['Heap Used', s.memoryHeapUsed + ' MB'], ['Heap Total', s.memoryHeapTotal + ' MB'],
            ['RSS Memory', s.memoryRSS + ' MB'], ['Environment', s.nodeEnv], ['Process ID', s.pid]
          ].map(([k,v]) => `<div class="sa-info-item"><div class="sa-info-key">${esc(k)}</div><div class="sa-info-val">${esc(String(v))}</div></div>`).join('')}
        </div>
      </div>
    </div>`;
}

// ── Env Config ────────────────────────────────────────────────────────────────
async function renderEnvConfig() {
  const d = await apiFetch('/env-config');
  if (!d.success) { content.innerHTML = err(d.message); return; }
  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Environment Configuration</h2></div>
    <div class="sa-card" style="margin-bottom:18px">
      <div class="sa-card-head"><h3>Active Config Values</h3></div>
      <div class="sa-card-body">
        <div class="sa-info-grid">
          ${Object.entries(d.config).map(([k,v]) =>
            `<div class="sa-info-item"><div class="sa-info-key">${esc(k)}</div><div class="sa-info-val">${esc(v)}</div></div>`
          ).join('')}
        </div>
      </div>
    </div>
    <div class="sa-card">
      <div class="sa-card-head"><h3>Sensitive Key Presence</h3></div>
      <div class="sa-card-body" style="display:flex;flex-wrap:wrap;gap:10px">
        ${Object.entries(d.secretsExist).map(([k,v]) =>
          `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid ${v?'rgba(34,197,94,.25)':'rgba(239,68,68,.25)'};border-radius:8px;background:${v?'rgba(34,197,94,.06)':'rgba(239,68,68,.06)'}">
            <span class="badge ${v?'green':'red'}">${v?'✓':'✗'}</span>
            <span style="font-size:12px;font-weight:700;color:#94a3b8">${esc(k)}</span>
          </div>`
        ).join('')}
      </div>
    </div>`;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function noData(cols) {
  return `<tr><td colspan="${cols}" class="sa-empty">No records found</td></tr>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROL CENTER SECTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ── System Config ─────────────────────────────────────────────────────────────
async function renderSystemConfig() {
  const [d, maint] = await Promise.all([
    apiFetch('/system-config'),
    apiFetch('/maintenance')
  ]);
  if (!d.success) { content.innerHTML = err(d.message); return; }

  const grouped = {};
  for (const row of d.data) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(row);
  }

  const catLabels = { general:'General', security:'Security', features:'Feature Switches', upload:'Upload Settings', notifications:'Notifications' };
  const maintOn = maint.maintenance;

  content.innerHTML = `
    <div class="sa-section-hdr"><h2>System Configuration Center</h2></div>

    <div class="sa-card" style="margin-bottom:18px;border-color:${maintOn?'rgba(239,68,68,.4)':'rgba(34,197,94,.3)'}">
      <div class="sa-card-head">
        <h3>⚡ Maintenance Mode</h3>
        <span class="badge ${maintOn?'red':'green'}">${maintOn?'ACTIVE':'OFF'}</span>
      </div>
      <div class="sa-card-body" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <p style="color:var(--muted);font-size:13px;margin-bottom:8px">When enabled, all users see the maintenance message. Super Admin access is unaffected.</p>
          <div style="font-size:12px;color:${maintOn?'var(--red)':'var(--green)'}">Status: <strong>${maintOn?'Site is DOWN for maintenance':'Site is live and accessible'}</strong></div>
        </div>
        <label class="sa-toggle" title="Toggle maintenance mode">
          <input type="checkbox" id="maintToggle" ${maintOn?'checked':''}>
          <span class="sa-toggle-slider"></span>
        </label>
      </div>
    </div>

    ${Object.entries(grouped).map(([cat, rows]) => `
      <div class="sa-card" style="margin-bottom:18px">
        <div class="sa-card-head"><h3>${catLabels[cat]||cat}</h3></div>
        <div class="sa-card-body" style="padding:0">
          ${rows.map(r => `
            <div class="sa-config-row" data-key="${esc(r.config_key)}">
              <div class="sa-config-info">
                <div class="sa-config-label">${esc(r.config_key)}</div>
                <div class="sa-config-desc">${esc(r.description)}</div>
              </div>
              <div class="sa-config-ctrl">
                ${r.config_type === 'boolean'
                  ? `<label class="sa-toggle">
                       <input type="checkbox" class="cfg-bool" data-key="${esc(r.config_key)}" ${r.config_value==='true'?'checked':''}>
                       <span class="sa-toggle-slider"></span>
                     </label>`
                  : r.config_type === 'number'
                  ? `<div style="display:flex;gap:8px;align-items:center">
                       <input class="cfg-input" data-key="${esc(r.config_key)}" type="number" value="${esc(r.config_value)}" style="width:90px;height:32px;border:1px solid var(--border2);border-radius:6px;padding:0 8px;background:var(--bg);color:var(--text)">
                       <button class="btn" onclick="saveCfgNum('${esc(r.config_key)}')">Save</button>
                     </div>`
                  : `<div style="display:flex;gap:8px;align-items:center">
                       <input class="cfg-input" data-key="${esc(r.config_key)}" value="${esc(r.config_value)}" style="width:220px;height:32px;border:1px solid var(--border2);border-radius:6px;padding:0 8px;background:var(--bg);color:var(--text)">
                       <button class="btn" onclick="saveCfgStr('${esc(r.config_key)}')">Save</button>
                     </div>`
                }
                <div class="sa-config-meta">by ${esc(r.updated_by)} · ${fmt(r.updated_at)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}`;

  $('maintToggle').addEventListener('change', async function() {
    const on = this.checked;
    const r = await apiFetch('/maintenance', { method:'PUT', body: JSON.stringify({ enabled: on }) });
    r.success ? (toast(`Maintenance mode ${on?'ENABLED':'DISABLED'}`, on?'error':'success'), renderSystemConfig()) : toast(r.message||'Failed','error');
  });

  document.querySelectorAll('.cfg-bool').forEach(cb => {
    cb.addEventListener('change', async function() {
      const key = this.dataset.key;
      const r = await apiFetch(`/system-config/${encodeURIComponent(key)}`, { method:'PUT', body: JSON.stringify({ config_value: this.checked?'true':'false' }) });
      r.success ? toast(`${key} updated`) : toast(r.message||'Failed','error');
    });
  });
}

window.saveCfgStr = async key => {
  const inp = document.querySelector(`.cfg-input[data-key="${key}"]`);
  if (!inp) return;
  const r = await apiFetch(`/system-config/${encodeURIComponent(key)}`, { method:'PUT', body: JSON.stringify({ config_value: inp.value }) });
  r.success ? toast(`${key} saved`) : toast(r.message||'Failed','error');
};
window.saveCfgNum = window.saveCfgStr;

// ── Feature Flags ─────────────────────────────────────────────────────────────
async function renderFeatureFlags() {
  const d = await apiFetch('/feature-flags');
  if (!d.success) { content.innerHTML = err(d.message); return; }

  const grouped = {};
  for (const f of d.data) {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category].push(f);
  }

  const enabled = d.data.filter(f=>f.enabled).length;
  const beta    = d.data.filter(f=>f.is_beta).length;

  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Feature Flag Management</h2></div>
    <div class="sa-stats" style="margin-bottom:18px">
      <div class="sa-stat"><div class="sa-stat-label">Total Features</div><div class="sa-stat-val blue">${d.data.length}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Enabled</div><div class="sa-stat-val green">${enabled}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Disabled</div><div class="sa-stat-val red">${d.data.length-enabled}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Beta Features</div><div class="sa-stat-val amber">${beta}</div></div>
    </div>

    <div class="sa-card" style="margin-bottom:18px">
      <div class="sa-card-head"><h3>Add New Feature Flag</h3></div>
      <div class="sa-card-body">
        <div class="sa-form-grid">
          <div class="sa-form-group"><label>Feature Key</label><input id="ff_key" placeholder="e.g. new_dashboard"></div>
          <div class="sa-form-group"><label>Label</label><input id="ff_label" placeholder="Human-readable name"></div>
          <div class="sa-form-group"><label>Category</label>
            <select id="ff_cat">
              <option value="general">General</option>
              <option value="candidate">Candidate</option>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
              <option value="beta">Beta</option>
            </select>
          </div>
          <div class="sa-form-group"><label>Roles (comma-separated or "all")</label><input id="ff_roles" value="all" placeholder="all / candidate / admin,upload_staff"></div>
          <div class="sa-form-group"><label>Description</label><input id="ff_desc" placeholder="What this feature does"></div>
          <div class="sa-form-group" style="display:flex;align-items:flex-end;gap:12px">
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);cursor:pointer">
              <input type="checkbox" id="ff_beta"> Beta Feature
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);cursor:pointer">
              <input type="checkbox" id="ff_enabled" checked> Enabled
            </label>
          </div>
        </div>
        <div class="sa-form-actions"><button class="btn primary" id="addFfBtn">Add Feature Flag</button></div>
      </div>
    </div>

    ${Object.entries(grouped).map(([cat, flags]) => `
      <div class="sa-card" style="margin-bottom:18px">
        <div class="sa-card-head"><h3>${cat.charAt(0).toUpperCase()+cat.slice(1)} Features (${flags.length})</h3></div>
        <div class="sa-table-wrap">
          <table class="sa-table">
            <thead><tr><th>Feature</th><th>Roles</th><th>Status</th><th>Beta</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              ${flags.map(f=>`<tr>
                <td>
                  <div style="font-weight:700">${esc(f.label)}</div>
                  <div style="font-size:11px;color:var(--muted)">${esc(f.feature_key)}</div>
                  ${f.description?`<div style="font-size:11px;color:var(--muted2)">${esc(f.description)}</div>`:''}
                </td>
                <td>${esc(f.roles)}</td>
                <td>
                  <label class="sa-toggle">
                    <input type="checkbox" class="ff-toggle" data-id="${f.id}" ${f.enabled?'checked':''}>
                    <span class="sa-toggle-slider"></span>
                  </label>
                </td>
                <td>${f.is_beta?'<span class="badge amber">Beta</span>':'<span class="badge muted">Stable</span>'}</td>
                <td style="white-space:nowrap">${fmt(f.updated_at)}</td>
                <td>
                  <button class="btn danger" onclick="deleteFlag(${f.id},'${esc(f.label)}')">Delete</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `).join('')}`;

  $('addFfBtn').onclick = async () => {
    const body = {
      feature_key: $('ff_key').value.trim(),
      label:       $('ff_label').value.trim(),
      description: $('ff_desc').value.trim(),
      roles:       $('ff_roles').value.trim() || 'all',
      category:    $('ff_cat').value,
      enabled:     $('ff_enabled').checked,
      is_beta:     $('ff_beta').checked
    };
    if (!body.feature_key||!body.label) return toast('Key and label required','error');
    const r = await apiFetch('/feature-flags',{method:'POST',body:JSON.stringify(body)});
    r.success?(toast('Feature flag added'),renderFeatureFlags()):toast(r.message||'Failed','error');
  };

  document.querySelectorAll('.ff-toggle').forEach(cb=>{
    cb.addEventListener('change', async function(){
      const r = await apiFetch(`/feature-flags/${this.dataset.id}`,{method:'PUT',body:JSON.stringify({enabled:this.checked})});
      r.success?toast(this.checked?'Feature enabled':'Feature disabled',this.checked?'success':'info'):toast(r.message||'Failed','error');
    });
  });
}

window.deleteFlag = async (id, label) => {
  if (!confirm(`Delete feature flag "${label}"?`)) return;
  const r = await apiFetch(`/feature-flags/${id}`,{method:'DELETE'});
  r.success?(toast('Deleted'),renderFeatureFlags()):toast(r.message||'Failed','error');
};

// ── Dashboard Control ─────────────────────────────────────────────────────────
async function renderDashboardCtrl() {
  const d = await apiFetch('/dashboard-sections');
  if (!d.success) { content.innerHTML = err(d.message); return; }

  const roleOrder = ['candidate','upload_staff','objection_staff','admin','all'];
  const grouped = {};
  for (const s of d.data) {
    const r = s.roles || 'all';
    if (!grouped[r]) grouped[r]=[];
    grouped[r].push(s);
  }

  const roleLabels = { candidate:'Candidate Portal', upload_staff:'Upload Staff', objection_staff:'Objection Staff', admin:'Admin Panel', all:'All Roles' };

  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Dashboard Section Control</h2></div>
    <div class="sa-stats" style="margin-bottom:18px">
      <div class="sa-stat"><div class="sa-stat-label">Total Sections</div><div class="sa-stat-val blue">${d.data.length}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Active</div><div class="sa-stat-val green">${d.data.filter(s=>s.enabled).length}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Disabled</div><div class="sa-stat-val red">${d.data.filter(s=>!s.enabled).length}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Pinned</div><div class="sa-stat-val amber">${d.data.filter(s=>s.pinned).length}</div></div>
    </div>

    <div class="sa-card" style="margin-bottom:18px">
      <div class="sa-card-head"><h3>Add Dashboard Section</h3></div>
      <div class="sa-card-body">
        <div class="sa-form-grid">
          <div class="sa-form-group"><label>Section Key</label><input id="ds_key" placeholder="e.g. new_widget"></div>
          <div class="sa-form-group"><label>Label</label><input id="ds_label" placeholder="Display name"></div>
          <div class="sa-form-group"><label>Target Role</label>
            <select id="ds_role">
              <option value="candidate">Candidate</option>
              <option value="upload_staff">Upload Staff</option>
              <option value="objection_staff">Objection Staff</option>
              <option value="admin">Admin</option>
              <option value="all">All Roles</option>
            </select>
          </div>
          <div class="sa-form-group"><label>Icon (emoji)</label><input id="ds_icon" value="▣" style="width:80px"></div>
          <div class="sa-form-group"><label>Sort Order</label><input id="ds_sort" type="number" value="99" style="width:80px"></div>
          <div class="sa-form-group"><label>Description</label><input id="ds_desc" placeholder="What this section shows"></div>
          <div class="sa-form-group" style="display:flex;align-items:flex-end;gap:14px">
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);cursor:pointer">
              <input type="checkbox" id="ds_pin"> Pin to top
            </label>
          </div>
        </div>
        <div class="sa-form-actions"><button class="btn primary" id="addDsBtn">Add Section</button></div>
      </div>
    </div>

    ${roleOrder.filter(r=>grouped[r]?.length).map(role=>`
      <div class="sa-card" style="margin-bottom:18px">
        <div class="sa-card-head">
          <h3>${roleLabels[role]||role} Sections (${grouped[role].length})</h3>
        </div>
        <div class="sa-table-wrap">
          <table class="sa-table">
            <thead><tr><th>Icon</th><th>Section</th><th>Description</th><th>Order</th><th>Pinned</th><th>Visible</th><th>Action</th></tr></thead>
            <tbody>
              ${grouped[role].sort((a,b)=>a.sort_order-b.sort_order).map(s=>`<tr>
                <td style="font-size:20px;text-align:center">${esc(s.icon)}</td>
                <td>
                  <div style="font-weight:700">${esc(s.label)}</div>
                  <div style="font-size:11px;color:var(--muted)">${esc(s.section_key)}</div>
                </td>
                <td style="color:var(--muted);font-size:12px">${esc(s.description)}</td>
                <td style="font-weight:700;text-align:center">${s.sort_order}</td>
                <td style="text-align:center">${s.pinned?'<span class="badge amber">📌</span>':'—'}</td>
                <td>
                  <label class="sa-toggle">
                    <input type="checkbox" class="ds-toggle" data-id="${s.id}" ${s.enabled?'checked':''}>
                    <span class="sa-toggle-slider"></span>
                  </label>
                </td>
                <td>
                  <button class="btn danger" onclick="deleteSection(${s.id},'${esc(s.label)}')">Remove</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `).join('')}`;

  $('addDsBtn').onclick = async () => {
    const body = {
      section_key: $('ds_key').value.trim(),
      label:       $('ds_label').value.trim(),
      description: $('ds_desc').value.trim(),
      roles:       $('ds_role').value,
      icon:        $('ds_icon').value.trim()||'▣',
      sort_order:  parseInt($('ds_sort').value)||99,
      pinned:      $('ds_pin').checked,
      enabled:     true
    };
    if (!body.section_key||!body.label) return toast('Key and label required','error');
    const r = await apiFetch('/dashboard-sections',{method:'POST',body:JSON.stringify(body)});
    r.success?(toast('Section added'),renderDashboardCtrl()):toast(r.message||'Failed','error');
  };

  document.querySelectorAll('.ds-toggle').forEach(cb=>{
    cb.addEventListener('change', async function(){
      const r = await apiFetch(`/dashboard-sections/${this.dataset.id}`,{method:'PUT',body:JSON.stringify({enabled:this.checked})});
      r.success?toast(this.checked?'Section visible':'Section hidden',this.checked?'success':'info'):toast(r.message||'Failed','error');
    });
  });
}

window.deleteSection = async (id, label) => {
  if (!confirm(`Remove dashboard section "${label}"?`)) return;
  const r = await apiFetch(`/dashboard-sections/${id}`,{method:'DELETE'});
  r.success?(toast('Section removed'),renderDashboardCtrl()):toast(r.message||'Failed','error');
};

// ── Announcements ─────────────────────────────────────────────────────────────
async function renderAnnouncements() {
  const d = await apiFetch('/announcements');
  if (!d.success) { content.innerHTML = err(d.message); return; }

  const active = d.data.filter(a=>a.is_active).length;

  content.innerHTML = `
    <div class="sa-section-hdr"><h2>Dynamic Announcement System</h2></div>
    <div class="sa-stats" style="margin-bottom:18px">
      <div class="sa-stat"><div class="sa-stat-label">Total</div><div class="sa-stat-val blue">${d.data.length}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Active</div><div class="sa-stat-val green">${active}</div></div>
      <div class="sa-stat"><div class="sa-stat-label">Inactive</div><div class="sa-stat-val muted">${d.data.length-active}</div></div>
    </div>

    <div class="sa-card" style="margin-bottom:18px">
      <div class="sa-card-head"><h3>Create Announcement</h3></div>
      <div class="sa-card-body">
        <div class="sa-form-grid">
          <div class="sa-form-group"><label>Title</label><input id="an_title" placeholder="Announcement title"></div>
          <div class="sa-form-group"><label>Type</label>
            <select id="an_type">
              <option value="banner">Banner (top of page)</option>
              <option value="popup">Popup (modal dialog)</option>
              <option value="scroll">Scrolling Ticker</option>
              <option value="alert">Alert Box</option>
            </select>
          </div>
          <div class="sa-form-group"><label>Target Audience</label>
            <select id="an_roles">
              <option value="all">All Users</option>
              <option value="candidate">Candidates Only</option>
              <option value="staff">Staff Only</option>
              <option value="admin">Admin Only</option>
            </select>
          </div>
          <div class="sa-form-group"><label>Start Date (optional)</label><input id="an_start" type="datetime-local"></div>
          <div class="sa-form-group"><label>End Date (optional)</label><input id="an_end" type="datetime-local"></div>
          <div class="sa-form-group sa-form-full"><label>Content / Message</label><textarea id="an_content" placeholder="Full announcement text…"></textarea></div>
        </div>
        <div class="sa-form-actions">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);cursor:pointer;margin-right:auto">
            <input type="checkbox" id="an_active" checked> Active immediately
          </label>
          <button class="btn primary" id="addAnBtn">Publish Announcement</button>
        </div>
      </div>
    </div>

    <div class="sa-card">
      <div class="sa-card-head"><h3>All Announcements</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>#</th><th>Title</th><th>Type</th><th>Audience</th><th>Active</th><th>Schedule</th><th>Actions</th></tr></thead>
          <tbody>
            ${d.data.map(a=>`<tr>
              <td>${a.id}</td>
              <td>
                <div style="font-weight:700">${esc(a.title)}</div>
                ${a.content?`<div style="font-size:11px;color:var(--muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.content)}</div>`:''}
              </td>
              <td>${badge(a.type,{banner:'blue',popup:'amber',scroll:'green',alert:'red'})}</td>
              <td>${badge(a.target_roles||'all',{all:'muted',candidate:'blue',staff:'amber',admin:'red'})}</td>
              <td>
                <label class="sa-toggle">
                  <input type="checkbox" class="an-toggle" data-id="${a.id}" ${a.is_active?'checked':''}>
                  <span class="sa-toggle-slider"></span>
                </label>
              </td>
              <td style="font-size:11px;color:var(--muted)">
                ${a.start_at?`From: ${fmt(a.start_at)}`:'—'}<br>
                ${a.end_at?`Until: ${fmt(a.end_at)}`:'No expiry'}
              </td>
              <td>
                <button class="btn danger" onclick="deleteAnnouncement(${a.id},'${esc(a.title)}')">Delete</button>
              </td>
            </tr>`).join('') || noData(7)}
          </tbody>
        </table>
      </div>
    </div>`;

  $('addAnBtn').onclick = async () => {
    const body = {
      title:        $('an_title').value.trim(),
      content:      $('an_content').value.trim(),
      type:         $('an_type').value,
      target_roles: $('an_roles').value,
      is_active:    $('an_active').checked,
      start_at:     $('an_start').value || null,
      end_at:       $('an_end').value || null
    };
    if (!body.title) return toast('Title required','error');
    const r = await apiFetch('/announcements',{method:'POST',body:JSON.stringify(body)});
    r.success?(toast('Announcement published'),renderAnnouncements()):toast(r.message||'Failed','error');
  };

  document.querySelectorAll('.an-toggle').forEach(cb=>{
    cb.addEventListener('change', async function(){
      const r = await apiFetch(`/announcements/${this.dataset.id}`,{method:'PUT',body:JSON.stringify({is_active:this.checked})});
      r.success?toast(this.checked?'Announcement activated':'Announcement deactivated',this.checked?'success':'info'):toast(r.message||'Failed','error');
    });
  });
}

window.deleteAnnouncement = async (id, title) => {
  if (!confirm(`Delete announcement "${title}"?`)) return;
  const r = await apiFetch(`/announcements/${id}`,{method:'DELETE'});
  r.success?(toast('Deleted'),renderAnnouncements()):toast(r.message||'Failed','error');
};

// ── Activity Monitor ──────────────────────────────────────────────────────────
let actRole = '';
let actRefreshTimer = null;

async function renderActivity() {
  const d = await apiFetch(`/activity?limit=100${actRole?'&role='+actRole:''}`);
  if (!d.success) { content.innerHTML = err(d.message); return; }

  const roleColors = { admin:'amber', upload_staff:'blue', objection_staff:'muted', candidate:'green' };

  content.innerHTML = `
    <div class="sa-section-hdr">
      <h2>Activity Monitor</h2>
      <button class="btn" id="actRefreshBtn">↻ Refresh</button>
    </div>

    <div class="sa-stats" style="margin-bottom:18px">
      ${d.loginsByRole.map(r=>`
        <div class="sa-stat">
          <div class="sa-stat-label">${esc(r.role||'unknown')} logins (24h)</div>
          <div class="sa-stat-val ${roleColors[r.role]||'blue'}">${r.total}</div>
        </div>
      `).join('')}
      ${!d.loginsByRole.length?`<div class="sa-stat"><div class="sa-stat-label">Logins Today</div><div class="sa-stat-val muted">0</div></div>`:''}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">
      <div class="sa-card">
        <div class="sa-card-head"><h3>Top Actions (7 days)</h3></div>
        <div class="sa-table-wrap">
          <table class="sa-table">
            <thead><tr><th>Action</th><th>Count</th></tr></thead>
            <tbody>
              ${d.topActions.map(a=>`<tr>
                <td><code>${esc(a.action)}</code></td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:${Math.min(80,Math.round((a.count/(d.topActions[0]?.count||1))*80))}px;height:6px;background:var(--blue);border-radius:3px"></div>
                    <span style="font-weight:700">${a.count}</span>
                  </div>
                </td>
              </tr>`).join('') || noData(2)}
            </tbody>
          </table>
        </div>
      </div>

      <div class="sa-card">
        <div class="sa-card-head"><h3>Failed SA Logins (24h)</h3></div>
        <div class="sa-table-wrap">
          <table class="sa-table">
            <thead><tr><th>IP</th><th>Attempts</th><th>Last Try</th></tr></thead>
            <tbody>
              ${d.failedLogins.map(f=>`<tr>
                <td><code>${esc(f.ip)}</code></td>
                <td><span class="badge ${f.attempts>=5?'red':'amber'}">${f.attempts}</span></td>
                <td style="font-size:11px">${fmt(f.last_try)}</td>
              </tr>`).join('') || noData(3)}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="sa-card" style="margin-bottom:18px">
      <div class="sa-card-head">
        <h3>Live Activity Feed</h3>
        <div style="display:flex;gap:8px">
          ${['','admin','upload_staff','objection_staff','candidate'].map(r=>`
            <button class="btn ${actRole===r?'primary':''}" onclick="setActRole('${r}')">
              ${r||'All'}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>Time</th><th>Role</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            ${d.recentActivity.map(a=>`<tr>
              <td style="white-space:nowrap;font-size:12px">${fmt(a.created_at)}</td>
              <td>${badge(a.role||'unknown',roleColors)}</td>
              <td><code>${esc(a.action)}</code></td>
              <td style="font-size:12px;color:var(--muted);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.details)}</td>
              <td><code style="font-size:11px">${esc(a.ip)}</code></td>
            </tr>`).join('') || noData(5)}
          </tbody>
        </table>
      </div>
    </div>

    <div class="sa-card">
      <div class="sa-card-head"><h3>Super Admin Recent Actions</h3></div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>Time</th><th>Passkey</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            ${d.saRecentActivity.map(a=>`<tr>
              <td style="white-space:nowrap;font-size:12px">${fmt(a.created_at)}</td>
              <td><span class="badge amber">${esc(a.passkey_id)}</span></td>
              <td><code>${esc(a.action)}</code></td>
              <td style="font-size:12px;color:var(--muted)">${esc(a.details)}</td>
              <td><code style="font-size:11px">${esc(a.ip)}</code></td>
            </tr>`).join('') || noData(5)}
          </tbody>
        </table>
      </div>
    </div>`;

  $('actRefreshBtn').onclick = () => { spin(); renderActivity(); };
}

window.setActRole = role => { actRole = role; spin(); renderActivity(); };

// ── Boot ──────────────────────────────────────────────────────────────────────
navigate('overview');
