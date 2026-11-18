# Findings

What the real kits and network do, checked against the packages and docs before
writing code. Each finding says what the build prompt assumed, what is true, and
what Alat does instead.

Sources read on 18 Nov 2026: the READMEs, type declarations and source of
`create-qorechain-dapp@0.14.0`, `@qorechain/sdk@0.14.0`, `@qorechain/evm@0.14.0`,
`@qorechain/qoresign@0.2.0`, `@qorechain/qorex-types@0.1.0`,
`@qorechain/qorex-rainbowkit@0.1.0` and `@qorechain/qorex-wallet-mock@0.1.0`
from npm, and these docs.qorechain.io pages: build-before-qday (overview,
prerequisites, key binding, workshops 1 and 2 with their apps), qoresign
(overview, sign-in guide, SIWQ v1 spec, message-signing v1 spec),
qorex (overview, browser extension, dApp browser), developer-tools/qorex-integrations,
developer-guide/evm-precompiles and evm-window-reference.

## F1. QoreX cannot sign messages yet

- **Assumed:** the owner signs a challenge as a "hybrid message proof", and uses
  "Sign In With QoreChain via QoreX" on `/respond`.
- **True:** QoreX's native provider offers `enable`, `getKey`, `signAndBroadcast`,
  `signDirect` (only if the page already attached the ML-DSA-87 layer, which a
  page cannot build), `listAccounts` and `experimentalSuggestChain`.
  `signArbitrary` is refused ("not yet supported"), so neither QoreSign message
  signing v1 nor SIWQ v1 can be produced by QoreX today. QoreX lists "sign-in"
  as mobile-only, and that is the QoreX account sign-in, not SIWQ for dApps.
  (`qorex-types` README, `qorex-wallet-mock` profile table, qorex overview and
  dApp browser pages.)
- **Alat does instead:** the owner answers a check with a **hybrid-signed
  native-lane transaction** sent through `signAndBroadcast`: a 1 uqor transfer to
  themselves whose memo carries the challenge (`alat1:ans:<nonce>:yes|no`).
  QoreX adds the ML-DSA-87 layer itself, and the chain verifies both signatures
  before it includes the transaction. Alat then reads the transaction from the
  chain and checks that:
  - the signer is the address linked to the account (read from the registry
    contract, never from the client);
  - the transaction succeeded (`code 0`) with a `pqc_hybrid_verify` event that
    reads `verified`;
  - the ML-DSA-87 layer matches the key registered on chain for that address
    (QoreSign `assertPqLayerMatchesRegisteredKey`);
  - the memo nonce belongs to an open challenge for that account;
  - the block time is before the challenge's expiry.

  This gives a stronger record than an off-chain proof: every answer is public
  and anyone can re-check it on the explorer. It costs a small testnet fee and
  one block.
