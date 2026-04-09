/**
 * Voice rewriter registry + factory.
 *
 * Mirrors sister repo `parachute-scribe`'s `src/providers.ts:cleaners`
 * shape so the two stay easy to compare. The differences are:
 *   - Renamed `cleaners` → `rewriters` to match the task.
 *   - Adds the `claude-cli` provider (subprocess `claude -p`, doesn't
 *     exist in scribe).
 *   - `getRewriter(env)` factory instead of scribe's CLI-driven
 *     `getProvider(map, key, label)` — narrate is a library first, so
 *     reading from an env object (defaulting to `process.env`) is the
 *     more natural integration shape.
 *
 * Each rewriter is a plain `(text: string) => Promise<string>` function.
 * No setup, no provider object — just call it. Errors propagate (no
 * silent fallthrough); the synthesize-side caller (PR #2) decides whether
 * to surface them as `NarrateProviderError` or some new typed error.
 */

import { rewrite as claude } from "./claude.ts";
import { rewrite as claudeCli } from "./claude-cli.ts";
import { rewrite as ollama } from "./ollama.ts";
import { openai, gemini, groq, custom } from "./openai-compat.ts";

/** A rewriter takes plain text in, returns rewritten plain text. */
export type Rewriter = (text: string) => Promise<string>;

/** Names recognized by `TTS_REWRITE_PROVIDER`. `none` is a no-op identity. */
export type RewriteProviderName =
  | "none"
  | "claude"
  | "claude-cli"
  | "ollama"
  | "openai"
  | "gemini"
  | "groq"
  | "custom";

/**
 * The full registry. Exposed so callers (e.g. a future CLI subcommand)
 * can enumerate available providers without re-deriving the list.
 */
export const rewriters: Record<RewriteProviderName, Rewriter> = {
  none: async (text) => text,
  claude,
  "claude-cli": claudeCli,
  ollama,
  openai,
  gemini,
  groq,
  custom,
};

/**
 * Resolve a rewriter from an environment-style record. Returns the
 * `none` identity rewriter when:
 *   - `TTS_REWRITE_PROVIDER` is unset
 *   - `TTS_REWRITE_PROVIDER=none`
 *   - `TTS_REWRITE_PROVIDER` is set to an unknown name (logs a warning,
 *     same shape as `getTtsProvider` for unknown TTS providers)
 *
 * Always returns a callable — never `null`. The integration in
 * `synthesize.ts` (PR #2) can call the result unconditionally and rely
 * on the `none` fallthrough to mean "no rewrite happened".
 */
export function getRewriter(
  env: Record<string, string | undefined> = process.env,
): Rewriter {
  const raw = env.TTS_REWRITE_PROVIDER?.toLowerCase();
  if (!raw || raw === "none") return rewriters.none;

  if (raw in rewriters) {
    return rewriters[raw as RewriteProviderName];
  }

  console.warn(
    `Unknown TTS_REWRITE_PROVIDER: ${raw}. Falling back to none. ` +
      `Available: ${Object.keys(rewriters).join(", ")}`,
  );
  return rewriters.none;
}
