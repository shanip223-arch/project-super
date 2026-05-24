'use strict';

// ── Auth Guard ────────────────────────────────────────────────────────────────
const SA_TOKEN     = () => sessionStorage.getItem('sa_token');
const SA_NAME      = () => sessionStorage.getItem('sa_name') || 'Super Admin';
const SA_PKID      = () => sessionStorage.getItem('sa_pkid') || '';
const LOGIN_TIME   = () => parseInt(sessionStorage.getItem('sa_login_time') || '0', 10);
const SESSION_MAX  = 30 * 60 * 1000;

function checkAuth() {
  if (!SA_TOKEN() || Date.now() - LOGIN_TIME() > SESSION_MAX) {
    sessionStorage.clear();
    window.location.href = '/superadmin';
  }
}
checkAuth();

// ── Helpers ───────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const content = $('saContent');

function esc(v) {
  return String(v ?? '—').replace(/[&<>'"]/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])
  );
}

function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return isNaN(d) ? esc(dt) : d.toLocaleString('en-IN');
}

function badge(val, map) {
  const v = String(val || '').toLowerCase();
  for (const [k, cls] of Object.entries(map)) {
    if (v.includes(k)) return `<span class="badge ${cls}">${esc(val)}</span>`;
  }
  return `<span class="badge muted">${esc(val)}</span>`;
}

