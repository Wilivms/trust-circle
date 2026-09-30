const $ = (id) => document.getElementById(id);
const EXPLORER = 'https://stellar.expert/explorer/testnet';
const fr = window.freighterApi;

let state = null;
let busy = false;
let logEmpty = true;
let walletAddr = null;

const fmt = (n, max = 2) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: max });
const short = (g) => `${g.slice(0, 4)}…${g.slice(-4)}`;

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `Erreur ${r.status}`);
  return data;
}

function log(label, hash, cls) {
  const ol = $('log');
  if (logEmpty) { ol.innerHTML = ''; logEmpty = false; }
  const li = document.createElement('li');
  if (cls) li.className = cls;
  const span = document.createElement('span');
  span.textContent = label;
  li.append(span);
  if (hash) {
    const a = document.createElement('a');
    a.href = `${EXPLORER}/tx/${hash}`; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = `${hash.slice(0, 8)}… ↗`;
    li.append(a);
  }
  ol.prepend(li);
}

// ---------- Freighter ----------

async function connectWallet({ silent = false } = {}) {
  if (!fr) throw new Error('Extension Freighter introuvable dans ce navigateur.');
  const c = await fr.isConnected();
  if (!c.isConnected) throw new Error('Freighter n’est pas installé ou pas activé dans ce navigateur.');
  let address;
  if (silent) {
    const allowed = await fr.isAllowed();
    if (!allowed.isAllowed) return;
    address = (await fr.getAddress()).address;
    if (!address) return;
  } else {
    const r = await fr.requestAccess();
    if (r.error) throw new Error(r.error.message ?? 'Connexion refusée');
    address = r.address;
  }
  const net = await fr.getNetworkDetails();
  if (net.networkPassphrase !== state.passphrase) throw new Error('Passez Freighter sur « Testnet » (Paramètres → Réseau).');
  if (address !== state.wallet.public) {
    throw new Error(`Le compte actif dans Freighter (${short(address)}) n’est pas celui de la démo (${short(state.wallet.public)}).`);
  }
  walletAddr = address;
}

/** Prépare côté serveur → signe dans Freighter → soumet côté serveur. */
async function walletTx(action, extra = {}) {
  const built = await api('/api/wallet/build', { action, ...extra });
  const signed = await fr.signTransaction(built.xdr, { networkPassphrase: state.passphrase, address: walletAddr });
  if (signed.error) throw new Error(signed.error.message ?? 'Signature refusée dans Freighter');
  const { steps } = await api('/api/wallet/submit', { xdr: signed.signedTxXdr, kind: built.kind, label: built.label, action });
  steps.forEach((s) => log(s.label, s.hash));
}

async function walletContribute() {
  const me = state.members[state.wallet.index];
  if (me.balanceUsdc < state.contribution) await walletTx('convert'); // 1re signature : XLM → USDC
  await walletTx('contribute');                                        // 2e signature : versement au contrat
  return { steps: [] };
}

// ---------- Rendu ----------

function walletButton(m) {
  const btn = document.createElement('button');
  if (!walletAddr) {
    btn.className = 'ghost';
    btn.textContent = 'Connecter Freighter';
    btn.onclick = () => run('Connexion…', async () => { await connectWallet(); return { steps: [] }; }, btn);
  } else if (!state.wallet.ready) {
    btn.textContent = 'Activer mon wallet';
    btn.onclick = () => run('Signature…', async () => { await walletTx('activate'); return { steps: [] }; }, btn);
  } else {
    btn.className = m.paid ? 'ghost' : '';
    btn.textContent = m.paid ? 'Payé' : `Cotiser en ${m.code} · Freighter`;
    btn.disabled = busy || state.finished || m.paid;
    btn.onclick = () => run('Signez dans Freighter…', walletContribute, btn);
  }
  if (busy) btn.disabled = true;
  return btn;
}

