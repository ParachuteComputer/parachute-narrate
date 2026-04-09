/**
 * TTS (text-to-speech) provider abstraction.
 *
 * The factory reads env vars and returns a configured provider or null.
 * Two reference implementations ship today:
 *
 *   - ElevenLabs (cloud, mp3 out)
 *   - Kokoro-82M via mlx-audio (local, wav out)
 *
 * Additional providers (XTTS, F5, etc.) can slot into the same interface
 * without touching callers.
 *
 * Env vars:
 *   TTS_PROVIDER=elevenlabs|kokoro|none  # default: none
 *   TTS_VOICE=<voice_id>                 # provider-specific (shared fallback)
 *   ELEVENLABS_API_KEY=<key>
 *   ELEVENLABS_MODEL=<model_id>          # optional, default eleven_multilingual_v2
 *   KOKORO_BIN=<path>                    # optional, default "uvx" — launcher
 *                                        #   for the mlx_audio Python package
 *   KOKORO_MODEL=<hf_repo_id>            # optional, default
 *                                        #   "prince-canuma/Kokoro-82M"
 *   KOKORO_VOICE=<voice_preset>          # optional, default "af_heart";
 *                                        #   falls back to TTS_VOICE if unset
 *   KOKORO_PYTHON_ARGS=<extra args>      # optional, space-separated; appended
 *                                        #   to the generate.py invocation.
 *                                        #   Values containing spaces within
 *                                        #   a single arg are not supported —
 *                                        #   args are whitespace-split.
 *   KOKORO_TIMEOUT_MS=<int ms>           # optional, default 300000 (5 min);
 *                                        #   subprocess timeout. Non-numeric
 *                                        #   values fall back to the default.
 */

import { mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface TtsSynthesisResult {
  audio: Buffer;
  mime: string;
  /** Optional duration in seconds, if the provider reports it. */
  duration?: number;
}

export interface TtsProvider {
  name: string;
  synthesize(text: string, opts?: { voice?: string }): Promise<TtsSynthesisResult>;
}

// ---------------------------------------------------------------------------
// ElevenLabs
// ---------------------------------------------------------------------------

function createElevenLabsProvider(apiKey: string, defaultModel: string): TtsProvider {
  return {
    name: "elevenlabs",
    async synthesize(text: string, opts?: { voice?: string }): Promise<TtsSynthesisResult> {
      const voice = opts?.voice;
      if (!voice) {
        throw new Error("ElevenLabs TTS requires a voice id (set TTS_VOICE or pass opts.voice)");
      }
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: defaultModel,
          output_format: "mp3_44100_128",
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`ElevenLabs TTS error (${res.status}): ${body}`);
      }
      const audio = Buffer.from(await res.arrayBuffer());
      return { audio, mime: "audio/mpeg" };
    },
  };
}

// ---------------------------------------------------------------------------
// Kokoro (local, via Python + mlx-audio)
// ---------------------------------------------------------------------------

/**
 * Configuration resolved from env vars for the Kokoro provider.
 * Exposed for testing — see `buildKokoroCommand`.
 */
export interface KokoroConfig {
  /** Launcher binary. Default "uvx". */
  bin: string;
  /** mlx-audio HF repo id. Default "prince-canuma/Kokoro-82M". */
  model: string;
  /** Default voice preset. Default "af_heart". */
  voice: string;
  /** Optional extra args appended to the generate.py invocation. */
  extraArgs: string[];
  /** Subprocess timeout in milliseconds. Default 300_000 (5 min). */
  timeoutMs: number;
}

const KOKORO_DEFAULTS = {
  bin: "uvx",
  model: "prince-canuma/Kokoro-82M",
  voice: "af_heart",
  // First run downloads the model (~400MB) so we want generous headroom.
  // Steady-state generation is 3-30s. Callers surface timeouts as errors.
  timeoutMs: 300_000,
} as const;

export function resolveKokoroConfig(env: Record<string, string | undefined>): KokoroConfig {
  const extraRaw = env.KOKORO_PYTHON_ARGS ?? "";
  const extraArgs = extraRaw.trim().length > 0 ? extraRaw.trim().split(/\s+/) : [];
  const timeoutRaw = env.KOKORO_TIMEOUT_MS;
  const parsedTimeout = timeoutRaw !== undefined ? parseInt(timeoutRaw, 10) : NaN;
  const timeoutMs = Number.isFinite(parsedTimeout) ? parsedTimeout : KOKORO_DEFAULTS.timeoutMs;
  return {
    bin: env.KOKORO_BIN ?? KOKORO_DEFAULTS.bin,
    model: env.KOKORO_MODEL ?? KOKORO_DEFAULTS.model,
    voice: env.KOKORO_VOICE ?? env.TTS_VOICE ?? KOKORO_DEFAULTS.voice,
    extraArgs,
    timeoutMs,
  };
}

