const REPO = "https://github.com/ahmardchain/alat/blob/main";
const RAW = (h: string) => `https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/${h}`;

type Row = { feature: string; since: string; evidence: [string, string][]; open: string };

/** Every caveat lives here, dated, with its evidence. Update it when something changes. */
const ROWS: Row[] = [
  {
    feature: "Hybrid-signed (secp256k1 + ML-DSA-87) transaction on testnet",
    since: "19 Nov 2026",
    evidence: [["tx D17E9DDC…8162", RAW("D17E9DDC1DAD4D8AEF248B6E1C3EC46C43076DF81A8705BB8D8476CC8B1D8162")]],
    open: "—",
  },
  {
    feature: "QoreX connect and signing on the site",
    since: "18 Nov 2026",
    evidence: [["e2e: wallet.spec.ts", `${REPO}/apps/web/e2e/wallet.spec.ts`]],
    open: "Tested with the official QoreX wallet mock (real hybrid signing). A run with the QoreX extension by a human is still to do.",
  },
  {
    feature: "AlatRegistry: 7-day re-link wait, cancel, consent, ML-DSA-87 key check",
    since: "19 Nov 2026",
    evidence: [
      ["contract tests", `${REPO}/contracts/test/AlatRegistry.ts`],
      ["0x431da38e…70ec", "https://explore.qore.network/address/0x431da38e11e27ba0e74ba06a4fbce7b86d1570ec"],
    ],
    open: "The relayer is the only writer (QoreX can't sign EVM yet). Consent changes (move to a new key at once) exist in the contract, not in the site.",
  },
  {
    feature: "Link a Telegram account (/link)",
    since: "19 Nov 2026",
    evidence: [["link tx 85C54BB2…0BE2", RAW("85C54BB278D78A9D61009A07300C1767D21C4FC87A0509EF3D9704306A180BE2")], ["e2e: flow.live.spec.ts", `${REPO}/apps/web/e2e/flow.live.spec.ts`]],
    open: "—",
  },
  {
    feature: "Owner answers on /respond (yes / not me)",
    since: "19 Nov 2026",
    evidence: [
      ["not me 7EC01298…9BE1", RAW("7EC012981137D656BB8593723987EFDB12202B38850F874B5457FD6E7F449BE1")],
      ["yes 5E96BD3B…8537", RAW("5E96BD3B1B3AA575CFD2CD5B4FED1B175AC0681B1EFA431454EE684FE0208537")],
    ],
    open: "Pending checks are listed by address, which QoreX reveals without a signature: anyone who knows an owner's address can read the request text of their open checks.",
  },
  {
    feature: "Refusals: other key, replay, other account, late answer, non-hybrid",
    since: "19 Nov 2026",
    evidence: [
      ["core tests", `${REPO}/packages/core/test/verify.test.ts`],
      ["service tests", `${REPO}/apps/server/test/service.test.ts`],
      ["refused on testnet DBE276F5…458C", RAW("DBE276F5ED0C916455D6232AA8778BE8337D9CCF8A8AA776B8CFCE56C3BE458C")],
    ],
    open: "—",
  },
  {
    feature: "Hacker re-link → 7-day wait, flagged, cancelled by the old key",
    since: "19 Nov 2026",
    evidence: [
      ["request F9E471C9…6D79", RAW("F9E471C983F523364E1893EB37E2EBE94095D97A99A9FA97E61F07A948386D79")],
      ["cancel 24D5AC9A…9529", RAW("24D5AC9AF5E8DB01253151609D80BEC88D84E275ECC8BD51571336EE11849529")],
    ],
    open: "Only the 7-day path and cancel were run on the testnet; a change that runs its full 7 days is covered by the contract tests only.",
  },
  {
    feature: "Telegram bot: /link, /check, forwarded messages, /demo",
    since: "20 Nov 2026 (tests)",
    evidence: [["bot tests", `${REPO}/apps/server/test/bot.test.ts`]],
    open: "Not running on real Telegram yet: needs a bot token and hosting.",
  },
  {
    feature: "Demo on /demo (no wallet needed)",
    since: "20 Nov 2026",
    evidence: [["demo tests", `${REPO}/apps/server/test/demo.test.ts`]],
    open: "The server holds the demo owner's key, by design, and says so on the page.",
  },
  {
    feature: "Public hosting with a stable URL",
    since: "—",
    evidence: [],
    open: "Not deployed yet.",
  },
  {
    feature: "WhatsApp, Instagram, family groups",
    since: "—",
    evidence: [],
    open: "Not built (next steps).",
  },
];

export function Status() {
  return (
    <>
      <h1>Status</h1>
      <p className="lede">What works today, since when, the evidence, and what is still open. Every caveat is here.</p>
      <section className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table className="small" style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              {["Feature", "Live since", "Evidence", "Still open"].map((h) => (
                <th key={h} style={{ padding: "12px 14px" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.feature} style={{ borderTop: "1px solid var(--line)", verticalAlign: "top" }}>
                <td style={{ padding: "12px 14px", fontWeight: 600 }}>{r.feature}</td>
                <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{r.since}</td>
                <td style={{ padding: "12px 14px" }}>
                  {r.evidence.length === 0
                    ? "—"
                    : r.evidence.map(([label, href]) => (
                        <div key={href}>
                          <a href={href} style={{ fontFamily: "var(--mono)", fontSize: "0.86em", whiteSpace: "nowrap" }}>
                            {label}
                          </a>
                        </div>
                      ))}
                </td>
                <td style={{ padding: "12px 14px" }} className={r.open === "—" ? "muted" : ""}>
                  {r.open}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="small muted">Last updated 20 Nov 2026. All addresses and hashes: docs/testnet-log.md.</p>
    </>
  );
}
