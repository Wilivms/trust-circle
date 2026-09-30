// Serveur de démo : sert le front et pilote les comptes de testnet.
// - Les 4 membres « simulés » sont signés ici (clés de testnet, jamais envoyées au navigateur).
// - Le membre relié à Freighter signe lui-même : le serveur prépare la transaction (XDR),
//   le navigateur la fait signer par Freighter, puis le serveur la soumet.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { Operation } from '@stellar/stellar-sdk';
import {
  CONTRIBUTION, FAMILY, HERE, PASSPHRASE, WALLET_INDEX, addr, balances, buildClassic, convertFromUsdc,
  convertToUsdc, fromUsdcOp, horizon, invoke, kp, loadConfig, localOf, prepareInvoke, quoteToUsdc, read,
  ROOT, saveConfig, sendSoroban, submitClassic, submitSignedClassic, toUsdcOp, usdcOf,
} from './lib.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const cfg = loadConfig();
if (!cfg?.contractId) {
  console.error('Pas de tontine déployée : lancez d’abord `npm run setup`.');
  process.exit(1);
}

const USDC = (stroops) => Number(stroops) / 1e7;
const indexOf = (pub) => cfg.members.findIndex((m) => m.public === pub);
const isWallet = (i) => Boolean(cfg.members[i]?.wallet);
const walletPub = cfg.members[WALLET_INDEX].public;

/** Le wallet a-t-il ses trustlines USDC + devise locale ? */
async function walletReady() {
  const acc = await horizon.loadAccount(walletPub);
  const has = (code) => acc.balances.some((b) => b.asset_code === code && b.asset_issuer === cfg.issuer.public);
  return has('USDC') && (FAMILY[WALLET_INDEX].native || has(FAMILY[WALLET_INDEX].code));
}

async function state() {
  const s = await read(cfg, 'get_state');
  const members = await Promise.all(FAMILY.map(async (f, i) => {
    const pub = cfg.members[i].public;
    const [bal, quote] = await Promise.all([balances(cfg, pub), quoteToUsdc(cfg, i).catch(() => null)]);
    return {
      ...f, index: i, public: pub, wallet: isWallet(i),
      paid: s.paid.includes(pub),
      balanceLocal: bal[f.code] ?? 0,
      balanceUsdc: bal.USDC ?? 0,
      contributionLocal: quote?.amount ?? null,
    };
  }));
  return {
    contractId: cfg.contractId,
    passphrase: PASSPHRASE,
    wallet: { index: WALLET_INDEX, public: walletPub, ready: await walletReady() },
    contribution: USDC(s.amount),
    round: s.round,
    totalRounds: s.total_rounds,
    pot: USDC(s.pot),
    potTarget: USDC(s.amount) * s.total_rounds,
    beneficiary: s.beneficiary ? indexOf(s.beneficiary) : null,
    finished: s.finished,
    members,
  };
}

// ---------- Membres simulés (signés côté serveur) ----------

async function contribute(i) {
  if (isWallet(i)) throw new Error('Ce membre signe avec Freighter.');
  const f = FAMILY[i];
  const steps = [];
  const bal = await balances(cfg, cfg.members[i].public);
  if ((bal.USDC ?? 0) < Number(CONTRIBUTION)) {
    const conv = await convertToUsdc(cfg, i);
    steps.push({ label: `${f.name} convertit ${conv.spent.toFixed(2)} ${f.code} en ${CONTRIBUTION} USDC`, hash: conv.hash });
  }
  const call = await invoke(cfg, kp(cfg.members[i]), 'contribute', addr(cfg.members[i].public));
  steps.push({ label: `${f.name} verse ${CONTRIBUTION} USDC dans la tontine`, hash: call.hash });
  return steps;
}

async function contributeAll() {
  const s = await read(cfg, 'get_state');
  const steps = [];
  for (let i = 0; i < FAMILY.length; i++) {
    if (isWallet(i) || s.paid.includes(cfg.members[i].public)) continue;
    steps.push(...(await contribute(i)));
  }
  return steps;
}

/** Le contrat verse la cagnotte. Si le bénéficiaire est le wallet, il reconvertira lui-même. */
async function payout() {
  const s = await read(cfg, 'get_state');
  const call = await invoke(cfg, kp(cfg.admin), 'payout');
  const i = indexOf(call.value);
  const f = FAMILY[i];
  const pot = USDC(s.amount) * s.total_rounds;
  const steps = [{ label: `La tontine verse ${pot} USDC à ${f.name} (${f.city})`, hash: call.hash }];
  if (isWallet(i)) return { steps, walletConvert: pot };
  const conv = await convertFromUsdc(cfg, i, pot);
  steps.push({ label: `${f.name} reçoit ${conv.received.toFixed(2)} ${f.code}`, hash: conv.hash });
  return { steps };
}

