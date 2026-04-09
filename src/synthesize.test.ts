/**
 * Tests for the end-to-end `synthesize` helper. All providers + encoders are
 * injected, so these tests never spawn ffmpeg or hit a network.
 */

import { describe, test, expect } from "bun:test";
import { synthesize } from "./synthesize.ts";
import type { TtsProvider, TtsSynthesisResult } from "./tts-provider.ts";
import {
  NarrateError,
  NarrateEmptyInputError,
  NarrateNoProviderError,
  NarrateProviderError,
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