async function saFetch(path, opts = {}) {
  const res = await fetch('/api/superadmin' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${SA_TOKEN()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  if (res.status === 401) { sessionStorage.clear(); window.location.href = '/superadmin'; }
  return res.json();
}

let toastTimer;
function toast(msg, type = 'success') {
  const el = $('saToast');
  el.textContent = msg;
  el.className   = `sa-toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function loading() {
  content.innerHTML = '<div class="sa-loading"><span class="sa-spinner"></span> Loading…</div>';
}

// ── Navigation ────────────────────────────────────────────────────────────────
const sections = {
  overview:      { label: 'Dashboard',       render: renderOverview },
  users:         { label: 'User Management', render: renderUsers },
  applications:  { label: 'Applications',    render: renderApplications },
  certificates:  { label: 'Certificates',    render: renderCertificates },
  notices:       { label: 'Notices',         render: renderNotices },
  objections:    { label: 'Objections',      render: renderObjections },
  uploads:       { label: 'Uploads',         render: renderUploads },
  backups:       { label: 'Backups',         render: renderBackups },
  audit:         { label: 'Audit Logs',      render: renderAuditLogs },
  'sa-activity': { label: 'SA Activity',     render: renderSAActivity },
  'login-attempts': { label: 'Login Attempts', render: renderLoginAttempts },
  security:      { label: 'Security Monitor', render: renderSecurity },
  system:        { label: 'System Monitor',  render: renderSystemInfo },
  env:           { label: 'Env Config',      render: renderEnvConfig },
};

let currentSection = 'overview';

function navigate(section) {
  if (!sections[section]) return;
  currentSection = section;
  document.querySelectorAll('.sa-nav-item').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-section="${section}"]`);
  if (btn) btn.classList.add('active');
  $('sectionLabel').textContent = sections[section].label;
  $('sectionTitle').textContent  = sections[section].label;
  loading();
  sections[section].render();
}

document.getElementById('saNav').addEventListener('click', e => {
  const btn = e.target.closest('[data-section]');
  if (btn) navigate(btn.dataset.section);
});

// ── Session Info ──────────────────────────────────────────────────────────────
$('saUserInfo').textContent = `${SA_NAME()} (${SA_PKID()})`;

function updateTimer() {
  const elapsed = Date.now() - LOGIN_TIME();
  const remain  = Math.max(0, SESSION_MAX - elapsed);
  const m = Math.floor(remain / 60000);
  const s = Math.floor((remain % 60000) / 1000);
  $('sessionTimer').textContent = remain > 0
    ? `Session expires in ${m}m ${String(s).padStart(2,'0')}s`
    : 'Session expired';
  if (remain === 0) { sessionStorage.clear(); window.location.href = '/superadmin'; }
}
setInterval(updateTimer, 1000);
updateTimer();

// ── Logout ────────────────────────────────────────────────────────────────────
$('saLogoutBtn').addEventListener('click', async () => {
  try { await saFetch('/auth/logout', { method: 'POST' }); } catch {}
  sessionStorage.clear();
  window.location.href = '/superadmin';
});

// ── Mobile sidebar ────────────────────────────────────────────────────────────
const toggleBtn = $('mobileSidebarToggle');
if (window.innerWidth <= 900) { toggleBtn.style.display = 'inline-flex'; }
toggleBtn.addEventListener('click', () => $('saSidebar').classList.toggle('open'));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

// ── Overview ──────────────────────────────────────────────────────────────────
async function renderOverview() {
  const data = await saFetch('/stats');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  const s = data.stats;
  content.innerHTML = `
    <div class="sa-section-title">System Overview</div>
    <div class="sa-stats-grid">
      <div class="sa-stat-card"><div class="stat-label">Total Users</div><div class="stat-val blue">${s.users}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Applications</div><div class="stat-val accent">${s.applications}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Pending</div><div class="stat-val amber">${s.pending}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Approved</div><div class="stat-val green">${s.approved}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Certificates</div><div class="stat-val blue">${s.certificates}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Open Objections</div><div class="stat-val red">${s.objections}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Notices</div><div class="stat-val">${s.notices}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Upload Batches</div><div class="stat-val">${s.uploadBatches}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Today SA Logins</div><div class="stat-val blue">${s.todayLoginAttempts}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Today Failures</div><div class="stat-val red">${s.todayFailedAttempts}</div></div>
    </div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>Quick Access</h3></div>
      <div class="sa-card-body" style="display:flex;flex-wrap:wrap;gap:10px;">
        ${Object.entries(sections).filter(([k])=>k!=='overview').map(([k,v])=>
          `<button class="sa-btn-sm primary" onclick="navigate('${k}')">${v.label}</button>`
        ).join('')}
      </div>
    </div>`;
}

// ── Users ─────────────────────────────────────────────────────────────────────
async function renderUsers() {
  const data = await saFetch('/users');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  const rows = data.data;

  content.innerHTML = `
    <div class="sa-section-title">User Management</div>
    <div class="sa-card" style="margin-bottom:16px;">
      <div class="sa-card-header"><h3>Create New User</h3></div>
      <div class="sa-card-body">
        <div class="sa-form-row">
          <div class="sa-form-group"><label>Username</label><input id="nu_username" placeholder="username"></div>
          <div class="sa-form-group"><label>Full Name</label><input id="nu_fullname" placeholder="Full name"></div>
          <div class="sa-form-group"><label>Password</label><input type="password" id="nu_password" placeholder="Password (min 6 chars)"></div>
          <div class="sa-form-group"><label>Role</label>
            <select id="nu_role">
              <option value="upload_staff">Upload Staff</option>
              <option value="objection_staff">Objection Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="sa-form-actions">
          <button class="sa-btn-sm primary" id="createUserBtn">Create User</button>
        </div>
      </div>
    </div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>All Users (${rows.length})</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>#</th><th>Full Name</th><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${rows.map(u => `<tr>
              <td>${u.id}</td>
              <td>${esc(u.full_name || u.username)}</td>
              <td><code style="color:#94a3b8">${esc(u.username)}</code></td>
              <td>${badge(u.role, { admin:'amber', upload:'blue', objection:'muted' })}</td>
              <td>${u.is_active ? '<span class="badge green">Active</span>' : '<span class="badge red">Inactive</span>'}</td>
              <td>${fmt(u.created_at)}</td>
              <td style="white-space:nowrap">
                <button class="sa-btn-sm" onclick="toggleUser(${u.id})">${u.is_active ? 'Deactivate' : 'Activate'}</button>
                <button class="sa-btn-sm" onclick="resetPasswordPrompt(${u.id},'${esc(u.username)}')">Reset PW</button>
                ${u.role !== 'admin' ? `<button class="sa-btn-sm danger" onclick="deleteUser(${u.id},'${esc(u.username)}')">Delete</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="7"><div class="sa-empty">No users found</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  $('createUserBtn').addEventListener('click', async () => {
    const body = {
      username:  $('nu_username').value.trim(),
      full_name: $('nu_fullname').value.trim(),
      password:  $('nu_password').value,
      role:      $('nu_role').value
    };
    if (!body.username || !body.password) return toast('Username and password required.', 'error');
    const res = await saFetch('/users', { method: 'POST', body: JSON.stringify(body) });
    if (res.success) { toast('User created.'); renderUsers(); }
    else toast(res.message || 'Failed', 'error');
  });
}

window.toggleUser = async function (id) {
  const res = await saFetch(`/users/${id}/toggle`, { method: 'PUT' });
  if (res.success) { toast('Status toggled.'); renderUsers(); }
  else toast(res.message || 'Failed', 'error');
};

window.resetPasswordPrompt = async function (id, username) {
  const pw = prompt(`New password for "${username}" (min 6 chars):`);
  if (!pw) return;
  const res = await saFetch(`/users/${id}/reset-password`, { method: 'PUT', body: JSON.stringify({ new_password: pw }) });
  if (res.success) toast('Password reset.');
  else toast(res.message || 'Failed', 'error');
};

window.deleteUser = async function (id, username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  const res = await saFetch(`/users/${id}`, { method: 'DELETE' });
  if (res.success) { toast('User deleted.'); renderUsers(); }
  else toast(res.message || 'Failed', 'error');
};

// ── Applications ──────────────────────────────────────────────────────────────
let appState = { search: '', status: '', page: 1, limit: 50 };

async function renderApplications() {
  const params = new URLSearchParams({ search: appState.search, status: appState.status, page: appState.page, limit: appState.limit });
  const data = await saFetch(`/applications?${params}`);
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  const rows = data.data;
  const pg   = data.pagination;

  content.innerHTML = `
    <div class="sa-section-title">Application Control</div>
    <div class="sa-search-bar">
      <input id="appSearch" placeholder="Search by no, name, district, mobile" value="${esc(appState.search)}">
      <select id="appStatus">
        <option value="">All Status</option>
        ${['pending','verification','objection','approved','rejected','cop','renewal'].map(s =>
          `<option value="${s}" ${appState.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <button class="sa-btn-sm primary" id="appSearchBtn">Search</button>
      <button class="sa-btn-sm" id="appClearBtn">Clear</button>
    </div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>Applications — ${pg.total} total</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>#</th><th>App No</th><th>Name</th><th>Father/Husband</th><th>District</th><th>Mobile</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>
            ${rows.map(a => `<tr>
              <td>${a.id}</td>
              <td style="font-weight:700;color:#f59e0b">${esc(a.application_no)}</td>
              <td>${esc(a.name)}</td>
              <td>${esc(a.father_name)}</td>
              <td>${esc(a.district)}</td>
              <td>${esc(a.mobile)}</td>
              <td>${badge(a.status,{pending:'amber',approved:'green',rejected:'red',verification:'blue',objection:'red',cop:'blue',renewal:'blue'})}</td>
              <td>${fmt(a.created_at)}</td>
              <td style="white-space:nowrap">
                <button class="sa-btn-sm" onclick="editApplication(${a.id},'${esc(a.application_no)}','${esc(a.name)}','${esc(a.father_name)}','${esc(a.district)}','${esc(a.mobile)}','${esc(a.status)}')">Edit</button>
                <button class="sa-btn-sm danger" onclick="deleteApplication(${a.id},'${esc(a.application_no)}')">Delete</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="9"><div class="sa-empty">No records found</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="sa-pager">
      <span>Page ${pg.page} of ${pg.totalPages} — ${pg.total} records</span>
      <div class="sa-pager-btns">
        <button class="sa-btn-sm" id="appPrev" ${pg.page<=1?'disabled':''}>Previous</button>
        <button class="sa-btn-sm" id="appNext" ${pg.page>=pg.totalPages?'disabled':''}>Next</button>
      </div>
    </div>`;

  $('appSearchBtn').addEventListener('click', () => {
    appState.search = $('appSearch').value.trim();
    appState.status = $('appStatus').value;
    appState.page   = 1;
    loading(); renderApplications();
  });
  $('appClearBtn').addEventListener('click', () => {
    appState = { search:'', status:'', page:1, limit:50 };
    loading(); renderApplications();
  });
  $('appPrev') && $('appPrev').addEventListener('click', () => { appState.page--; loading(); renderApplications(); });
  $('appNext') && $('appNext').addEventListener('click', () => { appState.page++; loading(); renderApplications(); });
}

window.editApplication = async function (id, appNo, name, father, district, mobile, status) {
  const newName    = prompt('Full Name:', name);       if (newName === null) return;
  const newFather  = prompt('Father/Husband:', father); if (newFather === null) return;
  const newDistrict= prompt('District:', district);    if (newDistrict === null) return;
  const newMobile  = prompt('Mobile:', mobile);        if (newMobile === null) return;
  const statuses   = ['pending','verification','objection','approved','rejected','cop','renewal'];
  const newStatus  = prompt(`Status (${statuses.join('|')}):`, status); if (newStatus === null) return;
  const res = await saFetch(`/applications/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name:newName, father_name:newFather, district:newDistrict, mobile:newMobile, status:newStatus })
  });
  if (res.success) { toast('Application updated.'); renderApplications(); }
  else toast(res.message || 'Failed', 'error');
};

