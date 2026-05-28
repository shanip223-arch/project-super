const token = localStorage.getItem('token');
const role = localStorage.getItem('role');
if (!token || role !== 'candidate') window.location.href = '/';

let candidateData = null;
const workflowModal = new WorkflowModalEngine();
const OBJECTION_LOCK_STATUSES = ['open', 'under_review', 'rejected', 'objection_pending', 'objection_reupload_required', 'objection_under_review'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function parseDocs(raw) {
  try { return JSON.parse(raw || '[]'); } catch(e) { return []; }
}

function getWorkflowObjections() {
  if (!candidateData) return [];
  return (candidateData.objections || []).filter(o => OBJECTION_LOCK_STATUSES.includes(o.status));
}

function getPrimaryWorkflowObjection() {
  const active = getWorkflowObjections();
  const selected = active.find(o => ['open', 'rejected', 'objection_pending', 'objection_reupload_required'].includes(o.status)) || active[0];
  if (selected) return selected;
  if (candidateData && String(candidateData.data.status || '').toLowerCase() === 'objection') {
    return {
      id: 0,
      application_no: candidateData.data.application_no,
      status: 'objection_pending',
      reason: 'Application has been marked under objection. Please contact the Bar Council objection desk if correction details are not visible yet.',
      required_docs: '[]',
      cleared_files: '[]',
      created_at: new Date().toISOString()
    };
  }
  return null;
}

function hasCriticalObjectionLock() {
  return !!getPrimaryWorkflowObjection() || (candidateData && String(candidateData.data.status || '').toLowerCase() === 'objection');
}

function logout() { localStorage.clear(); window.location.href = '/'; }
function showLoader(s) { document.getElementById('loader').style.display = s ? 'flex' : 'none'; }
function toast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  setTimeout(() => t.className = 'toast', 3000);
}

async function load() {
  showLoader(true);
  try {
    const r = await fetch('/api/candidate/me', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json();
    if (!j.success) { alert(j.message); logout(); return; }
    candidateData = j;
    document.getElementById('userName').textContent = j.data.name;

    const activeNav = document.querySelector('.nav-item.active');
    if (activeNav) {
      if (activeNav.textContent.includes('Dashboard')) renderDash();
      else if (activeNav.textContent.includes('Correction')) renderCorrection();
      else if (activeNav.textContent.includes('Objection')) renderObjections();
    } else {
      renderDash();
    }
    syncObjectionWorkflowModal();
  } catch (err) {
    toast('Failed to load data', 'error');
  } finally {
    showLoader(false);
  }
}

function setPage(p, el) {
  if (hasCriticalObjectionLock() && p !== 'objections') {
    toast('Objection workflow locked hai. Pehle objection response complete karein.', 'error');
    syncObjectionWorkflowModal();
    return;
  }
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('pageTitle').textContent = el.textContent.trim();

  if (p === 'dashboard') return renderDash();
  if (p === 'correction') return renderCorrection();
  if (p === 'objections') return renderObjections();
}

function renderDash() {
  if (!candidateData) return;
  const a = candidateData.data;
  const cert = candidateData.certificates[0];
  const openObjs = candidateData.objections.filter(o => o.status === 'open' || o.status === 'under_review');

  document.getElementById('content').innerHTML = `
    ${openObjs.length ? `
    <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:16px; padding:20px 24px; margin-bottom:24px; display:flex; gap:16px; align-items:flex-start;">
      <span style="font-size:28px;">⚠️</span>
      <div>
        <h4 style="color:#dc2626; margin-bottom:6px;">Action Required: ${openObjs.length} Active Objection(s)</h4>
        <p style="color:#b91c1c; font-size:14px; margin-bottom:12px;">
          Aapke application par objection raised ki gayi hai. 
          <b>2 din ke andar required documents submit karein.</b> 
          Agar 2 din mein clear nahi karein to objection clearance ke liye <b>payment fee lagegi.</b>
        </p>
        <button class="btn btn-danger" data-action="goto-objections">
          🔴 Clear Objection Now
        </button>
      </div>
    </div>` : ''}
    <div class="card">
      <h3 style="color:#1a3a6c; border-bottom:none; margin-bottom:10px;">Welcome, ${a.name}</h3>
      <p style="color:#666">Application No: <b>${a.application_no}</b></p>
      <div class="info-grid">
        <div class="info-item"><label>Father's Name</label><p>${a.father_name||'-'}</p></div>
        <div class="info-item"><label>District</label><p>${a.district||'-'}</p></div>
        <div class="info-item"><label>Mobile</label><p>${a.mobile||'-'}</p></div>
        <div class="info-item"><label>Status</label><p><span class="tag ${a.status}">${a.status.toUpperCase()}</span></p></div>
      </div>
    </div>
    <div class="card">
      <h3>Certificate Status</h3>
      <p style="font-size: 16px;">${cert ? '✅ Available - ' + cert.status.toUpperCase() : '⏳ Not yet issued'}</p>
      ${cert && cert.status === 'verified' ? '<br><button class="btn btn-success" data-action="download-cert">⬇️ Download Certificate</button>' : ''}
    </div>
  `;
}

function renderCorrection() {
  document.getElementById('content').innerHTML = `
    <div class="card">
      <h3>Request Correction</h3>
      <p style="color: var(--text-muted); margin-bottom: 20px;">If there is a mistake in your application details, you can submit a correction request.</p>
      <label>Field to Correct</label>
      <select id="corrField">
        <option value="Name">Name</option>
        <option value="Father Name">Father's Name</option>
        <option value="District">District</option>
        <option value="Mobile">Mobile</option>
      </select>
      <label>Correct Value</label>
      <input type="text" id="corrValue" placeholder="Enter the correct detail...">
      <button class="btn btn-primary" data-action="submit-correction" style="margin-top:15px;">Submit Request</button>
    </div>
  `;
}

async function submitCorrection() {
  if (hasCriticalObjectionLock()) return toast('Active objection ke dauraan sirf objection response submit ho sakta hai.', 'error');
  const field = document.getElementById('corrField').value;
  const val = document.getElementById('corrValue').value;
  if (!val) return toast('Enter the correct value', 'error');

  const reason = `Correction Request for ${field}: Please update to "${val}"`;
  const r = await fetch('/api/objection', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization: 'Bearer '+token },
    body: JSON.stringify({reason})
  });
  const j = await r.json();
  if (j.success) { toast('Correction request submitted'); load(); }
  else toast(j.message, 'error');
}

