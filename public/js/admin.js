const ADMIN_PAGES = [
  { key: 'dashboard', label: 'Dashboard', href: '/admin/dashboard.html', icon: 'D' },
  { key: 'applications', label: 'Applications', href: '/admin/applications.html', icon: 'A' },
  { key: 'cop', label: 'COP', href: '/admin/cop.html', icon: 'C' },
  { key: 'renewals', label: 'Renewals', href: '/admin/renewals.html', icon: 'R' },
  { key: 'verification', label: 'Verification', href: '/admin/verification.html', icon: 'V' },
  { key: 'objections', label: 'Objections', href: '/admin/objections.html', icon: 'O' },
  { key: 'imports', label: 'Imports', href: '/admin/imports.html', icon: 'I' },
  { key: 'certificates', label: 'Certificates', href: '/admin/certificates.html', icon: 'CT' },
  { key: 'staff', label: 'Staff', href: '/admin/staff.html', icon: 'S' },
  { key: 'reports', label: 'Reports', href: '/admin/reports.html', icon: 'RP' },
  { key: 'settings', label: 'Settings', href: '/admin/settings.html', icon: 'ST' },
  { key: 'logout', label: 'Logout', href: '#logout', icon: 'L', logout: true }
];

const TOP_ACTIONS = [
  { key: 'applications', label: 'Applications', href: '/admin/applications.html' },
  { key: 'verification', label: 'Verification', href: '/admin/verification.html' },
  { key: 'objections', label: 'Objections', href: '/admin/objections.html' },
  { key: 'imports', label: 'Imports', href: '/admin/imports.html' }
];

const PAGE_META = {
  dashboard: { title: 'Dashboard', description: 'Operational queue overview from saved database records only.' },
  applications: { title: 'Applications', description: 'Enrollment and application records imported into the database.' },
  cop: { title: 'COP', description: 'Certificate of Practice records from saved workflow data.' },
  renewals: { title: 'Renewals', description: 'Renewal records from saved workflow data.' },
  reissue: { title: 'Re-Issue', description: 'Duplicate/re-issue requests from saved workflow data.' },
  verification: { title: 'Verification', description: 'Records currently assigned to verification workflow.' },
  objections: { title: 'Objections', description: 'Open objection records from the database.' },
  imports: { title: 'Imports', description: 'Upload Excel/CSV files and review real import batches.' },
  certificates: { title: 'Certificates', description: 'Certificate records saved in the database.' },
  staff: { title: 'Staff', description: 'Saved staff and administrator accounts.' },
  reports: { title: 'Reports', description: 'Simple operational exports and database-backed lists.' },
  settings: { title: 'Settings', description: 'Admin profile and system configuration routes.' }
};

const WORKFLOW_PAGE_STATUS = {
  cop: 'cop',
  renewals: 'renewal',
  verification: 'verification',
  objections: 'objection',
  certificates: 'approved'
};

const state = {
  page: 1,
  pageSize: 25,
  search: '',
  status: '',
  sortKey: 'created_at',
  sortDir: 'desc',
  selectedId: null,
  selectedRecord: null,
  records: [],
  total: 0,
  totalPages: 1,
  stats: { applications: 0, pending: 0, verification: 0, objections: 0, approved: 0, certificates: 0, staff: 0 },
  uploads: [],
  staff: [],
  audit: [],
  loading: false,
  error: ''
};

const currentPage = document.body.dataset.adminPage || 'dashboard';
const shell = document.getElementById('appShell');
const overlay = document.getElementById('overlay');
const pageContent = document.getElementById('pageContent');

