/**
 * Tests for the end-to-end `synthesize` helper. All providers + encoders are
 * injected, so these tests never spawn ffmpeg or hit a network.
 */

import { describe, test, expect } from "bun:test";
import { synthesize } from "./synthesize.ts";
import type { TtsProvider, TtsSynthesisResult } from "./tts-provider.ts";
import type { Rewriter } from "./rewrite/rewriters.ts";
import {
  NarrateError,
  NarrateEmptyInputError,
  NarrateNoProviderError,
  NarrateProviderError,
  NarrateRewriterDegenerateError,
} from "./errors.ts";

function fakeProvider(
  calls: Array<{ text: string; voice?: string }> = [],
  overrides: Partial<TtsSynthesisResult> = {},
): TtsProvider {
  return {
    name: "fake",
    async synthesize(text, opts) {
      calls.push({ text, voice: opts?.voice });
      return {
        audio: Buffer.from("fake-audio-bytes"),
        mime: "audio/mpeg",
        ...overrides,
      };
    },
  };
}

async function fakeEncode(audio: Buffer, _mime: string): Promise<Buffer> {
  return Buffer.concat([Buffer.from("OggS"), audio]);
}

describe("synthesize", () => {
  test("happy path: preprocesses, synthesizes, encodes", async () => {
    const calls: Array<{ text: string; voice?: string }> = [];
    const result = await synthesize("# Hello\n\n**world**", {
      provider: fakeProvider(calls),
      encode: fakeEncode,
      voice: "af_heart",
    });

    // Markdown was stripped before the provider saw it.
    expect(calls.length).toBe(1);
    expect(calls[0]!.text).not.toContain("#");
    expect(calls[0]!.text).not.toContain("**");
    expect(calls[0]!.text).toContain("Hello");
    expect(calls[0]!.text).toContain("world");
    expect(calls[0]!.voice).toBe("af_heart");

    // Result is the fake-encoded output.
    expect(result.mime).toBe("audio/ogg");
    expect(result.provider).toBe("fake");
    expect(result.voice).toBe("af_heart");
    expect(result.audio.toString("ascii", 0, 4)).toBe("OggS");
  });

  test("skipMarkdownPreprocessing passes text through verbatim", async () => {
    const calls: Array<{ text: string; voice?: string }> = [];
    await synthesize("# not a header", {
      provider: fakeProvider(calls),
      encode: fakeEncode,
      skipMarkdownPreprocessing: true,
    });
    expect(calls[0]!.text).toBe("# not a header");
  });

  test("throws NarrateEmptyInputError when text is empty after preprocessing", async () => {
    // A note whose only content is a fenced code block collapses to empty
    // after markdownToSpeech — this is the canonical "unspeakable" case.
    let caught: unknown;
    try {
      await synthesize("```python\nprint('hi')\n```", {
        provider: fakeProvider(),
        encode: fakeEncode,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NarrateEmptyInputError);
    expect(caught).toBeInstanceOf(NarrateError);
    // Message preserved for back-compat with existing substring matches.
    expect((caught as Error).message).toContain("empty after markdown preprocessing");
    expect((caught as Error).name).toBe("NarrateEmptyInputError");
  });

  test("throws NarrateEmptyInputError when text is empty and preprocessing is skipped", async () => {
    await expect(
      synthesize("   ", {
        provider: fakeProvider(),
        encode: fakeEncode,
        skipMarkdownPreprocessing: true,
      }),
    ).rejects.toBeInstanceOf(NarrateEmptyInputError);
  });

  test("throws NarrateNoProviderError when no provider is configured", async () => {
    let caught: unknown;
    try {
      await synthesize("hello world", {
        env: {}, // no TTS_PROVIDER set
        encode: fakeEncode,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NarrateNoProviderError);
    expect(caught).toBeInstanceOf(NarrateError);
    expect((caught as Error).message).toContain("no TTS provider configured");
    expect((caught as Error).name).toBe("NarrateNoProviderError");
  });

  test("wraps provider failures in NarrateProviderError with cause + providerName", async () => {
    const original = new Error("provider boom");
    const failingProvider: TtsProvider = {
      name: "boom",
      async synthesize() {
        throw original;
      },
    };
    let caught: unknown;
    try {
      await synthesize("hello", { provider: failingProvider, encode: fakeEncode });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NarrateProviderError);
    expect(caught).toBeInstanceOf(NarrateError);
    const perr = caught as NarrateProviderError;
    expect(perr.providerName).toBe("boom");
    expect(perr.cause).toBe(original);
    // Message still contains the underlying cause text for logs + legacy
    // substring matches.
    expect(perr.message).toContain("provider boom");
  });

  test("wraps encoder failures in NarrateProviderError with providerName='encoder'", async () => {
    const original = new Error("encoder boom");
    const failingEncode = async () => {
      throw original;
    };
    let caught: unknown;
    try {
      await synthesize("hello", { provider: fakeProvider(), encode: failingEncode });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NarrateProviderError);
    const perr = caught as NarrateProviderError;
    expect(perr.providerName).toBe("encoder");
    expect(perr.cause).toBe(original);
    expect(perr.message).toContain("encoder boom");
  });

  test("default path: no rewriter configured leaves text unchanged and rewriterUsed='none'", async () => {
    const calls: Array<{ text: string; voice?: string }> = [];
    const result = await synthesize("# Hello\n\n**world**", {
      provider: fakeProvider(calls),
      encode: fakeEncode,
      env: {}, // explicitly no TTS_REWRITE_PROVIDER
    });
    expect(result.rewriterUsed).toBe("none");
    expect(result.rewritten).toBeUndefined();
    // Provider received the preprocessed text, not anything rewritten.
    expect(calls[0]!.text).toContain("Hello");
    expect(calls[0]!.text).not.toContain("**");
  });

  test("injected rewriter: provider receives rewritten text, result reports it", async () => {
    const calls: Array<{ text: string; voice?: string }> = [];
    const upper = async (t: string) => t.toUpperCase();

    const result = await synthesize("# Hello world", {
      provider: fakeProvider(calls),
      encode: fakeEncode,
      rewriter: upper,
    });

    // markdownToSpeech may add a trailing period; assert uppercased shape
    // rather than exact equality so we don't pin preprocessor punctuation.
    expect(calls[0]!.text).toMatch(/^HELLO WORLD/);
    expect(calls[0]!.text).toBe(calls[0]!.text.toUpperCase());
    expect(result.rewritten).toBe(calls[0]!.text);
    expect(result.rewriterUsed).toBe("injected");
  });

  test("rewriter receives the preprocessed text, not raw markdown", async () => {
    let seenByRewriter: string | undefined;
    const probe = async (t: string) => {
      seenByRewriter = t;
      return t;
    };
    await synthesize("# Heading\n\n**bold** and `code`", {
      provider: fakeProvider(),
      encode: fakeEncode,
      rewriter: probe,
    });
    expect(seenByRewriter).toBeDefined();
    // Markdown sigils should already be stripped before the rewriter sees it.
    expect(seenByRewriter).not.toContain("#");
    expect(seenByRewriter).not.toContain("**");
    expect(seenByRewriter).not.toContain("`");
    expect(seenByRewriter).toContain("Heading");
    expect(seenByRewriter).toContain("bold");
  });

  test("rewriter:null explicitly opts out even when env says otherwise", async () => {
    const calls: Array<{ text: string; voice?: string }> = [];
    const result = await synthesize("hello", {
      provider: fakeProvider(calls),
      encode: fakeEncode,
      env: { TTS_REWRITE_PROVIDER: "ollama" },
      rewriter: null,
      skipMarkdownPreprocessing: true,
    });
    expect(result.rewriterUsed).toBe("none");
    expect(result.rewritten).toBeUndefined();
    // Provider received the literal input — no ollama resolution attempted.
    expect(calls[0]!.text).toBe("hello");
  });

  test("opts.rewriter wins over env-resolved rewriter", async () => {
    const calls: Array<{ text: string; voice?: string }> = [];
    const tag = async (t: string) => `[tagged] ${t}`;
    const input = "This is a longer sentence that stays within the ratio bounds after tagging";
    const result = await synthesize(input, {
      provider: fakeProvider(calls),
      encode: fakeEncode,
      env: { TTS_REWRITE_PROVIDER: "ollama" }, // would normally hit ollama
      rewriter: tag,
    });
    expect(calls[0]!.text).toBe(`[tagged] ${input}`);
    expect(result.rewriterUsed).toBe("injected");
  });

  test("rewriter failures are wrapped in NarrateProviderError with cause", async () => {
    const original = new Error("rewrite api 500");
    const exploding: Rewriter = async () => {
      throw original;
    };
    let caught: unknown;
    try {
      await synthesize("hello", {
        provider: fakeProvider(),
        encode: fakeEncode,
        rewriter: exploding,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NarrateProviderError);
    const perr = caught as NarrateProviderError;
    expect(perr.providerName).toBe("rewriter:injected");
    expect(perr.cause).toBe(original);
    expect(perr.message).toContain("rewrite api 500");
  });

  test("rewriter returning empty string throws NarrateEmptyInputError", async () => {
    const eraser: Rewriter = async () => "   ";
    let caught: unknown;
    try {
      await synthesize("hello world", {
        provider: fakeProvider(),
        encode: fakeEncode,
        rewriter: eraser,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NarrateEmptyInputError);
    expect((caught as Error).message).toContain("after rewrite");
    expect((caught as Error).message).toContain("injected");
  });

  test("rewriter output too long throws NarrateRewriterDegenerateError", async () => {
    const bloater: Rewriter = async (t) => t.repeat(3);
    let caught: unknown;
    try {
      await synthesize("hello world this is a test sentence", {
        provider: fakeProvider(),
        encode: fakeEncode,
        rewriter: bloater,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NarrateRewriterDegenerateError);
    const derr = caught as NarrateRewriterDegenerateError;
    expect(derr.ratio).toBeGreaterThan(1.5);
    expect(derr.rewriter).toBe("injected");
  });

  test("rewriter output too short throws NarrateRewriterDegenerateError", async () => {
    const truncator: Rewriter = async (t) => t.slice(0, 5);
    let caught: unknown;
    try {
      await synthesize("this is a much longer input that will be severely truncated by the rewriter", {
        provider: fakeProvider(),
        encode: fakeEncode,
        rewriter: truncator,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NarrateRewriterDegenerateError);
    const derr = caught as NarrateRewriterDegenerateError;
    expect(derr.ratio).toBeLessThan(0.5);
  });

  test("quality gate bounds are configurable via env", async () => {
    const doubler: Rewriter = async (t) => t + t;
    const calls: Array<{ text: string; voice?: string }> = [];
    // With default bounds (1.5), doubling would fail. With max_ratio=3.0, it passes.
    const result = await synthesize("hello world this is some text", {
      provider: fakeProvider(calls),
      encode: fakeEncode,
      rewriter: doubler,
      env: { TTS_REWRITE_MAX_RATIO: "3.0" },
    });
    expect(result.rewriterUsed).toBe("injected");
    expect(calls.length).toBe(1);
  });

  test("env-resolved rewriter: TTS_REWRITE_PROVIDER=none skips rewriting", async () => {
    const calls: Array<{ text: string; voice?: string }> = [];
    const result = await synthesize("hello", {
      provider: fakeProvider(calls),
      encode: fakeEncode,
      env: { TTS_REWRITE_PROVIDER: "none" },
      skipMarkdownPreprocessing: true,
    });
    expect(result.rewriterUsed).toBe("none");
    expect(result.rewritten).toBeUndefined();
    expect(calls[0]!.text).toBe("hello");
  });

  test("unknown TTS_PROVIDER in env resolves to no provider", async () => {
    // `getTtsProvider` warns + returns null for unknown providers, so
    // synthesize must surface the same "no provider configured" error
    // as the empty-env case.
    const warn = console.warn;
    console.warn = () => {};
    try {
      await expect(
        synthesize("hello", {
          env: { TTS_PROVIDER: "bogus" },
          encode: fakeEncode,
        }),
      ).rejects.toThrow(/no TTS provider configured/);
    } finally {
      console.warn = warn;
    }
  });
});
