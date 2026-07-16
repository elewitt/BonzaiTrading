import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ReferralProvider } from "@jup-ag/referral-sdk";

/* ————— Jupiter Ultra referral fees — one small file per external integration —————
 * (matches hyperliquid.js / kamino.js's style). Every Ultra order can carry
 * a referralAccount + referralFee, and Jupiter routes a cut of each swap
 * into a token account owned by that referral account. Setup is a one-time,
 * real-SOL-spending on-chain action (admin-triggered, see the
 * /api/admin/jupiter-fees/* routes in index.js) — this file only wraps the
 * SDK, it never runs anything automatically.
 *
 * The referral account address is a deterministic PDA of
 * (PROJECT_PUBKEY, name) — computable synchronously via
 * getReferralAccountWithNamePubKey, confirmed against the installed SDK's
 * own .d.ts (node_modules/@jup-ag/referral-sdk/dist/index.d.ts). That means
 * no env var is needed to *reference* it later; buildOrder() just derives
 * the same pubkey every time. Whether it's actually been created on-chain
 * yet, and whether it's actually owned by our wallet, are separate
 * questions — see ensureReferralAccount below.
 */
const JUP_ULTRA_PROJECT = new PublicKey("DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc");
const REFERRAL_NAME = "bonzai-trading";

const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_URL, "confirmed");
const provider = new ReferralProvider(connection);

// Deterministic from (project, name) only — the SDK's own types confirm no
// partner argument goes into this derivation. That means claiming the name
// "bonzai-trading" is a global, first-come reservation under Jupiter's Ultra
// project, not scoped to our wallet — ensureReferralAccount() below verifies
// the account it finds is actually owned by our sponsor wallet rather than
// assuming a pre-existing account at this address is ours.
function getReferralAccountPubkey() {
  return provider.getReferralAccountWithNamePubKey({ projectPubKey: JUP_ULTRA_PROJECT, name: REFERRAL_NAME });
}

async function sendAndConfirm(tx, signer) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = signer.publicKey;
  tx.sign(signer);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

/** Idempotent: creates the referral account on-chain if it doesn't exist
 * yet, does nothing otherwise. `sponsor` is both payer and partner — the
 * sponsor wallet owns the referral account, so claimed fees are its own. */
export async function ensureReferralAccount(sponsor) {
  const referralAccountPubKey = getReferralAccountPubkey();
  const existing = await connection.getAccountInfo(referralAccountPubKey);
  if (existing) {
    // The name "bonzai-trading" is a global reservation under Jupiter's
    // Ultra project (see getReferralAccountPubkey's comment) — confirm this
    // account is actually ours before treating setup as done.
    const account = await provider.getReferralAccount(referralAccountPubKey);
    if (!account.partner.equals(sponsor.publicKey)) {
      throw new Error(
        `Referral account "${REFERRAL_NAME}" already exists but is owned by ${account.partner.toBase58()}, not the sponsor wallet — pick a different REFERRAL_NAME`
      );
    }
    return { referralAccountPubKey, created: false };
  }

  const { tx } = await provider.initializeReferralAccountWithName({
    payerPubKey: sponsor.publicKey,
    partnerPubKey: sponsor.publicKey,
    projectPubKey: JUP_ULTRA_PROJECT,
    name: REFERRAL_NAME,
  });
  const signature = await sendAndConfirm(tx, sponsor);
  return { referralAccountPubKey, created: true, signature };
}

/** Idempotent per mint: fees for a mint are only collected if this has been
 * run for it first. Cheap to call repeatedly — no-ops if already set up. */
export async function ensureTokenAccount(sponsor, mintAddress) {
  const referralAccountPubKey = getReferralAccountPubkey();
  const mint = new PublicKey(mintAddress);
  const tokenAccount = provider.getReferralTokenAccountPubKeyV2({
    referralAccountPubKey, mint, tokenProgramId: TOKEN_PROGRAM_ID,
  });
  const existing = await connection.getAccountInfo(tokenAccount);
  if (existing) return { tokenAccount, created: false };

  const { tx } = await provider.initializeReferralTokenAccountV2({
    payerPubKey: sponsor.publicKey, referralAccountPubKey, mint,
  });
  const signature = await sendAndConfirm(tx, sponsor);
  return { tokenAccount, created: true, signature };
}

/** Sweeps every accumulated fee (across all initialized mints) to the
 * sponsor wallet's own token accounts. Manual/admin-triggered — no
 * automatic schedule in v1. */
export async function claimAllFees(sponsor) {
  const referralAccountPubKey = getReferralAccountPubkey();
  const transactions = await provider.claimAllV2({ payerPubKey: sponsor.publicKey, referralAccountPubKey });
  const signatures = [];
  for (const tx of transactions) {
    tx.sign([sponsor]);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    signatures.push(sig);
  }
  return signatures;
}

export function referralAccountPubkey() {
  return getReferralAccountPubkey().toBase58();
}

/** Whether the referral account exists on-chain yet (read-only, no signing). */
export async function referralAccountExists() {
  const info = await connection.getAccountInfo(getReferralAccountPubkey());
  return !!info;
}

/** Unclaimed balance sitting in the referral-program-owned token account for
 * one mint — this is "fees waiting to be claimed," distinct from whatever
 * the sponsor wallet's own token account holds post-claim. Returns null if
 * the token account for this mint hasn't been initialized yet. */
export async function getPendingBalance(mintAddress) {
  const referralAccountPubKey = getReferralAccountPubkey();
  const mint = new PublicKey(mintAddress);
  const tokenAccount = provider.getReferralTokenAccountPubKeyV2({
    referralAccountPubKey, mint, tokenProgramId: TOKEN_PROGRAM_ID,
  });
  const info = await connection.getAccountInfo(tokenAccount);
  if (!info) return null;
  const { value } = await connection.getTokenAccountBalance(tokenAccount);
  return value.uiAmount;
}