function render() {
  const s = state;
  $('round-n').textContent = s.finished ? s.totalRounds : s.round + 1;
  $('round-total').textContent = s.totalRounds;
  const b = s.beneficiary != null ? s.members[s.beneficiary] : null;
  $('beneficiary').textContent = s.finished ? 'Cercle terminé' : `${b.name} · ${b.city}`;
  $('pot').textContent = fmt(s.pot);
  $('pot-target').textContent = fmt(s.potTarget);
  $('pot-fill').style.width = `${(s.pot / s.potTarget) * 100}%`;
  const link = $('contract-link');
  link.href = `${EXPLORER}/contract/${s.contractId}`;
  link.textContent = `${s.contractId.slice(0, 10)}…${s.contractId.slice(-6)}`;

  const wb = $('btn-wallet');
  wb.textContent = walletAddr ? `Freighter · ${short(walletAddr)}` : 'Connecter Freighter';
  wb.classList.toggle('connected', Boolean(walletAddr));

  const allPaid = s.members.every((m) => m.paid);
  const othersPaid = s.members.every((m) => m.paid || m.wallet);
  $('btn-payout').disabled = busy || s.finished || !allPaid;
  $('btn-all').disabled = busy || s.finished || othersPaid;
  $('btn-reset').disabled = busy;
  $('btn-reset').textContent = 'Recommencer au mois 1';

  $('members').innerHTML = '';
  for (const m of s.members) {
    const isBenef = m.index === s.beneficiary;
    const card = document.createElement('article');
    card.className = `card${m.paid ? ' paid' : ''}${isBenef ? ' beneficiary' : ''}`;
    const contrib = m.contributionLocal != null ? `${fmt(m.contributionLocal)} ${m.code}` : '—';
    const tags = [
      m.wallet ? `<span class="tag wallet">Votre wallet</span>` : '',
      isBenef && !s.finished ? '<span class="tag">Reçoit ce mois-ci</span>' : '',
    ].join('');
    card.innerHTML = `
      <span class="star" title="${m.paid ? 'A cotisé' : 'Pas encore cotisé'}"></span>
      <div>
        <h3>${m.name}</h3>
        <p class="where">${m.city} · ${m.wallet ? m.country : m.continent}</p>
        ${m.wallet ? `<p class="addr">${short(m.public)}</p>` : ''}
      </div>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      <dl>
        <div><dt>Cotisation · ${fmt(s.contribution)} USDC</dt><dd>${contrib}</dd></div>
        <div><dt>Solde</dt><dd>${fmt(m.balanceLocal)} <span class="code">${m.code}</span></dd></div>
      </dl>
      <p class="status">${m.paid ? '✓ A cotisé ce mois-ci' : 'En attente'}</p>
    `;
    if (m.wallet) {
      card.append(walletButton(m));
    } else {
      const btn = document.createElement('button');
      btn.className = 'ghost';
      btn.textContent = m.paid ? 'Payé' : `Cotiser en ${m.code}`;
      btn.disabled = busy || s.finished || m.paid;
      btn.onclick = () => run(`${m.name} cotise…`, () => api('/api/contribute', { index: m.index }), btn);
      card.append(btn);
    }
    $('members').append(card);
  }
}

async function refresh() {
  try {
    state = await api('/api/state');
    render();
  } catch (e) {
    log(`Impossible de lire l’état : ${e.message}`, null, 'error');
  }
}

async function run(label, fn, button) {
  if (busy) return;
  busy = true;
  render();
  if (button) { button.disabled = true; button.innerHTML = `<span class="spinner"></span>${label}`; }
  try {
    const { steps = [], walletConvert } = (await fn()) ?? {};
    for (const st of steps) log(st.label, st.hash);
    // La cagnotte vient d'arriver sur votre wallet : vous la reconvertissez en XLM.
    if (walletConvert) {
      if (!walletAddr) await connectWallet();
      await walletTx('receive', { amount: walletConvert });
    }
  } catch (e) {
    log(e.message, null, 'error');
  } finally {
    busy = false;
    await refresh();
  }
}

$('btn-wallet').onclick = (e) => run('Connexion…', async () => { await connectWallet(); return {}; }, e.currentTarget);
$('btn-all').onclick = (e) => run('Cotisations…', () => api('/api/contribute-all', {}), e.currentTarget);
$('btn-payout').onclick = (e) => run('Versement…', () => api('/api/payout', {}), e.currentTarget);
$('btn-reset').onclick = (e) => run('Redéploiement…', async () => {
  const r = await api('/api/reset', {});
  $('log').innerHTML = ''; logEmpty = false;
  return r;
}, e.currentTarget);

await refresh();
if (state) connectWallet({ silent: true }).then(render).catch(() => {});
setInterval(() => { if (!busy) refresh(); }, 15000);
