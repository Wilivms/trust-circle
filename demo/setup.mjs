// Prépare tout le décor sur le testnet Stellar.
//
//   node setup.mjs          → comptes + stablecoins + marché des changes + contrat
//   node setup.mjs --reset  → garde les comptes, redéploie un cercle neuf
//
// Les secrets de testnet sont écrits dans demo/config.json (ignoré par git).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Keypair, Operation } from '@stellar/stellar-sdk';
import {
  CONFIG_PATH, CONTRIBUTION, FAMILY, ROOT, WALLET, WALLET_INDEX, amt, horizon, kp, loadConfig, localOf,
  saveConfig, submitClassic, usdcOf,
} from './lib.mjs';

const RESET = process.argv.includes('--reset');
const SPREAD = 0.003;          // 0,3 % de marge pour le teneur de marché
const MARKET_USD = 200_000;    // profondeur du carnet d'ordres, par paire, en USD
const MEMBER_USD = 2_000;      // argent de poche initial de chaque membre, en USD
const XLM_BOOST_ACCOUNTS = 3;  // comptes friendbot fusionnés dans le teneur de marché
const XLM_MARKET_XLM = 30_000; // XLM mis en vente contre de l'USDC
const XLM_MARKET_USD = 20_000; // USDC mis en vente contre du XLM

const log = (...a) => console.log('•', ...a);
const newAcc = () => { const k = Keypair.random(); return { public: k.publicKey(), secret: k.secret() }; };

