/**
 * Tests for the TTS provider factory and the Kokoro provider command builder.
 *
 * Never hits ElevenLabs or spawns a real Kokoro Python process — all
 * subprocess work goes through the injectable spawner stub.
 */

import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildKokoroCommand,
  createKokoroProvider,
  getTtsProvider,
  resolveKokoroConfig,
  type KokoroConfig,
} from "./tts-provider.ts";

describe("getTtsProvider factory", () => {
  test("returns null when TTS_PROVIDER is unset", () => {
    expect(getTtsProvider({})).toBeNull();
  });

  test("returns null when TTS_PROVIDER=none", () => {
    expect(getTtsProvider({ TTS_PROVIDER: "none" })).toBeNull();
  });

  test("returns null when elevenlabs selected without API key", () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(getTtsProvider({ TTS_PROVIDER: "elevenlabs" })).toBeNull();
    } finally {
      console.warn = warn;
    }
  });

  test("returns elevenlabs provider when configured", () => {
    const provider = getTtsProvider({
      TTS_PROVIDER: "elevenlabs",
      ELEVENLABS_API_KEY: "sk-test",
    });
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("elevenlabs");
  });

  test("returns kokoro provider when TTS_PROVIDER=kokoro (no API key needed)", () => {
    const provider = getTtsProvider({ TTS_PROVIDER: "kokoro" });
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("kokoro");
  });

  test("returns null for unknown providers", () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(getTtsProvider({ TTS_PROVIDER: "bogus" })).toBeNull();
    } finally {
      console.warn = warn;
    }
  });
});