function authHeaders(extra = {}) {
  const token = localStorage.getItem('token');
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function preservePermanentNo(value) {
  return String(value || '').trim();
}

function normalizeStatus(status) {
  return String(status || 'pending').trim().toLowerCase();
}

function statusClass(status) {
  const value = normalizeStatus(status);
  if (value.includes('object')) return 'objection';
  if (value.includes('verif')) return 'verification';
  if (value.includes('approv')) return 'approved';
  if (value.includes('reject')) return 'rejected';
  if (value.includes('cop')) return 'cop';
  if (value.includes('renew')) return 'renewal';
  return 'pending';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: authHeaders(options.headers || {}) });
  if (response.status === 401) throw new Error('Login required to load admin records.');
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(data.message || 'Request failed');
  return data;
}

function renderNavigation() {
  const sidebar = document.getElementById('sidebarMenu');
  const topNav = document.getElementById('topNav');
  if (sidebar) {
    sidebar.innerHTML = ADMIN_PAGES.map(item => {
      const active = item.key === currentPage ? 'active' : '';
      const attrs = item.logout ? 'href="#logout" data-logout' : `href="${item.href}"`;
      return `<a class="nav-item ${active}" ${attrs}><span class="nav-main"><span class="nav-icon">${item.icon}</span><span class="nav-label">${item.label}</span></span></a>`;
    }).join('');
  }
  if (topNav) topNav.innerHTML = TOP_ACTIONS.map(item => `<a href="${item.href}" class="${item.key === currentPage ? 'active' : ''}">${item.label}</a>`).join('');
}

function pageHeader() {
  const meta = PAGE_META[currentPage] || PAGE_META.dashboard;
  document.getElementById('activeSectionLabel').textContent = meta.title;
  document.getElementById('pageTitle').textContent = meta.title;
  return `<div class="page-head"><div><h3>${meta.title}</h3><p>${meta.description}</p></div><span class="identity-note">Application format preserved: UP12345/25</span></div>`;
}

function summaryCards() {
  const s = state.stats;
  return `<section class="summary-grid" aria-label="Database record summary">
    <article class="card summary-card"><p>Total Applications</p><strong>${s.applications || 0}</strong><small>Saved records</small></article>
    <article class="card summary-card"><p>Pending</p><strong>${s.pending || 0}</strong><small>Database status</small></article>
    <article class="card summary-card"><p>Verification</p><strong>${s.verification || 0}</strong><small>Database status</small></article>
    <article class="card summary-card"><p>Objections</p><strong>${s.objections || 0}</strong><small>Open workflow records</small></article>
  </section>`;
}

