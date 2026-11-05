/**
 * Password unlock without a user database.
 *
 * One shared password (ACCESS_PASSWORD) unlocks LLM answers. Entering it sets a
 * cookie holding `<expires>.<signature>`: an HMAC of the expiry time. The server can
 * check the signature with its secret, and nobody without the secret can forge or
 * extend one. Nothing is stored server-side.
 *
 * The signing key mixes SESSION_SECRET with the password, so changing the password
 * invalidates every cookie already handed out: no session list to clear.
 */
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "rag_session";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // seconds

export type SessionEnv = { password?: string; secret?: string };

const fromEnv = (): SessionEnv => ({
  password: process.env.ACCESS_PASSWORD,
  secret: process.env.SESSION_SECRET,
});

const sha256 = (text: string) => createHash("sha256").update(text).digest();

function signingKey({ password, secret }: SessionEnv) {
  if (!password || !secret) return null;
  return createHash("sha256").update(secret).update("\0").update(password).digest();
}

function sign(key: Buffer, expires: number) {
  return createHmac("sha256", key).update(`v1:${expires}`).digest("base64url");
}

export function isConfigured(env = fromEnv()) {
  return signingKey(env) !== null;
}

export function passwordMatches(given: string, env = fromEnv()) {
  if (!env.password) return false;
  // Comparing fixed-length hashes with timingSafeEqual takes the same time whatever
  // was typed, so response timing can't reveal how much of a guess was right.
  return timingSafeEqual(sha256(given), sha256(env.password));
}

export function createToken(now = Date.now(), env = fromEnv()): string | null {
  const key = signingKey(env);
  if (!key) return null;
  const expires = Math.floor(now / 1000) + SESSION_MAX_AGE;
  return `${expires}.${sign(key, expires)}`;
}

export function verifyToken(token: string | undefined, now = Date.now(), env = fromEnv()) {
  const key = signingKey(env);
  if (!key || !token) return false;
  const [exp, sig, ...rest] = token.split(".");
  const expires = Number(exp);
  if (rest.length || !sig || !Number.isInteger(expires) || expires * 1000 <= now) return false;
  const expected = Buffer.from(sign(key, expires), "base64url");
  const given = Buffer.from(sig, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
