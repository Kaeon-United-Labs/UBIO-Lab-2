'use strict';

function fmtSats(sats) {
  if (sats === null || sats === undefined) return ['—', ''];
  const btc = sats / 1e8;
  return [btc.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 }), 'BTC'];
}

function notice(el, type, html) {
  el.innerHTML = `<div class="notice ${type}">${html}</div>`;
}

async function loadInfo() {
  try {
    const res = await fetch('/api/info');
    const info = await res.json();

    document.getElementById('brand').innerHTML =
      info.institutionName ? `${info.institutionName} · UB<span>IO</span>` : 'UB<span>IO</span>';
    document.title = info.institutionName ? `${info.institutionName} — UBIO` : 'UBIO';

    const net = document.getElementById('net');
    net.textContent = info.network;
    net.classList.toggle('mainnet', info.network === 'mainnet');
    document.getElementById('net-foot').textContent = info.network;

    const [amount, unit] = fmtSats(info.balanceSats);
    document.getElementById('balance').textContent = amount;
    document.getElementById('balance-unit').textContent = unit;

    document.getElementById('address').textContent = info.donationAddress;
  } catch {
    document.getElementById('address').textContent = 'Unable to load service info.';
  }
}

function wireCopy() {
  const btn = document.getElementById('copy');
  btn.addEventListener('click', async () => {
    const addr = document.getElementById('address').textContent;
    try {
      await navigator.clipboard.writeText(addr);
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    } catch {
      btn.textContent = 'Copy failed';
    }
  });
}

function wireSubmit() {
  const btn = document.getElementById('submit');
  const noticeEl = document.getElementById('form-notice');
  btn.addEventListener('click', async () => {
    const payload = {
      fullName: document.getElementById('fullName').value,
      email: document.getElementById('email').value,
      btcAddress: document.getElementById('btcAddress').value,
      note: document.getElementById('note').value,
    };
    btn.disabled = true;
    try {
      const res = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        notice(noticeEl, 'ok', 'Application received. We\'ll be in touch by email.');
        ['fullName', 'email', 'btcAddress', 'note'].forEach((id) => (document.getElementById(id).value = ''));
      } else if (res.status === 429) {
        notice(noticeEl, 'err', 'Too many submissions from your connection. Please try again later.');
      } else {
        const data = await res.json().catch(() => ({}));
        const list = (data.errors || ['Something went wrong.']).map((e) => `<li>${e}</li>`).join('');
        notice(noticeEl, 'err', `Please fix the following:<ul>${list}</ul>`);
      }
    } catch {
      notice(noticeEl, 'err', 'Network error. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });
}

loadInfo();
wireCopy();
wireSubmit();
