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
  overview:        { label: 'Dashboard',        render: renderOverview },
  users:           { label: 'User Management',  render: renderUsers },
  applications:    { label: 'Applications',     render: renderApplications },
  certificates:    { label: 'Certificates',     render: renderCertificates },
  notices:         { label: 'Notices',          render: renderNotices },
  objections:      { label: 'Objections',       render: renderObjections },
  uploads:         { label: 'Upload Batches',   render: renderUploads },
  backups:         { label: 'Backup Logs',      render: renderBackups },
  audit:           { label: 'Audit Logs',       render: renderAuditLogs },
  'sa-activity':   { label: 'SA Activity',      render: renderSAActivity },
  'login-attempts':{ label: 'Login Attempts',   render: renderLoginAttempts },
  security:        { label: 'Security Monitor', render: renderSecurity },
  system:          { label: 'System Info',      render: renderSystemInfo },
  env:             { label: 'Env Config',       render: renderEnvConfig },
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

// ── Boot ──────────────────────────────────────────────────────────────────────
navigate('overview');
