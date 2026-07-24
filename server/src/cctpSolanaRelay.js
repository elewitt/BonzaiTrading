/**
 * Solana-side CCTP V2 relay for the withdraw direction: once a user burns
 * USDC on Arbitrum (see cctp.js) and Circle attests the message, this mints
 * it into their Solana USDC account via MessageTransmitterV2.receiveMessage
 * — permissionless, so the Solana sponsor wallet pays gas and relays it
 * without needing the user's own signature. Mirrors arbitrumSponsor.js's
 * relayCctpMessage() for the deposit direction, on the other chain.
 *
 * Every address/PDA/account here is copied verbatim from Circle's own
 * official reference implementation (circlefin/solana-cctp-contracts,
 * examples/v2/solana.ts's receiveMessageSol), the same source verified
 * against for the deposit-direction burn instruction — see
 * web/src/perps/funding/cctp/burnInstruction.js's file header for how that
 * was cross-checked. Getting any of this wrong mints to the wrong place or
 * fails outright, not a fund-loss risk to us (the burn already happened,
 * this only routes an already-burned amount) but a real risk of a
 * customer's withdrawal getting stuck.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGE_TRANSMITTER_V2_IDL = JSON.parse(readFileSync(join(__dirname, "cctp/message_transmitter_v2_idl.json"), "utf8"));
const TOKEN_MESSENGER_MINTER_V2_IDL = JSON.parse(readFileSync(join(__dirname, "cctp/token_messenger_minter_v2_idl.json"), "utf8"));

const MESSAGE_TRANSMITTER_V2_PROGRAM_ID = new PublicKey("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
const TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID = new PublicKey("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");
const SOLANA_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const CCTP_ARBITRUM_DOMAIN = 3;

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_URL, "confirmed");
const sponsorKeypair = process.env.SPONSOR_PRIVATE_KEY
  ? Keypair.fromSecretKey(bs58.decode(process.env.SPONSOR_PRIVATE_KEY))
  : null;

if (!sponsorKeypair) {
  console.warn("[cctpSolanaRelay] SPONSOR_PRIVATE_KEY not set — CCTP withdraw relay unavailable.");
}

function findPda(label, programId, extraSeeds = []) {
  const seeds = [Buffer.from(label, "utf8"), ...extraSeeds];
  const [publicKey] = PublicKey.findProgramAddressSync(seeds, programId);
  return publicKey;
}

// V2 messages carry a 32-byte nonce starting at byte offset 12 (V1's was an
// 8-byte uint64 at the same offset — confirmed different by inspecting
// Circle's own decodeEventNonceFromMessage vs decodeEventNonceFromMessageV2
// examples side by side).
function decodeEventNonceFromMessageV2(messageHex) {
  const message = Buffer.from(messageHex.replace("0x", ""), "hex");
  return message.subarray(12, 12 + 32);
}

function anchorWalletFromKeypair(keypair) {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async (tx) => { tx.partialSign(keypair); return tx; },
    signAllTransactions: async (txs) => { txs.forEach((tx) => tx.partialSign(keypair)); return txs; },
  };
}

/**
 * Relays an attested CCTP V2 message (Arbitrum burn -> Solana mint) via the
 * sponsor wallet. `solanaRecipient` is the user's own wallet address — their
 * USDC associated token account is derived from it directly rather than
 * parsed out of the message bytes, since the client already knows its own
 * address and this avoids a second layer of byte-offset parsing.
 */
export async function relayCctpMessageToSolana({ messageHex, attestationHex, solanaRecipient }) {
  if (!sponsorKeypair) throw new Error("Solana sponsor wallet not configured");

  const provider = new anchor.AnchorProvider(connection, anchorWalletFromKeypair(sponsorKeypair), { commitment: "confirmed" });
  const messageTransmitterProgram = new anchor.Program(MESSAGE_TRANSMITTER_V2_IDL, provider);
  const tokenMessengerMinterProgram = new anchor.Program(TOKEN_MESSENGER_MINTER_V2_IDL, provider);

  const nonce = decodeEventNonceFromMessageV2(messageHex);
  const remoteTokenMessengerKey = findPda("remote_token_messenger", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID, [Buffer.from(String(CCTP_ARBITRUM_DOMAIN), "utf8")]);
  const tokenMessengerAccount = findPda("token_messenger", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID);
  const tokenMinterAccount = findPda("token_minter", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID);
  const localToken = findPda("local_token", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID, [SOLANA_USDC_MINT.toBuffer()]);
  // Arbitrum's native USDC address, as the 32-byte value CCTP encodes EVM
  // addresses into (left-padded) — this is the "remote token" this message
  // was burned from, used to look up the token_pair PDA.
  const remoteUsdcBytes32 = Buffer.alloc(32);
  Buffer.from("af88d065e77c8cC2239327C5EDb3A432268e5831", "hex").copy(remoteUsdcBytes32, 12);
  const remoteTokenKey = new PublicKey(remoteUsdcBytes32);
  const tokenPair = findPda("token_pair", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID, [Buffer.from(String(CCTP_ARBITRUM_DOMAIN), "utf8"), remoteTokenKey.toBuffer()]);
  const custodyTokenAccount = findPda("custody", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID, [SOLANA_USDC_MINT.toBuffer()]);
  const authorityPda = findPda("message_transmitter_authority", MESSAGE_TRANSMITTER_V2_PROGRAM_ID, [TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID.toBuffer()]);
  const tokenMessengerEventAuthority = findPda("__event_authority", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID);
  const usedNonce = findPda("used_nonce", MESSAGE_TRANSMITTER_V2_PROGRAM_ID, [nonce]);

  const tokenMessengerAccountData = await tokenMessengerMinterProgram.account.tokenMessenger.fetch(tokenMessengerAccount);
  const feeRecipientTokenAccount = await getAssociatedTokenAddress(SOLANA_USDC_MINT, tokenMessengerAccountData.feeRecipient);

  const userTokenAccount = await getAssociatedTokenAddress(SOLANA_USDC_MINT, new PublicKey(solanaRecipient));

  const remainingAccounts = [
    { pubkey: tokenMessengerAccount, isSigner: false, isWritable: false },
    { pubkey: remoteTokenMessengerKey, isSigner: false, isWritable: false },
    { pubkey: tokenMinterAccount, isSigner: false, isWritable: true },
    { pubkey: localToken, isSigner: false, isWritable: true },
    { pubkey: tokenPair, isSigner: false, isWritable: false },
    { pubkey: feeRecipientTokenAccount, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: custodyTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: tokenMessengerEventAuthority, isSigner: false, isWritable: false },
    { pubkey: tokenMessengerMinterProgram.programId, isSigner: false, isWritable: false },
  ];

  const sig = await messageTransmitterProgram.methods
    .receiveMessage({
      message: Buffer.from(messageHex.replace("0x", ""), "hex"),
      attestation: Buffer.from(attestationHex.replace("0x", ""), "hex"),
    })
    .accounts({
      payer: sponsorKeypair.publicKey,
      caller: sponsorKeypair.publicKey,
      authorityPda,
      messageTransmitter: findPda("message_transmitter", MESSAGE_TRANSMITTER_V2_PROGRAM_ID),
      usedNonce,
      receiver: tokenMessengerMinterProgram.programId,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .rpc();

  return { solanaTxSig: sig };
}