describe("Kokoro provider", () => {
  const baseConfig: KokoroConfig = {
    bin: "uvx",
    model: "prince-canuma/Kokoro-82M",
    voice: "af_heart",
    extraArgs: [],
    timeoutMs: 300_000,
  };

  test("buildKokoroCommand wraps uvx with --from mlx-audio and required extras", () => {
    const argv = buildKokoroCommand(baseConfig, "hello", "/tmp/work", "out");
    expect(argv[0]).toBe("uvx");
    // The first positional chunk must pull in mlx-audio plus misaki[en] and
    // num2words, which mlx-audio imports at runtime but does not declare.
    expect(argv).toContain("--from");
    expect(argv[argv.indexOf("--from") + 1]).toBe("mlx-audio");
    const withFlags: string[] = [];
    for (let i = 0; i < argv.length - 1; i++) {
      if (argv[i] === "--with") withFlags.push(argv[i + 1]!);
    }
    expect(withFlags).toContain("misaki[en]");
    expect(withFlags).toContain("num2words");
    // python -m mlx_audio.tts.generate ...
    expect(argv).toContain("python");
    expect(argv).toContain("mlx_audio.tts.generate");
    // Env-driven flags should be present.
    const i = (f: string) => argv.indexOf(f);
    expect(argv[i("--model") + 1]).toBe("prince-canuma/Kokoro-82M");
    expect(argv[i("--voice") + 1]).toBe("af_heart");
    expect(argv[i("--audio_format") + 1]).toBe("wav");
    expect(argv[i("--output_path") + 1]).toBe("/tmp/work");
    expect(argv[i("--file_prefix") + 1]).toBe("out");
    expect(argv[i("--text") + 1]).toBe("hello");
    // --join_audio ensures a single `out.wav` regardless of segment count.
    expect(argv).toContain("--join_audio");
  });

  test("buildKokoroCommand honors env-derived overrides", () => {
    const config: KokoroConfig = {
      bin: "uvx",
      model: "custom/model-id",
      voice: "bf_emma",
      extraArgs: ["--speed", "1.2"],
      timeoutMs: 300_000,
    };
    const argv = buildKokoroCommand(config, "hi", "/tmp/w", "x");
    expect(argv[argv.indexOf("--model") + 1]).toBe("custom/model-id");
    expect(argv[argv.indexOf("--voice") + 1]).toBe("bf_emma");
    // Extra args appended after the required flags.
    expect(argv.slice(-2)).toEqual(["--speed", "1.2"]);
  });

  test("buildKokoroCommand respects per-call voice override", () => {
    const argv = buildKokoroCommand(baseConfig, "hello", "/tmp/w", "x", "af_bella");
    expect(argv[argv.indexOf("--voice") + 1]).toBe("af_bella");
  });

  test("buildKokoroCommand uses direct bin invocation when not uvx", () => {
    const config: KokoroConfig = {
      ...baseConfig,
      bin: "/usr/bin/python3",
    };
    const argv = buildKokoroCommand(config, "hi", "/tmp/w", "x");
    expect(argv[0]).toBe("/usr/bin/python3");
    expect(argv[1]).toBe("-m");
    expect(argv[2]).toBe("mlx_audio.tts.generate");
  });

  test("createKokoroProvider writes a WAV and returns its bytes (stubbed spawner)", async () => {
    // Stub spawner: simulate the Python process writing the expected WAV
    // file to the output_path / file_prefix location it was given.
    const provider = createKokoroProvider(baseConfig, async (argv, _timeoutMs) => {
      const outIdx = argv.indexOf("--output_path");
      const prefixIdx = argv.indexOf("--file_prefix");
      const outDir = argv[outIdx + 1]!;
      const prefix = argv[prefixIdx + 1]!;
      const path = join(outDir, `${prefix}.wav`);
      // "RIFF....WAVE" — not a valid WAV body, but enough for a byte-count
      // check in the test.
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path, Buffer.from("RIFF0000WAVEfmt "));
      return { exitCode: 0, stderr: "" };
    });

    const result = await provider.synthesize("Hello from Kokoro");
    expect(result.mime).toBe("audio/wav");
    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(result.audio.toString("ascii", 0, 4)).toBe("RIFF");
  });

  test("createKokoroProvider throws on non-zero exit", async () => {
    const provider = createKokoroProvider(baseConfig, async () => ({
      exitCode: 2,
      stderr: "model not found",
    }));
    await expect(provider.synthesize("hello")).rejects.toThrow(/exited with code 2/);
  });

  test("createKokoroProvider throws if the output WAV is missing", async () => {
    const provider = createKokoroProvider(baseConfig, async () => ({
      exitCode: 0,
      stderr: "",
    }));
    await expect(provider.synthesize("hello")).rejects.toThrow(
      /expected output file .* was not created/,
    );
  });

  test("createKokoroProvider forwards per-call voice override to the command", async () => {
    let capturedVoice: string | undefined;
    const provider = createKokoroProvider(baseConfig, async (argv) => {
      capturedVoice = argv[argv.indexOf("--voice") + 1];
      const outDir = argv[argv.indexOf("--output_path") + 1]!;
      const prefix = argv[argv.indexOf("--file_prefix") + 1]!;
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `${prefix}.wav`), Buffer.from("RIFF"));
      return { exitCode: 0, stderr: "" };
    });
    await provider.synthesize("hi", { voice: "af_bella" });
    expect(capturedVoice).toBe("af_bella");
  });

  test("getTtsProvider resolves KOKORO_* env vars into the Kokoro config", () => {
    const provider = getTtsProvider({
      TTS_PROVIDER: "kokoro",
      KOKORO_MODEL: "prince-canuma/Kokoro-82M",
      KOKORO_VOICE: "bm_george",
      TTS_VOICE: "ignored-because-kokoro-voice-wins",
    });
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("kokoro");
  });

  test("resolveKokoroConfig applies voice precedence: KOKORO_VOICE > TTS_VOICE > default", () => {
    const bothSet = resolveKokoroConfig({
      KOKORO_VOICE: "kokoro-wins",
      TTS_VOICE: "shared-tts-voice",
    });
    expect(bothSet.voice).toBe("kokoro-wins");

    const onlyTts = resolveKokoroConfig({ TTS_VOICE: "shared-tts-voice" });
    expect(onlyTts.voice).toBe("shared-tts-voice");

    const neither = resolveKokoroConfig({});
    expect(neither.voice).toBe("af_heart");
  });

  test("resolveKokoroConfig honors KOKORO_TIMEOUT_MS override and falls back on non-numeric", () => {
    const override = resolveKokoroConfig({ KOKORO_TIMEOUT_MS: "12345" });
    expect(override.timeoutMs).toBe(12345);

    const bogus = resolveKokoroConfig({ KOKORO_TIMEOUT_MS: "not-a-number" });
    expect(bogus.timeoutMs).toBe(300_000);

    const unset = resolveKokoroConfig({});
    expect(unset.timeoutMs).toBe(300_000);
  });

  test("createKokoroProvider cleans up workDir after a non-zero exit", async () => {
    let capturedWorkDir: string | undefined;
    const provider = createKokoroProvider(baseConfig, async (argv) => {
      capturedWorkDir = argv[argv.indexOf("--output_path") + 1];
      return { exitCode: 2, stderr: "boom" };
    });
    await expect(provider.synthesize("hello")).rejects.toThrow(/exited with code 2/);
    expect(capturedWorkDir).toBeTruthy();
    expect(existsSync(capturedWorkDir!)).toBe(false);
  });

  test("createKokoroProvider cleans up workDir when the output file is missing", async () => {
    let capturedWorkDir: string | undefined;
    const provider = createKokoroProvider(baseConfig, async (argv) => {
      capturedWorkDir = argv[argv.indexOf("--output_path") + 1];
      return { exitCode: 0, stderr: "" };
    });
    await expect(provider.synthesize("hello")).rejects.toThrow(
      /expected output file .* was not created/,
    );
    expect(capturedWorkDir).toBeTruthy();
    expect(existsSync(capturedWorkDir!)).toBe(false);
  });
});
