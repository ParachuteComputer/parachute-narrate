/**
 * Tests for the end-to-end `synthesize` helper. All providers + encoders are
 * injected, so these tests never spawn ffmpeg or hit a network.
 */

import { describe, test, expect } from "bun:test";
import { synthesize } from "./synthesize.ts";
import type { TtsProvider, TtsSynthesisResult } from "./tts-provider.ts";

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

  test("throws when text is empty after preprocessing", async () => {
    await expect(
      synthesize("```python\nprint('hi')\n```", {
        provider: fakeProvider(),
        encode: fakeEncode,
      }),
    ).rejects.toThrow(/empty after markdown preprocessing/);
  });

  test("throws when text is empty and preprocessing is skipped", async () => {
    await expect(
      synthesize("   ", {
        provider: fakeProvider(),
        encode: fakeEncode,
        skipMarkdownPreprocessing: true,
      }),
    ).rejects.toThrow(/empty after markdown preprocessing/);
  });

  test("throws when no provider is configured", async () => {
    await expect(
      synthesize("hello world", {
        env: {}, // no TTS_PROVIDER set
        encode: fakeEncode,
      }),
    ).rejects.toThrow(/no TTS provider configured/);
  });

  test("propagates provider errors", async () => {
    const failingProvider: TtsProvider = {
      name: "boom",
      async synthesize() {
        throw new Error("provider boom");
      },
    };
    await expect(
      synthesize("hello", { provider: failingProvider, encode: fakeEncode }),
    ).rejects.toThrow(/provider boom/);
  });

  test("propagates encoder errors", async () => {
    const failingEncode = async () => {
      throw new Error("encoder boom");
    };
    await expect(
      synthesize("hello", { provider: fakeProvider(), encode: failingEncode }),
    ).rejects.toThrow(/encoder boom/);
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
