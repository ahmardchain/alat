# Demo video script (≤ 3:00)

Screen recording at 1280×720, browser plus Telegram desktop side by side. No
music under speech. Every on-screen hash is real; nothing is mocked.

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00 | A Telegram chat. One message arrives from "Maya": *"Hi, it's me. I'm stuck abroad and my card is blocked. Can you send 200 urgently?"* | "This is how most account-takeover scams end. The hacker has Maya's account, her name and her chat history. Her friends have no way to check." |
| 0:12 | Title card: belief line. | "A hacked account can copy your words. It can't copy your key." |
| 0:20 | Maya sends `/link` to the Alat bot, opens the one-time link, connects QoreX, approves. | "Before anything goes wrong, Maya links her Telegram account to her QoreChain key, once. QoreX signs a transaction with two keys: secp256k1 and ML-DSA-87, a post-quantum signature." |
| 0:38 | Explorer (Testnet): the link transaction, 4,627-byte ML-DSA-87 signature, `pqc_hybrid_verify: verified`. Then the AlatRegistry write. | "The chain checks both. Alat records the binding in a contract on QoreChain: a salted hash of her Telegram id, never the id itself." |
| 0:50 | Hacker's view: the "stuck abroad" message sent to Sam. | "Now Maya's account is hacked, and Sam gets the message." |
| 1:00 | Sam forwards it to the Alat bot. The bot replies ⏳ *Waiting for the owner. Do not send money until this turns green.* | "Sam forwards it to Alat. Alat asks the only thing the hacker doesn't have: Maya's key." |
| 1:15 | The hacker tries `/link` from Maya's Telegram with their own key. Bot: *A link to a NEW key was requested. It takes effect in 7 days…* Sam's check now shows ⚠️ link change pending. | "The hacker tries to re-link her account to their own key. The contract makes that wait seven days, in public, and flags every check." |
| 1:40 | Maya, on her laptop (locked out of Telegram), opens alat `/respond`, connects QoreX, sees the request text, presses **No, that's not me**, approves. | "Maya is locked out of Telegram, but she still has her key. She answers from her laptop." |
| 1:55 | Sam's bot message changes in place to ❌ *The owner says this is NOT them.* | "Sam's message turns red. The hacker is caught, while still typing." |
| 2:05 | Maya cancels the pending re-link on /respond. | "And Maya cancels the hacker's re-link with the same key." |
| 2:15 | A second, real request → Maya presses **Yes** → ✅ in Sam's chat. | "When it really is her, it turns green." |
| 2:20 | /demo: "What Alat refuses" table and the live proof numbers. | "Alat refuses a different key, a replayed answer, an answer meant for another account, a late answer, and anything without a valid post-quantum signature. Each has a test, and the numbers here are read live from the testnet." |
| 2:45 | Belief line, URL, "Built for Build Before Q-Day". | "A hacked account can copy your words. It can't copy your key." |

## Before recording

- Use two testnet QoreX accounts with QOR from the faucet; register Maya's key with one send first.
- Explorer: select **Testnet** first (it remembers the choice in a cookie).
- Keep the bot server running in a stable place; record the bot's real replies.
