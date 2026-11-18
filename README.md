# Alat

**A hacked account can copy your words. It can't copy your key.**

Alat lets friends check a money request with the sender's QoreChain key, not their chat account. Telegram first.

Built for **Build Before Q-Day: QoreChain Developer Fest**, category **Quantum Pass**.

> Work in progress. The full README (judge guide, requirements checklist, testnet addresses, credits) lands with the Day 4 build. Design notes from reading the real kits: [docs/FINDINGS.md](docs/FINDINGS.md).

## Layout

| Path | What |
| --- | --- |
| `apps/web` | the site (scaffolded with `npx create-qorechain-dapp web -t viem-wagmi`) |
| `contracts` | `AlatRegistry` and the operator scripts (scaffolded with `npx create-qorechain-dapp contracts -t hardhat`) |
| `docs` | findings, threat model, demo script |

## Licence

MIT, see [LICENSE](LICENSE).
