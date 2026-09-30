// Outils partagés par setup.mjs et server.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Address, Asset, BASE_FEE, Contract, Horizon, Keypair, Networks, Operation,
  TransactionBuilder, rpc, scValToNative,
} from '@stellar/stellar-sdk';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const CONFIG_PATH = path.join(HERE, 'config.json');

export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const PASSPHRASE = Networks.TESTNET;
export const horizon = new Horizon.Server(HORIZON_URL);
export const soroban = new rpc.Server(RPC_URL);

/** Cotisation par membre et par mois, en USDC. */
export const CONTRIBUTION = '100';

/**
 * La famille : 6 frères et sœurs. Vous (wallet Freighter, pays imaginaire, en XLM),
 * puis 5 continents avec 5 stablecoins qui existent sur Stellar (EURC, GYEN, AUDD,
 * NGNC, ARST). Sur le testnet on émet nos propres versions de démo de ces
 * stablecoins ; les taux sont fixés ici (unités locales pour 1 USD).
 * L'ordre du tableau = l'ordre de rotation de la cagnotte.
 */
export const FAMILY = [
  { name: 'Vous', city: 'Nova Lumen',   country: 'Stellaria', continent: 'Pays imaginaire', code: 'XLM',  currency: 'lumen', symbol: 'XLM', rate: 3.5, native: true },
  { name: 'Léa',  city: 'Paris',        country: 'France',    continent: 'Europe',          code: 'EURC', currency: 'euro',             symbol: '€',  rate: 0.86 },
  { name: 'Hugo', city: 'Tokyo',        country: 'Japon',     continent: 'Asie',            code: 'GYEN', currency: 'yen',              symbol: '¥',  rate: 148 },
  { name: 'Inès', city: 'Sydney',       country: 'Australie', continent: 'Océanie',         code: 'AUDD', currency: 'dollar australien', symbol: 'A$', rate: 1.52 },
  { name: 'Noah', city: 'Lagos',        country: 'Nigeria',   continent: 'Afrique',         code: 'NGNC', currency: 'naira',            symbol: '₦',  rate: 1530 },
  { name: 'Emma', city: 'Buenos Aires', country: 'Argentine', continent: 'Amérique du Sud', code: 'ARST', currency: 'peso argentin',    symbol: '$',  rate: 1380 },
];

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}
export function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export const usdcOf = (cfg) => new Asset('USDC', cfg.issuer.public);
export const localOf = (cfg, i) => (FAMILY[i].native ? Asset.native() : new Asset(FAMILY[i].code, cfg.issuer.public));
export const kp = (acc) => Keypair.fromSecret(acc.secret);

/** Montant Stellar : 7 décimales max. */
export const amt = (x) => Number(x).toFixed(7);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Construit une transaction classique non signée ayant `sourcePub` pour source. */
export async function buildClassic(sourcePub, ops) {
  const account = await horizon.loadAccount(sourcePub);
  let b = new TransactionBuilder(account, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: PASSPHRASE });
  for (const op of ops) b = b.addOperation(op);
  return b.setTimeout(300).build();
}

/** Envoie une transaction classique déjà signée (objet ou XDR) à Horizon. */
export async function submitSignedClassic(txOrXdr) {
  const tx = typeof txOrXdr === 'string' ? TransactionBuilder.fromXDR(txOrXdr, PASSPHRASE) : txOrXdr;
  try {
    const res = await horizon.submitTransaction(tx);
    return res.hash;
  } catch (e) {
    const codes = e?.response?.data?.extras?.result_codes;
    throw new Error(`Transaction refusée : ${JSON.stringify(codes ?? e.message)}`);
  }
}

/** Soumet une transaction classique signée par `signer` (clé côté serveur). */
export async function submitClassic(signer, ops) {
  const tx = await buildClassic(signer.publicKey(), ops);
  tx.sign(signer);
  return submitSignedClassic(tx);
}

const CONTRACT_ERRORS = {
  1: "ce compte n'est pas membre de la tontine",
  2: 'ce membre a déjà cotisé ce mois-ci',
  3: "tout le monde n'a pas encore cotisé",
  4: 'la tontine est terminée',
};
function explain(msg) {
  const m = /Error\(Contract, #(\d+)\)/.exec(msg);
  return m ? CONTRACT_ERRORS[m[1]] ?? msg : msg;
}

/** Prépare (simulation + ressources) un appel de contrat non signé ayant `sourcePub` pour source. */
export async function prepareInvoke(cfg, sourcePub, method, ...args) {
  const contract = new Contract(cfg.contractId);
  const account = await soroban.getAccount(sourcePub);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();
  try {
    return await soroban.prepareTransaction(tx);
  } catch (e) {
    throw new Error(explain(String(e?.message ?? e)));
  }
}

/** Appelle une fonction du contrat, signée côté serveur, et attend le résultat. */
export async function invoke(cfg, signer, method, ...args) {
  const tx = await prepareInvoke(cfg, signer.publicKey(), method, ...args);
  tx.sign(signer);
  return sendSoroban(tx);
}

/** Envoie une transaction Soroban signée (objet ou XDR) et attend sa confirmation. */
export async function sendSoroban(txOrXdr) {
  const tx = typeof txOrXdr === 'string' ? TransactionBuilder.fromXDR(txOrXdr, PASSPHRASE) : txOrXdr;
  const sent = await soroban.sendTransaction(tx);
  if (sent.status === 'ERROR') throw new Error(`Envoi refusé : ${sent.errorResult?.result().switch().name ?? 'erreur'}`);
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const r = await soroban.getTransaction(sent.hash);
    if (r.status === 'SUCCESS') return { hash: sent.hash, value: r.returnValue ? scValToNative(r.returnValue) : null };
    if (r.status === 'FAILED') throw new Error(`Transaction ${sent.hash} échouée`);
  }
  throw new Error(`Transaction ${sent.hash} : pas de confirmation après 30 s`);
}

