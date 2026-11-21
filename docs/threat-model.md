# Threat model

## What Alat protects

A friend gets a money request from a chat account. Alat answers one question:
**did the person who linked this account to a QoreChain key say this is them?**

It does not judge whether the request is a good idea, and it does not move money.

## Who's involved

| Actor | Has | Wants |
| --- | --- | --- |
| Owner | their Telegram account (normally) and their QoreX key | friends to trust real requests, and to catch fake ones |
| Friend | the chat, the Alat bot | to know whether to send money |
| Hacker | the owner's Telegram account, name and history; not the QoreX key | money from the friend |
| Alat server | the relayer key, the demo key, the ID salt, a database | to report the truth |

## Attacks and what stops them

| # | Attack | What stops it | Where |
| --- | --- | --- | --- |
| 1 | Hacker answers "yes" from the hacked chat | Chat messages count for nothing. Only a hybrid-signed transaction from the **linked** key answers. | `verifyAnswer`: `wrong-signer` |
| 2 | Hacker answers with their own QoreChain key | The signer must be the owner in AlatRegistry, read from chain when the answer arrives. | `verifyAnswer`: `wrong-signer` |
| 3 | Hacker re-links the Telegram account to their own key (they control `/link`) | The contract makes the change wait **7 days**, every check shows "⚠️ link change pending", and only the current key can cancel it. The old key keeps answering during the wait. | `AlatRegistry.requestChange`, `cancelChange` |
| 4 | Replay an old "yes" on a new check | Each check has a random nonce in the memo. A transaction is accepted once. | `wrong-challenge`, `already-used` |
| 5 | Use account A's signature on account B's check | The nonce belongs to one check of one account, and the signer must be that account's owner. | `wrong-challenge`, `wrong-signer` |
| 6 | Answer after the check expired | Block time (not arrival time) must be before expiry; expired checks stay ❌. | `expired` |
| 7 | Classical-only signature (a quantum attacker who recovered the secp256k1 key) | The chain must report `pqc_hybrid_verify: verified`, **and** QoreSign re-verifies the ML-DSA-87 layer against the key registered on chain for the signer. A classical-only transaction fails both. | `observeTx`: `not-hybrid`, `pq-key-mismatch` |
| 8 | Link to a key with no post-quantum key, or one registered without proof of possession | The contract checks the PQC Key Status precompile (`0x…0A02`): registered, ML-DSA-87, possession proven. | `AlatRegistry._requirePqcKey` |
| 9 | Someone else's browser submits a forged result | The browser only submits a hash. The server reads the transaction from the chain itself. | `observeTx` |
| 10 | Reading who uses Alat from the chain | The registry stores HMAC-SHA256(secret salt, Telegram id), never the id or username. Memos hold no names or request text. | `accountHash` |
| 11 | Hacker renames the account, or takes over a freed username | Links are by Telegram **id**. `/check @name` resolves through ids the bot has seen; forwarding the message uses the sender's id directly. The verdict names the account it checked. | `bot.ts`, FINDINGS F7 |

## What you have to trust

- **The relayer** (Alat's server key) is the only writer of AlatRegistry, because
  QoreX can't sign EVM transactions yet. It could refuse to write, or write a
  link it never verified. Limits on that: the 7-day wait is enforced by the
  contract, so even a compromised relayer can't swap an owner silently; every
  write stores the hybrid-signed native transaction it is based on, so anyone
  can audit it; a new owner must hold a registered ML-DSA-87 key. When QoreX can
  sign messages, consent and cancel can move into the contract through the PQC
  Verify precompile (`0x…0A01`), and this trust goes away.
- **The Alat server** reports verdicts to the friend. A compromised server could
  lie. Every verdict links the answer transaction, which anyone can check
  against the registry.
- **The ID salt.** If it leaks, someone could test whether a known Telegram id
  is linked. It does not let anyone answer for an account.

## Known gaps

- `/respond` lists pending checks by address, and QoreX reveals the address
  without a signature (`getKey`). Anyone who knows an owner's address can read
  the request text of their open checks. Fix once QoreX ships message signing:
  require a Sign In With QoreChain session.
- If the owner keeps QoreX on the same phone as Telegram and loses the phone,
  both fall together. The bot tells owners to keep the key elsewhere.
- A hacker can keep asking for re-links after each cancel. Each one is public,
  flagged and cancellable, but the owner has to act every time.
- The demo account's key is held by the server, by design and stated on /judge.
