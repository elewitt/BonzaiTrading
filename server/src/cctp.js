/**
 * CCTP V2 deposit relay — server side of the "Solana burn → Circle
 * attestation → sponsor-relayed Arbitrum mint" flow (web/src/perps/funding/
 * cctp.js builds and signs the Solana burn instruction; this handles
 * everything after that, which needs no user signature at all since
 * receiveMessage() is permissionless).
 *
 * Exists as a genuinely cheaper alternative to the deBridge rail: CCTP is a
 * native 1:1 burn-and-mint with no solver/liquidity margin, so the only
 * real cost is Arbitrum gas (already sponsored) — see the comment on
 * MIN_FINALITY_THRESHOLD below for the fee/speed tradeoff this defaults to.
 */
import { relayCctpMessage } from "./arbitrumSponsor.js";
import { relayCctpMessageToSolana } from "./cctpSolanaRelay.js";

const IRIS_API_BASE = "https://iris-api.circle.com";
const CCTP_SOLANA_DOMAIN = 5;
const CCTP_ARBITRUM_DOMAIN = 3;

// In-memory only — a server restart mid-relay just means the next poll
// re-checks Circle and (if genuinely not yet relayed) tries again; if it
// WAS already relayed, MessageTransmitterV2's own nonce check makes a
// repeat attempt a harmless no-op revert, not a double-mint risk. No
// database needed for what's ultimately just a resumable cache.
const relayedByTxHash = new Map(); // solanaTxHash -> { arbTxHash, at }
const relayedByArbTxHash = new Map(); // arbTxHash -> { solanaTxSig, at }

/**
 * Polls Circle's attestation service for a Solana burn transaction and, once
 * attested, relays it to Arbitrum via the sponsor wallet. Safe to call
 * repeatedly (e.g. from client-side polling) — returns the current state
 * each time rather than assuming anything about prior calls.
 */
export async function checkAndRelayCctpDeposit(solanaTxHash) {
  const cached = relayedByTxHash.get(solanaTxHash);
  if (cached) return { status: "relayed", arbTxHash: cached.arbTxHash };

  let data;
  try {
    const r = await fetch(`${IRIS_API_BASE}/v2/messages/${CCTP_SOLANA_DOMAIN}?transactionHash=${encodeURIComponent(solanaTxHash)}`);
    data = await r.json();
  } catch (e) {
    return { status: "pending", detail: `attestation lookup failed: ${e.message}` };
  }

  const msg = data?.messages?.[0];
  if (!msg || !msg.attestation || msg.attestation === "PENDING" || !msg.message || msg.message === "0x") {
    return { status: "pending" };
  }

  try {
    const { hash } = await relayCctpMessage(msg.message, msg.attestation);
    relayedByTxHash.set(solanaTxHash, { arbTxHash: hash, at: Date.now() });
    return { status: "relayed", arbTxHash: hash };
  } catch (e) {
    console.error(`[cctp] relay failed for ${solanaTxHash}:`, e.message);
    // Attested but not yet relayed — client keeps polling and this will
    // retry on the next call. Distinct from "pending" so the UI can show
    // "attested, finishing up" rather than "still waiting on Solana".
    return { status: "attested", error: e.message };
  }
}

/**
 * Withdraw direction's mirror of checkAndRelayCctpDeposit() — polls Circle
 * for an Arbitrum burn transaction and, once attested, relays the mint to
 * Solana via the Solana sponsor wallet (see cctpSolanaRelay.js).
 * `solanaRecipient` is the user's own wallet address, needed to derive
 * their USDC associated token account as the mint destination.
 */
export async function checkAndRelayCctpWithdraw(arbTxHash, solanaRecipient) {
  const cached = relayedByArbTxHash.get(arbTxHash);
  if (cached) return { status: "relayed", solanaTxSig: cached.solanaTxSig };

  let data;
  try {
    const r = await fetch(`${IRIS_API_BASE}/v2/messages/${CCTP_ARBITRUM_DOMAIN}?transactionHash=${encodeURIComponent(arbTxHash)}`);
    data = await r.json();
  } catch (e) {
    return { status: "pending", detail: `attestation lookup failed: ${e.message}` };
  }

  const msg = data?.messages?.[0];
  if (!msg || !msg.attestation || msg.attestation === "PENDING" || !msg.message || msg.message === "0x") {
    return { status: "pending" };
  }

  try {
    const { solanaTxSig } = await relayCctpMessageToSolana({
      messageHex: msg.message, attestationHex: msg.attestation, solanaRecipient,
    });
    relayedByArbTxHash.set(arbTxHash, { solanaTxSig, at: Date.now() });
    return { status: "relayed", solanaTxSig };
  } catch (e) {
    console.error(`[cctp] withdraw relay failed for ${arbTxHash}:`, e.message);
    return { status: "attested", error: e.message };
  }
}
