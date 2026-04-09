/**
 * Typed error classes thrown by `synthesize()`.
 *
 * Consumers that wrap narrate should catch these classes instead of matching
 * substrings in `err.message`. The messages are kept identical to the prior
 * generic-Error versions so existing `.includes()` checks keep working during
 * the transition.
 *
 * All classes extend `Error` and set their `name` field so a downstream
 * `console.error(err)` or structured logger still prints something useful.
 */

/**
 * Base class for errors thrown by parachute-narrate. Catching `NarrateError`
 * matches every typed error below — useful for a cross-cutting "is this an
 * error from narrate?" check. For precise control flow, prefer the concrete
 * subclasses; don't throw the base class directly.
 */
export class NarrateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NarrateError";
  }
}

/**
 * Thrown when the input text is empty after markdown preprocessing (or
 * empty to begin with when preprocessing is skipped). Callers that want to
 * silently drop unspeakable notes — e.g. a note whose only content is a
 * fenced code block — can catch this specifically and mark the note as
 * "rendered, skipped" without escalating.
 */
export class NarrateEmptyInputError extends NarrateError {
  constructor(message = "narrate.synthesize: text is empty after markdown preprocessing") {
    super(message);
    this.name = "NarrateEmptyInputError";
  }
}

/**
 * Thrown when no TTS provider is configured — either `TTS_PROVIDER` is
 * unset, set to `none`, or set to a value the factory rejected (unknown
 * name, missing API key, etc.). Callers should treat this as a
 * configuration error and bail out rather than retrying.
 */
export class NarrateNoProviderError extends NarrateError {
  constructor(
    message = "narrate.synthesize: no TTS provider configured (set TTS_PROVIDER=kokoro|elevenlabs)",
  ) {
    super(message);
    this.name = "NarrateNoProviderError";
  }
}

/**
 * Thrown when the underlying TTS provider fails (HTTP error, subprocess
 * non-zero exit, missing output file, etc.). Wraps the original error on
 * `.cause` so callers can inspect it. `providerName` is set to the
 * `TtsProvider.name` of whichever provider threw, so logs can attribute
 * failures without peeking at `.cause`.
 *
 * The same wrapping is done when the OGG Opus encoder (ffmpeg) fails —
 * `providerName` is `"encoder"` in that case.
 */
export class NarrateProviderError extends NarrateError {
  readonly providerName: string;

  constructor(providerName: string, cause: unknown) {
    const causeMessage =
      cause instanceof Error ? cause.message : String(cause);
    super(`narrate.synthesize: ${providerName} failed: ${causeMessage}`, {
      cause,
    });
    this.name = "NarrateProviderError";
    this.providerName = providerName;
  }
}
