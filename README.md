# Trust Circle

A cross-border family savings circle (a *tontine*) built on Stellar.

Six siblings live in six countries and use six currencies. Every month, each of them contributes **the same value (100 USDC)** in their own currency, and a different member receives the whole pot (600 USDC), converted back into their own currency. Currency conversion happens at market rate, on-chain, at the moment of payment, so the circle stays fair no matter where each member lives.

| Member | City | Region | Currency |
|---|---|---|---|
| **You** (Freighter wallet) | Nova Lumen, Stellaria | Imaginary country | XLM (native) |
| Léa | Paris | Europe | EURC (Circle) |
| Hugo | Tokyo | Asia | GYEN (GMO Trust) |
| Inès | Sydney | Oceania | AUDD (Novatti) |
| Noah | Lagos | Africa | NGNC (Link) |
| Emma | Buenos Aires | South America | ARST (Anclap) |

All five stablecoins exist on Stellar mainnet. The demo runs on testnet with look-alike demo assets.

## How it works

```
XLM  ─┐                                          ┌─► XLM (this month's recipient)
EURC ─┤   path payment         Soroban           │   path payment
GYEN ─┤                        contract          │
AUDD ─┼─  strict receive  ─►   (holds USDC)  ────┘   strict send
NGNC ─┤   (exactly 100 USDC)
ARST ─┘
```

- **Soroban smart contract** (`contracts/trust-circle`): only deals with USDC. It checks membership, rejects double payments, waits until every member has paid, then sends the pot to the current recipient and moves to the next round (round-robin).
- **Path payments** (native to Stellar): each member converts their local currency into *exactly* 100 USDC with a `strict receive` path payment, so everyone contributes the same value. The recipient converts the pot back with a `strict send` path payment.
- **Freighter**: your card is signed in the browser. The server builds the transaction, Freighter signs it, the server submits it. Your keys never leave Freighter.
- **Simulated members**: the other five members are testnet accounts created by the setup script. The demo server signs for them so the demo runs in one click.

## Running the demo

Requirements: Rust with the `wasm32v1-none` target, the `stellar` CLI, Node 18+, and the Freighter extension set to **Testnet**.

```bash
cargo test                 # 5 contract tests
stellar contract build     # builds target/wasm32v1-none/release/trust_circle.wasm

cd demo
npm install
npm run setup              # ~2 min: accounts, demo stablecoins, FX market, contract deployment
npm start                  # → http://localhost:3000
```

The page opens on a short scroll-driven story (the problem, then Stellar). Draw a circle, or press **Skip to demo**, to reach the island: each district is a member's country, and the panel on the left drives the circle on testnet. The previous card-based page is still available at `/classic.html`.

Opened without the demo server (for example as a static file), the page falls back to a local simulation with the same FX rates, so the story and the island can be shown anywhere.

The wallet used as "You" is set in `demo/lib.mjs`. To use another one: `WALLET=G... npm run setup`.

To replay the demo from month 1 (same accounts, fresh contract), click **Restart at month 1** at the bottom of the panel, or run `npm run reset`.

### What `npm run setup` does on testnet

1. Creates and funds (friendbot) an issuer, a market maker, an admin and the five simulated members.
2. Issues demo versions of USDC, EURC, GYEN, AUDD, NGNC and ARST.
3. Opens a small FX market on the Stellar DEX (sell offers both ways for each pair, including XLM/USDC), at fixed demo rates with a 0.3% spread. Rates live in `demo/lib.mjs` (e.g. 1 USD = 3.5 XLM).
4. Deploys the Stellar Asset Contract for USDC, then deploys the Trust Circle contract.

Testnet secret keys are written to `demo/config.json`, which is git-ignored.

## Demo script (about 1 minute)

0. Before going on stage: **Skip to demo**, **Connect Freighter**, then **Activate my wallet** (one signature: USDC trustline), then **The others pay** so the five other members have already paid (their coins fly to the plaza).
1. Scroll back to the start with **Replay the story** and tell it in five beats, then draw the circle.
2. On the island, point at the panel: every contribution looks different (351 XLM, 86 EURC, 14,844 GYEN…) but each one is worth exactly 100 USDC.
3. Click **Pay in XLM · Freighter**. Freighter opens twice: XLM → USDC conversion, then the payment into the contract.
4. Click **Pay out 600 USDC**. The contract sends you 600 USDC, and Freighter opens once more to convert them back into XLM.

Every transaction in the log links to the Stellar testnet explorer.

## Project layout

- `contracts/trust-circle/src/lib.rs`: the Soroban contract
- `contracts/trust-circle/src/test.rs`: contract tests
- `demo/setup.mjs`: testnet setup
- `demo/server.mjs`: demo server (signs for simulated members, prepares transactions for your wallet)
- `demo/lib.mjs`: shared helpers, members and FX rates
- `demo/public/index.html`, `circle.js`, `circle.css`: front end (story, island, live panel), built with three.js
- `demo/public/classic.html`, `app.js`, `style.css`: the previous card-based front end
- `docs/trust_circle_pitch.pptx`: pitch deck

## Next steps

- Collateral deposit, slashed if a member skips a payment.
- One real wallet per member (Stellar Wallets Kit) instead of server-side keys.
- Real FX rates from an oracle (Reflector) and the real issuers, plus bank deposits and withdrawals through anchors (SEP-24).
