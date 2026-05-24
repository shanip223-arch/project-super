'use strict';

const blankCover = document.getElementById('blankCover');
const loginPage  = document.getElementById('loginPage');
const msgEl      = document.getElementById('loginMsg');
const loginBtn   = document.getElementById('loginBtn');
const passkeyInput  = document.getElementById('passkeyInput');
const passwordInput = document.getElementById('passwordInput');

let unlocked = false;

// ── Keyboard Unlock: Ctrl + Shift + Alt + S ───────────────────────────────────
document.addEventListener('keydown', function (e) {
  if (e.ctrlKey && e.shiftKey && e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    unlock();
  }
});

function unlock() {
  if (unlocked) return;
  unlocked = true;
  blankCover.style.display = 'none';
  loginPage.classList.add('visible');
  passkeyInput.focus();
}

// ── Submit on Enter ───────────────────────────────────────────────────────────
document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && unlocked) doLogin();
});

loginBtn.addEventListener('click', doLogin);

// ── Messages ─────────────────────────────────────────────────────────────────
function showMsg(msg, type) {
  msgEl.textContent    = msg;
  msgEl.className      = 'sa-msg ' + type;
  msgEl.style.display  = 'block';
}

function hideMsg() {
  msgEl.style.display = 'none';
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const passkey_id = passkeyInput.value.trim();
  const password   = passwordInput.value;

  if (!passkey_id) { passkeyInput.focus(); showMsg('Enter your Passkey ID.', 'error'); return; }
  if (!password)   { passwordInput.focus(); showMsg('Enter your password.', 'error'); return; }

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
      sessionStorage.setItem('sa_token',      data.token);
      sessionStorage.setItem('sa_name',       data.name);
      sessionStorage.setItem('sa_pkid',       data.passkey_id);
      sessionStorage.setItem('sa_login_time', Date.now().toString());
      window.location.href = '/superadmin/panel';
    } else {
      showMsg(data.message || 'Access denied. Check your credentials.', 'error');
      passwordInput.value = '';
      passwordInput.focus();
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
(function () {
  const token     = sessionStorage.getItem('sa_token');
  const loginTime = parseInt(sessionStorage.getItem('sa_login_time') || '0', 10);
  if (token && Date.now() - loginTime < 30 * 60 * 1000) {
    window.location.href = '/superadmin/panel';
  }
})();