/** Redéploie une tontine neuve (mêmes comptes) : la démo repart du mois 1. */
async function reset() {
  const wasm = path.join(ROOT, 'target/wasm32v1-none/release/tontine.wasm');
  const { stdout } = await promisify(execFile)('stellar', [
    'contract', 'deploy', '--wasm', wasm, '--source-account', cfg.admin.secret, '--network', 'testnet',
    '--', '--token', cfg.usdcContract,
    '--members', JSON.stringify(cfg.members.map((m) => m.public)),
    '--amount', String(Math.round(Number(CONTRIBUTION) * 1e7)),
  ], { cwd: ROOT });
  cfg.contractId = stdout.trim().split('\n').pop().trim();
  saveConfig(cfg);
  return [{ label: 'Nouveau cercle déployé : retour au mois 1', hash: null }];
}

// ---------- Wallet Freighter : préparer → (signature navigateur) → soumettre ----------

const W = FAMILY[WALLET_INDEX];

/** Construit la transaction non signée demandée par le front. */
async function walletBuild(action, body) {
  switch (action) {
    case 'activate': {
      const assets = [usdcOf(cfg), localOf(cfg, WALLET_INDEX)].filter((a) => !a.isNative());
      const tx = await buildClassic(walletPub, assets.map((asset) => Operation.changeTrust({ asset })));
      return { xdr: tx.toXDR(), kind: 'classic', label: `Activation du wallet : ligne de confiance ${assets.map((a) => a.code).join(' + ')}` };
    }
    case 'convert': {
      const { op, spent } = await toUsdcOp(cfg, WALLET_INDEX);
      const tx = await buildClassic(walletPub, [op]);
      return { xdr: tx.toXDR(), kind: 'classic', label: `Vous convertissez ${spent.toFixed(2)} ${W.code} en ${CONTRIBUTION} USDC` };
    }
    case 'contribute': {
      const tx = await prepareInvoke(cfg, walletPub, 'contribute', addr(walletPub));
      return { xdr: tx.toXDR(), kind: 'soroban', label: `Vous versez ${CONTRIBUTION} USDC dans la tontine` };
    }
    case 'receive': {
      const usdc = Number(body.amount);
      if (!(usdc > 0)) throw new Error('Montant invalide');
      const { op, received } = await fromUsdcOp(cfg, WALLET_INDEX, usdc);
      const tx = await buildClassic(walletPub, [op]);
      return { xdr: tx.toXDR(), kind: 'classic', label: `Vous convertissez ${usdc} USDC en ${received.toFixed(2)} ${W.code}` };
    }
    default:
      throw new Error('Action inconnue');
  }
}

/** Soumet la transaction signée par Freighter (+ suite côté serveur si besoin). */
async function walletSubmit({ xdr, kind, label, action }) {
  const hash = kind === 'soroban' ? (await sendSoroban(xdr)).hash : await submitSignedClassic(xdr);
  const steps = [{ label, hash }];
  if (action === 'activate' && cfg.walletFunding) {
    // Si le wallet cotise dans un stablecoin de démo, l'émetteur le crédite comme les autres.
    const h = await submitClassic(kp(cfg.issuer), [
      Operation.payment({ destination: walletPub, asset: localOf(cfg, WALLET_INDEX), amount: cfg.walletFunding }),
    ]);
    steps.push({ label: `Vous recevez ${Number(cfg.walletFunding).toLocaleString('fr-FR')} ${W.code} de démo`, hash: h });
  }
  return { steps };
}

// ---------- HTTP ----------
const PUBLIC = path.join(HERE, 'public');
const VENDOR = { '/vendor/freighter-api.js': path.join(HERE, 'node_modules/@stellar/freighter-api/build/index.min.js') };
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

let busy = false; // une action serveur à la fois

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/state') return send(res, 200, await state());

    if (req.method === 'POST' && url.pathname.startsWith('/api/wallet/')) {
      const body = await readBody(req);
      if (url.pathname === '/api/wallet/build') return send(res, 200, await walletBuild(body.action, body));
      if (url.pathname === '/api/wallet/submit') return send(res, 200, await walletSubmit(body));
      return send(res, 404, { error: 'Route inconnue' });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (busy) return send(res, 409, { error: 'Une opération est déjà en cours.' });
      busy = true;
      try {
        const body = await readBody(req);
        if (url.pathname === '/api/contribute') {
          const i = Number(body.index);
          if (!(i >= 0 && i < FAMILY.length)) return send(res, 400, { error: 'Membre inconnu' });
          return send(res, 200, { steps: await contribute(i) });
        }
        if (url.pathname === '/api/contribute-all') return send(res, 200, { steps: await contributeAll() });
        if (url.pathname === '/api/payout') return send(res, 200, await payout());
        if (url.pathname === '/api/reset') return send(res, 200, { steps: await reset() });
        return send(res, 404, { error: 'Route inconnue' });
      } finally {
        busy = false;
      }
    }

    const file = VENDOR[url.pathname] ?? path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!(VENDOR[url.pathname] || file.startsWith(PUBLIC)) || !fs.existsSync(file)) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => {
  console.log(`\nTrust Circle → http://localhost:${PORT}`);
  console.log(`Wallet Freighter (membre ${W.name}) : ${walletPub}`);
  console.log(`Contrat : https://stellar.expert/explorer/testnet/contract/${cfg.contractId}\n`);
});