window.deleteApplication = async function (id, appNo) {
  if (!confirm(`Permanently delete application "${appNo}"?`)) return;
  const res = await saFetch(`/applications/${id}`, { method: 'DELETE' });
  if (res.success) { toast('Deleted.'); renderApplications(); }
  else toast(res.message || 'Failed', 'error');
};

// ── Certificates ──────────────────────────────────────────────────────────────
async function renderCertificates() {
  const data = await saFetch('/certificates');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  content.innerHTML = `
    <div class="sa-section-title">Certificate Management</div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>All Certificates (${data.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>#</th><th>App No</th><th>Candidate</th><th>District</th><th>File</th><th>Status</th><th>Uploaded</th></tr></thead>
          <tbody>
            ${data.data.map(c => `<tr>
              <td>${c.id}</td>
              <td style="color:#f59e0b;font-weight:700">${esc(c.application_no)}</td>
              <td>${esc(c.name)}</td>
              <td>${esc(c.district)}</td>
              <td><a href="/${esc(c.file_path)}" target="_blank" style="color:#3b82f6">View</a></td>
              <td>${badge(c.status,{pending:'amber',approved:'green',rejected:'red'})}</td>
              <td>${fmt(c.uploaded_at)}</td>
            </tr>`).join('') || '<tr><td colspan="7"><div class="sa-empty">No certificates</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Notices ───────────────────────────────────────────────────────────────────
async function renderNotices() {
  const data = await saFetch('/notices');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  content.innerHTML = `
    <div class="sa-section-title">Notice Management</div>
    <div class="sa-card" style="margin-bottom:16px;">
      <div class="sa-card-header"><h3>Create Notice</h3></div>
      <div class="sa-card-body">
        <div class="sa-form-row">
          <div class="sa-form-group"><label>Title</label><input id="nt_title" placeholder="Notice title"></div>
          <div class="sa-form-group"><label>Audience</label>
            <select id="nt_audience"><option value="public">Public</option><option value="staff">Staff</option></select>
          </div>
          <div class="sa-form-group full"><label>Content</label><textarea id="nt_content" placeholder="Notice content…"></textarea></div>
        </div>
        <div class="sa-form-actions"><button class="sa-btn-sm primary" id="createNoticeBtn">Publish Notice</button></div>
      </div>
    </div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>All Notices (${data.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>#</th><th>Title</th><th>Audience</th><th>Active</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${data.data.map(n => `<tr>
              <td>${n.id}</td>
              <td>${esc(n.title)}</td>
              <td>${badge(n.target_audience||'public',{public:'blue',staff:'amber'})}</td>
              <td>${n.is_active ? '<span class="badge green">Yes</span>' : '<span class="badge muted">No</span>'}</td>
              <td>${fmt(n.created_at)}</td>
              <td><button class="sa-btn-sm danger" onclick="deleteNotice(${n.id})">Delete</button></td>
            </tr>`).join('') || '<tr><td colspan="6"><div class="sa-empty">No notices</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  $('createNoticeBtn').addEventListener('click', async () => {
    const body = { title: $('nt_title').value.trim(), content: $('nt_content').value.trim(), target_audience: $('nt_audience').value };
    if (!body.title) return toast('Title is required.', 'error');
    const res = await saFetch('/notices', { method: 'POST', body: JSON.stringify(body) });
    if (res.success) { toast('Notice published.'); renderNotices(); }
    else toast(res.message || 'Failed', 'error');
  });
}

window.deleteNotice = async function (id) {
  if (!confirm('Delete this notice?')) return;
  const res = await saFetch(`/notices/${id}`, { method: 'DELETE' });
  if (res.success) { toast('Notice deleted.'); renderNotices(); }
  else toast(res.message || 'Failed', 'error');
};

// ── Objections ────────────────────────────────────────────────────────────────
async function renderObjections() {
  const data = await saFetch('/objections');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  content.innerHTML = `
    <div class="sa-section-title">Objection Management</div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>All Objections (${data.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>#</th><th>App No</th><th>Candidate</th><th>Reason</th><th>Status</th><th>Raised</th><th>Resolved</th></tr></thead>
          <tbody>
            ${data.data.map(o => `<tr>
              <td>${o.id}</td>
              <td style="color:#f59e0b;font-weight:700">${esc(o.application_no)}</td>
              <td>${esc(o.name)}</td>
              <td>${esc(o.reason)}</td>
              <td>${badge(o.status,{open:'red',resolved:'green',closed:'muted'})}</td>
              <td>${fmt(o.created_at)}</td>
              <td>${fmt(o.resolved_at)}</td>
            </tr>`).join('') || '<tr><td colspan="7"><div class="sa-empty">No objections</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Uploads ───────────────────────────────────────────────────────────────────
async function renderUploads() {
  const data = await saFetch('/uploads');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  content.innerHTML = `
    <div class="sa-section-title">Upload Batches</div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>Excel Import History (${data.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>#</th><th>Filename</th><th>Total</th><th>Inserted</th><th>Errors</th><th>Skipped</th><th>Uploaded</th></tr></thead>
          <tbody>
            ${data.data.map(u => `<tr>
              <td>${u.id}</td>
              <td>${esc(u.filename)}</td>
              <td>${u.total_rows}</td>
              <td><span class="badge green">${u.inserted_rows}</span></td>
              <td><span class="badge ${u.error_rows>0?'red':'muted'}">${u.error_rows}</span></td>
              <td><span class="badge amber">${u.skipped_rows}</span></td>
              <td>${fmt(u.uploaded_at)}</td>
            </tr>`).join('') || '<tr><td colspan="7"><div class="sa-empty">No uploads</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Backups ───────────────────────────────────────────────────────────────────
async function renderBackups() {
  const data = await saFetch('/backups');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  content.innerHTML = `
    <div class="sa-section-title">Backup Logs</div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>Backup History (${data.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>#</th><th>Filename</th><th>Size (KB)</th><th>Type</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            ${data.data.map(b => `<tr>
              <td>${b.id}</td>
              <td>${esc(b.filename)}</td>
              <td>${b.size_kb ?? '—'}</td>
              <td>${badge(b.type||'manual',{manual:'blue',auto:'muted'})}</td>
              <td>${badge(b.status,{success:'green',failed:'red'})}</td>
              <td>${fmt(b.created_at)}</td>
            </tr>`).join('') || '<tr><td colspan="6"><div class="sa-empty">No backups</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Audit Logs ────────────────────────────────────────────────────────────────
async function renderAuditLogs() {
  const data = await saFetch('/audit-logs?limit=200');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  content.innerHTML = `
    <div class="sa-section-title">System Audit Logs</div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>Recent Actions (${data.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Role</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            ${data.data.map(l => `<tr>
              <td>${l.id}</td>
              <td>${fmt(l.created_at)}</td>
              <td>${badge(l.role||'—',{admin:'amber',upload:'blue',objection:'muted',candidate:'green'})}</td>
              <td><code style="color:#94a3b8;font-size:11px">${esc(l.action)}</code></td>
              <td>${esc(l.details)}</td>
              <td><code style="font-size:11px;color:#475569">${esc(l.ip_address)}</code></td>
            </tr>`).join('') || '<tr><td colspan="6"><div class="sa-empty">No logs</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── SA Activity ───────────────────────────────────────────────────────────────
async function renderSAActivity() {
  const data = await saFetch('/sa-logs');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  content.innerHTML = `
    <div class="sa-section-title">Super Admin Activity Log</div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>SA Actions (${data.data.length})</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Passkey ID</th><th>Action</th><th>Details</th><th>IP</th><th>Device</th></tr></thead>
          <tbody>
            ${data.data.map(l => `<tr>
              <td>${l.id}</td>
              <td>${fmt(l.created_at)}</td>
              <td><span class="badge amber">${esc(l.passkey_id)}</span></td>
              <td><code style="color:#f59e0b;font-size:11px">${esc(l.action)}</code></td>
              <td>${esc(l.details)}</td>
              <td><code style="font-size:11px;color:#475569">${esc(l.ip)}</code></td>
              <td style="font-size:11px;color:#475569;max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(l.user_agent)}</td>
            </tr>`).join('') || '<tr><td colspan="7"><div class="sa-empty">No SA activity logged</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Login Attempts ─────────────────────────────────────────────────────────────
async function renderLoginAttempts() {
  const data = await saFetch('/login-attempts');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  const success  = data.data.filter(r => r.success).length;
  const failures = data.data.filter(r => !r.success).length;
  content.innerHTML = `
    <div class="sa-section-title">SA Login Attempts</div>
    <div class="sa-stats-grid" style="margin-bottom:14px">
      <div class="sa-stat-card"><div class="stat-label">Total Attempts</div><div class="stat-val">${data.data.length}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Successful</div><div class="stat-val green">${success}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Failed</div><div class="stat-val red">${failures}</div></div>
    </div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>Login Attempt History (Last 300)</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Passkey ID</th><th>Result</th><th>Reason</th><th>IP</th><th>Device</th></tr></thead>
          <tbody>
            ${data.data.map(r => `<tr>
              <td>${r.id}</td>
              <td>${fmt(r.created_at)}</td>
              <td>${esc(r.passkey_id)}</td>
              <td>${r.success ? '<span class="badge green">Success</span>' : '<span class="badge red">Failed</span>'}</td>
              <td>${esc(r.failure_reason)}</td>
              <td><code style="font-size:11px;color:#475569">${esc(r.ip)}</code></td>
              <td style="font-size:11px;color:#475569;max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(r.user_agent)}</td>
            </tr>`).join('') || '<tr><td colspan="7"><div class="sa-empty">No login attempts</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Security Monitor ──────────────────────────────────────────────────────────
async function renderSecurity() {
  const data = await saFetch('/security-monitor');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  const locked = data.currentlyLocked;

  content.innerHTML = `
    <div class="sa-section-title">Security Monitor</div>
    ${locked.length ? `<div class="sa-card" style="border-color:rgba(239,68,68,.4);margin-bottom:14px">
      <div class="sa-card-header" style="border-color:rgba(239,68,68,.3)"><h3 style="color:#ef4444">⚠ Currently Locked IPs (${locked.length})</h3></div>
      <div class="sa-card-body" style="display:flex;flex-wrap:wrap;gap:8px">
        ${locked.map(ip => `<span class="badge red">${esc(ip)}</span>`).join('')}
      </div>
    </div>` : ''}
    <div class="sa-card" style="margin-bottom:14px">
      <div class="sa-card-header"><h3>Recent Failures by IP (Last 24h)</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>IP Address</th><th>Attempts</th><th>Last Attempt</th></tr></thead>
          <tbody>
            ${data.recentFailures.map(r => `<tr>
              <td><code>${esc(r.ip)}</code></td>
              <td><span class="badge ${r.attempts>=5?'red':'amber'}">${r.attempts}</span></td>
              <td>${fmt(r.last_attempt)}</td>
            </tr>`).join('') || '<tr><td colspan="3"><div class="sa-empty">No failures in last 24h</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>Recent Successful Logins</h3></div>
      <div class="sa-table-wrap">
        <table>
          <thead><tr><th>Passkey ID</th><th>IP</th><th>Device</th><th>Time</th></tr></thead>
          <tbody>
            ${data.recentSuccessfulLogins.map(r => `<tr>
              <td><span class="badge amber">${esc(r.passkey_id)}</span></td>
              <td><code style="font-size:11px">${esc(r.ip)}</code></td>
              <td style="font-size:11px;color:#94a3b8;max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(r.user_agent)}</td>
              <td>${fmt(r.created_at)}</td>
            </tr>`).join('') || '<tr><td colspan="4"><div class="sa-empty">No successful logins yet</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── System Monitor ────────────────────────────────────────────────────────────
async function renderSystemInfo() {
  const data = await saFetch('/system-info');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  const s = data.system;
  const memPct = ((s.memoryHeapUsed / s.memoryHeapTotal) * 100).toFixed(1);
  const osPct  = (((parseFloat(s.totalMemGB)-parseFloat(s.freeMemGB)) / parseFloat(s.totalMemGB)) * 100).toFixed(1);

  content.innerHTML = `
    <div class="sa-section-title">System Monitor</div>
    <div class="sa-stats-grid">
      <div class="sa-stat-card"><div class="stat-label">Uptime</div><div class="stat-val blue" style="font-size:16px">${esc(s.uptimeHuman)}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Node.js</div><div class="stat-val" style="font-size:18px">${esc(s.nodeVersion)}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Heap Used / Total</div><div class="stat-val" style="font-size:16px">${s.memoryHeapUsed} MB / ${s.memoryHeapTotal} MB</div></div>
      <div class="sa-stat-card"><div class="stat-label">Heap Usage</div><div class="stat-val ${parseFloat(memPct)>80?'red':'green'}">${memPct}%</div></div>
      <div class="sa-stat-card"><div class="stat-label">OS Memory</div><div class="stat-val ${parseFloat(osPct)>85?'red':'green'}">${osPct}%</div></div>
      <div class="sa-stat-card"><div class="stat-label">CPU Cores</div><div class="stat-val">${s.cpuCores}</div></div>
      <div class="sa-stat-card"><div class="stat-label">Platform</div><div class="stat-val" style="font-size:15px">${esc(s.platform)} ${esc(s.arch)}</div></div>
      <div class="sa-stat-card"><div class="stat-label">PID / Port</div><div class="stat-val" style="font-size:15px">${s.pid} / :${s.port}</div></div>
    </div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>Server Details</h3></div>
      <div class="sa-card-body">
        <div class="sa-info-grid">
          ${[
            ['Hostname', s.hostname], ['OS Platform', s.osPlatform], ['OS Release', s.osRelease],
            ['Total RAM', s.totalMemGB + ' GB'], ['Free RAM', s.freeMemGB + ' GB'],
            ['RSS Memory', s.memoryRSS + ' MB'], ['Environment', s.nodeEnv], ['Process ID', s.pid]
          ].map(([k,v]) => `<div class="sa-info-item"><div class="info-key">${esc(k)}</div><div class="info-val">${esc(v)}</div></div>`).join('')}
        </div>
      </div>
    </div>`;
}

// ── Env Config ────────────────────────────────────────────────────────────────
async function renderEnvConfig() {
  const data = await saFetch('/env-config');
  if (!data.success) { content.innerHTML = `<div class="sa-empty">${esc(data.message)}</div>`; return; }
  content.innerHTML = `
    <div class="sa-section-title">Environment Configuration</div>
    <div class="sa-card" style="margin-bottom:14px">
      <div class="sa-card-header"><h3>Active Configuration Values</h3></div>
      <div class="sa-card-body">
        <div class="sa-info-grid">
          ${Object.entries(data.config).map(([k,v]) =>
            `<div class="sa-info-item"><div class="info-key">${esc(k)}</div><div class="info-val">${esc(v)}</div></div>`
          ).join('')}
        </div>
      </div>
    </div>
    <div class="sa-card">
      <div class="sa-card-header"><h3>Sensitive Key Presence Check</h3></div>
      <div class="sa-card-body">
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          ${Object.entries(data.secretsExist).map(([k,v]) =>
            `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid ${v?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)'};border-radius:7px;background:${v?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)'}">
               <span class="${v?'badge green':'badge red'}">${v?'✓':'✗'}</span>
               <span style="font-size:12px;font-weight:700;color:#94a3b8">${esc(k)}</span>
             </div>`
          ).join('')}
        </div>
      </div>
    </div>`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
navigate('overview');