function renderObjections() {
  if (!candidateData) return;
  const objs = candidateData.objections;
  const openObjs = objs.filter(o => o.status === 'open');

  document.getElementById('content').innerHTML = `
    ${openObjs.length ? `
    <div style="background:#fef2f2; border:2px solid #fca5a5; border-radius:16px; padding:20px 24px; margin-bottom:24px;">
      <h4 style="color:#dc2626; margin-bottom:8px;">⚠️ IMPORTANT NOTICE</h4>
      <p style="color:#b91c1c; font-size:15px;">
        Aapke ${openObjs.length} open objection(s) hain. <b>2 din ke andar required documents upload karein.</b>
        Delay hone par <b>Objection Clearance Payment</b> applicable hogi.
      </p>
    </div>` : ''}

    <div class="card">
      <h3>Your Objections</h3>
      ${objs.length ? objs.map(o => {
        let docs = [];
        try { docs = JSON.parse(o.required_docs || '[]'); } catch(e) {}

        return `
        <div style="border:1px solid ${o.status === 'open' ? '#fca5a5' : '#d1fae5'}; border-radius:12px; padding:20px; margin-bottom:16px; background:${o.status === 'open' ? '#fff5f5' : '#f0fdf4'};">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div>
              <span class="tag ${o.status}" style="font-size:13px;">${o.status.replace('_',' ').toUpperCase()}</span>
              <span style="font-size:13px; color:#666; margin-left:10px;">${new Date(o.created_at).toLocaleDateString('en-IN')}</span>
            </div>
            ${o.status === 'open' ? `<button class="btn btn-danger btn-sm" data-action="toggle-clear-form" data-objection-id="${o.id}">🔴 Clear Objection Now</button>` : ''}
          </div>

          ${docs.length ? `
          <div style="margin-bottom:12px;">
            <p style="font-size:13px; font-weight:600; color:#374151; margin-bottom:8px;">Required Documents:</p>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${docs.map(d => `<span style="background:#fee2e2; color:#dc2626; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:600;">${d}</span>`).join('')}
            </div>
          </div>` : o.reason ? `<p style="font-size:14px; color:#374151; margin-bottom:8px;"><b>Reason:</b> ${o.reason}</p>` : ''}

          ${o.remarks ? `<p style="font-size:13px; color:#065f46; background:#d1fae5; padding:8px 12px; border-radius:8px;"><b>Staff Remarks:</b> ${o.remarks}</p>` : ''}
          ${o.status === 'under_review' ? `<p style="font-size:13px; color:#1d4ed8; background:#dbeafe; padding:8px 12px; border-radius:8px; margin-top:8px;">🕐 Aapke documents submit ho gaye hain aur review under hai.</p>` : ''}

          <div id="clearForm_${o.id}" style="display:none; margin-top:15px; background:white; border:1px solid #e5e7eb; border-radius:10px; padding:16px;">
            <p style="font-size:14px; font-weight:600; color:#1f2937; margin-bottom:12px;">Upload Required Documents:</p>
            ${docs.length ? docs.map(d => {
              const isImage = d === 'Passport Size Photograph' || d === 'Signature';
              return `
              <div style="margin-bottom:12px;">
                <label style="font-size:13px; font-weight:600; color:#374151; display:block; margin-bottom:4px;">${d} ${isImage ? '(JPG only)' : '(PDF only)'}</label>
                <input type="file" data-doc="${d}" class="clear-file-${o.id}" accept="${isImage ? 'image/jpeg' : 'application/pdf'}" style="margin:0;">
              </div>`;
            }).join('') : `<input type="file" class="clear-file-${o.id}" multiple accept="application/pdf,image/jpeg" style="margin:0;">`}
            <button class="btn btn-primary" data-action="submit-clear" data-objection-id="${o.id}" style="margin-top:10px;">Submit Documents</button>
            <button class="btn" data-action="hide-clear-form" data-objection-id="${o.id}" style="margin-left:8px;">Cancel</button>
          </div>
        </div>`;
      }).join('') : '<p style="color:var(--text-muted)">Koi objection nahi hai. 🎉</p>'}
    </div>
  `;
}