/**
 * Build the argv for launching mlx-audio's generate.py. Pure function —
 * returns `[bin, ...args]`. Exposed so tests can assert the exact command
 * without actually spawning Python.
 */
export function buildKokoroCommand(
  config: KokoroConfig,
  text: string,
  outputDir: string,
  filePrefix: string,
  voiceOverride?: string,
): string[] {
  const voice = voiceOverride ?? config.voice;
  const argv: string[] = [];
  // If using uvx, we need `--from mlx-audio` so the tool provides mlx_audio,
  // plus `--with misaki[en] --with num2words` because the Kokoro model in
  // mlx-audio has these as hard runtime imports that aren't declared in the
  // package's own dependencies. Anything else (e.g. a direct python path)
  // is assumed to already have these importable.
  if (/(^|\/)uvx$/.test(config.bin)) {
    argv.push(
      config.bin,
      "--from",
      "mlx-audio",
      "--with",
      "misaki[en]",
      "--with",
      "num2words",
      "python",
    );
  } else {
    argv.push(config.bin);
  }
  argv.push(
    "-m",
    "mlx_audio.tts.generate",
    "--model",
    config.model,
    "--voice",
    voice,
    "--audio_format",
    "wav",
    "--output_path",
    outputDir,
    "--file_prefix",
    filePrefix,
    // With --join_audio, mlx-audio writes a single `{file_prefix}.wav`
    // regardless of how many internal segments the model produced. Without
    // this, longer inputs would split into `{file_prefix}_000.wav`,
    // `{file_prefix}_001.wav`, ... and we'd have to concat ourselves.
    "--join_audio",
    "--text",
    text,
  );
  if (config.extraArgs.length > 0) argv.push(...config.extraArgs);
  return argv;
}

/**
 * Injectable spawn surface — lets tests stub subprocess execution without
 * touching `Bun.spawn` globally. Returns the process exit code and any
 * captured stderr (used for error messages).
 */
export type KokoroSpawner = (argv: string[], timeoutMs: number) => Promise<{
  exitCode: number;
  stderr: string;
}>;

const defaultSpawner: KokoroSpawner = async (argv, timeoutMs) => {
  const proc = Bun.spawn(argv, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }, timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  const stderr = await new Response(proc.stderr).text();
  // Drain stdout so the pipe doesn't back up (we don't use its contents).
  try {
    await new Response(proc.stdout).text();
  } catch {
    // ignore
  }

  if (timedOut) {
    throw new Error(
      `Kokoro TTS subprocess timed out after ${timeoutMs}ms. stderr: ${stderr.slice(0, 500)}`,
    );
  }
  return { exitCode: exitCode ?? -1, stderr };
};

export function createKokoroProvider(
  config: KokoroConfig,
  spawner: KokoroSpawner = defaultSpawner,
): TtsProvider {
  return {
    name: "kokoro",
    async synthesize(text: string, opts?: { voice?: string }): Promise<TtsSynthesisResult> {
      if (!text || text.trim().length === 0) {
        throw new Error("Kokoro TTS: refusing to synthesize empty text");
      }
      const workDir = join(
        tmpdir(),
        `kokoro-tts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(workDir, { recursive: true });
      const filePrefix = "out";
      const outPath = join(workDir, `${filePrefix}.wav`);

      try {
        const argv = buildKokoroCommand(config, text, workDir, filePrefix, opts?.voice);
        const { exitCode, stderr } = await spawner(argv, config.timeoutMs);
        if (exitCode !== 0) {
          throw new Error(
            `Kokoro TTS subprocess exited with code ${exitCode}. stderr: ${stderr.slice(0, 1000)}`,
          );
        }
        let audio: Buffer;
        try {
          audio = Buffer.from(readFileSync(outPath));
        } catch {
          throw new Error(
            `Kokoro TTS: expected output file ${outPath} was not created. stderr: ${stderr.slice(0, 500)}`,
          );
        }
        return { audio, mime: "audio/wav" };
      } finally {
        // Best-effort cleanup of the temp working directory. `rmSync` with
        // `recursive: true` handles `outPath` (if it exists) plus any other
        // files mlx-audio may have written alongside it.
        try {
          rmSync(workDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getTtsProvider(
  env: Record<string, string | undefined> = process.env,
): TtsProvider | null {
  const provider = env.TTS_PROVIDER?.toLowerCase();
  if (!provider || provider === "none") return null;

  if (provider === "elevenlabs") {
    const apiKey = env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.warn("TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY not set. TTS disabled.");
      return null;
    }
    const model = env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
    return createElevenLabsProvider(apiKey, model);
  }

  if (provider === "kokoro") {
    return createKokoroProvider(resolveKokoroConfig(env));
  }

  console.warn(`Unknown TTS_PROVIDER: ${provider}. TTS disabled.`);
  return null;
}
