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
import {
  NarrateEmptyInputError,
  NarrateNoProviderError,
  NarrateProviderError,
} from "./errors.ts";

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
    throw new NarrateEmptyInputError();
  }

  // 2. Resolve provider (explicit override wins over env-based resolution).
  const provider = opts.provider ?? getTtsProvider(opts.env ?? process.env);
  if (!provider) {
    throw new NarrateNoProviderError();
  }

  // 3. Synthesize. Wrap provider failures so downstream callers can
  //    catch `NarrateProviderError` without substring matching, and can
  //    still reach the original error via `.cause`.
  let rawResult;
  try {
    rawResult = await provider.synthesize(speechText, { voice: opts.voice });
  } catch (err) {
    throw new NarrateProviderError(provider.name, err);
  }

  // 4. Encode to OGG Opus (48 kbps mono, VOIP profile). Same wrapping —
  //    encoder failures are surfaced as NarrateProviderError with
  //    `providerName === "encoder"` so the two failure classes stay
  //    distinguishable via `.providerName` without new error types.
  const encode = opts.encode ?? encodeOggOpus;
  let encoded;
  try {
    encoded = await encode(rawResult.audio, rawResult.mime);
  } catch (err) {
    throw new NarrateProviderError("encoder", err);
  }

  return {
    audio: encoded,
    mime: "audio/ogg",
    voice: opts.voice,
    provider: provider.name,
  };
}