- **Upgrade path:** when QoreX ships `signArbitrary` (listed as planned by the
  mock's `planned` profile), add QoreSign message proofs as a second answer
  method. Answers that are already on chain stay valid.

## F2. QoreX does not sign EVM transactions yet

- **Assumed:** the owner submits the binding to a registry contract on the EVM
  lane from QoreX.
- **True:** QoreX's EIP-1193 provider answers `eth_chainId`, `eth_accounts`,
  `eth_requestAccounts` and `wallet_switchEthereumChain` only. `personal_sign`,
  `eth_signTypedData_v4` and `eth_sendTransaction` are refused ("QoreX: EVM
  method ... not yet supported"). One workshop page (qday-guestbook) describes
  QoreX signing an EVM write; the package READMEs and the QoreX manual both say
  it is not shipped. Alat follows the package READMEs and does not rely on it.
- **Alat does instead:** the owner links with a hybrid-signed native transaction
  (`alat1:link:<accountHash>:<token>` in the memo). Alat's **relayer** account,
  which holds its own registered ML-DSA-87 key and EVM window, writes the
  binding to `AlatRegistry` on the EVM lane and records the native transaction
  hash as evidence.

## F3. Who enforces re-link protection

The prompt asks for the 7-day rule to be enforced in the contract. With F2,
only the relayer writes the contract, so the split is:

- **The contract enforces (no trust in the bot):**
  - a link to a new key never takes effect immediately when the account is
    already linked, unless the old owner consented (see the next list);
  - a change without consent waits **7 days** on chain, is visible as
    "pending" to every reader, and can be cancelled during that time;
  - a new owner must have an ML-DSA-87 key registered with proof of possession,
    checked on chain through the PQC Key Status precompile (`0x…0A02`, active
    on the testnet since 27 Oct 2026);
  - every write stores the native transaction hash it is based on.
- **The relayer is trusted to:** submit only links, consents and cancellations
  whose native transaction it verified (F1 checks). Every one of those
  transactions is on chain, so anyone can audit what the relayer wrote.
- **What this means:** a hacker who controls the Telegram account and even the
  Alat bot cannot swap the link silently. The contract makes them wait 7 days
  in public, which gives the real owner time to cancel from their key.
- **Upgrade path:** when QoreX can sign messages (F1), the contract can check
  the old owner's ML-DSA-87 signature itself with the PQC Verify precompile
  (`0x…0A01`, active on the testnet) and the relayer stops being trusted for
  consent and cancel.

## F4. Hybrid transactions and keys

- Every native-lane transaction must carry the hybrid layer (secp256k1 plus a
  4,627-byte ML-DSA-87 signature). The only classical transaction the chain
  accepts is the account's first, which registers the ML-DSA-87 key
  (`MsgRegisterPQCKeyV2` with a proof of possession). QoreX does that
  registration itself on an account's first send.
- The testnet (`qorechain-diana`) uses hybrid sign-bytes v2. The SDK resolves it
  with `signBytesVersion: "auto"` when given the REST endpoint.
- Every EVM transaction needs a registered ML-DSA-87 key and a live EVM
  authorisation window, opened by a hybrid native message
  (`openEvmWindowMsg`). Opening a window advances the account's nonce. The
  relayer opens windows before it writes the registry.
- QoreX derives `qor1` accounts at `m/44'/118'/0'/0/i` (secp256k1). The SDK's
  `deriveUnifiedAccount` uses `m/44'/60'/0'/0/i` (eth_secp256k1). Alat's server
  accounts (relayer, demo owner) use the SDK path. Owners use whatever QoreX
  gives them, and Alat compares `qor1` addresses only.

## F5. Network and tooling notes

- Public endpoints (from the SDK presets): REST `https://api-testnet.qore.host`,
  RPC `https://rpc-testnet.qore.host`, EVM `https://evm-testnet.qore.host`
  (chain id 9800), explorer `https://explore.qore.network` (switch to Testnet).
- The explorer chooses mainnet or testnet from a cookie (`qore-network`), not
  from the URL. A testnet transaction link opens as "not found" until the
  reader selects Testnet once. Alat labels every explorer link "(select
  Testnet)" and also links the raw REST JSON
  (`/cosmos/tx/v1beta1/txs/<hash>`), which always works.
- The public REST endpoint sends no CORS headers, so the web app reaches it
  through its own server, as the template's `/lcd-testnet` proxy does.
- The faucet (`dashboard.qorechain.io/faucet`) needs a Dashboard sign-in and pays
  100 QOR per address per 24 hours. Alat funds one relayer account there and
  sends the demo owner what it needs.
- Sourcify does not list chain ids 9800 and 9801 yet, so the contract source
  can't be verified on an explorer. The source and the deploy transaction are
  linked from the README instead.
- Q-Day Drill (18 Nov 2026): registration closed on 17 Nov, before Alat had a
  testnet account. Alat does not take part.

## F6. Judge demo without QoreX

- **Assumed:** a judge can watch a check go ❌, then ✅, without installing
  QoreX.
- **Alat does:** a demo owner account whose key is held by the Alat server is
  linked to a demo Telegram identity. On `/judge`, "Answer as the demo owner"
  makes the server sign the answer transaction with that account. It is a real
  hybrid-signed testnet transaction, verified the same way as any other answer.
  The page says plainly that the server holds this one demo key.
