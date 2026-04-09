/**
 * Tests for the rewriter registry + `getRewriter` factory.
 *
 * The load-bearing contract: `getRewriter` always returns a callable,
 * never `null`. The integration in `synthesize.ts` (a follow-up PR) is
 * going to call the result unconditionally and rely on the `none`
 * fallthrough to mean "no rewrite happened". If that ever stops being
 * true, callers will start crashing.
 */

import { describe, test, expect, spyOn } from "bun:test";
import { getRewriter, rewriters } from "./rewriters.ts";

describe("getRewriter", () => {
  test("returns the identity rewriter when env is empty", async () => {
    const r = getRewriter({});
    expect(r).toBe(rewriters.none);
    expect(await r("hello")).toBe("hello");
  });

  test("returns the identity rewriter when TTS_REWRITE_PROVIDER=none", () => {
    expect(getRewriter({ TTS_REWRITE_PROVIDER: "none" })).toBe(rewriters.none);
  });

  test("is case-insensitive", () => {
    expect(getRewriter({ TTS_REWRITE_PROVIDER: "OLLAMA" })).toBe(
      rewriters.ollama,
    );
    expect(getRewriter({ TTS_REWRITE_PROVIDER: "Claude-CLI" })).toBe(
      rewriters["claude-cli"],
    );
  });

  test("resolves each known provider name to the matching rewriter", () => {
    const names = [
      "claude",
      "claude-cli",
      "ollama",
      "openai",
      "gemini",
      "groq",
      "custom",
    ] as const;
    for (const name of names) {
      expect(getRewriter({ TTS_REWRITE_PROVIDER: name })).toBe(rewriters[name]);
    }
  });

  test("falls back to identity + warns on unknown provider names", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = getRewriter({ TTS_REWRITE_PROVIDER: "not-a-real-provider" });
      expect(r).toBe(rewriters.none);
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0]![0]);
      expect(msg).toMatch(/not-a-real-provider/);
      expect(msg).toMatch(/none/);
    } finally {
      warn.mockRestore();
    }
  });

  test("does not let prototype keys like 'constructor' sneak through", () => {
    // Regression guard: an early version used `raw in rewriters`, which
    // walks the prototype chain. `constructor` would have passed the
    // guard and then crashed when invoked as a rewriter.
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = getRewriter({ TTS_REWRITE_PROVIDER: "constructor" });
      expect(r).toBe(rewriters.none);
    } finally {
      warn.mockRestore();
    }
  });

  test("defaults the env arg to process.env", async () => {
    const before = process.env.TTS_REWRITE_PROVIDER;
    delete process.env.TTS_REWRITE_PROVIDER;
    try {
      // No arg => reads process.env => no provider set => identity.
      expect(getRewriter()).toBe(rewriters.none);
    } finally {
      if (before === undefined) delete process.env.TTS_REWRITE_PROVIDER;
      else process.env.TTS_REWRITE_PROVIDER = before;
    }
  });
});

describe("rewriters registry", () => {
  test("none is an identity function", async () => {
    expect(await rewriters.none("anything at all")).toBe("anything at all");
    expect(await rewriters.none("")).toBe("");
  });

  test("exposes every documented provider name", () => {
    const expected = [
      "none",
      "claude",
      "claude-cli",
      "ollama",
      "openai",
      "gemini",
      "groq",
      "custom",
    ];
    expect(Object.keys(rewriters).sort()).toEqual(expected.sort());
  });
});