function tableMarkup(title = 'Application Records') {
  return `<section class="table-card" aria-label="${escapeHtml(title)}">
    <div class="card-header"><div><p class="eyebrow">Database Records</p><h3>${escapeHtml(title)}</h3></div>
      <div class="table-tools">
        <label class="table-search"><span>Search</span><input type="search" id="applicationSearch" value="${escapeHtml(state.search)}" placeholder="Application no, name, district"></label>
        <select id="statusFilter" aria-label="Filter by status"><option value="">All Status</option>${['pending','verification','objection','approved','rejected','cop','renewal'].map(s => `<option value="${s}" ${state.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select id="pageSize" aria-label="Rows per page">${[25,50,100].map(size => `<option value="${size}" ${state.pageSize === size ? 'selected' : ''}>${size} rows</option>`).join('')}</select>
        <button class="btn" type="button" id="clearFilters">Clear</button>
      </div></div>
    <div class="table-wrap"><table class="app-table"><thead><tr>
      <th><button type="button" data-sort="application_no">Application No</button></th><th><button type="button" data-sort="name">Name</button></th><th>Father/Husband</th><th><button type="button" data-sort="district">District</button></th><th>Mobile</th><th><button type="button" data-sort="status">Status</button></th><th><button type="button" data-sort="created_at">Date</button></th><th>Actions</th>
    </tr></thead><tbody id="applicationRows"><tr><td colspan="8"><div class="empty-card">Loading records…</div></td></tr></tbody></table></div>
    <div class="pagination"><span id="pageSummary">Showing 0 records</span><div class="pager-controls"><button type="button" id="prevPage">Previous</button><span id="pageNumber">Page 1</span><button type="button" id="nextPage">Next</button></div></div>
  </section>`;
}

function detailsPanelMarkup() {
  return `<aside class="details-panel" aria-label="Selected application details">
    <div class="panel-header"><div><p class="eyebrow">Selected Record</p><h3 id="detailAppNo">No record selected</h3></div><span class="status-badge pending" id="detailStatus">—</span></div>
    <div class="detail-card"><h4>Application Details</h4><dl id="detailList"></dl></div>
    <div class="detail-card"><h4>Certificates / Files</h4><ul class="office-list" id="documentList"></ul></div>
    <div class="detail-card"><h4>Objection History</h4><ul class="office-list" id="objectionList"></ul></div>
    <div class="detail-card"><h4>Workflow Actions</h4><div class="workflow-steps" id="workflowSteps"></div></div>
  </aside>`;
}

function emptyRow(message = 'No application records found. Upload records to begin.') {
  return `<tr><td colspan="8"><div class="empty-card"><strong>${escapeHtml(message)}</strong><br><span>Only uploaded, imported, or saved database records are displayed.</span></div></td></tr>`;
}

function renderRows() {
  const rowsContainer = document.getElementById('applicationRows');
  if (!rowsContainer) return;
  if (state.loading) {
    rowsContainer.innerHTML = '<tr><td colspan="8"><div class="empty-card">Loading records…</div></td></tr>';
    return;
  }
  if (state.error) {
    rowsContainer.innerHTML = emptyRow(state.error);
    return;
  }
  rowsContainer.innerHTML = state.records.map(item => {
    const appNo = preservePermanentNo(item.application_no);
    const safeNo = escapeHtml(appNo);
    return `<tr data-id="${item.id}"><td><button class="app-no" type="button" data-select="${item.id}">${safeNo}</button></td>
      <td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.father_name || '—')}</td><td>${escapeHtml(item.district || '—')}</td><td>${escapeHtml(item.mobile || '—')}</td>
      <td><span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status || 'pending')}</span></td><td>${formatDate(item.created_at || item.updated_at)}</td>
      <td class="action-cell"><div class="row-actions">
        <button class="btn btn-sm" type="button" data-select="${item.id}">View</button><button class="btn btn-sm btn-edit" type="button" data-edit="${item.id}">Edit</button><button class="btn btn-sm" type="button" data-action="verify" data-id="${item.id}">Verify</button><button class="btn btn-sm btn-primary" type="button" data-action="approve" data-id="${item.id}">Approve</button><button class="btn btn-sm" type="button" data-action="objection" data-id="${item.id}">Objection</button><button class="btn btn-sm btn-danger" type="button" data-action="reject" data-id="${item.id}">Reject</button>
      </div></td></tr>`;
  }).join('') || emptyRow();
  document.getElementById('pageSummary').textContent = `Showing ${state.total ? ((state.page - 1) * state.pageSize) + 1 : 0}-${Math.min(state.page * state.pageSize, state.total)} of ${state.total} records`;
  document.getElementById('pageNumber').textContent = `Page ${state.page} of ${state.totalPages}`;
  document.getElementById('prevPage').disabled = state.page === 1;
  document.getElementById('nextPage').disabled = state.page >= state.totalPages;
  renderDetails();
}

function renderDetails() {
  if (!document.getElementById('detailAppNo')) return;
  const item = state.selectedRecord || state.records.find(record => record.id === state.selectedId);
  if (!item) {
    document.getElementById('detailAppNo').textContent = 'No record selected';
    document.getElementById('detailStatus').textContent = '—';
    document.getElementById('detailList').innerHTML = '<div><dt>Status</dt><dd>No application records found</dd></div>';
    document.getElementById('documentList').innerHTML = '<li>No certificate/file records found</li>';
    document.getElementById('objectionList').innerHTML = '<li>No objection records found</li>';
    document.getElementById('workflowSteps').innerHTML = '<div class="empty-card">Workflow actions appear after selecting a saved record.</div>';
    return;
  }
  const appNo = preservePermanentNo(item.application_no);
  document.getElementById('detailAppNo').textContent = appNo;
  const badge = document.getElementById('detailStatus');
  badge.textContent = item.status || 'pending';
  badge.className = `status-badge ${statusClass(item.status)}`;
  document.getElementById('detailList').innerHTML = [
    ['Database ID', item.id], ['Application No', appNo], ['Name', item.name], ['Father/Husband', item.father_name || '—'], ['District', item.district || '—'], ['Mobile', item.mobile || '—'], ['Created', formatDate(item.created_at)], ['Updated', formatDate(item.updated_at)]
  ].map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
  const certs = item.certificates || [];
  document.getElementById('documentList').innerHTML = certs.length ? certs.map(cert => `<li><span>${escapeHtml(cert.file_path)}</span><a class="btn btn-sm" href="/${escapeHtml(cert.file_path)}" target="_blank" rel="noreferrer">View</a></li>`).join('') : '<li>No certificate/file records found</li>';
  const objections = item.objections || [];
  document.getElementById('objectionList').innerHTML = objections.length ? objections.map(obj => `<li><span>${escapeHtml(obj.reason || obj.remarks || 'Objection record')}</span><small>${escapeHtml(obj.status || 'open')}</small></li>`).join('') : '<li>No objection records found</li>';
  document.getElementById('workflowSteps').innerHTML =
    `<button class="btn btn-edit" type="button" data-edit="${item.id}">Edit Record</button>` +
    ['View','Verify','Approve','Objection','Reject','Assign'].map(action => `<button class="btn" type="button" data-action="${action.toLowerCase()}" data-id="${item.id}">${action}</button>`).join('');
}

function officeQueueMarkup(title) {
  return `<div class="workflow-grid">${tableMarkup(title)}${detailsPanelMarkup()}</div>`;
}

function editModalMarkup() {
  return `<div class="edit-modal-backdrop" id="editModalBackdrop" role="dialog" aria-modal="true" aria-labelledby="editModalTitle">
    <div class="edit-modal">
      <div class="edit-modal-header">
        <div>
          <p class="eyebrow">Edit Application</p>
          <h3 id="editModalTitle">Edit Record</h3>
        </div>
        <button class="edit-modal-close" type="button" id="editModalClose" aria-label="Close">✕</button>
      </div>
      <form class="edit-modal-form form-grid" id="editRecordForm" novalidate>
        <input type="hidden" id="editRecordId">
        <label class="full-span">Application No (read-only)
          <input type="text" id="editAppNo" disabled>
        </label>
        <label>Full Name <span class="required-star">*</span>
          <input type="text" id="editName" required placeholder="Full name">
        </label>
        <label>Father / Husband Name
          <input type="text" id="editFatherName" placeholder="Father / husband name">
        </label>
        <label>District
          <input type="text" id="editDistrict" placeholder="District">
        </label>
        <label>Mobile
          <input type="text" id="editMobile" placeholder="Mobile number">
        </label>
        <label>Status
          <select id="editStatus">
            ${['pending','verification','objection','approved','rejected','cop','renewal'].map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </label>
        <div class="full-span edit-modal-footer">
          <button type="button" class="btn" id="editCancelBtn">Cancel</button>
          <button type="submit" class="btn btn-primary" id="editSaveBtn">Save Changes</button>
        </div>
        <p class="full-span edit-modal-error" id="editModalError" hidden></p>
      </form>
    </div>
  </div>`;
}

function injectEditModal() {
  if (document.getElementById('editModalBackdrop')) return;
  document.body.insertAdjacentHTML('beforeend', editModalMarkup());
  document.getElementById('editModalClose').addEventListener('click', closeEditModal);
  document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
  document.getElementById('editModalBackdrop').addEventListener('click', event => {
    if (event.target === document.getElementById('editModalBackdrop')) closeEditModal();
  });
  document.getElementById('editRecordForm').addEventListener('submit', submitEditForm);
}

function openEditModal(id) {
  injectEditModal();
  const record = state.records.find(r => r.id === Number(id)) || state.selectedRecord;
  if (!record) return;
  document.getElementById('editRecordId').value = record.id;
  document.getElementById('editAppNo').value = preservePermanentNo(record.application_no);
  document.getElementById('editName').value = record.name || '';
  document.getElementById('editFatherName').value = record.father_name || '';
  document.getElementById('editDistrict').value = record.district || '';
  document.getElementById('editMobile').value = record.mobile || '';
  document.getElementById('editStatus').value = normalizeStatus(record.status);
  const errEl = document.getElementById('editModalError');
  errEl.textContent = '';
  errEl.hidden = true;
  document.getElementById('editSaveBtn').disabled = false;
  document.getElementById('editModalBackdrop').classList.add('open');
  document.getElementById('editName').focus();
}

function closeEditModal() {
  document.getElementById('editModalBackdrop')?.classList.remove('open');
}

async function submitEditForm(event) {
  event.preventDefault();
  const id = document.getElementById('editRecordId').value;
  const name = document.getElementById('editName').value.trim();
  const errEl = document.getElementById('editModalError');
  if (!name) {
    errEl.textContent = 'Full name is required.';
    errEl.hidden = false;
    document.getElementById('editName').focus();
    return;
  }
  const saveBtn = document.getElementById('editSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  errEl.hidden = true;
  try {
    await api(`/api/admin/edit/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        father_name: document.getElementById('editFatherName').value.trim(),
        district: document.getElementById('editDistrict').value.trim(),
        mobile: document.getElementById('editMobile').value.trim(),
        status: document.getElementById('editStatus').value
      })
    });
    closeEditModal();
    await loadRecords();
    if (state.selectedId) await loadSelectedRecord(state.selectedId);
  } catch (err) {
    errEl.textContent = err.message || 'Failed to save. Please try again.';
    errEl.hidden = false;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
  }
}

