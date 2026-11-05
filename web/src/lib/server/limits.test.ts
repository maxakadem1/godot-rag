import { describe, expect, it } from "vitest";
import { DAILY_ANSWER_LIMIT, MemoryStore, spendAnswer, type LimitStore } from "./limits";

describe("MemoryStore sliding window", () => {
  it("allows max hits per window, per id, then says when to retry", async () => {
    let t = 0;
    const store = new MemoryStore(() => t);
    const bucket = { max: 2, windowS: 60 };
    expect((await store.hit("ask", "a", bucket)).ok).toBe(true);
    t = 30_000;
    expect((await store.hit("ask", "a", bucket)).ok).toBe(true);
    expect(await store.hit("ask", "a", bucket)).toEqual({ ok: false, retryAfterS: 30 });
    expect((await store.hit("ask", "b", bucket)).ok).toBe(true); // other ids unaffected
    t = 60_000; // the first hit has left the window
    expect((await store.hit("ask", "a", bucket)).ok).toBe(true);
  });
});

describe("daily answer budget", () => {
  it("allows the limit, then refuses, and starts over the next day", async () => {
    const store = new MemoryStore();
    const day1 = new Date("2026-11-05T10:00:00Z");
    for (let i = 0; i < DAILY_ANSWER_LIMIT; i++) expect(await spendAnswer(store, day1)).toBe(true);
    expect(await spendAnswer(store, day1)).toBe(false);
    expect(await spendAnswer(store, new Date("2026-11-06T00:00:01Z"))).toBe(true);
  });

  it("refuses when the counter can't be reached (fails closed)", async () => {
    const broken: LimitStore = {
      hit: async () => ({ ok: true }),
      increment: async () => {
        throw new Error("redis down");
      },
    };
    const error = console.error;
    console.error = () => {};
    try {
      expect(await spendAnswer(broken)).toBe(false);
    } finally {
      console.error = error;
    }
  });
});
