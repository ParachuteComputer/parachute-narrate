/**
 * Voice rewriter via the Anthropic Messages API.
 *
 * Lifted from sister repo `parachute-scribe`'s `src/cleanup/claude.ts` with
 * three changes:
 *   1. System prompt is `REWRITE_PROMPT` (voice-narration rewrite), not
 *      `CLEANUP_PROMPT` (voice-memo cleanup).
 *   2. `temperature: 0.2` is set explicitly. The default Anthropic
 *      temperature is 1.0, which we found produced register drift and
 *      occasional meta-commentary on small inputs. 0.2 is deterministic
 *      enough to be cacheable while still producing natural prose.
 *   3. Model env var is `TTS_REWRITE_MODEL` (the narrate-side override) and
 *      it falls back through `CLAUDE_MODEL` for back-compat with anyone who
 *      already has scribe configured.
 *
 * No `claude-cli` style subprocess fallback here — that's a separate
 * provider in `./claude-cli.ts`. This file is the direct-API path:
 * fast (~sub-second after warm-up), pays per call, requires
 * `ANTHROPIC_API_KEY`.
 */

import { REWRITE_PROMPT } from "./prompt.ts";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.2;

export async function rewrite(text: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const model =
    process.env.TTS_REWRITE_MODEL ?? process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
      system: REWRITE_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { content: Array<{ text: string }> };
  return json.content[0]!.text;
}
