import { useEffect, useState } from "react";
import { balanceUqor, formatQor, pqcKeyRegistered, txJsonUrl, txUrl } from "../lib/chain.js";
import { connectQorex, sendMemoTx, waitForQorex, type QorexState } from "../lib/qorex.js";

type Sent = { txHash: string; code: number; shield: string; height?: number };

/**
 * Connect QoreX and send one hybrid-signed transaction. This is the base of the
 * /link and /respond flows: QoreX signs a native transaction, never a message.
 */
export function Wallet() {
  const [state, setState] = useState<QorexState | null>(null);
  const [address, setAddress] = useState<string>();
  const [pqc, setPqc] = useState<boolean | undefined>();
  const [balance, setBalance] = useState<bigint | undefined>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void waitForQorex().then(setState);
  }, []);

  async function refresh(addr: string) {
    const [k, b] = await Promise.all([pqcKeyRegistered(addr), balanceUqor(addr)]);
    setPqc(k);
    setBalance(b);
  }

  async function connect() {
    setError(undefined);
    try {
      const addr = await connectQorex();
      setAddress(addr);
      await refresh(addr);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function send() {
    if (!address) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await sendMemoTx(address, "alat: wallet check");
      setSent(r);
      await refresh(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Check your wallet</h1>
      <p className="lede">
        Alat asks QoreX for one thing: a transaction signed with both your keys, secp256k1 and ML-DSA-87. Try it
        here before you link an account.
      </p>

      <section className="card">
        <h2>1. Connect QoreX</h2>
        {state === null && <p className="muted">Looking for QoreX…</p>}
        {state?.kind === "missing" && (
          <p>
            QoreX was not found in this browser. Install the QoreX extension, switch it to testnet (tap the
            version number 7 times, then <b>Switch to testnet (diana)</b>), and reload.
          </p>
        )}
        {state?.kind === "unsupported" && <p>This QoreX build can't send transactions from a website. Update QoreX.</p>}
        {state?.kind === "ready" && !address && (
          <button type="button" onClick={connect}>
            Connect QoreX
          </button>
        )}
        {address && (
          <dl className="kv">
            <dt>Account</dt>
            <dd>
              <code data-testid="address">{address}</code>
            </dd>
            <dt>Balance</dt>
            <dd>{balance === undefined ? "…" : formatQor(balance)}</dd>
            <dt>ML-DSA-87 key</dt>
            <dd data-testid="pqc">
              {pqc === undefined ? "…" : pqc ? "registered on chain" : "not registered yet (QoreX registers it on your first send)"}
            </dd>
          </dl>
        )}
      </section>

      {address && (
        <section className="card">
          <h2>2. Send a hybrid-signed transaction</h2>
          <p className="muted small">Sends 1 uqor to yourself with the memo "alat: wallet check". Testnet only.</p>
          <button type="button" onClick={send} disabled={busy}>
            {busy ? "Approve in QoreX…" : "Sign with QoreX"}
          </button>
          {sent && (
            <div className={`card verdict ${sent.code === 0 && sent.shield === "shielded" ? "go" : "stop"}`} style={{ marginTop: 16 }}>
              <dl className="kv">
                <dt>Result</dt>
                <dd data-testid="result">{sent.code === 0 ? "included" : `refused (code ${sent.code})`}</dd>
                <dt>Hybrid layer</dt>
                <dd>{sent.shield}</dd>
                <dt>Transaction</dt>
                <dd>
                  <code>{sent.txHash}</code>
                  <br />
                  <a href={txUrl(sent.txHash)} target="_blank" rel="noreferrer">
                    Explorer (select Testnet)
                  </a>{" "}
                  ·{" "}
                  <a href={txJsonUrl(sent.txHash)} target="_blank" rel="noreferrer">
                    Raw JSON
                  </a>
                </dd>
              </dl>
            </div>
          )}
        </section>
      )}

      {error && (
        <p className="card verdict stop" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