function staffMarkup() {
  const rows = state.staff.map(user => `<tr><td>${escapeHtml(user.full_name || user.username)}</td><td>${escapeHtml(user.role)}</td><td>${escapeHtml(user.username)}</td><td><span class="status-badge ${user.is_active ? 'approved' : 'pending'}">${user.is_active ? 'Active' : 'Inactive'}</span></td><td><a class="btn btn-sm" href="/admin/settings.html#staff-${user.id}">View</a></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty-card">No staff records found.</div></td></tr>';
  return `<section class="card"><div class="card-header"><div><p class="eyebrow">Database Users</p><h3>Staff Accounts</h3></div></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Username</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function importsMarkup() {
  const rows = state.uploads.map(upload => `<tr><td>${escapeHtml(upload.filename)}</td><td>${upload.total_rows}</td><td>${upload.inserted_rows}</td><td>${upload.error_rows}</td><td>${upload.skipped_rows}</td><td>${formatDate(upload.uploaded_at)}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty-card">No import batches found. Upload records to begin.</div></td></tr>';
  return `<section class="card"><div class="card-header"><div><p class="eyebrow">Excel / CSV Upload</p><h3>Import Records</h3></div></div><form class="form-grid" id="importForm" style="padding:12px"><label class="full-span">Excel or CSV File<input type="file" id="importFile" accept=".xlsx,.xls,.csv" required></label><button class="btn btn-primary" type="submit">Upload and Preview</button><span id="importStatus" class="empty-card">Imported rows are saved before they appear in tables.</span></form><div class="table-wrap"><table><thead><tr><th>File</th><th>Total</th><th>Inserted</th><th>Errors</th><th>Skipped</th><th>Uploaded</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function reportsMarkup() {
  return `<section class="card"><div class="card-header"><div><p class="eyebrow">Reports</p><h3>Operational Record Lists</h3></div><a class="btn" href="/api/admin/applications?limit=500" target="_blank" rel="noreferrer">Open JSON Export</a></div><div class="empty-card">Reports use saved database records only. Use search and filters on Applications for operational review.</div></section>`;
}

function settingsMarkup() {
  return `<section class="card"><div class="card-header"><div><p class="eyebrow">Settings</p><h3>Admin Profile</h3></div></div><div class="detail-card"><dl><div><dt>User Area</dt><dd>AD / System Administrator / System Admin</dd></div><div><dt>Data Rule</dt><dd>No automatic non-database records</dd></div></dl></div></section>`;
}

function auditMarkup() {
  const rows = state.audit.map(log => `<tr><td>${formatDate(log.created_at)}</td><td>${escapeHtml(log.role || '—')}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.details || '—')}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty-card">No audit log records found.</div></td></tr>';
  return `<section class="card"><div class="card-header"><div><p class="eyebrow">Audit</p><h3>Recent System Actions</h3></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Role</th><th>Action</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function renderPageSkeleton() {
  let content = pageHeader();
  if (currentPage === 'dashboard') content += summaryCards() + officeQueueMarkup('Main Office Queue');
  else if (['applications', 'cop', 'renewals', 'reissue', 'verification', 'objections', 'certificates'].includes(currentPage)) content += officeQueueMarkup(PAGE_META[currentPage].title);
  else if (currentPage === 'staff') content += staffMarkup();
  else if (currentPage === 'imports') content += importsMarkup();
  else if (currentPage === 'reports') content += reportsMarkup();
  else if (currentPage === 'settings') content += settingsMarkup();
  else content += auditMarkup();
  pageContent.innerHTML = content;
  bindTableEvents();
  bindImportEvents();
  renderRows();
}

function queryForRecords() {
  const params = new URLSearchParams({ page: state.page, limit: state.pageSize, search: state.search, sort: state.sortKey, dir: state.sortDir });
  const pageStatus = WORKFLOW_PAGE_STATUS[currentPage];
  if (state.status) params.set('status', state.status);
  else if (pageStatus) params.set('status', pageStatus);
  return params;
}

async function loadStats() {
  const data = await api('/api/admin/dashboard');
  state.stats = data.stats || state.stats;
}

async function loadRecords() {
  if (!document.getElementById('applicationRows')) return;
  state.loading = true; state.error = ''; renderRows();
  try {
    const data = await api(`/api/admin/applications?${queryForRecords()}`);
    state.records = data.data || [];
    state.total = data.pagination?.total || 0;
    state.totalPages = data.pagination?.totalPages || 1;
    if (!state.selectedId && state.records[0]) state.selectedId = state.records[0].id;
    state.selectedRecord = state.records.find(record => record.id === state.selectedId) || null;
  } catch (err) {
    state.error = err.message;
    state.records = []; state.total = 0; state.totalPages = 1; state.selectedRecord = null;
  } finally {
    state.loading = false; renderRows();
  }
}

async function loadSelectedRecord(id) {
  state.selectedId = Number(id);
  const existing = state.records.find(record => record.id === state.selectedId);
  state.selectedRecord = existing || null;
  renderDetails();
  try {
    const data = await api(`/api/admin/applications/${state.selectedId}`);
    state.selectedRecord = { ...data.data, certificates: data.certificates || [], objections: data.objections || [] };
    renderDetails();
  } catch (err) {
    alert(err.message);
  }
}

async function loadAuxiliary() {
  if (currentPage === 'staff') {
    const data = await api('/api/admin/staff');
    state.staff = data.data || [];
  }
  if (currentPage === 'imports') {
    const data = await api('/api/admin/uploads');
    state.uploads = data.data || [];
  }
  if (currentPage === 'reports') {
    const data = await api('/api/admin/audit-logs');
    state.audit = data.data || [];
  }
}

async function renderPage() {
  try { await loadStats(); } catch (err) { state.error = err.message; }
  try { await loadAuxiliary(); } catch (err) { state.error = err.message; }
  renderPageSkeleton();
  await loadRecords();
}

function bindTableEvents() {
  document.getElementById('applicationSearch')?.addEventListener('input', event => { state.search = event.target.value; state.page = 1; window.clearTimeout(window.adminSearchTimer); window.adminSearchTimer = window.setTimeout(loadRecords, 250); });
  document.getElementById('statusFilter')?.addEventListener('change', event => { state.status = event.target.value; state.page = 1; loadRecords(); });
  document.getElementById('pageSize')?.addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; loadRecords(); });
  document.getElementById('clearFilters')?.addEventListener('click', () => { state.search = ''; state.status = ''; state.page = 1; renderPageSkeleton(); loadRecords(); });
  document.getElementById('prevPage')?.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadRecords(); } });
  document.getElementById('nextPage')?.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; loadRecords(); } });
  document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => { const key = button.dataset.sort; state.sortDir = state.sortKey === key && state.sortDir === 'asc' ? 'desc' : 'asc'; state.sortKey = key; loadRecords(); }));
}

