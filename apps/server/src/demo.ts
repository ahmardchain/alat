/**
 * The judge demo: a pre-linked demo account whose QoreChain key is held by the
 * Alat server, so anyone can watch a check go ⏳ → ❌ or ✅ without installing
 * QoreX. Nothing is simulated: every answer is a real hybrid-signed testnet
 * transaction, verified by the same code as any owner's answer.
 *
 * "Another key" is Alat's relayer account: a real account with a registered
 * ML-DSA-87 key that is not the one linked to the demo account. It stands in
 * for a hacker answering with their own key.
 */
import { answerMemo, type Answer } from "@alat/core";
import { AlatError, type Alat } from "./service.ts";

export const DEMO_USER = "owner";
export const DEMO_USERNAME = "alat_demo";
export const DEMO_TTL_MS = 5 * 60_000;
const MAX_PENDING = 6;

export const SCENARIOS = {
  hacker: "Hi, it's me. I'm stuck abroad and my card is blocked. Can you send 200 urgently? I'll pay you back tomorrow.",
  real: "Can you cover my half of dinner? Sending you the link now.",
} as const;
export type Scenario = keyof typeof SCENARIOS;

export interface DemoSigner {
  /** Sign a hybrid self-send with this memo as the demo owner, or as another registered key. */
  sign(who: "demo" | "other", memo: string): Promise<string>;
  /** The demo owner's qor1 address. */
  demoAddress(): Promise<string>;
}

export class Demo {
  constructor(
    private readonly alat: Alat,
    private readonly signer: DemoSigner,
  ) {}

  get account() {
    return this.alat.accountFor("demo", DEMO_USER);
  }

  /** Link the demo account once, through the normal link path. */
  async setup(): Promise<{ state: "already-linked" | "linked"; nativeTx?: string }> {
    const link = await this.alat.chain.linkOf(this.account);
    const address = await this.signer.demoAddress();
    this.alat.remember("demo", DEMO_USER, DEMO_USERNAME, null);
    if (link?.owner === address) return { state: "already-linked" };
    if (link) throw new Error(`the demo account is linked to ${link.owner}, not the demo key ${address}`);
    const t = this.alat.issueLinkToken({ platform: "demo", userId: DEMO_USER, username: DEMO_USERNAME, chatId: null });
    const info = await this.alat.linkInfo(t.token);
    const hash = await this.signer.sign("demo", info.memo);
    const r = await this.alat.submitLink(t.token, hash);
    return { state: "linked", nativeTx: r.nativeTx };
  }

  async start(scenario: Scenario, friendChatId: string | null = null) {
    const pending = Number(
      (this.alat.db.sql.prepare(`SELECT COUNT(*) AS n FROM checks WHERE demo = 1 AND status = 'pending'`).get() as { n: number }).n,
    );
    if (pending >= MAX_PENDING) throw new AlatError("bad-request", "Several demo checks are already running. Try again in a few minutes.");
    const r = await this.alat.startCheck({
      account: this.account,
      friendChatId,
      requestText: SCENARIOS[scenario],
      demo: true,
      ttlMs: DEMO_TTL_MS,
    });
    if (r.notLinked) throw new AlatError("not-linked", "The demo account is not linked yet.");
    return r;
  }

  private demoCheck(id: string) {
    const c = this.alat.db.check(id);
    if (!c || !c.demo) throw new AlatError("not-found");
    return c;
  }

  /** The demo owner answers with their key. */
  async answer(id: string, answer: Answer) {
    const c = this.demoCheck(id);
    if (c.status !== "pending") throw new AlatError("challenge-closed");
    const hash = await this.signer.sign("demo", answerMemo(c.nonce, answer));
    return this.alat.submitAnswer(hash);
  }

  /** Another registered key (the "hacker") tries to confirm. Alat must refuse it. */
  async forge(id: string) {
    const c = this.demoCheck(id);
    const hash = await this.signer.sign("other", answerMemo(c.nonce, "yes"));
    try {
      await this.alat.submitAnswer(hash);
    } catch (e) {
      if (e instanceof AlatError) return { refused: true as const, reason: e.code, message: e.message, tx: hash };
      throw e;
    }
    // Reaching here would be a bug; say so loudly rather than hide it.
    throw new Error(`demo forge was ACCEPTED: ${hash}`);
  }
}
