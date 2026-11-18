const { ipcRenderer } = require('electron');

let pendingCred = null;
let lastAutofillAt = 0;

function credHostMatches(cred) {
  try {
    const allowed = String((cred && cred.host) || '').trim().toLowerCase();
    if (!allowed) return false;
    const current = window.location.hostname.toLowerCase();
    return current === allowed || current.endsWith('.' + allowed);
  } catch { return false; }
}

ipcRenderer.on('autofill-credentials', (_event, cred) => {
  if (!credHostMatches(cred)) {
    pendingCred = null;
    return;
  }
  pendingCred = cred;
  tryAutofill(cred);
});

function findUsernameForPassword(pwdInput) {
  try {
    const form = pwdInput.form;
    if (form) {
      const candidates = Array.from(form.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])'));
      const visible = candidates.filter((el) => {
        const t = (el.type || '').toLowerCase();
        const okType = t === 'text' || t === 'email' || t === 'tel' || t === '' || t === 'username';
        if (!okType) return false;
        try {
          if (el.offsetParent !== null) return true;
          if (el.getClientRects && el.getClientRects().length > 0) return true;
          return true;
        } catch { return true; }
      });
      if (visible.length) return visible[visible.length - 1];
      if (candidates.length) return candidates[candidates.length - 1];
    }
    const all = Array.from(document.querySelectorAll('input'));
    const idx = all.indexOf(pwdInput);
    if (idx > 0) {
      const before = all.slice(0, idx).filter((el) => {
        const t = (el.type || '').toLowerCase();
        return t === 'text' || t === 'email' || t === 'tel' || t === '' || t === 'username';
      });
      if (before.length) return before[before.length - 1];
    }
  } catch {}
  return null;
}

function tryAutofill(cred) {
  if (!cred) return;
  const username = cred.username || '';
  const password = cred.password || '';
  if (!password && !username) return;
  const pwds = Array.from(document.querySelectorAll('input[type="password"]'));
  if (!pwds.length) return;
  pwds.forEach((pwd) => {
    try {
      if (password) {
        pwd.focus();
        pwd.value = password;
        pwd.dispatchEvent(new Event('input', { bubbles: true }));
        pwd.dispatchEvent(new Event('change', { bubbles: true }));
        pwd.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      }
    } catch {}
    const userInput = findUsernameForPassword(pwd);
    if (userInput && username) {
      try {
        userInput.focus();
        userInput.value = username;
        userInput.dispatchEvent(new Event('input', { bubbles: true }));
        userInput.dispatchEvent(new Event('change', { bubbles: true }));
        userInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        const prev = userInput.style.backgroundColor;
        userInput.style.backgroundColor = 'rgba(0, 240, 255, 0.08)';
        setTimeout(() => { try { userInput.style.backgroundColor = prev; } catch {} }, 900);
      } catch {}
    }
    try {
      const prev = pwd.style.backgroundColor;
      pwd.style.backgroundColor = 'rgba(0, 240, 255, 0.08)';
      setTimeout(() => { try { pwd.style.backgroundColor = prev; } catch {} }, 900);
    } catch {}
  });
}

function extractAndSend(formOrPwd) {
  // Never exfiltrate from third-party iframes; host attributes top-URL.
  let isTopFrame = true;
  try { isTopFrame = window.top === window.self; } catch { isTopFrame = false; }
  if (!isTopFrame) return;
  let username = '';
  let password = '';
  let pwdInput = null;

  if (formOrPwd && formOrPwd.tagName === 'FORM') {
    const pwd = formOrPwd.querySelector('input[type="password"]');
    if (pwd) {
      pwdInput = pwd;
      password = pwd.value || '';
      const userInput = findUsernameForPassword(pwd);
      if (userInput) username = userInput.value || '';
      if (!username) {
        const alt = formOrPwd.querySelector('input[type="text"], input[type="email"], input[type="tel"]');
        if (alt) username = alt.value || '';
      }
    }
  } else if (formOrPwd && formOrPwd.type === 'password') {
    pwdInput = formOrPwd;
    password = formOrPwd.value || '';
    const userInput = findUsernameForPassword(formOrPwd);
    if (userInput) username = userInput.value || '';
  } else {
    const pwd = document.querySelector('input[type="password"]');
    if (pwd) {
      pwdInput = pwd;
      password = pwd.value || '';
      const userInput = findUsernameForPassword(pwd);
      if (userInput) username = userInput.value || '';
    }
  }

  if (!password || password.length < 1) return;
  if (password.length > 512) return;

  const payload = {
    username: (username || '').trim(),
    password: password,
    url: window.location.href,
    title: document.title || window.location.hostname || window.location.href,
    isTopFrame: true,
  };
  try {
    ipcRenderer.sendToHost('save-credentials', payload);
  } catch {}
}

function attachListeners() {
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form && form.tagName === 'FORM') {
      const pwd = form.querySelector('input[type="password"]');
      if (pwd) {
        setTimeout(() => extractAndSend(form), 40);
      }
    }
  }, true);

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target || !target.closest) return;
    const btn = target.closest('button, input[type="submit"], input[type="button"], [role="button"]');
    if (!btn) return;
    const pwd = document.querySelector('input[type="password"]');
    if (pwd && pwd.value) {
      setTimeout(() => {
        try {
          if (!pwd.value) return;
          const form = pwd.form || btn.closest('form');
          if (form) extractAndSend(form);
          else extractAndSend(pwd);
        } catch {}
      }, 120);
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const active = document.activeElement;
      if (active && active.type === 'password') {
        setTimeout(() => extractAndSend(active), 60);
      }
    }
  }, true);
}

function init() {
  attachListeners();
  if (pendingCred) {
    setTimeout(() => tryAutofill(pendingCred), 60);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init();
    if (pendingCred) tryAutofill(pendingCred);
  });
} else {
  init();
}

window.addEventListener('load', () => {
  if (pendingCred) tryAutofill(pendingCred);
});

try {
  const observer = new MutationObserver(() => {
    if (!pendingCred) return;
    const now = Date.now();
    if (now - lastAutofillAt < 2000) return;
    lastAutofillAt = now;
    tryAutofill(pendingCred);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
} catch {}

window.addEventListener('pageshow', () => {
  if (pendingCred) setTimeout(() => tryAutofill(pendingCred), 80);
});