function bindImportEvents() {
  document.getElementById('importForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const file = document.getElementById('importFile').files[0];
    if (!file) return;
    const status = document.getElementById('importStatus');
    const form = new FormData();
    form.append('file', file);
    status.textContent = 'Uploading file for preview…';
    try {
      const preview = await api('/api/admin/excel-upload/preview', { method: 'POST', body: form });
      const mapping = { application_no: preview.columns[0], name: preview.columns[1], father_name: preview.columns[2], district: preview.columns[3], mobile: preview.columns[4] };
      status.textContent = `Preview loaded with ${preview.totalRows} rows. Saving mapped records…`;
      const saved = await api('/api/admin/excel-upload/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tempFile: preview.tempFile, mapping }) });
      status.textContent = `Import complete: ${saved.inserted} inserted, ${saved.errors} errors, ${saved.skipped} skipped.`;
      await loadAuxiliary();
      renderPageSkeleton();
    } catch (err) { status.textContent = err.message; }
  });
}

function bindGlobalEvents() {
  document.addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit]');
    if (editButton) { openEditModal(editButton.dataset.edit); return; }
    const selectButton = event.target.closest('[data-select]');
    if (selectButton) await loadSelectedRecord(selectButton.dataset.select);
    const workflowButton = event.target.closest('[data-action]');
    if (workflowButton) {
      const id = workflowButton.dataset.id;
      const action = workflowButton.dataset.action;
      try {
        await api(`/api/admin/applications/${id}/workflow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
        await loadRecords();
        await loadSelectedRecord(id);
      } catch (err) { alert(err.message); }
    }
    if (event.target.closest('[data-logout]')) secureLogout();
  });
  document.getElementById('globalSearch')?.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.value.trim()) window.location.href = `/admin/applications.html?search=${encodeURIComponent(event.target.value.trim())}`; });
  document.getElementById('notificationButton')?.addEventListener('click', () => { window.location.href = '/admin/reports.html#audit-notifications'; });
  document.getElementById('profileTrigger')?.addEventListener('click', () => { const dropdown = document.getElementById('profileDropdown'); dropdown.classList.toggle('open'); document.getElementById('profileTrigger').setAttribute('aria-expanded', String(dropdown.classList.contains('open'))); });
  document.getElementById('collapseSidebar')?.addEventListener('click', () => shell.classList.toggle('sidebar-collapsed'));
  document.getElementById('mobileMenu')?.addEventListener('click', () => { shell.classList.add('sidebar-open'); overlay.classList.add('show'); });
  overlay?.addEventListener('click', () => { shell.classList.remove('sidebar-open'); overlay.classList.remove('show'); });
}

function secureLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  localStorage.removeItem('name');
  sessionStorage.clear();
  window.location.href = '/';
}

function applyQuerySearch() {
  const params = new URLSearchParams(window.location.search);
  state.search = params.get('search') || params.get('application') || '';
}

renderNavigation();
applyQuerySearch();
bindGlobalEvents();
renderPage();
