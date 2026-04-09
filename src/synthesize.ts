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
  getRewriter,
  rewriters,
  type Rewriter,
} from "./rewrite/rewriters.ts";
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
  /**
   * Override the rewriter. When omitted, the rewriter is resolved from
   * `env.TTS_REWRITE_PROVIDER` via `getRewriter`. Pass a function to
   * inject a stub or a pre-resolved rewriter (skips env reading and
   * counts as `rewriterUsed: "injected"`). Pass `null` to explicitly
   * disable rewriting regardless of env (counts as `rewriterUsed: "none"`).
   */
  rewriter?: Rewriter | null;
}

export interface SynthesizeResult {
  audio: Buffer;
  mime: "audio/ogg";
  voice: string | undefined;
  provider: string;
  /**
   * The post-rewrite text that was actually handed to the TTS provider.
   * Set only when a rewriter ran (i.e. `rewriterUsed !== "none"`); left
   * `undefined` for the default no-rewrite path so unchanged callers don't
   * pay the memory cost of carrying a redundant copy of the input.
   */
  rewritten?: string;
  /**
   * Name of the rewriter that ran. `"none"` when no rewriter was
   * configured (or `opts.rewriter === null`); the resolved provider name
   * (`"ollama"`, `"claude"`, …) when env-resolved; `"injected"` when the
   * caller passed `opts.rewriter` directly.
   */
  rewriterUsed: string;
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

  // 3. Resolve rewriter. Three paths:
  //    a) `opts.rewriter === null`  → caller explicitly opted out, skip rewrite
  //    b) `opts.rewriter` provided  → use it verbatim, name as "injected"
  //    c) neither                   → resolve from env via getRewriter
  //    `getRewriter` always returns a callable (identity for unset/none/
  //    unknown), so the env path can never blow up here.
  let rewriter: Rewriter;
  let rewriterUsed: string;
  if (opts.rewriter === null) {
    rewriter = rewriters.none;
    rewriterUsed = "none";
  } else if (opts.rewriter !== undefined) {
    rewriter = opts.rewriter;
    rewriterUsed = "injected";
  } else {
    const env = opts.env ?? process.env;
    rewriter = getRewriter(env);
    // If getRewriter fell back to identity (unset / "none" / unknown),
    // call it "none" so the result field reflects what actually ran
    // rather than the raw env string. In the non-identity branch
    // `TTS_REWRITE_PROVIDER` is guaranteed defined (getRewriter only
    // returns a non-identity for a known key).
    rewriterUsed =
      rewriter === rewriters.none
        ? "none"
        : env.TTS_REWRITE_PROVIDER!.toLowerCase();
  }

  // 4. Rewrite. Skipped entirely when `rewriterUsed === "none"` so the
  //    default (no rewriter configured) path stays a single function
  //    call cheaper and `result.rewritten` stays undefined for callers
  //    that don't care.
  let rewrittenText = speechText;
  const didRewrite = rewriterUsed !== "none";
  if (didRewrite) {
    try {
      rewrittenText = await rewriter(speechText);
    } catch (err) {
      throw new NarrateProviderError(`rewriter:${rewriterUsed}`, err);
    }
    if (!rewrittenText || !rewrittenText.trim()) {
      throw new NarrateEmptyInputError(
        `narrate.synthesize: text is empty after rewrite (rewriter=${rewriterUsed})`,
      );
    }
  }

  // 5. Synthesize. Wrap provider failures so downstream callers can
  //    catch `NarrateProviderError` without substring matching, and can
  //    still reach the original error via `.cause`.
  let rawResult;
  try {
    rawResult = await provider.synthesize(rewrittenText, { voice: opts.voice });
  } catch (err) {
    throw new NarrateProviderError(provider.name, err);
  }

  // 6. Encode to OGG Opus (48 kbps mono, VOIP profile). Same wrapping —
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
    rewritten: didRewrite ? rewrittenText : undefined,
    rewriterUsed,
  };
}