function showClearForm(objId) {
  const el = document.getElementById('clearForm_' + objId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function submitClear(objId) {
  const files = document.querySelectorAll('.clear-file-' + objId);
  const fd = new FormData();
  let hasFile = false;
  files.forEach(inp => {
    if (inp.files[0]) { fd.append('files', inp.files[0]); hasFile = true; }
  });
  if (!hasFile) return toast('Kam se kam ek file select karein', 'error');

  showLoader(true);
  try {
    const r = await fetch('/api/objection/clear/' + objId, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: fd
    });
    const j = await r.json();
    if (j.success) { toast('Documents submit ho gaye! Staff review karega.'); workflowModal.close(); load(); }
    else toast(j.message, 'error');
  } catch(e) { toast('Network error', 'error'); }
  finally { showLoader(false); }
}


function buildCandidateObjectionBody(objection, theme) {
  const a = candidateData.data || {};
  const docs = parseDocs(objection.required_docs);
  const files = parseDocs(objection.cleared_files);
  const canUpload = objection.id && ['open', 'rejected', 'objection_pending', 'objection_reupload_required'].includes(objection.status);
  const statusLabel = objection.status.replace(/_/g, ' ').toUpperCase();
  const date = objection.created_at ? new Date(objection.created_at).toLocaleString('en-IN') : '-';

  return `
    <div class="workflow-grid">
      <div class="workflow-field"><label>Application Number</label><strong>${escapeHtml(objection.application_no || a.application_no)}</strong></div>
      <div class="workflow-field"><label>Current Status</label><strong>${escapeHtml(statusLabel)}</strong></div>
      <div class="workflow-field"><label>Objection Date</label><strong>${escapeHtml(date)}</strong></div>
      <div class="workflow-field"><label>Candidate</label><strong>${escapeHtml(a.name || '-')}</strong></div>
      <div class="workflow-field"><label>Objection By</label><strong>${escapeHtml(objection.handled_by ? 'Bar Council Staff' : 'Processing Desk')}</strong></div>
      <div class="workflow-field"><label>Workflow Modules</label><span>Enrollment · COP · Renewal · Re-Issue · Duplicate ID · Verification · Objections</span></div>
    </div>
    <div class="workflow-section">
      <h4>Objection Remarks / Required Corrections</h4>
      ${docs.length ? `<div class="workflow-doc-tags">${docs.map(d => `<span class="workflow-doc-tag">${escapeHtml(d)}</span>`).join('')}</div>` : `<p class="workflow-note">${escapeHtml(objection.reason || 'Document correction required by Bar Council processing desk.')}</p>`}
      ${objection.remarks ? `<p class="workflow-note" style="margin-top:12px;"><b>Latest staff remarks:</b> ${escapeHtml(objection.remarks)}</p>` : ''}
    </div>
    <div class="workflow-section">
      <h4>Uploaded Response Documents</h4>
      ${files.length ? `<div class="workflow-doc-tags">${files.map((f, i) => `<span class="workflow-doc-tag">Document ${i + 1}: ${escapeHtml(f)}</span>`).join('')}</div>` : '<p class="workflow-note">No response document uploaded yet. Upload corrected files below to unlock workflow review.</p>'}
    </div>
    ${canUpload ? `
      <div class="workflow-section">
        <h4>Correction Upload Section</h4>
        <p class="workflow-note">Upload corrected files only. New upload will replace the previous objection response after submission.</p>
        ${docs.length ? docs.map(d => {
          const isImage = d === 'Passport Size Photograph' || d === 'Signature';
          return `<div class="workflow-upload-row"><label>${escapeHtml(d)} ${isImage ? '(JPG only)' : '(PDF only)'}</label><input type="file" data-doc="${escapeHtml(d)}" class="clear-file-${objection.id}" accept="${isImage ? 'image/jpeg' : 'application/pdf'}"></div>`;
        }).join('') : `<div class="workflow-upload-row"><label>Corrected Documents</label><input type="file" class="clear-file-${objection.id}" multiple accept="application/pdf,image/jpeg,image/png"></div>`}
        <div class="workflow-actions"><button class="btn btn-danger" data-action="submit-clear" data-objection-id="${objection.id}">Submit Objection Response</button></div>
      </div>` : `
      <div class="workflow-section">
        <h4>Review Status</h4>
        <p class="workflow-note">Your objection response has been submitted and is under Bar Council review. Normal workflow access will be restored after clearance.</p>
      </div>`}
  `;
}

function syncObjectionWorkflowModal() {
  if (!candidateData) return;
  const objection = getPrimaryWorkflowObjection();
  if (!objection) {
    workflowModal.close();
    document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('disabled'));
    return;
  }

  const isReview = ['under_review', 'objection_under_review'].includes(objection.status);
  const theme = isReview ? 'review' : 'warning';
  document.querySelectorAll('.nav-item').forEach(item => {
    if (!item.textContent.includes('Objection') && !item.classList.contains('logout')) item.classList.add('disabled');
  });

  workflowModal.open({
    theme,
    critical: true,
    title: isReview ? 'Objection Response Under Review' : 'Objection Raised Against Application',
    subtitle: isReview
      ? 'Your corrected documents are locked for staff review. Background workflow remains unavailable until cleared.'
      : 'Resolve the objection to continue Enrollment, COP, Renewal, Re-Issue, Duplicate ID, Verification or related workflow actions.',
    body: buildCandidateObjectionBody(objection, theme)
  });
}

