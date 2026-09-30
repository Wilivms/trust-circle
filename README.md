# Tontine Monde

Tontine familiale multi-devises sur Stellar. Six frères et sœurs : **vous**, dans un pays imaginaire, qui cotisez en **XLM** avec votre wallet Freighter, et cinq membres sur cinq continents, chacun avec un stablecoin qui existe vraiment sur Stellar :

| Membre | Ville | Continent | Monnaie |
|---|---|---|---|
| **Vous** (Freighter) | Nova Lumen, Stellaria | Pays imaginaire | XLM (natif) |
| Léa | Paris | Europe | EURC (Circle) |
| Hugo | Tokyo | Asie | GYEN (GMO Trust) |
| Inès | Sydney | Océanie | AUDD (Novatti) |
| Noah | Lagos | Afrique | NGNC (Link) |
| Emma | Buenos Aires | Amérique du Sud | ARST (Anclap) |

Chaque mois, chacun verse **l'équivalent de 100 USDC** dans sa monnaie ; un membre différent reçoit les 600 USDC, reconvertis dans sa devise. Vous êtes premier dans la rotation : vous recevez la cagnotte dès le mois 1.

## Comment ça marche

```
XLM  ─┐                                     ┌─► XLM (bénéficiaire du mois)
EURC ─┤  path payment        contrat        │   path payment
GYEN ─┤
AUDD ─┼─ strict receive ─► Soroban (USDC) ──┘   strict send
NGNC ─┤  (exactement 100 USDC)
ARST ─┘
```

- **Contrat Soroban** (`contracts/tontine`) : ne manipule que de l'USDC. Il vérifie les membres, empêche les doubles paiements, attend que tout le monde ait payé, puis verse la cagnotte au bénéficiaire du tour (rotation).
- **Path payments** (natifs Stellar) : conversion au taux du marché au moment du paiement. `strict receive` garantit que chacun verse **exactement** 100 USDC, quelle que soit sa devise.
- **Testnet** : `setup.mjs` émet des versions de démo de l'USDC et des 5 stablecoins, et ouvre un petit marché des changes sur le DEX, XLM/USDC compris (taux fixés dans `demo/lib.mjs`, marge de 0,3 % ; 1 USD = 3,5 XLM pour la démo).
- **Freighter** : pour votre carte, le serveur prépare la transaction, Freighter la signe dans le navigateur, le serveur l'envoie. Aucune clé de votre wallet ne quitte Freighter.

## Lancer la démo

Prérequis : l'environnement du workshop (Rust + `wasm32v1-none` + `stellar` CLI), Node 18+, et l'extension Freighter réglée sur **Testnet** avec le compte `GB2W…D4OV` (un peu de XLM de faucet suffit). Autre wallet : `WALLET=G... npm run setup`.

```bash
cd tontine-monde
cargo test                 # 5 tests du contrat
stellar contract build     # compile le .wasm

cd demo
npm install
npm run setup              # ~2 min : comptes, stablecoins, marché, déploiement
npm start                  # → http://localhost:3000
```

Pour rejouer la démo depuis le mois 1 (mêmes comptes, nouvelle tontine) : `npm run reset`.

## Scénario de démo (1 minute)

0. Avant de passer : **Connecter Freighter** puis **Activer mon wallet** (1 signature : ligne de confiance USDC).
1. Montrer les 6 cartes : la cotisation affichée est différente dans chaque devise (351 XLM, 86 EURC, 14 844 GYEN…), mais vaut toujours 100 USDC.
2. **Les autres cotisent** → 10 transactions dans le journal (conversions + versements), liens vers l'explorateur.
3. Sur votre carte, **Cotiser en XLM** → Freighter s'ouvre deux fois : conversion XLM → USDC, puis versement au contrat.
4. **Verser la cagnotte** → le contrat vous verse 600 USDC, Freighter s'ouvre pour les reconvertir en XLM.

## Fichiers

- `contracts/tontine/src/lib.rs` : le contrat
- `contracts/tontine/src/test.rs` : les tests
- `demo/setup.mjs` : prépare le testnet (écrit `demo/config.json`, qui contient des clés de **testnet** uniquement)
- `demo/server.mjs` : petit serveur qui signe pour les 5 membres simulés et prépare les transactions de votre wallet
- `demo/public/` : le front

## Pour le hackathon

- Dépôt de garantie confisqué en cas de défaut de paiement.
- Un wallet par membre (Stellar Wallets Kit) au lieu des clés côté serveur.
- Taux de change réels via un oracle (Reflector) ou via les vrais émetteurs/anchors (SEP-24 pour le retrait en banque).
