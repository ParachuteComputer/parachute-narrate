/**
 * Public programmatic entry point for @openparachute/narrate.
 *
 * Typical usage:
 *
 *   import { synthesize } from "@openparachute/narrate";
 *   const { audio } = await synthesize("Hello, world.");
 *   await Bun.write("out.ogg", audio);
 *
 * For finer control, import the underlying pieces directly:
 *
 *   import { getTtsProvider } from "@openparachute/narrate";
 *   const provider = getTtsProvider(process.env);
 */

export {
  synthesize,
  type SynthesizeOptions,
  type SynthesizeResult,
} from "./synthesize.ts";

export {
  NarrateError,
  NarrateEmptyInputError,
  NarrateNoProviderError,
  NarrateProviderError,
  NarrateRewriterDegenerateError,
} from "./errors.ts";

export {
  getTtsProvider,
  createKokoroProvider,
  resolveKokoroConfig,
  buildKokoroCommand,
  type TtsProvider,
  type TtsSynthesisResult,
  type KokoroConfig,
  type KokoroSpawner,
} from "./tts-provider.ts";

export { markdownToSpeech } from "./tts-preprocess.ts";

export {
  encodeOggOpus,
  isFfmpegAvailable,
  assertFfmpegAvailable,
  OPUS_BITRATE,
  OPUS_EXT,
  OPUS_MIME,
} from "./audio-encoding.ts";

export {
  getRewriter,
  rewriters,
  type Rewriter,
  type RewriteProviderName,
} from "./rewrite/rewriters.ts";

export { REWRITE_PROMPT } from "./rewrite/prompt.ts";
