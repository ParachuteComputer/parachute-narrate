/**
 * Voice rewriter via a local Ollama HTTP API.
 *
 * NOT a verbatim lift from sister repo `parachute-scribe`. Two critical
 * deltas — both verified empirically on 2026-04-09 against `gemma4:e4b`:
 *
 *   1. `think: false` — Gemma 4 (and several other recent models) ship with
 *      a "thinking" capability on by default that emits a reasoning trace
 *      to the response. The `ollama run` CLI does not expose a flag to
 *      disable this; only the `/api/chat` HTTP endpoint accepts the
 *      `think` field. Without `think: false` the rewriter returns
 *      `<thinking>...</thinking>` cruft mixed in with the prose.
 *
 *   2. `options.temperature: 0.2`. The default temperature is 1.0 which
 *      produced register drift (second-person → first-person), prompt
 *      leakage ("I ended up rewriting written text just so it would work
 *      for listening" — meta-commentary about its own task), and
 *      paraphrasing of factual specifics. 0.2 is the lowest setting that
 *      still produces fluent prose without locking into the input phrasing
 *      verbatim.
 *
 * Default model is `gemma4:e4b` (Aaron's tested preference, launched
 * 2026-04-06; Q4_K_M, ~9.6GB on disk). Scribe defaults to `llama3.1` —
 * narrate diverges deliberately because Gemma 4 produced strictly better
 * voice-narration output in our 3-note A/B test, and is the recommended
 * local default in the design doc.
 */

import { REWRITE_PROMPT } from "./prompt.ts";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "gemma4:e4b";
const DEFAULT_TEMPERATURE = 0.2;

export async function rewrite(text: string): Promise<string> {
  const url = process.env.OLLAMA_URL ?? DEFAULT_BASE_URL;
  const model =
    process.env.TTS_REWRITE_MODEL ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;

  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      // Disable Gemma 4's default reasoning trace. See file header.
      think: false,
      options: {
        temperature: DEFAULT_TEMPERATURE,
      },
      messages: [
        { role: "system", content: REWRITE_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { message: { content: string } };
  return json.message.content;
}
