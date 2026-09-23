'use strict';

const $ = (id) => document.getElementById(id);
function notice(el, type, msg) { el.innerHTML = `<div class="notice ${type}">${msg}</div>`; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let mode = null;
let groupSlug = null;
let token = null;

function basePath() {
  return mode.platformMode === 'single' ? '/api/me' : `/api/groups/${encodeURIComponent(groupSlug)}/me`;
}
function tokenKey() { return `ubio.recipient.${mode.platformMode === 'single' ? 'default' : groupSlug}`; }

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${basePath()}${path}`, { ...opts, headers });
}

function showDashboard() {
  $('login-view').style.display = 'none';
  $('dash-view').style.display = 'block';
  $('logout').style.display = '';
  $('field-btcAddress').hidden = mode.paymentRail !== 'bitcoin';
  $('field-phone').hidden = mode.paymentRail === 'bitcoin';
  load();
}

async function load() {
  const res = await api('/');
  if (!res.ok) { localStorage.removeItem(tokenKey()); location.reload(); return; }
  const { recipient, payments } = await res.json();

  $('status').innerHTML = `
    <div class="row"><div class="meta">
      <div class="name">${esc(recipient.fullName || recipient.email)}</div>
      <div class="sub">${esc(recipient.email)}${recipient.phone ? ' · ' + esc(recipient.phone) : ''}${recipient.btcAddress ? ' · ' + esc(recipient.btcAddress) : ''}</div>
      <div class="sub">${recipient.payoutReady ? 'Payout ready' : 'Onboarding not finished yet'}${recipient.onboardingUrl && !recipient.payoutReady ? ` — <a href="${esc(recipient.onboardingUrl)}">finish setup</a>` : ''}</div>
    </div></div>`;

  $('u-note').value = recipient.note || '';
  if (mode.paymentRail === 'bitcoin') $('u-btc').value = recipient.btcAddress || '';
  else $('u-phone').value = recipient.phone || '';

  const el = $('history');
  if (!payments.length) { el.innerHTML = '<div class="empty">No payments yet.</div>'; return; }
  el.innerHTML = payments.map((p) => `
    <div class="row"><div class="meta">
      <div class="name">${p.amount != null ? `$${p.amount.toFixed(2)}` : ''} <span class="tag">${esc(p.status)}</span></div>
      <div class="sub">${p.txid ? esc(p.txid) : (p.transferId ? esc(p.transferId) : '')}</div>
    </div></div>`).join('');
}

$('save-details').addEventListener('click', async () => {
  const payload = { note: $('u-note').value };
  if (mode.paymentRail === 'bitcoin') payload.btcAddress = $('u-btc').value;
  else payload.phone = $('u-phone').value;
  const res = await api('/', { method: 'PATCH', body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  notice($('update-notice'), res.ok ? 'ok' : 'err', res.ok ? 'Saved.' : (body.error || 'Could not save.'));
  if (res.ok) load();
});

$('save-password').addEventListener('click', async () => {
  const res = await api('/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: $('cur-pw').value, newPassword: $('new-pw').value }),
  });
  const body = await res.json().catch(() => ({}));
  notice($('password-notice'), res.ok ? 'ok' : 'err', res.ok ? 'Password changed.' : (body.error || 'Could not change password.'));
  if (res.ok) { $('cur-pw').value = ''; $('new-pw').value = ''; }
});

$('login-btn').addEventListener('click', async () => {
  if (mode.platformMode === 'federated') groupSlug = $('slug').value.trim();
  const res = await api('/login', {
    method: 'POST',
    body: JSON.stringify({ email: $('email').value, password: $('password').value }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    token = body.token;
    localStorage.setItem(tokenKey(), token);
    $('password').value = '';
    showDashboard();
  } else {
    notice($('login-notice'), 'err', body.error || 'Sign-in failed.');
  }
});
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-btn').click(); });

$('logout').addEventListener('click', () => {
  localStorage.removeItem(tokenKey());
  location.reload();
});

(async () => {
  mode = await (await fetch('/api/mode')).json();
  $('slug-field').hidden = mode.platformMode !== 'federated';

  const params = new URLSearchParams(location.search);
  const slugParam = params.get('slug');
  if (slugParam) { $('slug').value = slugParam; groupSlug = slugParam; }

  const saved = mode.platformMode === 'single' || slugParam ? localStorage.getItem(tokenKey()) : null;
  if (saved) { token = saved; showDashboard(); }
})();
