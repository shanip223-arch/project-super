const token = localStorage.getItem('token');
const role = localStorage.getItem('role') || 'upload_staff';
if (!token) window.location.href = '/';

document.getElementById('userName').textContent = localStorage.getItem('name') || 'Staff';
document.getElementById('roleBadge').textContent = role.toUpperCase().replace('_', ' ');
const staffWorkflowModal = new WorkflowModalEngine();
let staffObjectionCache = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function parseJsonArray(raw) { try { return JSON.parse(raw || '[]'); } catch(e) { return []; } }

function logout() { localStorage.clear(); window.location.href = '/'; }
function showLoader(s) { document.getElementById('loader').style.display = s ? 'flex' : 'none'; }
function toast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  setTimeout(() => t.className = 'toast', 3000);
}
async function api(url, opts = {}) {
  showLoader(true);
  opts.headers = opts.headers || {};
  opts.headers['Authorization'] = 'Bearer ' + token;
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  try {
    const r = await fetch(url, opts);
    const j = await r.json();
    if (!j.success) toast(j.message || 'Error', 'error');
    return j;
  } catch(e) {
    toast('Network error. Is the server running?', 'error');
    return { success: false, data: [] };
  }
  finally { showLoader(false); }
}

// ── NAV BUILD ──────────────────────────────────────────────
const nav = document.getElementById('staffNav');
if (role === 'upload_staff') {
  nav.innerHTML = `
    <a class="nav-item active" onclick="setPage('dashboard',this)">📊 Dashboard</a>
    <a class="nav-item" onclick="setPage('applications',this)">📋 Applications</a>
    <a class="nav-item" onclick="setPage('duplicates',this)">📑 Duplicate Requests</a>
    <a class="nav-item" onclick="setPage('single',this)">📤 Single Upload</a>
    <a class="nav-item" onclick="setPage('bulk',this)">📦 Bulk Upload</a>
    <a class="nav-item" onclick="setPage('uploads',this)">📑 Excel Upload History</a>
    <a class="nav-item" onclick="setPage('notices',this)">📢 Notices</a>
    <a class="nav-item" onclick="setPage('logs',this)">📝 System Logs</a>`;
} else if (role === 'objection_staff') {
  nav.innerHTML = `
    <a class="nav-item active" onclick="setPage('dashboard',this)">📊 Dashboard</a>
    <a class="nav-item" onclick="setPage('applications',this)">📋 Search Applications</a>
    <a class="nav-item" onclick="setPage('objections',this)">⚠️ Manage Objections</a>
    <a class="nav-item" onclick="setPage('notices',this)">📢 Notices</a>
    <a class="nav-item" onclick="setPage('logs',this)">📝 System Logs</a>`;
} else {
  nav.innerHTML = `
    <a class="nav-item active" onclick="setPage('dashboard',this)">📊 Dashboard</a>
    <a class="nav-item" onclick="setPage('applications',this)">📋 Applications</a>
    <a class="nav-item" onclick="setPage('objections',this)">⚠️ Objections</a>
    <a class="nav-item" onclick="setPage('uploads',this)">📑 Uploads</a>`;
}

