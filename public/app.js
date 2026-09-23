'use strict';

const $ = (id) => document.getElementById(id);
function show(id) { $(id).hidden = false; }
function notice(el, type, html) { el.innerHTML = `<div class="notice ${type}">${html}</div>`; }
function fmtSats(sats) {
  if (sats === null || sats === undefined) return ['—', ''];
  return [(sats / 1e8).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 }), 'BTC'];
}

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

function slugFromPath() {
  const m = location.pathname.match(/^\/g\/([^/]+)/);
  return m ? m[1] : null;
}

function setBrand(name) {
  $('brand').innerHTML = name ? `${name} · UB<span>IO</span>` : 'UB<span>IO</span>';
  document.title = name ? `${name} — UBIO` : 'UBIO';
}

function setBadge(mode) {
  const net = $('net');
  const label = mode.paymentRail === 'bitcoin' ? mode.network : mode.paymentRail;
  net.textContent = `${mode.platformMode} · ${label || mode.paymentRail}`;
  net.className = `net-badge${mode.network === 'mainnet' ? ' mainnet' : ''}`;
  $('net-foot').textContent = label || mode.paymentRail;
}

function wireApplyFields(mode) {
  $('field-fullName').hidden = mode.paymentRail !== 'bitcoin';
  $('field-phone').hidden = mode.paymentRail === 'bitcoin';
  $('field-btcAddress').hidden = mode.paymentRail !== 'bitcoin';
  if (mode.platformMode === 'federated') {
    $('apply-heading').textContent = 'Subscribe';
    $('apply-sub').textContent = 'The institution running this group already knows who it serves — you\'re enrolled right away, no review queue.';
    $('submit').textContent = 'Subscribe';
  }
}

function renderGroupFacts(mode, info) {
  if (mode.paymentRail === 'bitcoin') {
    show('address-row');
    $('address').textContent = info.donationAddress;
    const [amount, unit] = fmtSats(info.balanceSats);
    $('balance').textContent = amount;
    $('balance-unit').textContent = unit;
  } else {
    show('donate-row');
    $('pot-label').textContent = `Current pool balance · payout unit $${info.payoutUnit ?? 1}`;
    $('balance').textContent = info.balance != null ? `$${info.balance.toFixed(2)}` : '—';
    $('balance-unit').textContent = 'USD';
  }
}

function wireCopy() {
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('address').textContent);
      $('copy').textContent = 'Copied';
      setTimeout(() => ($('copy').textContent = 'Copy'), 1500);
    } catch {
      $('copy').textContent = 'Copy failed';
    }
  });
}