/** Lecture seule : simule l'appel sans rien envoyer. */
export async function read(cfg, method, ...args) {
  const contract = new Contract(cfg.contractId);
  const account = await soroban.getAccount(cfg.admin.public);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await soroban.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(explain(sim.error));
  return scValToNative(sim.result.retval);
}

export const addr = (g) => new Address(g).toScVal();

const toAsset = (p) => (p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code, p.asset_issuer));

/** Combien de devise locale faut-il pour obtenir exactement `usdc` USDC ? */
export async function quoteToUsdc(cfg, i, usdc = CONTRIBUTION) {
  const { records } = await horizon.strictReceivePaths([localOf(cfg, i)], usdcOf(cfg), amt(usdc)).call();
  if (!records.length) return null;
  const best = records.reduce((a, b) => (Number(a.source_amount) <= Number(b.source_amount) ? a : b));
  return { amount: Number(best.source_amount), path: best.path.map(toAsset) };
}

/** Combien de devise locale obtient-on en envoyant `usdc` USDC ? */
export async function quoteFromUsdc(cfg, i, usdc) {
  const { records } = await horizon.strictSendPaths(usdcOf(cfg), amt(usdc), [localOf(cfg, i)]).call();
  if (!records.length) return null;
  const best = records.reduce((a, b) => (Number(a.destination_amount) >= Number(b.destination_amount) ? a : b));
  return { amount: Number(best.destination_amount), path: best.path.map(toAsset) };
}

/** Opération : convertir la devise locale du membre i en exactement `usdc` USDC (path payment vers soi). */
export async function toUsdcOp(cfg, i, usdc = CONTRIBUTION) {
  const q = await quoteToUsdc(cfg, i, usdc);
  if (!q) throw new Error(`Pas de liquidité ${FAMILY[i].code} → USDC`);
  const me = cfg.members[i].public;
  const op = Operation.pathPaymentStrictReceive({
    sendAsset: localOf(cfg, i), sendMax: amt(q.amount * 1.01),
    destination: me, destAsset: usdcOf(cfg), destAmount: amt(usdc), path: q.path,
  });
  return { op, spent: q.amount };
}

/** Opération : convertir `usdc` USDC du membre i dans sa devise locale. */
export async function fromUsdcOp(cfg, i, usdc) {
  const q = await quoteFromUsdc(cfg, i, usdc);
  if (!q) throw new Error(`Pas de liquidité USDC → ${FAMILY[i].code}`);
  const me = cfg.members[i].public;
  const op = Operation.pathPaymentStrictSend({
    sendAsset: usdcOf(cfg), sendAmount: amt(usdc),
    destination: me, destAsset: localOf(cfg, i), destMin: amt(q.amount * 0.99), path: q.path,
  });
  return { op, received: q.amount };
}

export async function convertToUsdc(cfg, i, usdc = CONTRIBUTION) {
  const { op, spent } = await toUsdcOp(cfg, i, usdc);
  return { hash: await submitClassic(kp(cfg.members[i]), [op]), spent };
}

export async function convertFromUsdc(cfg, i, usdc) {
  const { op, received } = await fromUsdcOp(cfg, i, usdc);
  return { hash: await submitClassic(kp(cfg.members[i]), [op]), received };
}

/**
 * Wallet Freighter de démo : c'est le membre « Vous » (index 0), qui cotise en XLM.
 * Changer d'adresse : WALLET=G... npm run setup
 */
export const WALLET = process.env.WALLET ?? 'GB2WNOBSNTZO7IWXPZGHUHSEHOFBDMW65XCSD7TKA3CFTYPX6HAAD4OV';
export const WALLET_INDEX = 0;

/** Soldes d'un compte : { CODE: nombre } pour les actifs de notre émetteur. */
export async function balances(cfg, pub) {
  const acc = await horizon.loadAccount(pub);
  const out = {};
  for (const b of acc.balances) {
    if (b.asset_type === 'native') out.XLM = Number(b.balance);
    else if (b.asset_issuer === cfg.issuer.public) out[b.asset_code] = Number(b.balance);
  }
  return out;
}