// ── INJECT MODAL INTO BODY (once at startup, always available in DOM) ──────
(function injectObjModal() {
  const div = document.createElement('div');
  div.id = 'objModalOverlay';
  div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);z-index:1000;align-items:center;justify-content:center;';
  div.innerHTML = `
    <div style="background:#fff;border-radius:20px;width:720px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 25px 60px rgba(0,0,0,0.35);" onclick="event.stopPropagation()">
      <div style="padding:24px 28px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
        <h3 style="font-size:18px;font-weight:700;color:#064e3b;">&#9888;&#65039; Raise Objection &mdash; <span id="modalAppNo" style="color:#10b981;"></span></h3>
        <button onclick="closeObjModal()" style="width:36px;height:36px;border-radius:50%;border:none;background:#f1f5f9;cursor:pointer;font-size:18px;color:#64748b;">&#10005;</button>
      </div>
      <div style="padding:24px 28px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
          <div>
            <div class="doc-section-title">&#127891; Qualification Documents</div>
            <label class="doc-check-label"><input type="checkbox" value="LL.B. Degree / Provisional Certificate" class="doc-check"> LL.B. Degree / Provisional Certificate</label>
            <label class="doc-check-label"><input type="checkbox" value="LL.B. Marksheets" class="doc-check"> LL.B. Marksheets</label>
            <label class="doc-check-label"><input type="checkbox" value="Graduation Degree / Marksheet" class="doc-check"> Graduation Degree / Marksheet</label>
            <label class="doc-check-label"><input type="checkbox" value="High School Certificate (10th)" class="doc-check"> High School Certificate (10th)</label>
          </div>
          <div>
            <div class="doc-section-title">&#129370; Identity &amp; Other Documents</div>
            <label class="doc-check-label"><input type="checkbox" value="Aadhar Card" class="doc-check"> Aadhar Card</label>
            <label class="doc-check-label"><input type="checkbox" value="Passport Size Photograph" class="doc-check"> Passport Size Photograph</label>
            <label class="doc-check-label"><input type="checkbox" value="Signature" class="doc-check"> Signature</label>
            <label class="doc-check-label"><input type="checkbox" value="Character Certificate" class="doc-check"> Character Certificate</label>
            <label class="doc-check-label"><input type="checkbox" value="Affidavit / Declaration" class="doc-check"> Affidavit / Declaration</label>
            <label class="doc-check-label other-label" style="margin-top:8px;">
              <input type="checkbox" id="otherCheck" onchange="document.getElementById('otherBox').style.display=this.checked?'block':'none'">
              &#9999;&#65039; Other (Specify Remark)
            </label>
            <div id="otherBox" style="display:none;margin-top:6px;">
              <textarea id="otherRemark" placeholder="Custom remark likhein..." rows="2" style="width:100%;padding:10px;border:1px solid #fed7aa;border-radius:8px;font-size:13px;"></textarea>
            </div>
          </div>
        </div>
      </div>
      <div style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn" onclick="closeObjModal()" style="background:#f1f5f9;color:#374151;">Cancel</button>
        <button class="btn btn-danger" onclick="submitObjModal()">Submit Objection</button>
      </div>
    </div>`;
  div.addEventListener('click', function(e) { if (e.target === div) closeObjModal(); });
  document.body.appendChild(div);
})();

function setPage(p, el) {
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('pageTitle').textContent = el.textContent.trim();
  if (p === 'dashboard')    return renderDash();
  if (p === 'applications') return renderApps();
  if (p === 'duplicates')   return renderDuplicates();
  if (p === 'single')       return renderSingle();
  if (p === 'bulk')         return renderBulk();
  if (p === 'uploads')      return renderUploads();
  if (p === 'objections')   return renderObjections();
  if (p === 'notices')      return renderNotices();
  if (p === 'logs')         return renderLogs();
}

