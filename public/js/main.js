function $(id){return document.getElementById(id);}

let isDuplicateSubmitInProgress = false;

function showMsg(elId, msg, type='error'){
  const el = $(elId); el.textContent = msg; el.className = 'msg ' + type;
}

// Datetime
setInterval(()=>{
  const datetimeEl = $('datetime');
  if (datetimeEl) datetimeEl.textContent = new Date().toLocaleString('en-IN');
},1000);
const lastUpdateEl = $('lastUpdate');
if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleDateString('en-IN');

// Load notices
async function loadNotices(){
  const list = $('noticeList');
  if (!list) return;

  try{
    const r = await fetch('/api/candidate/notices');
    const j = await r.json();

    if(!j.data || !j.data.length){ list.innerHTML = '<p>No notices available.</p>'; return; }
    list.innerHTML = j.data.map(n => `
      <div class="notice-item">
        <h4>${n.title}</h4>
        <p>${n.content || ''}</p>
        ${n.file_path ? `<a href="/uploads/temp/${n.file_path}" target="_blank" style="color:#1a3a6c; font-size:13px; font-weight:600; display:block; margin:5px 0;">📎 Download Notice Attachment</a>` : ''}
        <small>${new Date(n.created_at).toLocaleDateString('en-IN')}</small>
      </div>`).join('');
  }catch(e){ list.innerHTML = '<p>Failed to load notices. Please check if backend is running.</p>'; }
}
loadNotices();

// Candidate OTP
async function requestOtp(){
  const appNo = $('appNo').value.trim();
  if(!appNo) return showMsg('loginMsg','Enter Application Number');
  
  try {
    const r = await fetch('/api/auth/request-otp', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({application_no: appNo})
    });
    const j = await r.json();
    if(j.success){
      $('step1').style.display='none';
      $('step2').style.display='block';
      const msg = j.message || 'OTP sent successfully';
      showMsg('loginMsg', msg, 'success');
    } else showMsg('loginMsg', j.message);
  } catch(e) { showMsg('loginMsg', 'Network error. Is server running?'); }
}

async function verifyOtp(){
  const appNo = $('appNo').value.trim();
  const otp = $('otp').value.trim();
  
  try {
    const r = await fetch('/api/auth/verify-otp',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({application_no: appNo, otp})
    });
    const j = await r.json();
    if(j.success){
      localStorage.setItem('token', j.token);
      localStorage.setItem('role', j.role);
      localStorage.setItem('appNo', j.application_no);
      window.location.href = '/candidate';
    } else showMsg('loginMsg', j.message);
  } catch(e) { showMsg('loginMsg', 'Network error.'); }
}

// Admin Modal
function toggleAdminLogin(){ $('adminModal').classList.toggle('active'); }

async function adminLogin(){
  const u = $('adminUser').value, p = $('adminPass').value;
  
  try {
    const r = await fetch('/api/auth/login',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username:u, password:p})
    });
    const j = await r.json();
    if(j.success){
      localStorage.setItem('token', j.token);
      localStorage.setItem('role', j.role);
      localStorage.setItem('name', j.name);
      if(j.role === 'admin') window.location.href = '/admin.html';
      else window.location.href = '/staff.html';
    } else showMsg('adminMsg', j.message);
  } catch (err) {
    showMsg('adminMsg', 'Invalid credentials or server offline.', 'error');
  }
}

// ── DUPLICATE CERTIFICATE APPLICATION ───────────────────────
async function submitDuplicateApplication() {
  const appNo   = $('dupAppNo').value.trim();
  const reason  = $('dupReason').value.trim();
  const photo   = $('dupPhoto').files[0];
  const payMode = $('dupPayMode').value;
  const txnId   = $('dupTxnId').value.trim();
  const msgEl   = $('dupMsg');

  if (isDuplicateSubmitInProgress) return;

  msgEl.style.color = '#dc2626';
  if (!appNo)   return msgEl.textContent = 'Please enter your Application Number.';
  if (!reason)  return msgEl.textContent = 'Please enter the reason for duplicate.';
  if (!photo)   return msgEl.textContent = 'Please upload your passport size photograph.';
  if (!['image/jpeg', 'image/jpg'].includes(photo.type)) return msgEl.textContent = 'Only JPG/JPEG photo is allowed.';
  if (photo.size > 2 * 1024 * 1024) return msgEl.textContent = 'Photo size must be less than 2MB.';
  if (!payMode) return msgEl.textContent = 'Please select a payment mode.';
  if (!txnId)   return msgEl.textContent = 'Please enter the Transaction ID / Receipt number.';

  const fd = new FormData();
  fd.append('application_no', appNo);
  fd.append('reason', reason);
  fd.append('payment_mode', payMode);
  fd.append('txn_id', txnId);
  fd.append('photo', photo);

  isDuplicateSubmitInProgress = true;
  msgEl.style.color = '#1d4ed8';
  msgEl.textContent = 'Submitting...';

  try {
    const r = await fetch('/api/candidate/duplicate-apply', { method: 'POST', body: fd });
    const j = await r.json();
    if (j.success) {
      $('dupStep1').style.display = 'none';
      $('dupSuccess').style.display = 'block';
      $('dupAppNo').value = '';
      $('dupReason').value = '';
      $('dupPhoto').value = '';
      $('dupPayMode').value = '';
      $('dupTxnId').value = '';
      msgEl.textContent = '';
    } else {
      msgEl.style.color = '#dc2626';
      msgEl.textContent = j.message || 'Submission failed. Please try again.';
    }
  } catch(e) {
    msgEl.style.color = '#dc2626';
    msgEl.textContent = 'Network error. Please check your connection.';
  }
}