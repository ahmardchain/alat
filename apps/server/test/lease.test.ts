import assert from "node:assert/strict";
import { it } from "node:test";
import { memDb } from "./fakes.ts";

it("the relayer lease lets one holder run at a time, across concurrent callers", async () => {
  const db = await memDb();
  let inside = 0;
  let maxInside = 0;
  const order: number[] = [];
  await Promise.all(
    [1, 2, 3, 4].map((i) =>
      db.withLease("relayer", 10_000, async () => {
        inside++;
        maxInside = Math.max(maxInside, inside);
        await new Promise((r) => setTimeout(r, 30));
        order.push(i);
        inside--;
      }),
    ),
  );
  assert.equal(maxInside, 1);
  assert.equal(order.length, 4);
});

it("a lease left by a crashed holder is taken over after it expires", async () => {
  const db = await memDb();
  await db.q(`INSERT INTO leases(name, holder, until_ms) VALUES ('relayer', 'crashed', $1)`, [Date.now() - 1]);
  assert.equal(await db.withLease("relayer", 1000, async () => "ran"), "ran");
});
