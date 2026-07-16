# Longview — MVP

Prompt-built portfolios of tokenized equities (xStocks) on Solana. Real integrations:

| Layer | Provider | How it's used |
|---|---|---|
| Auth + wallets | **Privy** | Email/Google login → embedded Solana wallet per user, no seed phrase |
| Swaps | **Jupiter Ultra API** | `GET /ultra/v1/order` → sign → `POST /ultra/v1/execute` (Jupiter handles routing, slippage, priority fees, landing) |
| Prices | **Jupiter Price API v3** | Polled every 15s for live dashboard values |
| Assets | **xStocks (Backed)** | Token-2022 SPL tokens, mints resolved + verified at runtime via Jupiter token search |
| Cash | **USDC (Solana)** | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| AI | **Anthropic API** | `claude-sonnet-4-6` parses prompts → target allocations (server-side, key never exposed) |

⚠️ **This trades real assets on Solana mainnet.** Test with small amounts first.
⚠️ **xStocks are not available to US persons** (Backed/Kraken terms). You must geo-gate
before real users touch this — see Go-live checklist.

---

## Step 1 — Prerequisites
- Node.js ≥ 20
- A **Privy** account → [dashboard.privy.io](https://dashboard.privy.io): create an app, note the **App ID**
- An **Anthropic API key** → [console.anthropic.com](https://console.anthropic.com)
- (Recommended) a dedicated **Solana RPC** URL (Helius, QuickNode, Triton) — the public RPC rate-limits hard

## Step 2 — Configure Privy
In the Privy dashboard for your app:
1. **Login methods**: enable Email and Google.
2. **Embedded wallets**: enable **Solana**, set create-on-login for users without wallets.
3. **Allowed origins**: add `http://localhost:5173`.
4. (Optional) **Funding**: enable wallet funding (Apple Pay / card via their onramp partners) so
   users can buy USDC in-app instead of transferring it.

## Step 3 — Environment
```bash
cd server && cp .env.example .env   # fill in ANTHROPIC_API_KEY, SOLANA_RPC_URL
cd ../web  && cp .env.example .env  # fill in VITE_PRIVY_APP_ID
```

## Step 4 — Install & run
```bash
# terminal 1
cd server && npm install && npm run dev    # http://localhost:8787

# terminal 2
cd web && npm install && npm run dev       # http://localhost:5173
```
Vite proxies `/api/*` to the server, so no CORS setup is needed in dev.

## Step 5 — Fund and trade
1. Sign up with email → Privy creates your Solana wallet.
2. Send USDC (Solana network) to the deposit address shown.
3. Prompt: *"Apple, Tesla, Nvidia, QQQ and SPY"* → adjust weights → **Invest**.
4. Each leg goes: Jupiter order → embedded-wallet signature → Ultra execute → Solscan link.
5. Dashboard shows live positions; the rebalance bar previews exact buy/sell legs before executing.

## Step 6 — Gas: two modes
- **Default (user pays):** the wallet needs a little SOL (~0.01) for fees. Simplest to start.
- **Sponsored (no SOL ever):** generate a fee-payer keypair, fund it with SOL, and set
  `SPONSOR_PRIVATE_KEY` (base58) in `server/.env`. The server then requests Ultra orders with
  your wallet as the integrator fee payer and co-signs each user-signed transaction before
  execution. The server refuses to co-sign any transaction whose fee payer isn't the sponsor.
  ```bash
  node -e "const{Keypair}=require('@solana/web3.js');const bs58=require('bs58');const k=Keypair.generate();console.log('pub:',k.publicKey.toBase58());console.log('SPONSOR_PRIVATE_KEY='+bs58.encode(k.secretKey))"
  ```
  Add abuse controls (per-user rate limits) before exposing this publicly — sponsored Solana
  transactions can be farmed via ATA rent refunds.

## Architecture
```
web (Vite/React) ── Privy: auth + embedded wallet + signing
   │  /api proxy
   ▼
server (Node/Express)
   ├─ /api/parse     → Anthropic (prompt → allocations JSON)
   ├─ /api/tokens    → Jupiter token search (verified xStocks mints, 24h cache)
   ├─ /api/prices    → Jupiter Price v3 proxy
   ├─ /api/holdings  → Solana RPC (Token + Token-2022 accounts)
   ├─ /api/order     → Jupiter Ultra order (+ integrator payer if sponsoring)
   └─ /api/execute   → co-sign (if sponsoring) → Jupiter Ultra execute
```
Design decisions worth knowing:
- **No hardcoded mints.** Copycat tokens with xStocks tickers exist; the registry only accepts
  exact-symbol matches whose name contains "xStock", preferring Jupiter-verified entries.
- **Sells before buys** in every rebalance, so USDC is freed up before it's spent.
- **All third-party keys live server-side.** The browser only ever talks to your server and Privy.

## Go-live checklist (the unglamorous part)
- [ ] **Geo-gating / eligibility.** xStocks exclude US persons and other restricted
      jurisdictions. Gate by IP + attestation at minimum; review Backed's prospectus and terms.
- [ ] **Regulatory posture.** Depending on flow of funds, this can look like money transmission
      or securities intermediation. If Longview never custodies funds (pure self-custody
      orchestration), your surface is smaller — but get a real opinion before launch.
- [ ] **KYC** if you add fiat onramps under your own name (Privy's funding partners carry
      their own KYC, which helps for MVP).
- [ ] Rate-limit `/api/parse` and `/api/order`; add auth (verify Privy access tokens
      server-side) so the API isn't open to the internet.
- [ ] Slippage/price-impact guardrails: surface Ultra's `priceImpactPct` and block > n%.
- [ ] Error budget: Ultra orders can expire — add retry-with-fresh-order on failure.
- [ ] Move price polling to a websocket or server-sent events if user counts grow.
