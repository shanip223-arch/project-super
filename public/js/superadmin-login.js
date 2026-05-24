'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const blankPage  = document.getElementById('blankPage');
const loginPage  = document.getElementById('loginPage');
const step1      = document.getElementById('step1');
const step2      = document.getElementById('step2');
const msgEl      = document.getElementById('loginMsg');
const loginBtn   = document.getElementById('loginBtn');

let step1Unlocked = false;
let step2Unlocked = false;

// ── Keyboard Sequence Detector ────────────────────────────────────────────────
// CTRL+ALT+1→2→3  = reveal passkey field (step 1 unlock)
// CTRL+ALT+0→0    = reveal password field (step 2 unlock)
let keyBuffer = [];
let bufferTimer = null;

document.addEventListener('keydown', function (e) {
  if (!e.ctrlKey || !e.altKey) { keyBuffer = []; return; }

  const k = e.key;
  if (!['0','1','2','3'].includes(k)) return;

  e.preventDefault();
  keyBuffer.push(k);

  clearTimeout(bufferTimer);
  bufferTimer = setTimeout(() => { keyBuffer = []; }, 2500);

  const seq = keyBuffer.join('');

  if (seq === '123') {
    keyBuffer = [];
    unlockStep1();
    return;
  }

  if (seq === '00') {
    keyBuffer = [];
    if (step1Unlocked) unlockStep2();
    return;
  }

  // Trim buffer if too long
  if (keyBuffer.length > 3) keyBuffer = keyBuffer.slice(-3);
});

function unlockStep1() {
  if (step1Unlocked) return;
  step1Unlocked = true;
  blankPage.style.display = 'none';
  loginPage.style.display  = 'flex';
  step1.classList.add('active');
  document.getElementById('passkeyInput').focus();
}

function unlockStep2() {
  if (step2Unlocked) return;
  const passkey = document.getElementById('passkeyInput').value.trim();
  if (!passkey) {
    document.getElementById('passkeyInput').focus();
    return;
  }
  step2Unlocked = true;
  step1.classList.remove('active');
  step2.classList.add('active');
  document.getElementById('passkeyConfirm').value = passkey;
  document.getElementById('passwordInput').focus();
}

// ── Login Submission ──────────────────────────────────────────────────────────
function showMsg(msg, type) {
  msgEl.textContent = msg;
  msgEl.className   = 'sa-msg ' + type;
  msgEl.style.display = 'block';
}

function hideMsg() {
  msgEl.style.display = 'none';
}

loginBtn && loginBtn.addEventListener('click', doLogin);

document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && step2Unlocked) doLogin();
});

async function doLogin() {
  const passkey_id = document.getElementById('passkeyInput').value.trim();
  const password   = document.getElementById('passwordInput').value;

  if (!passkey_id || !password) {
    showMsg('All fields are required.', 'error');
    return;
  }

  loginBtn.disabled    = true;
  loginBtn.textContent = 'Authenticating…';
  hideMsg();

  try {
    const res  = await fetch('/api/superadmin/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ passkey_id, password })
    });
    const data = await res.json();

    if (data.success) {
      sessionStorage.setItem('sa_token', data.token);
      sessionStorage.setItem('sa_name',  data.name);
      sessionStorage.setItem('sa_pkid',  data.passkey_id);
      sessionStorage.setItem('sa_login_time', Date.now().toString());
      window.location.href = '/superadmin/panel';
    } else {
      showMsg(data.message || 'Access denied.', 'error');
      loginBtn.disabled    = false;
      loginBtn.textContent = 'Authenticate';
    }
  } catch {
    showMsg('Connection error. Please try again.', 'error');
    loginBtn.disabled    = false;
    loginBtn.textContent = 'Authenticate';
  }
}

// ── Auto-redirect if already logged in ───────────────────────────────────────
(function checkExistingSession() {
  const token     = sessionStorage.getItem('sa_token');
  const loginTime = parseInt(sessionStorage.getItem('sa_login_time') || '0', 10);
  const timeout   = 30 * 60 * 1000; // 30 min client-side guard

  if (token && Date.now() - loginTime < timeout) {
    window.location.href = '/superadmin/panel';
  }
})();