async function downloadCert() {
  if (hasCriticalObjectionLock()) return toast('Certificate download objection clear hone ke baad available hoga.', 'error');
  showLoader(true);
  try {
    const r = await fetch('/api/candidate/certificate/download', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return toast('Download failed', 'error');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'certificate.pdf'; a.click();
  } catch (err) {
    toast('Network error', 'error');
  } finally {
    showLoader(false);
  }
}

// Initial load
load();
function bindCandidateEventHandlers() {
  if (window.__candidateEventsBound) return;
  window.__candidateEventsBound = true;
  document.querySelectorAll('.candidate-sidebar .nav-item[data-page]').forEach((item) => {
    item.addEventListener('click', () => setPage(item.dataset.page, item));
  });
  const logoutButton = document.querySelector('.candidate-sidebar .nav-item.logout');
  if (logoutButton) logoutButton.addEventListener('click', logout);

  const content = document.getElementById('content');
  if (!content) return;
  content.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const objectionId = Number(target.dataset.objectionId || 0);
    switch (target.dataset.action) {
      case 'goto-objections': {
        const nav = document.querySelector('.candidate-sidebar .nav-item[data-page="objections"]');
        if (nav) setPage('objections', nav);
        break;
      }
      case 'download-cert': downloadCert(); break;
      case 'submit-correction': submitCorrection(); break;
      case 'toggle-clear-form': if (objectionId) showClearForm(objectionId); break;
      case 'submit-clear': if (objectionId) submitClear(objectionId); break;
      case 'hide-clear-form': {
        const form = document.getElementById(`clearForm_${objectionId}`);
        if (form) form.style.display = 'none';
        break;
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    bindCandidateEventHandlers();
    load();
  } catch (err) {
    console.error('[candidate.init.error]', err);
  }
});
