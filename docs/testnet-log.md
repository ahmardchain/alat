# Testnet log

Every address and transaction Alat has used on the QoreChain testnet
(`qorechain-diana`, EVM chain id 9800). Native transactions: open
<https://explore.qore.network>, select **Testnet**, then search the hash (the
explorer picks the network from a cookie), or read the raw JSON at
`https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/<hash>`.

## Addresses

| What | Address |
| --- | --- |
| AlatRegistry (EVM) | `0x431da38e11e27ba0e74ba06a4fbce7b86d1570ec` |
| Relayer (only writer of the registry) | `qor1md44fjsld8rjzx2r2hhyquw2wldm60a2dqlalk` = `0xdb6B54Ca1F69c721194355EE4071Ca77dbbd3faa` |
| Demo owner (server-held, for /judge) | `qor1psnx8dzwy3trwqg279zzr93l5ksd2ktgnsgp40` = `0x0C2663b44E245637010AF14421963FA5a0D55968` |
| Test owner (QoreX wallet mock in the e2e tests) | `qor1zrmp2jdwfq8kdv4u7ug5n7xvqnl8lpnl7s3etz` |
| PQC Key Status precompile | `0x0000000000000000000000000000000000000a02` |

## Day 1 to 3 (18 to 19 Nov 2026)

| When | What | Transaction |
| --- | --- | --- |
| 19 Nov | Relayer registers its ML-DSA-87 key (the one classical tx the chain allows) | `18E93D745780C4751BCE05301A095D349CBE50901E04B6456F355E47BDFB9413` |
| 19 Nov | **First hybrid-signed tx** (secp256k1 + 4,627-byte ML-DSA-87; `pqc_hybrid_verify: verified`) | `D17E9DDC1DAD4D8AEF248B6E1C3EC46C43076DF81A8705BB8D8476CC8B1D8162` |
| 19 Nov | Relayer opens an EVM window (hybrid native message) | `2787CFC0FE04D9B9044563DC1E834F734E2B9A738D56F83C1CB40A0BD26FC798` |
| 19 Nov | AlatRegistry deployed | EVM `0xc7343c04655ec79bb98c395a0263d2192a8d9b366492c30ef2a0aad25d154473` (block 10387468) |
| 19 Nov | Fund the test owner / demo owner | `F681CD4D7F56F016069A461B8818052CBE5FD8C13CEA38DE10FFDBACB68F5883`, `2245EF371993EB0DABCEB1FFF19CBB4D80CB4A191921E24F25A784F95E14E4DB` |

### End-to-end run (apps/web/e2e/flow.live.spec.ts)

The QoreX wallet mock signs as the owner; every owner action is a hybrid-signed
self-send whose memo carries the action.

| Step | Native tx (signed by) | Result |
| --- | --- | --- |
| Link (run 1) | `85C54BB278D78A9D61009A07300C1767D21C4FC87A0509EF3D9704306A180BE2` (owner) | registry `link`, EVM `0x130ca32f929f08812b2eb06c6b86382da3d5c35e57c73af2e233dcf7f6693693` |
| "No, that's not me" | `7EC012981137D656BB8593723987EFDB12202B38850F874B5457FD6E7F449BE1` (owner) | ❌ denied |
| Answer signed by another registered key | `DBE276F5ED0C916455D6232AA8778BE8337D9CCF8A8AA776B8CFCE56C3BE458C` (relayer) | refused: `wrong-signer` |
| "Yes, that's me" | `5E96BD3B1B3AA575CFD2CD5B4FED1B175AC0681B1EFA431454EE684FE0208537` (owner) | ✅ confirmed |
| Link (run 2, new account) | `87E27E8E9974BD4F59C8F3E091D66F7E7F70D4F94C3F5F483AF43E691F1165C3` (owner) | registry `link` |
| "No, that's not me" | `23B09B0D0A560E8D3FB6896CCD4C79758F3A9E14E6AC393ED3DB0EB53F33D47A` (owner) | ❌ denied |
| Answer signed by another registered key | `90590760241B0FAAFDE60A90634739DDA7B4850516E44C1CF87A11409EFA1655` (relayer) | refused: `wrong-signer` |
| "Yes, that's me" | `5D04BE1D72DFF92F856CA45D219344FA82F8A69C53636DE481DD55D23FCA59C3` (owner) | ✅ confirmed |
| Hacker re-link from Telegram alone | `F9E471C983F523364E1893EB37E2EBE94095D97A99A9FA97E61F07A948386D79` (relayer as hacker) | registry `requestChange`, EVM `0xf760567142b6d765efa0e0879dd77fef508de98fd401de492aa27cbfe1383628`, unlocks 26 Nov |
| Owner cancels it | `24D5AC9AF5E8DB01253151609D80BEC88D84E275ECC8BD51571336EE11849529` (owner) | registry `cancelChange` |

## Day 4 (20 Nov 2026): judge demo account

The demo account `@alat_demo` (a `demo:` id, not a Telegram user) is linked to
the demo owner key through the normal link path.

| Step | Transaction | Result |
| --- | --- | --- |
| Demo owner registers its ML-DSA-87 key | `E6ED571BFE175D9AE773F817E1E4A8D9FE9D1DD586E23D55393E615BA76BE8B4` | key registered with proof of possession |
| Demo link (hybrid self-send with the link memo) | `D29BD793982ECA6D3CDCB3B98F7DD699574644D28F9697071582194AD618175F` | registry `link`, EVM `0xe3a4084aa9461944ad234cef58cf6b87e8e90d0a47bb42258ad2c6955bafd515` |
| Relayer opens an EVM window | `A3ADE0AA0D0A3BF8FD9BC0052FEFDBF1AC49206BE1CE4A94EDC6C41CC0A2C8BA` | |
| /judge: "hacker" key answers yes | `4BC06823D5AB62EBCD1F8EF6B205C3F4B7BE312840895AFBEB0191D6744F41E4` | refused: `wrong-signer` |
| /judge: owner "not me" | `8EEF3F6297A1DD333404CB25EA8D4BD6214345927A4C82FDF1AABA083E663CA4` | ❌ denied |
| /judge: owner "yes" | `69F3195C39642410FD679A65D49AA713FDA55187E974D11B0D212A7E52BAC1B9` | ✅ confirmed |