function stellar(args) {
  return execFileSync('stellar', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function exists(pub) {
  try { await horizon.loadAccount(pub); return true; } catch { return false; }
}

async function fund(acc) {
  if (await exists(acc.public)) return;
  const r = await fetch(`https://friendbot.stellar.org/?addr=${acc.public}`);
  if (!r.ok) throw new Error(`Friendbot a refusé ${acc.public} (${r.status})`);
}

async function createWorld() {
  const cfg = {
    issuer: newAcc(),   // émet l'USDC et les 5 stablecoins de démo
    market: newAcc(),   // teneur de marché : fournit la liquidité de change
    admin: newAcc(),    // déploie le contrat
    // Le membre WALLET_INDEX est votre wallet Freighter : pas de clé secrète ici.
    members: FAMILY.map((_, i) => (i === WALLET_INDEX ? { public: WALLET, wallet: true } : newAcc())),
  };
  saveConfig(cfg);

  log('Création et financement des comptes (friendbot)…');
  for (const acc of [cfg.issuer, cfg.market, cfg.admin, ...cfg.members]) await fund(acc);

  // Le teneur de marché a besoin de beaucoup de XLM pour la paire XLM/USDC :
  // on finance des comptes temporaires puis on les fusionne dans le sien.
  log(`Réserve de XLM du teneur de marché (+${XLM_BOOST_ACCOUNTS * 10_000} XLM)…`);
  for (let k = 0; k < XLM_BOOST_ACCOUNTS; k++) {
    const tmp = newAcc();
    await fund(tmp);
    await submitClassic(kp(tmp), [Operation.accountMerge({ destination: cfg.market.public })]);
  }

  const usdc = usdcOf(cfg);
  const locals = FAMILY.map((_, i) => localOf(cfg, i));
  const issued = (a) => !a.isNative(); // le XLM ne s'émet pas et n'a pas de trustline

  log('Lignes de confiance (trustlines)…');
  await submitClassic(kp(cfg.market), [usdc, ...locals].filter(issued).map((asset) => Operation.changeTrust({ asset })));
  for (let i = 0; i < FAMILY.length; i++) {
    if (cfg.members[i].wallet) continue; // activé depuis le front, signé dans Freighter
    await submitClassic(kp(cfg.members[i]), [usdc, locals[i]].filter(issued).map((asset) => Operation.changeTrust({ asset })));
  }

  log('Émission des stablecoins de démo…');
  const pay = (destination, asset, amount) => Operation.payment({ destination, asset, amount: amt(amount) });
  await submitClassic(kp(cfg.issuer), [
    // Une offre de MARKET_USD USDC par devise : il faut en avoir pour toutes.
    pay(cfg.market.public, usdc, MARKET_USD * FAMILY.length * 2),
    ...FAMILY.flatMap((f, i) => (issued(locals[i]) ? [pay(cfg.market.public, locals[i], MARKET_USD * f.rate * 2)] : [])),
    ...FAMILY.flatMap((f, i) => (cfg.members[i].wallet || !issued(locals[i]) ? [] : [pay(cfg.members[i].public, locals[i], MEMBER_USD * f.rate)])),
  ]);

  log('Ouverture du marché des changes sur le DEX Stellar…');
  const offers = [];
  FAMILY.forEach((f, i) => {
    // Pour le XLM, la profondeur est limitée par la réserve réelle de XLM du teneur de marché.
    const usdcDepth = f.native ? XLM_MARKET_USD : MARKET_USD;
    const localDepth = f.native ? XLM_MARKET_XLM : MARKET_USD * f.rate;
    // Vend de l'USDC contre la devise locale : 1 USDC coûte rate × (1 + spread).
    offers.push(Operation.manageSellOffer({
      selling: usdc, buying: locals[i], amount: amt(usdcDepth), price: f.rate * (1 + SPREAD),
    }));
    // Vend de la devise locale contre de l'USDC : 1 unité locale coûte (1 + spread) / rate USDC.
    offers.push(Operation.manageSellOffer({
      selling: locals[i], buying: usdc, amount: amt(localDepth), price: (1 + SPREAD) / f.rate,
    }));
  });
  await submitClassic(kp(cfg.market), offers);

  log('Contrat USDC (Stellar Asset Contract)…');
  const assetId = `USDC:${cfg.issuer.public}`;
  try {
    cfg.usdcContract = stellar(['contract', 'asset', 'deploy', '--asset', assetId, '--source-account', cfg.admin.secret, '--network', 'testnet']);
  } catch {
    cfg.usdcContract = stellar(['contract', 'id', 'asset', '--asset', assetId, '--network', 'testnet']);
  }
  saveConfig(cfg);
  return cfg;
}

function deployCircle(cfg) {
  const wasm = path.join(ROOT, 'target/wasm32v1-none/release/trust_circle.wasm');
  if (!fs.existsSync(wasm)) {
    log('Compilation du contrat…');
    execFileSync('stellar', ['contract', 'build'], { cwd: ROOT, stdio: 'inherit' });
  }
  log('Déploiement du contrat Trust Circle…');
  const stroops = String(Math.round(Number(CONTRIBUTION) * 1e7));
  const out = stellar([
    'contract', 'deploy', '--wasm', wasm, '--source-account', cfg.admin.secret, '--network', 'testnet',
    '--', '--token', cfg.usdcContract,
    '--members', JSON.stringify(cfg.members.map((m) => m.public)),
    '--amount', stroops,
  ]);
  cfg.contractId = out.split('\n').pop().trim();
  saveConfig(cfg);
}

let cfg = loadConfig();
if (cfg && cfg.members?.[WALLET_INDEX]?.public !== WALLET) {
  log('Nouveau wallet détecté : on repart de zéro.');
  cfg = null;
}
if (cfg?.contractId && !RESET) {
  log(`Déjà prêt (${CONFIG_PATH}). Utilisez --reset pour repartir d'un cercle neuf.`);
  process.exit(0);
}
if (!cfg?.usdcContract) cfg = await createWorld();
deployCircle(cfg);

console.log(`\n✓ Trust Circle déployé : ${cfg.contractId}`);
console.log(`  https://stellar.expert/explorer/testnet/contract/${cfg.contractId}`);
console.log('  Lancez la démo : npm start  →  http://localhost:3000\n');