// ── DASHBOARD ──────────────────────────────────────────────
async function renderDash() {
  const j = await api('/api/staff/dashboard');
  const s = j.stats || {};
  document.getElementById('content').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><h3>Pending Uploads</h3><div class="num">${s.pending||0}</div></div>
      <div class="stat-card"><h3>Uploaded By Me</h3><div class="num">${s.uploaded||0}</div></div>
      <div class="stat-card"><h3>Open Objections</h3><div class="num">${s.open||0}</div></div>
    </div>
    <div class="card"><h3>Welcome</h3><p>You have full staff permissions. You can manage everything except deleting records.</p></div>`;
}

// ── APPLICATIONS ──────────────────────────────────────────
async function renderApps() {
  document.getElementById('content').innerHTML = `
    <div class="card">
      <h3>Manage Applications</h3>
      <div style="display:flex; gap:10px; margin-top:15px;">
        <input id="search" placeholder="Search by App No (e.g. 12345/25) or Name...">
        <button class="btn btn-primary" onclick="loadApps()">🔍 Find</button>
      </div>
      <div id="appsTable" style="margin-top:15px"></div>
    </div>`;
  loadApps();
}

async function loadApps() {
  const q = document.getElementById('search') ? document.getElementById('search').value : '';
  const j = await api('/api/staff/applications?search=' + encodeURIComponent(q));
  const html = `<table>
    <thead><tr><th>App No</th><th>Name</th><th>Father</th><th>District</th><th>Status</th><th>Upload Access</th><th>Actions</th></tr></thead>
    <tbody>${(j.data||[]).map(a => `
      <tr>
        <td>${a.application_no}</td><td>${a.name}</td><td>${a.father_name||''}</td>
        <td>${a.district||''}</td><td><span class="tag ${a.status}">${a.status}</span></td>
        <td>${a.upload_enabled ? '✅ Enabled' : '❌ Disabled'}</td>
        <td>
          ${role === 'upload_staff' ? `
            <button class="btn btn-primary btn-sm" onclick="editApp(${a.id})">Edit</button>
            <button class="btn btn-warn btn-sm" onclick="overrideApp('${a.application_no}',${a.upload_enabled},${a.final_chance})">Override</button>
            <button class="btn btn-success btn-sm" onclick="quickUpload('${a.application_no}')">Upload</button>
          ` : `
            <button class="btn btn-danger btn-sm" onclick="openObjModal('${a.application_no}')">⚠️ Raise Objection</button>
          `}
        </td>
      </tr>`).join('')}</tbody></table>`;
  document.getElementById('appsTable').innerHTML = html || 'No data';
}

async function editApp(id) {
  const j = await api('/api/staff/applications/' + id);
  const a = j.data;
  if (!a) return toast('Failed to fetch data', 'error');
  const name = prompt('Update Name:', a.name); if (name === null) return;
  const status = prompt('Status (pending/uploaded/approved/rejected):', a.status);
  const r = await api('/api/staff/edit/' + id, { method: 'PUT', body: { name, status } });
  if (r.success) { toast('Updated'); loadApps(); }
}

async function overrideApp(no, en, fc) {
  const upload_enabled = confirm(`Enable upload access for ${no}? (current: ${en?'Yes':'No'})`);
  const final_chance = confirm(`Grant final chance to candidate? (current: ${fc?'Yes':'No'})`);
  const r = await api('/api/staff/override', { method: 'POST', body: { application_no: no, upload_enabled, final_chance } });
  if (r.success) { toast('Overrides applied successfully'); loadApps(); }
}

function quickUpload(appNo) {
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
  renderSingle(appNo);
}

// ── CERTIFICATE UPLOADS ───────────────────────────────────
function renderSingle(prefill='') {
  document.getElementById('content').innerHTML = `<div class="card"><h3>Single Certificate Upload</h3>
    <label>Application Number</label>
    <input id="appNo" value="${prefill}" placeholder="UP12345/25">
    <label>Certificate File (PDF/Image)</label>
    <input type="file" id="certFile" accept=".pdf,.jpg,.png">
    <button class="btn btn-primary" onclick="doSingle()">Upload Certificate</button>
  </div>`;
}

async function doSingle() {
  const appNo = document.getElementById('appNo').value;
  const file = document.getElementById('certFile').files[0];
  if (!appNo || !file) return toast('Fill all fields','error');
  const fd = new FormData(); fd.append('application_no', appNo); fd.append('file', file);
  showLoader(true);
  try {
    const r = await fetch('/api/certificate/upload', { method:'POST', headers:{Authorization:'Bearer '+token}, body: fd });
    const j = await r.json();
    if (j.success) toast('✅ Certificate Uploaded Successfully'); else toast(j.message, 'error');
  } catch(err) { toast('Network error', 'error'); } finally { showLoader(false); }
}

function renderBulk() {
  document.getElementById('content').innerHTML = `<div class="card"><h3>Bulk Certificate Upload</h3>
    <p style="color:#666">Filenames must be in format: <b>UP12345_25.pdf</b></p>
    <input type="file" id="bulkFiles" multiple accept=".pdf,.jpg,.png">
    <button class="btn btn-primary" onclick="doBulk()">Upload All Certificates</button>
    <div id="bulkResult" style="margin-top:15px"></div>
  </div>`;
}

async function doBulk() {
  const files = document.getElementById('bulkFiles').files;
  if (!files.length) return toast('Choose files','error');
  const fd = new FormData(); for (const f of files) fd.append('files', f);
  showLoader(true);
  try {
    const r = await fetch('/api/certificate/bulk-upload', { method:'POST', headers:{Authorization:'Bearer '+token}, body: fd });
    const j = await r.json();
    if (j.success) {
      document.getElementById('bulkResult').innerHTML = `<div class="card">
        <p>✅ Uploaded: <b>${j.uploaded}</b></p><p>❌ Failed: <b>${j.failed}</b></p>
      </div>`;
    }
  } catch(err) { toast('Network Error', 'error'); } finally { showLoader(false); }
}

// ── EXCEL UPLOAD HISTORY ──────────────────────────────────
async function renderUploads() {
  const j = await api('/api/admin/uploads');
  document.getElementById('content').innerHTML = `
    <div class="card"><h3>Upload History</h3>
    <table><thead><tr><th>File</th><th>Total</th><th>Inserted</th><th>Errors</th><th>Skipped</th><th>Date</th></tr></thead>
    <tbody>${(j.data||[]).map(u=>`<tr><td>${u.filename}</td><td>${u.total_rows}</td><td>${u.inserted_rows}</td><td>${u.error_rows}</td><td>${u.skipped_rows}</td><td>${new Date(u.uploaded_at).toLocaleString()}</td></tr>`).join('')}</tbody></table>
    </div>`;
}

// ── DUPLICATE REQUESTS ────────────────────────────────────
async function renderDuplicates() {
  const j = await api('/api/staff/duplicates');
  document.getElementById('content').innerHTML = `<div class="card"><h3>Duplicate Certificate Requests</h3>
    <p style="color:var(--text-muted); margin-bottom:20px;">Review requests from candidates who lost their certificates.</p>
    <table><thead><tr><th>App No</th><th>Name</th><th>Reason for Duplicate</th><th>Date</th><th>Action</th></tr></thead>
    <tbody>${(j.data||[]).map(d=>`<tr>
      <td>${d.application_no}</td><td>${d.name||''}</td><td>${d.reason||''}</td>
      <td>${new Date(d.created_at).toLocaleDateString()}</td>
      <td>
        <button class="btn btn-success btn-sm" onclick="resolveDuplicate(${d.id},'approved')">Approve</button>
        <button class="btn btn-danger btn-sm" onclick="resolveDuplicate(${d.id},'rejected')">Reject</button>
      </td></tr>`).join('')}</tbody></table></div>`;
}

async function resolveDuplicate(id, decision) {
  const remarks = prompt(`Provide remarks for ${decision === 'approved' ? 'approving' : 'rejecting'}:`);
  if (remarks === null) return;
  const r = await api('/api/staff/duplicates/resolve', { method:'POST', body:{ id, decision, remarks } });
  if (r.success) { toast('Duplicate Request ' + decision); renderDuplicates(); }
}

// ── OBJECTIONS ────────────────────────────────────────────
async function renderObjections() {
  const j = await api('/api/objection?status=all');
  const allData = j.data || [];
  staffObjectionCache = allData;
  const pendingReview = allData.filter(o => o.status === 'under_review');

  document.getElementById('content').innerHTML = `
    ${pendingReview.length ? `
    <div style="background:#eff6ff; border:2px solid #3b82f6; border-radius:16px; padding:20px 24px; margin-bottom:24px; display:flex; gap:16px; align-items:flex-start;">
      <span style="font-size:32px;">&#128196;</span>
      <div style="flex:1;">
        <h4 style="color:#1d4ed8; margin-bottom:6px;">&#128276; ${pendingReview.length} Candidate(s) Awaiting Review</h4>
        <p style="color:#1e40af; font-size:14px; margin-bottom:14px;">Inhone documents submit kar diye hain. Aap niche list mein dekh sakte hain aur Approve/Reject kar sakte hain.</p>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          ${pendingReview.map(o => `
            <div style="background:white; border:1px solid #bfdbfe; border-radius:10px; padding:8px 14px; font-size:13px;">
              <b style="color:#1d4ed8;">${o.application_no}</b>
              <span style="color:#64748b; margin-left:6px;">${o.name || ''}</span>
              <button class="btn btn-sm" onclick="filterObj('under_review')" style="background:#dbeafe;color:#1e40af;margin-left:8px;padding:3px 8px;font-size:11px;">Review &#8594;</button>
            </div>`).join('')}
        </div>
      </div>
    </div>` : ''}

    <div class="card">
      <h3>Raise New Objection</h3>
      <div style="display:flex; gap:10px; margin-bottom:5px;">
        <input id="objAppNo" placeholder="Application No (e.g. UP12345/25 or 12345/25)" style="flex:1;">
        <button class="btn btn-danger" onclick="openObjModalFromInput()">&#9888;&#65039; Raise Objection</button>
      </div>
      <p style="font-size:12px; color:var(--text-muted);">Application number likhein aur Raise Objection button dabayein — popup form aayega.</p>
    </div>
    <div class="card">
      <h3>All Objections
        <span style="float:right; display:flex; gap:8px;">
          <button class="btn btn-sm" onclick="filterObj('open')" style="background:#fef3c7;color:#92400e;">Open</button>
          <button class="btn btn-sm" onclick="filterObj('under_review')" style="background:#dbeafe;color:#1e40af;">Under Review ${pendingReview.length ? `<b style='background:#1d4ed8;color:white;border-radius:10px;padding:1px 7px;font-size:10px;margin-left:4px;'>${pendingReview.length}</b>` : ''}</button>
          <button class="btn btn-sm" onclick="filterObj('approved')" style="background:#d1fae5;color:#065f46;">Approved</button>
          <button class="btn btn-sm" onclick="filterObj('rejected')" style="background:#fee2e2;color:#991b1b;">Rejected</button>
          <button class="btn btn-sm" onclick="filterObj('all')" style="background:#f1f5f9;color:#334155;">All</button>
        </span>
      </h3>
      <div id="objList">${renderObjTable(allData)}</div>
    </div>`;
}

function renderObjTable(data) {
  if (!data || !data.length) return '<p style="color:var(--text-muted)">No objections found.</p>';
  return `<table><thead><tr><th>App No</th><th>Name</th><th>Required Docs</th><th>Status</th><th>Files</th><th>Date</th><th>Action</th></tr></thead><tbody>
    ${data.map(o => {
      const docs = parseJsonArray(o.required_docs);
      let docsHtml = escapeHtml(o.reason || '-');
      if (docs.length) docsHtml = docs.map(d => `<span style="display:inline-block;background:#f0fdf4;padding:2px 7px;border-radius:4px;font-size:11px;margin:2px;color:#065f46;border:1px solid #bbf7d0">${escapeHtml(d)}</span>`).join('');

      const hasFiles = parseJsonArray(o.cleared_files).length > 0;

      return `<tr style="${o.status === 'under_review' ? 'background:#eff6ff;' : ''}">
        <td><b>${escapeHtml(o.application_no)}</b></td>
        <td>${escapeHtml(o.name||'-')}</td>
        <td style="max-width:220px;">${docsHtml}</td>
        <td><span class="tag ${o.status}">${o.status.replace('_',' ').toUpperCase()}</span></td>
        <td>${hasFiles
          ? `<button class="btn btn-sm" onclick="viewObjFiles(${o.id},'${escapeHtml(o.application_no)}')" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;">&#128196; View Files</button>`
          : '<span style="color:#9ca3af;font-size:12px;">No files</span>'}
        </td>
        <td>${new Date(o.created_at).toLocaleDateString('en-IN')}</td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="openStaffObjectionModal(${o.id})">Enterprise Review</button>
          ${o.status === 'open' || o.status === 'under_review' ? `
            <button class="btn btn-success btn-sm" onclick="resolveObj(${o.id},'approved')">Approve</button>
            <button class="btn btn-danger btn-sm" onclick="resolveObj(${o.id},'rejected')">Reject</button>` : '-'}
        </td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}


function buildStaffObjectionBody(o) {
  const docs = parseJsonArray(o.required_docs);
  const files = parseJsonArray(o.cleared_files);
  const date = o.created_at ? new Date(o.created_at).toLocaleString('en-IN') : '-';
  const resolved = o.resolved_at ? new Date(o.resolved_at).toLocaleString('en-IN') : '-';
  const fileCards = files.length ? files.map((f, i) => {
    const ext = f.split('.').pop().toLowerCase();
    const url = '/uploads/objection_docs/' + encodeURIComponent(f);
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
    return `<div class="workflow-section">
      <h4>Candidate Response Document ${i + 1}</h4>
      <p class="workflow-note"><a href="${url}" target="_blank">Open ${escapeHtml(f)} in new tab</a></p>
      ${isImage ? `<img src="${url}" style="width:100%;max-height:320px;object-fit:contain;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">` : `<iframe src="${url}" style="width:100%;height:320px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;"></iframe>`}
    </div>`;
  }).join('') : '<div class="workflow-section"><h4>Candidate Response</h4><p class="workflow-note">No files submitted yet.</p></div>';

  return `
    <div class="workflow-grid">
      <div class="workflow-field"><label>Application Number</label><strong>${escapeHtml(o.application_no)}</strong></div>
      <div class="workflow-field"><label>Candidate</label><strong>${escapeHtml(o.name || '-')}</strong></div>
      <div class="workflow-field"><label>Current Status</label><strong>${escapeHtml(o.status.replace(/_/g, ' ').toUpperCase())}</strong></div>
      <div class="workflow-field"><label>Objection Date</label><strong>${escapeHtml(date)}</strong></div>
      <div class="workflow-field"><label>District / Mobile</label><strong>${escapeHtml(o.district || '-')} · ${escapeHtml(o.mobile || '-')}</strong></div>
      <div class="workflow-field"><label>Resolved At</label><strong>${escapeHtml(resolved)}</strong></div>
    </div>
    <div class="workflow-section">
      <h4>Objection History & Required Documents</h4>
      <div class="workflow-history">
        <div class="workflow-history-item"><b>Raised:</b> ${escapeHtml(o.reason || 'Documents required')}</div>
        ${o.remarks ? `<div class="workflow-history-item"><b>Staff remarks:</b> ${escapeHtml(o.remarks)}</div>` : ''}
        ${files.length ? `<div class="workflow-history-item"><b>Candidate response:</b> ${files.length} document(s) uploaded for review.</div>` : ''}
      </div>
      ${docs.length ? `<div class="workflow-doc-tags" style="margin-top:14px;">${docs.map(d => `<span class="workflow-doc-tag">${escapeHtml(d)}</span>`).join('')}</div>` : ''}
    </div>
    ${fileCards}
    ${o.status === 'open' || o.status === 'under_review' ? `<div class="workflow-section"><h4>Decision Desk</h4><p class="workflow-note">Approve the response only after validating the previewed documents. Reject keeps the candidate in objection re-upload workflow.</p><div class="workflow-actions"><button class="btn btn-success" onclick="resolveObjFromModal(${o.id},'approved')">Approve Response</button><button class="btn btn-danger" onclick="resolveObjFromModal(${o.id},'rejected')">Reject / Re-upload Required</button></div></div>` : ''}
  `;
}

function openStaffObjectionModal(id) {
  const o = staffObjectionCache.find(item => Number(item.id) === Number(id));
  if (!o) return toast('Objection record not found', 'error');
  staffWorkflowModal.open({
    theme: o.status === 'approved' ? 'success' : (o.status === 'under_review' ? 'review' : 'warning'),
    critical: false,
    title: 'Enterprise Objection Review',
    subtitle: 'Review objection history, previous uploads, candidate response documents and record a staff decision.',
    body: buildStaffObjectionBody(o),
    footer: '<button class="btn" onclick="staffWorkflowModal.close()" style="background:#f1f5f9;color:#334155;">Close Review</button>'
  });
}

async function resolveObjFromModal(id, decision) {
  await resolveObj(id, decision);
  staffWorkflowModal.close();
}

async function filterObj(status) {
  const j = await api('/api/objection?status=' + status);
  staffObjectionCache = j.data || [];
  document.getElementById('objList').innerHTML = renderObjTable(staffObjectionCache);
}

async function resolveObj(id, decision) {
  const remarks = prompt('Remarks:'); if (remarks === null) return;
  const r = await api('/api/objection/resolve', { method:'POST', body:{id, decision, remarks} });
  if (r.success) { toast('Done ✅'); renderObjections(); }
}

// ── FILES VIEWER MODAL ─────────────────────────────────────
(function injectFilesModal() {
  const div = document.createElement('div');
  div.id = 'filesModalOverlay';
  div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:1100;align-items:center;justify-content:center;';
  div.innerHTML = `
    <div style="background:#fff;border-radius:20px;width:680px;max-width:95vw;max-height:88vh;overflow-y:auto;box-shadow:0 25px 60px rgba(0,0,0,0.4);" onclick="event.stopPropagation()">
      <div style="padding:22px 26px 14px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
        <h3 style="font-size:17px;font-weight:700;color:#1e3a5f;">&#128196; Submitted Documents &mdash; <span id="filesModalAppNo" style="color:#3b82f6;"></span></h3>
        <button onclick="closeFilesModal()" style="width:34px;height:34px;border-radius:50%;border:none;background:#f1f5f9;cursor:pointer;font-size:17px;color:#64748b;">&#10005;</button>
      </div>
      <div id="filesModalBody" style="padding:22px 26px;"></div>
      <div style="padding:14px 26px 22px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn" onclick="closeFilesModal()" style="background:#f1f5f9;color:#374151;">Close</button>
        <button class="btn btn-primary" id="downloadZipBtn">&#11015;&#65039; Download All as ZIP</button>
      </div>
    </div>`;
  div.addEventListener('click', function(e) { if (e.target === div) closeFilesModal(); });
  document.body.appendChild(div);
})();

async function viewObjFiles(objId, appNo) {
  const j = await api('/api/objection/' + objId + '/files');
  if (!j.success) return;

  document.getElementById('filesModalAppNo').textContent = appNo;
  const files = j.files || [];
  const body = document.getElementById('filesModalBody');

  if (!files.length) {
    body.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:30px 0;">Koi file nahi mili.</p>';
  } else {
    body.innerHTML = files.map((f, i) => {
      const ext = f.split('.').pop().toLowerCase();
      const url = '/uploads/objection_docs/' + f;
      const isImage = ['jpg','jpeg','png','gif'].includes(ext);
      return `
        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="font-weight:600;color:#1e3a5f;font-size:14px;">&#128196; Document ${i+1} (.${ext})</span>
            <a href="${url}" target="_blank" style="font-size:12px;color:#3b82f6;text-decoration:none;">&#128279; Open in New Tab</a>
          </div>
          ${isImage
            ? `<img src="${url}" style="width:100%;max-height:300px;object-fit:contain;border-radius:8px;background:#f8fafc;">`
            : `<iframe src="${url}" style="width:100%;height:300px;border:none;border-radius:8px;background:#f8fafc;"></iframe>`
          }
        </div>`;
    }).join('');
  }

  // Setup ZIP download button
  const zipBtn = document.getElementById('downloadZipBtn');
  zipBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = '/api/objection/' + objId + '/download-zip?token=' + token;
    a.download = appNo.replace(/\//g,'_') + '_documents.zip';
    a.click();
  };

  const overlay = document.getElementById('filesModalOverlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeFilesModal() {
  document.getElementById('filesModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

// Modal open/close/submit
function openObjModalFromInput() {
  const raw = (document.getElementById('objAppNo') || {}).value || '';
  if (!raw.trim()) return toast('Application Number daalna zaroori hai', 'error');
  openObjModal(raw.trim());
}

function openObjModal(appNo) {
  // Reset all checkboxes
  document.querySelectorAll('.doc-check').forEach(c => c.checked = false);
  const otherBox = document.getElementById('otherBox');
  const otherRemark = document.getElementById('otherRemark');
  const otherCheck = document.getElementById('otherCheck');
  if (otherBox) otherBox.style.display = 'none';
  if (otherRemark) otherRemark.value = '';
  if (otherCheck) otherCheck.checked = false;

  document.getElementById('modalAppNo').textContent = appNo;
  const overlay = document.getElementById('objModalOverlay');
  overlay.setAttribute('data-appno', appNo);
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeObjModal(e) {
  if (e && e.target.id !== 'objModalOverlay') return;
  const overlay = document.getElementById('objModalOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function submitObjModal() {
  const appNo = document.getElementById('objModalOverlay').getAttribute('data-appno');
  const checks = [...document.querySelectorAll('.doc-check:checked')].map(c => c.value);
  const otherCheck = document.getElementById('otherCheck');
  const otherRemark = document.getElementById('otherRemark');
  if (otherCheck && otherCheck.checked && otherRemark && otherRemark.value.trim()) {
    checks.push('Other: ' + otherRemark.value.trim());
  }
  if (!checks.length) return toast('Kam se kam ek document select karna zaroori hai', 'error');

  const r = await api('/api/objection/staff-add', { method: 'POST', body: { application_no: appNo, required_docs: checks } });
  if (r.success) {
    toast('Objection raise ho gayi! ✅');
    const overlay = document.getElementById('objModalOverlay');
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = '';
    renderObjections();
  }
}

// ── NOTICES (VIEW ONLY) ───────────────────────────────────
async function renderNotices() {
  const j = await api('/api/admin/notices');
  document.getElementById('content').innerHTML = `
    <div class="card"><h3>Staff Notices</h3>
      <p style="color:var(--text-muted); margin-bottom: 20px;">These notices are published by the Administrator for staff instructions.</p>
      ${j.data && j.data.length ? j.data.map(n=>`<div class="notice-item" style="padding:15px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:10px;">
        <h4 style="color:var(--text-dark);margin-bottom:5px;">${n.title}</h4>
        <p style="color:var(--text-muted);margin-bottom:10px;">${n.content||''}</p>
        ${n.file_path ? `<a href="/uploads/temp/${n.file_path}" target="_blank" style="display:inline-block;padding:5px 10px;background:var(--bg-color);color:var(--accent-color);border-radius:5px;text-decoration:none;font-size:12px;font-weight:600;">📎 View Attachment</a>` : ''}
      </div>`).join('') : '<p>No notices available.</p>'}
    </div>`;
}

// ── LOGS ──────────────────────────────────────────────────
async function renderLogs() {
  const j = await api('/api/admin/logs');
  document.getElementById('content').innerHTML = `
    <div class="card"><h3>Activity Logs</h3>
      <table><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
      <tbody>${(j.data||[]).map(l => `<tr><td>${new Date(l.created_at).toLocaleString()}</td><td>${l.user_id||'-'}</td><td>${l.role||'-'}</td><td>${l.action}</td><td>${l.details||''}</td><td>${l.ip_address||''}</td></tr>`).join('')}</tbody></table>
    </div>`;
}

renderDash();