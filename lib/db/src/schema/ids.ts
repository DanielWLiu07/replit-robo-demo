import { randomBytes } from "node:crypto";

/**
 * Crockford-ish base32: no i/l/o/u, so ids never read as a word and never get
 * mistyped. Ids are prefixed (`bot_`, `mch_`) so a bare id in a log line or a
 * URL says what it is without a lookup.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function newId(prefix: string, length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}_${out}`;
}

/** Match seeds are ids too — they are the whole replay, so they get shown. */
export function newSeed(): string {
  return newId("seed", 10);
}
