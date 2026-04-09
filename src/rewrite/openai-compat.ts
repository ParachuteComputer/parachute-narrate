/**
 * Voice rewriter via any OpenAI-compatible chat-completions endpoint.
 *
 * Lifted from sister repo `parachute-scribe`'s `src/cleanup/openai-compat.ts`
 * with three changes:
 *   1. System prompt is `REWRITE_PROMPT`, not `CLEANUP_PROMPT`.
 *   2. `temperature: 0.2` set explicitly. The OpenAI default is 1.0 — same
 *      register-drift / paraphrasing concerns as the other providers.
 *   3. The model env var is `TTS_REWRITE_MODEL` (narrate-side override).
 *      For the `custom` provider, the URL/key/model env vars are renamed
 *      to `TTS_REWRITE_URL` / `TTS_REWRITE_API_KEY` so they don't collide
 *      with scribe's `CLEANUP_*` vars when both packages are installed.
 *
 * Four named providers ship today: openai, gemini, groq, custom. Adding a
 * new one is one factory call. Each reads its API key lazily from
 * `process.env` so test code can set the var after import.
 */

import { REWRITE_PROMPT } from "./prompt.ts";

type ProviderConfig = {
  baseUrl: string;
  apiKey: string | undefined;
  defaultModel: string;
};

const DEFAULT_TEMPERATURE = 0.2;

function makeRewriter(config: ProviderConfig) {
  return async function rewrite(text: string): Promise<string> {
    const apiKey = config.apiKey;
    if (!apiKey) throw new Error(`API key not set for rewrite provider`);

    const model = process.env.TTS_REWRITE_MODEL ?? config.defaultModel;

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: DEFAULT_TEMPERATURE,
        messages: [
          { role: "system", content: REWRITE_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Rewrite API error ${res.status}: ${body}`);
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return json.choices[0]!.message.content;
  };
}

export const openai = makeRewriter({
  baseUrl: "https://api.openai.com/v1",
  get apiKey() {
    return process.env.OPENAI_API_KEY;
  },
  defaultModel: "gpt-4o-mini",
});

export const gemini = makeRewriter({
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  get apiKey() {
    return process.env.GEMINI_API_KEY;
  },
  defaultModel: "gemini-2.0-flash",
});

export const groq = makeRewriter({
  baseUrl: "https://api.groq.com/openai/v1",
  get apiKey() {
    return process.env.GROQ_API_KEY;
  },
  defaultModel: "llama-3.1-8b-instant",
});

// All three fields are lazy getters so tests (and shells that set env
// vars after import) see overrides. The other providers can hard-code
// `baseUrl` because their endpoints are fixed; `custom` is the one place
// the URL itself is user-configurable.
export const custom = makeRewriter({
  get baseUrl() {
    return process.env.TTS_REWRITE_URL ?? "http://localhost:8080/v1";
  },
  get apiKey() {
    return process.env.TTS_REWRITE_API_KEY;
  },
  get defaultModel() {
    return process.env.TTS_REWRITE_MODEL ?? "default";
  },
});
