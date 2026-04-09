/**
 * Tests for the Ollama HTTP rewriter.
 *
 * The two non-obvious config bits — `think: false` and
 * `options.temperature: 0.2` — are load-bearing. Without `think: false`
 * Gemma 4 emits a reasoning trace mixed into the output. Without
 * `temperature: 0.2` it drifts to first-person and leaks meta-commentary.
 * Both behaviors regressed during prompt iteration on 2026-04-09; this
 * file pins them.
 *
 * The default model `gemma4:e4b` is also pinned — narrate diverges from
 * scribe's `llama3.1` default deliberately and that should not regress.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rewrite } from "./ollama.ts";
import { REWRITE_PROMPT } from "./prompt.ts";

type FetchCall = { url: string; init: RequestInit };

let calls: FetchCall[];
let originalFetch: typeof fetch;
const originalEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "OLLAMA_URL",
  "OLLAMA_MODEL",
  "TTS_REWRITE_MODEL",
] as const;

function stubFetch(responder: () => Response | Promise<Response>) {
  // Cast to `any` because Bun's fetch type signature is broader than
  // what we use; tests only need to capture the call shape.
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return await responder();
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("ollama rewriter", () => {
  test("posts to /api/chat at the default URL with the expected body shape", async () => {
    stubFetch(() => jsonResponse({ message: { content: "rewritten" } }));

    const out = await rewrite("hello world");
    expect(out).toBe("rewritten");
    expect(calls.length).toBe(1);

    expect(calls[0]!.url).toBe("http://localhost:11434/api/chat");
    expect(calls[0]!.init.method).toBe("POST");

    const body = JSON.parse(String(calls[0]!.init.body));
    // Default model is gemma4:e4b — pinned divergence from scribe.
    expect(body.model).toBe("gemma4:e4b");
    expect(body.stream).toBe(false);
    // The two load-bearing config bits.
    expect(body.think).toBe(false);
    expect(body.options).toEqual({ temperature: 0.2 });
    // Messages = [system: REWRITE_PROMPT, user: input].
    expect(body.messages).toEqual([
      { role: "system", content: REWRITE_PROMPT },
      { role: "user", content: "hello world" },
    ]);
  });

  test("honors OLLAMA_URL override", async () => {
    process.env.OLLAMA_URL = "http://example.local:9999";
    stubFetch(() => jsonResponse({ message: { content: "ok" } }));

    await rewrite("hi");
    expect(calls[0]!.url).toBe("http://example.local:9999/api/chat");
  });

  test("honors OLLAMA_MODEL override", async () => {
    process.env.OLLAMA_MODEL = "llama3.1";
    stubFetch(() => jsonResponse({ message: { content: "ok" } }));

    await rewrite("hi");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe("llama3.1");
  });

  test("TTS_REWRITE_MODEL takes precedence over OLLAMA_MODEL", async () => {
    process.env.OLLAMA_MODEL = "should-be-ignored";
    process.env.TTS_REWRITE_MODEL = "winning-model";
    stubFetch(() => jsonResponse({ message: { content: "ok" } }));

    await rewrite("hi");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe("winning-model");
  });

  test("throws on non-200 with the upstream body in the message", async () => {
    stubFetch(() => new Response("model not found", { status: 404 }));
    await expect(rewrite("hi")).rejects.toThrow(/Ollama error 404.*model not found/);
  });
});
