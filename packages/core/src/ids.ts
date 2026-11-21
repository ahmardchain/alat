import { createHmac, randomBytes } from "node:crypto";
import { bech32 } from "@scure/base";

export type Hex32 = `0x${string}`;

/**
 * The on-chain id of a chat account: HMAC-SHA256(salt, "telegram:" + userId).
 *
 * The salt is a server secret. Telegram user ids are small integers, so a plain
 * hash could be reversed by trying every id; with the salt, the registry holds
 * no value an outsider can map back to a person.
 */
export function accountHash(salt: string, platform: "telegram" | "demo", userId: string | number): Hex32 {
  if (salt.length < 32) throw new Error("ALAT_ID_SALT must be at least 32 characters");
  const id = String(userId);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("invalid user id");
  return `0x${createHmac("sha256", salt).update(`${platform}:${id}`).digest("hex")}`;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l

/** A random token of `length` characters from an unambiguous alphabet (5 bits each). */
export function randomToken(length = 20): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! & 31];
  return out;
}

export function isToken(s: string, length = 20): boolean {
  return s.length === length && [...s].every((c) => ALPHABET.includes(c));
}

/** qor1… → 0x… (the same 20 bytes). */
export function qorToEvm(address: string): `0x${string}` {
  const { prefix, words } = bech32.decode(address as `${string}1${string}`);
  if (prefix !== "qor") throw new Error(`not a qor1 address: ${address}`);
  const bytes = bech32.fromWords(words);
  if (bytes.length !== 20) throw new Error(`not a 20-byte account: ${address}`);
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

/** 0x… → qor1… */
export function evmToQor(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`not an EVM address: ${address}`);
  return bech32.encode("qor", bech32.toWords(Buffer.from(address.slice(2), "hex")));
}

export function isQorAddress(s: string): boolean {
  try {
    qorToEvm(s);
    return true;
  } catch {
    return false;
  }
}

/** A native tx hash (64 hex) as the bytes32 the registry stores. */
export function txHashToBytes32(hash: string): Hex32 {
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`not a native tx hash: ${hash}`);
  return `0x${hash.toLowerCase()}`;
}

export function bytes32ToTxHash(b: string): string {
  return b.replace(/^0x/, "").toUpperCase();
}
