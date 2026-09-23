'use strict';

const $ = (id) => document.getElementById(id);
function notice(el, type, msg) { el.innerHTML = `<div class="notice ${type}">${msg}</div>`; }
function fmtSats(s) { return (s === null || s === undefined) ? '—' : `${(s / 1e8).toFixed(8)} BTC`; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let mode = null; // { platformMode, paymentRail, currency }
let groupSlug = null; // federated mode only
let bearerToken = null; // federated mode only

function tokenKey(slug) { return `ubio.admin.${slug}`; }

async function api(path, opts = {}) {
  const base = mode.platformMode === 'single' ? '/admin/api' : '/api/admin';
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (mode.platformMode === 'federated' && bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  return fetch(`${base}${path}`, { ...opts, headers, credentials: 'same-origin' });
}

async function checkSession() {
  if (mode.platformMode === 'single') {
    const res = await api('/session');
    const { isAdmin } = await res.json();
    if (isAdmin) showDashboard();
    return;
  }
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug');
  if (slug) $('slug').value = slug;
  if (slug && localStorage.getItem(tokenKey(slug))) {
    groupSlug = slug;
    bearerToken = localStorage.getItem(tokenKey(slug));
    showDashboard();
  }
}

function showDashboard() {
  $('login-view').style.display = 'none';
  $('dash-view').style.display = 'grid';
  $('logout').style.display = '';
  $('applications-section').hidden = mode.platformMode !== 'single';
  $('recipients-heading').textContent = mode.platformMode === 'single' ? 'Current payees' : 'Current subscribers';
  $('ap-name-field').hidden = mode.paymentRail !== 'bitcoin';
  $('ap-phone-field').hidden = mode.paymentRail === 'bitcoin';
  $('ap-addr-field').hidden = mode.paymentRail !== 'bitcoin';
  refreshAll();
}

async function refreshAll() {
  const tasks = [renderRecipients(), renderPayments()];
  if (mode.platformMode === 'single') tasks.push(renderApplications());
  await Promise.all(tasks);
}

async function renderApplications() {
  const apps = await (await api('/applications')).json();
  const el = $('applications');
  if (!apps.length) { el.innerHTML = '<div class="empty">No pending applications.</div>'; return; }
  el.innerHTML = apps.map((a) => `
    <div class="row">
      <div class="meta">
        <div class="name">${esc(a.fullName || a.email)}</div>
        <div class="sub">${esc(a.email)}${a.btcAddress ? ' · ' + esc(a.btcAddress) : ''}${a.phone ? ' · ' + esc(a.phone) : ''}</div>
        ${a.note ? `<div class="sub" style="font-family:var(--body)">${esc(a.note)}</div>` : ''}
      </div>
      <div style="display:flex; gap:8px">
        <button class="btn-primary" data-approve="${a._id}">Approve</button>
        <button class="btn-danger" data-reject="${a._id}">Reject</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => act(`/applications/${b.dataset.approve}/approve`)));
  el.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => act(`/applications/${b.dataset.reject}/reject`)));
}

function recipientsPath() { return mode.platformMode === 'single' ? '/payees' : '/subscribers'; }

async function renderRecipients() {
  const list = await (await api(recipientsPath())).json();
  const el = $('payees');
  if (!list.length) { el.innerHTML = '<div class="empty">No recipients yet.</div>'; return; }
  el.innerHTML = list.map((p) => {
    const detail = mode.paymentRail === 'bitcoin'
      ? esc(p.btcAddress)
      : `${esc(p.phone || '')} · ${p.payoutReady ? 'payout ready' : 'onboarding pending'}`;
    const removeKey = mode.platformMode === 'single' ? p.email : p.id;
    return `<div class="row">
      <div class="meta">
        <div class="name">${esc(p.fullName || p.email)}</div>
        <div class="sub">${esc(p.email)} · ${detail}</div>
      </div>
      <button class="btn-danger" data-remove="${esc(removeKey)}">Remove</button>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Remove ${b.dataset.remove}?`)) return;
    if (mode.platformMode === 'single') {
      await api('/payees', { method: 'DELETE', body: JSON.stringify({ email: b.dataset.remove }) });
    } else {
      await api(`/subscribers/${b.dataset.remove}`, { method: 'DELETE' });
    }
    renderRecipients();
  }));
}

async function renderPayments() {
  const path = mode.platformMode === 'single' ? '/payments' : '/transactions';
  const payments = await (await api(path)).json().catch(() => []);
  const el = $('payments');
  if (!payments.length) { el.innerHTML = '<div class="empty">No payments recorded.</div>'; return; }
  el.innerHTML = payments.map((p) => {
    if (mode.paymentRail === 'bitcoin') {
      return `<div class="row">
        <div class="meta">
          <div class="name">${esc(p.cycleId)} <span class="tag">${esc(p.status)}</span></div>
          <div class="sub">${fmtSats(p.distributableSats)} to ${p.payeeCount} · fee ${p.feeSats ?? '—'} sats${p.txid ? ` · ${esc(p.txid).slice(0, 16)}…` : ''}</div>
        </div>
      </div>`;
    }
    return `<div class="row">
      <div class="meta">
        <div class="name">${esc(p.recipient || '(unknown)')} <span class="tag">${esc(p.status)}</span></div>
        <div class="sub">$${(p.amount ?? 0).toFixed(2)}${p.transferId ? ` · ${esc(p.transferId)}` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

async function act(path) { await api(path, { method: 'POST' }); refreshAll(); }

$('add-payee-toggle').addEventListener('click', () => {
  const f = $('add-payee-form');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
});
$('ap-save').addEventListener('click', async () => {
  const payload = { email: $('ap-email').value };
  if (mode.paymentRail === 'bitcoin') { payload.fullName = $('ap-name').value; payload.btcAddress = $('ap-addr').value; }
  else payload.phone = $('ap-phone').value;
  const res = await api(recipientsPath(), { method: 'POST', body: JSON.stringify(payload) });
  if (res.ok) {
    ['ap-name', 'ap-email', 'ap-phone', 'ap-addr'].forEach((id) => { if ($(id)) $(id).value = ''; });
    $('add-payee-form').style.display = 'none';
    const body = await res.json().catch(() => ({}));
    notice($('dash-notice'), 'ok', body.loginPassword
      ? `Added. Login password (share this once): <code>${esc(body.loginPassword)}</code>`
      : 'Added.');
    renderRecipients();
  } else {
    const d = await res.json().catch(() => ({}));
    notice($('dash-notice'), 'err', d.error || 'Could not add recipient.');
  }
});

$('distribute').addEventListener('click', async () => {
  if (!confirm('Run a payout cycle right now?')) return;
  $('distribute').disabled = true;
  try {
    const res = await api('/distribute', { method: 'POST' });
    const r = await res.json();
    const ok = r.ran || r.outcome === 'sent' || (r.paid ?? 0) > 0;
    const detail = mode.paymentRail === 'bitcoin'
      ? (r.outcome === 'sent' ? `txid ${esc(r.txid)}` : `${esc(r.reason || r.error || 'no payout')}`)
      : `paid ${r.paid ?? 0}, total $${((r.totalCents ?? 0) / 100).toFixed(2)}`;
    notice($('dash-notice'), ok ? 'ok' : 'err', detail);
    renderPayments();
  } finally {
    $('distribute').disabled = false;
  }
});

$('login-btn').addEventListener('click', async () => {
  if (mode.platformMode === 'single') {
    const res = await api('/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    if (res.ok) { $('password').value = ''; showDashboard(); }
    else notice($('login-notice'), 'err', 'Incorrect password.');
    return;
  }
  const slug = $('slug').value.trim();
  const res = await fetch(`/api/groups/${encodeURIComponent(slug)}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: $('password').value }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    groupSlug = slug;
    bearerToken = body.token;
    localStorage.setItem(tokenKey(slug), bearerToken);
    $('password').value = '';
    showDashboard();
  } else {
    notice($('login-notice'), 'err', body.error || 'Sign-in failed.');
  }
});
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-btn').click(); });

$('logout').addEventListener('click', async () => {
  if (mode.platformMode === 'single') await api('/logout', { method: 'POST' });
  else if (groupSlug) localStorage.removeItem(tokenKey(groupSlug));
  location.reload();
});

(async () => {
  mode = await (await fetch('/api/mode')).json();
  $('slug-field').hidden = mode.platformMode !== 'federated';
  $('login-sub').textContent = mode.platformMode === 'single'
    ? 'Enter the administrator password.'
    : 'Enter your group\'s address and admin password.';
  checkSession();
})();
