import { Mark } from "./Logo.js";
import { Check } from "./pages/Check.js";
import { Link } from "./pages/Link.js";
import { Respond } from "./pages/Respond.js";
import { Wallet } from "./pages/Wallet.js";

function Home() {
  return (
    <>
      <h1>
        A hacked account can copy your words. <br />
        It can't copy your key.
      </h1>
      <p className="lede">
        Alat lets friends check a money request with the sender's QoreChain key, not their chat account. Telegram
        first.
      </p>
      <div className="row">
        <a className="button" href="/respond">
          Answer a check
        </a>
        <a className="button secondary" href="/wallet">
          Check your wallet
        </a>
      </div>
      <p className="muted small" style={{ marginTop: 32 }}>
        Being built for Build Before Q-Day. Testnet only.
      </p>
    </>
  );
}

const ROUTES: Record<string, () => JSX.Element> = { "/": Home, "/wallet": Wallet, "/link": Link, "/respond": Respond };

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const checkId = /^\/c\/([a-z0-9]{12})$/.exec(path)?.[1];
  const Page = checkId ? () => <Check id={checkId} /> : ROUTES[path];
  return (
    <div className="wrap">
      <header className="top">
        <a className="brand" href="/">
          <Mark /> alat
        </a>
        <nav className="links">
          <a href="/respond">Respond</a>
          <a href="/wallet">Wallet</a>
          <a href="https://github.com/ahmardchain/alat">GitHub</a>
        </nav>
      </header>
      <main>{Page ? <Page /> : <p>Page not found. <a href="/">Back to Alat</a></p>}</main>
      <footer>Testnet only (qorechain-diana). No real funds.</footer>
    </div>
  );
}