function wireDonate(donateUrl) {
  $('donate-btn').addEventListener('click', async () => {
    const amount = Number($('donate-amount').value);
    $('donate-btn').disabled = true;
    try {
      const { ok, body } = await getJson(donateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const el = $('donate-notice');
      if (!ok) return notice(el, 'err', body.error || 'Something went wrong.');
      if (body.redirectUrl) {
        notice(el, 'ok', 'Redirecting to complete your donation…');
        location.href = body.redirectUrl;
        return;
      }
      notice(el, 'ok', body.confirmed ? `Thank you! Pool balance is now $${body.balance.toFixed(2)}.` : 'Donation started.');
    } finally {
      $('donate-btn').disabled = false;
    }
  });
}

function wireSubmit(applyUrl, mode) {
  $('submit').addEventListener('click', async () => {
    const ids = mode.paymentRail === 'bitcoin' ? ['fullName', 'email', 'btcAddress', 'note'] : ['email', 'phone', 'note'];
    const payload = {};
    for (const id of ids) payload[id] = $(id).value;
    $('submit').disabled = true;
    const noticeEl = $('form-notice');
    try {
      const { ok, status, body } = await getJson(applyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (ok) {
        const msg = body.message || (mode.platformMode === 'federated'
          ? 'Enrolled. Check the console/admin for your onboarding link and login password.'
          : "Application received. We'll be in touch by email.");
        notice(noticeEl, 'ok', msg);
        ids.forEach((id) => ($(id).value = ''));
      } else if (status === 429) {
        notice(noticeEl, 'err', 'Too many submissions from your connection. Please try again later.');
      } else {
        const list = (body.errors || [body.error || 'Something went wrong.']).map((e) => `<li>${e}</li>`).join('');
        notice(noticeEl, 'err', `Please fix the following:<ul>${list}</ul>`);
      }
    } catch {
      notice(noticeEl, 'err', 'Network error. Please try again.');
    } finally {
      $('submit').disabled = false;
    }
  });
}

async function renderSingle(mode) {
  const { body: info } = await getJson('/api/info');
  setBrand(info.institutionName);
  setBadge(mode);
  show('group-view');
  show('apply-view');
  renderGroupFacts(mode, info);
  if (mode.paymentRail === 'bitcoin') wireCopy();
  else wireDonate('/api/donate');
  wireApplyFields(mode);
  wireSubmit('/api/apply', mode);
  $('me-link').href = '/me.html';
}

async function renderGroupPage(mode, slug) {
  const { ok, body: group } = await getJson(`/api/groups/${slug}`);
  setBadge(mode);
  if (!ok) {
    setBrand(null);
    show('group-view');
    $('headline').textContent = 'Group not found.';
    return;
  }
  setBrand(group.name);
  show('group-view');
  show('apply-view');
  renderGroupFacts(mode, group);
  if (mode.paymentRail === 'bitcoin') wireCopy();
  else wireDonate(`/api/groups/${slug}/donate`);
  wireApplyFields(mode);
  wireSubmit(`/api/groups/${slug}/subscribe`, mode);
  $('me-link').href = `/me.html?slug=${encodeURIComponent(slug)}`;
  $('admin-link').href = '/admin.html';
}

async function renderDirectory(mode) {
  setBrand(null);
  setBadge(mode);
  show('directory-view');
  show('create-group-view');
  $('cg-round-field').hidden = mode.paymentRail === 'bitcoin';
  $('admin-link').href = '/admin.html';
  $('me-link').href = '/me.html';

  const { body: groups } = await getJson('/api/groups');
  const list = $('group-list');
  if (!groups.length) {
    list.innerHTML = '<div class="empty">No groups yet — be the first to start one.</div>';
  } else {
    list.innerHTML = groups.map((g) => {
      const figure = mode.paymentRail === 'bitcoin'
        ? fmtSats(g.balanceSats).join(' ')
        : `$${(g.balance ?? 0).toFixed(2)}`;
      return `<a class="group-card" href="/g/${encodeURIComponent(g.slug)}">
        <div><div class="name">${g.name}</div><div class="sub">${g.description || ''} · ${g.recipientCount} recipient(s)</div></div>
        <div class="figure">${figure}</div>
      </a>`;
    }).join('');
  }

  $('cg-save').addEventListener('click', async () => {
    const payload = {
      name: $('cg-name').value,
      slug: $('cg-slug').value,
      description: $('cg-description').value,
      password: $('cg-password').value,
      roundThreshold: Number($('cg-round').value) || 1,
    };
    $('cg-save').disabled = true;
    const el = $('create-group-notice');
    try {
      const { ok, body } = await getJson('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!ok) return notice(el, 'err', body.error || 'Something went wrong.');
      localStorage.setItem(`ubio.admin.${body.group.slug}`, body.token);
      notice(el, 'ok', `Group created. <a href="/admin.html?slug=${encodeURIComponent(body.group.slug)}">Go to your admin dashboard</a>.`);
    } finally {
      $('cg-save').disabled = false;
    }
  });
}

(async () => {
  const { body: mode } = await getJson('/api/mode');
  if (mode.platformMode === 'single') {
    await renderSingle(mode);
    return;
  }
  const slug = slugFromPath();
  if (slug) await renderGroupPage(mode, slug);
  else await renderDirectory(mode);
})();
