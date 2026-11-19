/**
 * Reads real transactions from the QoreChain testnet (qorechain-diana).
 * Runs only with ALAT_LIVE=1, because it needs the network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { observeTx } from "../src/index.ts";

const live = process.env.ALAT_LIVE === "1";
const REST = "https://api-testnet.qore.host";
const CHAIN_ID = "qorechain-diana";

// Alat's first hybrid-signed transaction: the relayer sends 1 uqor to itself.
const HYBRID = "D17E9DDC1DAD4D8AEF248B6E1C3EC46C43076DF81A8705BB8D8476CC8B1D8162";
// The relayer's key registration: the one transaction the chain accepts signed classically.
const REGISTRATION = "18E93D745780C4751BCE05301A095D349CBE50901E04B6456F355E47BDFB9413";
const RELAYER = "qor1md44fjsld8rjzx2r2hhyquw2wldm60a2dqlalk";

describe("observeTx on the testnet", { skip: !live && "set ALAT_LIVE=1" }, () => {
  it("sees a hybrid self-send, verified by the chain and against the registered ML-DSA-87 key", async () => {
    const t = await observeTx({ rest: REST, chainId: CHAIN_ID, hash: HYBRID });
    assert.ok(t);
    assert.equal(t.code, 0);
    assert.equal(t.signer, RELAYER);
    assert.equal(t.selfSendOnly, true);
    assert.equal(t.chainVerifiedHybrid, true);
    assert.equal(t.pqLayerMatchesRegisteredKey, true);
    assert.equal(t.memo, "alat: first hybrid-signed transaction");
  });

  it("sees that a classical transaction carries no hybrid layer", async () => {
    const t = await observeTx({ rest: REST, chainId: CHAIN_ID, hash: REGISTRATION });
    assert.ok(t);
    assert.equal(t.chainVerifiedHybrid, false);
    assert.equal(t.pqLayerMatchesRegisteredKey, false);
    assert.equal(t.selfSendOnly, false);
  });

  it("returns undefined for an unknown hash", async () => {
    assert.equal(await observeTx({ rest: REST, chainId: CHAIN_ID, hash: "00".repeat(32) }), undefined);
  });
});
