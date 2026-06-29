'use strict';

const $ = (id) => document.getElementById(id);
function notice(el, type, msg) { el.innerHTML = `<div class="notice ${type}">${msg}</div>`; }
function fmtSats(s) { return (s === null || s === undefined) ? '—' : `${(s / 1e8).toFixed(8)} BTC`; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function api(path, opts = {}) {
  const res = await fetch(`/admin/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res;
}

async function checkSession() {
  const res = await api('/session');
  const { isAdmin } = await res.json();
  if (isAdmin) showDashboard();
}

function showDashboard() {
  $('login-view').style.display = 'none';
  $('dash-view').style.display = 'grid';
  $('logout').style.display = '';
  refreshAll();
}

// --- Auth ---
$('login-btn').addEventListener('click', async () => {
  const res = await api('/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
  if (res.ok) { $('password').value = ''; showDashboard(); }
  else notice($('login-notice'), 'err', 'Incorrect password.');
});
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-btn').click(); });
$('logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }); location.reload(); });

// --- Render ---
async function refreshAll() { await Promise.all([renderApplications(), renderPayees(), renderPayments()]); }

async function renderApplications() {
  const apps = await (await api('/applications')).json();
  const el = $('applications');
  if (!apps.length) { el.innerHTML = '<div class="empty">No pending applications.</div>'; return; }
  el.innerHTML = apps.map((a) => `
    <div class="row">
      <div class="meta">
        <div class="name">${esc(a.fullName)}</div>
        <div class="sub">${esc(a.email)} · ${esc(a.btcAddress)}</div>
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

async function renderPayees() {
  const payees = await (await api('/payees')).json();
  const el = $('payees');
  if (!payees.length) { el.innerHTML = '<div class="empty">No payees yet.</div>'; return; }
  el.innerHTML = payees.map((p) => `
    <div class="row">
      <div class="meta">
        <div class="name">${esc(p.fullName)}</div>
        <div class="sub">${esc(p.email)} · ${esc(p.btcAddress)}</div>
      </div>
      <button class="btn-danger" data-remove="${esc(p.email)}">Remove</button>
    </div>`).join('');
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Remove ${b.dataset.remove}?`)) return;
    await api('/payees', { method: 'DELETE', body: JSON.stringify({ email: b.dataset.remove }) });
    renderPayees();
  }));
}

async function renderPayments() {
  const payments = await (await api('/payments')).json();
  const el = $('payments');
  if (!payments.length) { el.innerHTML = '<div class="empty">No payments recorded.</div>'; return; }
  el.innerHTML = payments.map((p) => `
    <div class="row">
      <div class="meta">
        <div class="name">${esc(p.cycleId)} <span class="tag">${esc(p.status)}</span></div>
        <div class="sub">${fmtSats(p.distributableSats)} to ${p.payeeCount} · fee ${p.feeSats ?? '—'} sats${p.txid ? ` · ${esc(p.txid).slice(0, 16)}…` : ''}</div>
      </div>
    </div>`).join('');
}

async function act(path) { await api(path, { method: 'POST' }); refreshAll(); }

// --- Add payee directly ---
$('add-payee-toggle').addEventListener('click', () => {
  const f = $('add-payee-form');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
});
$('ap-save').addEventListener('click', async () => {
  const res = await api('/payees', { method: 'POST', body: JSON.stringify({
    fullName: $('ap-name').value, email: $('ap-email').value, btcAddress: $('ap-addr').value,
  }) });
  if (res.ok) {
    ['ap-name', 'ap-email', 'ap-addr'].forEach((id) => ($(id).value = ''));
    $('add-payee-form').style.display = 'none';
    notice($('dash-notice'), 'ok', 'Payee added.');
    renderPayees();
  } else {
    const d = await res.json().catch(() => ({}));
    notice($('dash-notice'), 'err', d.error || 'Could not add payee.');
  }
});

// --- Manual distribution ---
$('distribute').addEventListener('click', async () => {
  if (!confirm('Distribute the entire pool to all current payees now?')) return;
  $('distribute').disabled = true;
  try {
    const res = await api('/distribute', { method: 'POST' });
    const r = await res.json();
    const ok = r.outcome === 'sent';
    notice($('dash-notice'), ok ? 'ok' : 'err',
      ok ? `Sent. txid ${esc(r.txid)}` : `No payout: ${esc(r.reason || r.error || 'unknown')}`);
    renderPayments();
  } finally {
    $('distribute').disabled = false;
  }
});

checkSession();
