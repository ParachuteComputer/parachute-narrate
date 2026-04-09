/**
 * End-to-end synthesize helper: preprocess → provider → encode.
 *
 * This is the main programmatic entry point for parachute-narrate. It wraps
 * the three load-bearing pieces (`markdownToSpeech`, `getTtsProvider`,
 * `encodeOggOpus`) into a single call that returns OGG Opus bytes.
 *
 * Callers that want finer control (bring your own provider, skip encoding,
 * etc.) can import the underlying pieces directly from `./tts-provider.ts`,
 * `./tts-preprocess.ts`, and `./audio-encoding.ts`.
 */

import { getTtsProvider, type TtsProvider } from "./tts-provider.ts";
import { markdownToSpeech } from "./tts-preprocess.ts";
import { encodeOggOpus } from "./audio-encoding.ts";

export interface SynthesizeOptions {
  /** Voice id passed through to the provider (provider-specific format). */
  voice?: string;
  /** Skip the markdown → speech preprocessor. Use when the input is already plain. */
  skipMarkdownPreprocessing?: boolean;
  /**
   * Environment to read provider configuration from. Defaults to
   * `process.env`. Exposed primarily so tests can inject a specific env
   * without mutating the real one.
   */
  env?: Record<string, string | undefined>;
  /**
   * Override the provider resolution entirely. When set, `env` is ignored
   * for provider selection. Intended for tests and callers that already
   * hold a configured provider instance.
   */
  provider?: TtsProvider;
  /**
   * Override the encoder. Defaults to `encodeOggOpus`. Exposed so tests
   * can stub ffmpeg and so specialized callers can swap in a different
   * codec without forking this module.
   */
  encode?: (audio: Buffer, mime: string) => Promise<Buffer>;
}

export interface SynthesizeResult {
  audio: Buffer;
  mime: "audio/ogg";
  voice: string | undefined;
  provider: string;
}

/**
 * End-to-end text-to-speech: preprocess markdown → synthesize via configured
 * provider → encode to OGG Opus. Returns the audio bytes plus basic metadata.
 *
 * Throws if no provider is configured, if the input is empty after
 * preprocessing, or if the provider / encoder fails.
 */
export async function synthesize(
  text: string,
  opts: SynthesizeOptions = {},
): Promise<SynthesizeResult> {
  // 1. Preprocess (unless skipped).
  const speechText = opts.skipMarkdownPreprocessing ? text : markdownToSpeech(text);
  if (!speechText || !speechText.trim()) {
    throw new Error("narrate.synthesize: text is empty after markdown preprocessing");
  }

  // 2. Resolve provider (explicit override wins over env-based resolution).
  const provider = opts.provider ?? getTtsProvider(opts.env ?? process.env);
  if (!provider) {
    throw new Error(
      "narrate.synthesize: no TTS provider configured (set TTS_PROVIDER=kokoro|elevenlabs)",
    );
  }

  // 3. Synthesize.
  const rawResult = await provider.synthesize(speechText, { voice: opts.voice });

  // 4. Encode to OGG Opus (48 kbps mono, VOIP profile).
  const encode = opts.encode ?? encodeOggOpus;
  const encoded = await encode(rawResult.audio, rawResult.mime);

  return {
    audio: encoded,
    mime: "audio/ogg",
    voice: opts.voice,
    provider: provider.name,
  };
}
