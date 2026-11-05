import { describe, expect, it } from "vitest";
import {
  createToken,
  isConfigured,
  passwordMatches,
  SESSION_MAX_AGE,
  verifyToken,
} from "./session";

const env = { password: "hunter2", secret: "s".repeat(32) };
const now = Date.UTC(2026, 10, 5);

describe("password", () => {
  it("matches only the exact password", () => {
    expect(passwordMatches("hunter2", env)).toBe(true);
    expect(passwordMatches("hunter", env)).toBe(false);
    expect(passwordMatches("hunter22", env)).toBe(false);
    expect(passwordMatches("", env)).toBe(false);
  });

  it("never matches when no password is configured", () => {
    expect(passwordMatches("", {})).toBe(false);
    expect(isConfigured({ password: "x" })).toBe(false);
    expect(createToken(now, { secret: "x" })).toBeNull();
  });
});

describe("session token", () => {
  const token = createToken(now, env)!;

  it("verifies until it expires", () => {
    expect(verifyToken(token, now, env)).toBe(true);
    expect(verifyToken(token, now + (SESSION_MAX_AGE - 1) * 1000, env)).toBe(true);
    expect(verifyToken(token, now + SESSION_MAX_AGE * 1000, env)).toBe(false);
  });

  it("rejects a token whose expiry was pushed back", () => {
    const [exp, sig] = token.split(".");
    expect(verifyToken(`${Number(exp) + 3600}.${sig}`, now, env)).toBe(false);
  });

  it("rejects garbage and missing tokens", () => {
    for (const bad of [undefined, "", "abc", "123", "123.", ".sig", `${token}.extra`, "1e12.sig"])
      expect(verifyToken(bad, now, env)).toBe(false);
  });

  it("stops working when the password changes", () => {
    expect(verifyToken(token, now, { ...env, password: "new-password" })).toBe(false);
  });

  it("stops working when the secret changes", () => {
    expect(verifyToken(token, now, { ...env, secret: "t".repeat(32) })).toBe(false);
  });
});
