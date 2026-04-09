/**
 * Tests for the direct Anthropic API rewriter. Stubs `fetch` so we never
 * hit the real endpoint.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rewrite } from "./claude.ts";
import { REWRITE_PROMPT } from "./prompt.ts";

type FetchCall = { url: string; init: RequestInit };

let calls: FetchCall[];
let originalFetch: typeof fetch;
const originalEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "TTS_REWRITE_MODEL",
  "CLAUDE_MODEL",
] as const;

function stubFetch(responder: () => Response | Promise<Response>) {
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

describe("claude (Anthropic API) rewriter", () => {
  test("throws when ANTHROPIC_API_KEY is missing", async () => {
    await expect(rewrite("hi")).rejects.toThrow(/ANTHROPIC_API_KEY not set/);
  });

  test("posts to /v1/messages with the expected headers and body shape", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-123";
    stubFetch(() =>
      jsonResponse({ content: [{ text: "rewritten output" }] }),
    );

    const out = await rewrite("hello");
    expect(out).toBe("rewritten output");
    expect(calls.length).toBe(1);

    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]!.init.method).toBe("POST");

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test-123");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["content-type"]).toBe("application/json");

    const body = JSON.parse(String(calls[0]!.init.body));
    // Default model when no override is set.
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0.2);
    expect(body.system).toBe(REWRITE_PROMPT);
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  test("honors TTS_REWRITE_MODEL override", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.TTS_REWRITE_MODEL = "claude-opus-4-6";
    stubFetch(() => jsonResponse({ content: [{ text: "ok" }] }));

    await rewrite("hi");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe("claude-opus-4-6");
  });

  test("falls back to CLAUDE_MODEL when TTS_REWRITE_MODEL is unset", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.CLAUDE_MODEL = "claude-haiku-4-5";
    stubFetch(() => jsonResponse({ content: [{ text: "ok" }] }));

    await rewrite("hi");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe("claude-haiku-4-5");
  });

  test("TTS_REWRITE_MODEL takes precedence over CLAUDE_MODEL", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.CLAUDE_MODEL = "loser";
    process.env.TTS_REWRITE_MODEL = "winner";
    stubFetch(() => jsonResponse({ content: [{ text: "ok" }] }));

    await rewrite("hi");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe("winner");
  });

  test("throws on non-200 with the upstream body in the message", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    stubFetch(
      () => new Response("rate limited", { status: 429 }),
    );
    await expect(rewrite("hi")).rejects.toThrow(/Claude API error 429.*rate limited/);
  });
});
