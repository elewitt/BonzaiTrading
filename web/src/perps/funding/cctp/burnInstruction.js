/**
 * Builds the Solana-side "depositForBurn" instruction for CCTP V2
 * (Circle's native USDC burn-and-mint bridge) — the deposit direction's
 * first leg: burn USDC on Solana, later minted on Arbitrum once Circle's
 * attestation service signs off.
 *
 * Deliberately built via the real Anchor IDL + Program client (not
 * hand-encoded instruction bytes) — every address/PDA/account-order value
 * here is copied verbatim from Circle's own official reference
 * implementation (circlefin/solana-cctp-contracts, examples/v2/solana.ts),
 * cross-checked against developers.circle.com's published mainnet program
 * addresses. Getting any of this wrong on a real burn instruction
 * irreversibly destroys real USDC, so nothing here is guessed.
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import TOKEN_MESSENGER_MINTER_V2_IDL from "./token_messenger_minter_v2_idl.json";

export const MESSAGE_TRANSMITTER_V2_PROGRAM_ID = new PublicKey("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
export const TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID = new PublicKey("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");
export const SOLANA_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const CCTP_SOLANA_DOMAIN = 5;
export const CCTP_ARBITRUM_DOMAIN = 3;

// Read-only "wallet" — .instruction() never signs or submits anything, it
// only builds calldata, so this dummy never actually needs to sign. Real
// signing happens later via Privy against the Transaction this instruction
// gets wrapped into (see cctp.js).
function readOnlyProvider(connection, ownerPubkey) {
  const dummyWallet = {
    publicKey: ownerPubkey,
    signTransaction: async () => { throw new Error("readOnlyProvider cannot sign"); },
    signAllTransactions: async () => { throw new Error("readOnlyProvider cannot sign"); },
  };
  return new anchor.AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
}

function findPda(label, programId, extraSeeds = []) {
  const seeds = [Buffer.from(label, "utf8"), ...extraSeeds];
  const [publicKey] = PublicKey.findProgramAddressSync(seeds, programId);
  return publicKey;
}

function evmAddressToBytes32Pubkey(evmAddress) {
  // depositForBurn's mintRecipient/destinationCaller are bytes32 — an EVM
  // address is 20 bytes, left-padded with 12 zero bytes to fill it (same
  // convention Circle's own evmAddressToBytes32() example helper uses).
  const hex = evmAddress.replace("0x", "").toLowerCase();
  const bytes = Buffer.alloc(32);
  Buffer.from(hex, "hex").copy(bytes, 12);
  return new PublicKey(bytes);
}

/**
 * @param {object} opts
 * @param {import("@solana/web3.js").Connection} opts.connection
 * @param {string} opts.solanaSender  User's own Solana address (owner of the burn_token_account, fee payer)
 * @param {string} opts.evmRecipient  User's own Arbitrum address — USDC mints here once attested
 * @param {bigint} opts.amountAtoms   USDC amount in 6-decimal atoms
 * @returns {Promise<{instruction: import("@solana/web3.js").TransactionInstruction, messageSentEventKeypair: Keypair}>}
 */
export async function buildDepositForBurnInstruction({ connection, solanaSender, evmRecipient, amountAtoms }) {
  const owner = new PublicKey(solanaSender);
  const provider = readOnlyProvider(connection, owner);
  const tokenMessengerMinterProgram = new anchor.Program(TOKEN_MESSENGER_MINTER_V2_IDL, provider);

  const burnTokenAccount = await getAssociatedTokenAddress(SOLANA_USDC_MINT, owner);
  const senderAuthorityPda = findPda("sender_authority", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID);
  const messageTransmitterAccount = findPda("message_transmitter", MESSAGE_TRANSMITTER_V2_PROGRAM_ID);
  const tokenMessengerAccount = findPda("token_messenger", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID);
  const tokenMinterAccount = findPda("token_minter", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID);
  const localToken = findPda("local_token", TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID, [SOLANA_USDC_MINT.toBuffer()]);
  const remoteTokenMessengerKey = findPda(
    "remote_token_messenger",
    TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID,
    [Buffer.from(String(CCTP_ARBITRUM_DOMAIN), "utf8")],
  );

  // Fresh, single-use keypair that owns the new "message sent" event
  // account this instruction creates — must co-sign alongside the user's
  // own wallet. Generated locally, never leaves this device, holds no
  // funds, and has no purpose beyond this one transaction.
  const messageSentEventKeypair = Keypair.generate();

  const mintRecipient = evmAddressToBytes32Pubkey(evmRecipient);
  // destinationCaller = zero pubkey means "anyone may call receiveMessage
  // on the destination" — required so the app's Arbitrum sponsor wallet
  // (not the user) can relay the mint step permissionlessly.
  const destinationCaller = PublicKey.default;

  const instruction = await tokenMessengerMinterProgram.methods
    .depositForBurn({
      amount: new anchor.BN(amountAtoms.toString()),
      destinationDomain: CCTP_ARBITRUM_DOMAIN,
      mintRecipient,
      destinationCaller,
      // maxFee: 0 + minFinalityThreshold: 1000 = Standard Transfer, the
      // no-extra-fee tier (Fast Transfer would need maxFee > 0 and
      // minFinalityThreshold <= 500) — this whole rail exists specifically
      // to avoid deBridge's solver margin, so it defaults to the free tier.
      maxFee: new anchor.BN(0),
      minFinalityThreshold: 1000,
    })
    .accounts({
      owner,
      eventRentPayer: owner,
      senderAuthorityPda,
      burnTokenAccount,
      messageTransmitter: messageTransmitterAccount,
      tokenMessenger: tokenMessengerAccount,
      remoteTokenMessenger: remoteTokenMessengerKey,
      tokenMinter: tokenMinterAccount,
      localToken,
      burnTokenMint: SOLANA_USDC_MINT,
      messageSentEventData: messageSentEventKeypair.publicKey,
      messageTransmitterProgram: MESSAGE_TRANSMITTER_V2_PROGRAM_ID,
      tokenMessengerMinterProgram: TOKEN_MESSENGER_MINTER_V2_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return { instruction, messageSentEventKeypair };
}
