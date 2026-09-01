// Privy react-auth v3 changed the Solana signing surface: the
// `useSignTransaction()` hook now takes raw transaction *bytes* plus a
// wallet object and returns `{ signedTransaction: Uint8Array }` — where v2
// took a web3.js transaction object and returned that object signed.
//
// Every caller in this codebase (lib/api.js, PerpsApp, BorrowApp, the
// agent executor) still builds a web3.js `VersionedTransaction` (or, for
// the CCTP burn, a legacy `Transaction`) and then calls `.serialize()` on
// whatever comes back. This shim bridges the two worlds so those callers
// stay untouched: serialize on the way in, wrap the signed bytes in a
// `{ serialize() }` object on the way out.
//
// `wallet` is a Privy v3 `ConnectedStandardSolanaWallet` (from
// `useWallets()` in `@privy-io/react-auth/solana`); `signTransaction` is
// the function from `useSignTransaction()`.
export async function signVersionedTxWithPrivy(tx, wallet, signTransaction) {
  if (!wallet) throw new Error("No Solana wallet connected");

  // VersionedTransaction exposes `.message`; a legacy web3.js Transaction
  // does not. Legacy `.serialize()` verifies signatures by default and
  // would throw on a not-yet-fully-signed tx, so opt out explicitly.
  const bytes = tx.message !== undefined
    ? tx.serialize()
    : tx.serialize({ requireAllSignatures: false, verifySignatures: false });

  const { signedTransaction } = await signTransaction({
    transaction: bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes),
    wallet,
    options: { uiOptions: { showWalletUIs: false } },
  });

  return { serialize: () => signedTransaction };
}
