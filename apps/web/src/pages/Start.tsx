import { useEffect, useState } from "react";

/** For a real person, not a judge: what to do, in order, for each role. */
export function Start() {
  const [bot, setBot] = useState("https://t.me/alatAppbot");
  useEffect(() => {
    fetch("/api/info")
      .then((r) => r.json())
      .then((i: { bot: string | null }) => i.bot && setBot(i.bot), () => undefined);
  }, []);
  const handle = "@" + bot.replace(/^https:\/\/t\.me\//, "");

  return (
    <>
      <h1>Get started</h1>
      <p className="lede">
        Two roles. If you send money requests to friends, link your account once. If you receive one, check it before you
        pay. Testnet only for now.
      </p>

      <section className="card guide">
        <h2>Got a money request? Check it</h2>
        <p className="muted small">No wallet needed.</p>
        <ol>
          <li>
            Open <a href={bot}>{handle}</a> in Telegram.
          </li>
          <li>
            <b>Forward</b> the message that asks for money to the bot. Or send <code>/check @their_username</code>.
          </li>
          <li>
            The bot answers <b>Waiting for the owner. Do not send money until this turns green.</b> Wait. The same message
            changes when the owner answers with their key.
          </li>
          <li>
            <b>Confirmed by the real owner</b> (green): it's them. <b>Not confirmed</b> (red): don't send money, and tell them another way. If the
            account hasn't set up Alat, call them on a number you already know.
          </li>
        </ol>
      </section>

      <section className="card guide">
        <h2>Protect your own account: link it once</h2>
        <p className="muted small">About 3 minutes. You need the QoreX wallet.</p>
        <ol>
          <li>
            Install <b>QoreX</b> (browser extension or phone app). Switch it to testnet: in the extension, tap the version number
            7 times, then <b>Switch to testnet (diana)</b>.
          </li>
          <li>
            Get free test QOR from the <a href="https://dashboard.qorechain.io/faucet">QoreChain faucet</a> for your{" "}
            <code>qor1…</code> address.
          </li>
          <li>
            Send <code>/link</code> to <a href={bot}>{handle}</a> in a private chat. Open the one-time link it sends, on the
            device where QoreX is installed.
          </li>
          <li>
            Connect QoreX and press <b>Sign and link</b>. QoreX signs a 1 uqor transfer to yourself, with your secp256k1 and
            ML-DSA-87 keys. On your first send it also registers your post-quantum key.
          </li>
          <li>
            Done. When someone checks a message from you, the bot tells you. Answer on <a href="/respond">alat /respond</a> with
            QoreX: <b>Yes, that's me</b> or <b>No, that's not me</b>.
          </li>
        </ol>
        <p className="small muted">
          Keep QoreX off the phone you chat on, if you can. If someone ever moves your account to another key, it waits 7 days
          and you can cancel it on <a href="/respond">/respond</a>.
        </p>
      </section>

      <section className="card guide">
        <h2>Just looking?</h2>
        <p style={{ margin: 0 }}>
          <a href="/demo">Watch Alat catch a hacker</a>, in your browser, in two minutes, or send <code>/demo</code> to the bot.
        </p>
      </section>
    </>
  );
}
