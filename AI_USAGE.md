# AI usage

Alat was built with an AI coding agent, **Claude Code** (Anthropic), running in a
cloud sandbox with access to this repository, npm, the QoreChain docs and the
QoreChain testnet. This file says what the agent did, what the human did, and
how the results were checked. It is written to be specific, not flattering.

## Workflow

1. **Brief (human).** The human wrote a build brief: the product, the hard
   requirements of the Quantum Pass category, the exact flows (link, check,
   respond, re-link protection), the refusals that must be tested, the judge
   page, a day-by-day plan, and rules for the agent: verify every SDK call
   against the real package, never fake a signature or a chain result, write
   down where the kits differ from the brief, keep copy plain.
2. **Brand (human + agent).** The human asked the agent for a brand direction
   (name check, palette, type, logo idea, UX copy). The agent proposed "colour is
   a verdict" (ink and paper; green, red and amber only for results), the
   chat-bubble-with-key-teeth mark and the lattice background. The human kept it.
3. **Research before code (agent).** The agent downloaded and read the kit
   packages from npm (READMEs, type declarations, source) and about 35 pages of
   docs.qorechain.io, then wrote [docs/FINDINGS.md](docs/FINDINGS.md) **before**
   writing app code. Three findings changed the design the brief assumed:
   - QoreX can't sign messages (`signArbitrary` refused), so no Sign In With
     QoreChain or message proofs from QoreX → owners answer with a hybrid-signed
     self-transfer whose memo carries the answer (F1).
   - QoreX can't sign EVM transactions → a relayer writes the registry; the
     contract still enforces the 7-day wait and the post-quantum key check (F2, F3).
   - The Telegram Bot API can't resolve an arbitrary @username (F7).
4. **Build in daily steps (agent), steered by the human.** The human started each
   step ("start", "do day 2 and 3", "start day 4") and handled what needs a
   person: funding the relayer from the faucet (it needs a Dashboard login) and
   approving every change to the sandbox's network access.
5. **Verify on the real network (agent).** Every flow was run against the
   QoreChain testnet, not only in unit tests. The hashes are in
   [docs/testnet-log.md](docs/testnet-log.md).

## What the agent generated

Practically all of the code and documents in this repository:

| Area | Files |
| --- | --- |
| Contract and tests | `contracts/contracts/AlatRegistry.sol`, `contracts/test/AlatRegistry.ts`, `contracts/scripts/ops.ts` (keys, PQC registration, EVM window, deploy) |
| Rules | `packages/core` (account hashing, memo formats, answer/link/cancel verification, chain observation) and its tests |
| Server and bot | `apps/server` (API, relayer, grammY bot, judge demo) and its tests |
| Site | `apps/web` (pages, QoreX integration, e2e tests with the QoreX wallet mock) |
| Docs | README, FINDINGS, threat model, demo script, testnet log, this file, the featured image (rendered from `docs/featured/featured.html`) |

The scaffolding came from `create-qorechain-dapp` (templates `viem-wagmi` and
`hardhat`); the agent ran it and then replaced the template's example code.

## Mistakes the agent made, and how they were caught

Listed because they show what the checks are for.

- Used `msg.cosmos.send` from memory; the SDK's namespace is `msg.bank.send`.
  Caught when the first transaction failed; fixed before any commit.
- Checked "closed" before "expired" in answer verification, so a late answer to
  an expired check was refused with the wrong reason. Caught by a service test;
  fixed in `packages/core/src/verify.ts`.
- Assumed the explorer takes the network from the URL. It uses a cookie; links
  now say "select Testnet" and also link the raw REST JSON (F5).
- Assumed the QoreX wallet mock could reach the REST API from a page. The API
  sends no CORS headers; the tests now proxy those calls (F8). The app was not
  changed to hide this.
- Node's built-in `fetch` ignored the sandbox proxy until `NODE_USE_ENV_PROXY=1`;
  this affects only the sandbox.

## How results were verified

- **Tests:** 14 contract tests (Hardhat, on a local EVM with a stand-in for the
  PQC Key Status precompile), 16 rule tests and 3 live chain tests in
  `packages/core`, 22 service, bot and demo tests in `apps/server`, and
  Playwright tests in `apps/web`.
- **On chain:** the live Playwright runs (`flow.live.spec.ts`, `demo.live.spec.ts`)
  drive the real site and server against the testnet with the official QoreX
  wallet mock, which signs for real. They cover link, "not me", a different key
  being refused, "yes", a hacker re-link held for 7 days, and its cancellation.
- **Independent checks of the post-quantum part:** for each owner transaction
  the server requires the chain's `pqc_hybrid_verify: verified` event **and**
  re-verifies the ML-DSA-87 layer against the key registered on chain, with
  QoreSign. A live test shows a classical-only transaction failing both.
- **Nothing a judge sees is hard-coded:** the counters on `/demo` are read from
  the registry contract and the server's records at request time, and every
  verdict links its transaction.

## What the human decided

- The idea, the audience, the scope (Telegram only) and the hard rules in the brief.
- To accept the agent's brand direction and the design changes in FINDINGS.
- To fund the relayer and approve network access for the sandbox.

## Still to be done by the human before submission

- A run of the full flow with the real QoreX browser extension (so far: the
  official QoreX wallet mock, which signs for real but is not the extension).
- Recording the video (script: [docs/demo-script.md](docs/demo-script.md)).
- Creating the Telegram bot, choosing hosting, and setting the secrets there.
- Reviewing this file and adding anything the agent couldn't see.
