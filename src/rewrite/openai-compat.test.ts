/**
 * Tests for the OpenAI-compatible rewriter factory and its four named
 * provider exports (openai, gemini, groq, custom). Stubs `fetch`.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { openai, gemini, groq, custom } from "./openai-compat.ts";
import { REWRITE_PROMPT } from "./prompt.ts";

type FetchCall = { url: string; init: RequestInit };

let calls: FetchCall[];
let originalFetch: typeof fetch;
const originalEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "TTS_REWRITE_API_KEY",
  "TTS_REWRITE_URL",
  "TTS_REWRITE_MODEL",
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

function okBody() {
  return jsonResponse({
    choices: [{ message: { content: "rewritten" } }],
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

function assertChatBody(body: any, expectedModel: string) {
  expect(body.model).toBe(expectedModel);
  expect(body.temperature).toBe(0.2);
  expect(body.messages).toEqual([
    { role: "system", content: REWRITE_PROMPT },
    { role: "user", content: "hi" },
  ]);
}

describe("openai rewriter", () => {
  test("throws when OPENAI_API_KEY is missing", async () => {
    await expect(openai("hi")).rejects.toThrow(/API key not set/);
  });

  test("posts to api.openai.com with the default model", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-test";
    stubFetch(okBody);

    const out = await openai("hi");
    expect(out).toBe("rewritten");

    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-openai-test");
    assertChatBody(JSON.parse(String(calls[0]!.init.body)), "gpt-4o-mini");
  });

  test("honors TTS_REWRITE_MODEL override", async () => {
    process.env.OPENAI_API_KEY = "sk";
    process.env.TTS_REWRITE_MODEL = "gpt-4.1";
    stubFetch(okBody);

    await openai("hi");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe("gpt-4.1");
  });

  test("throws on non-200 with upstream body in the message", async () => {
    process.env.OPENAI_API_KEY = "sk";
    stubFetch(() => new Response("server boom", { status: 500 }));
    await expect(openai("hi")).rejects.toThrow(/Rewrite API error 500.*server boom/);
  });
});

describe("gemini rewriter", () => {
  test("posts to the gemini openai-compat endpoint with the default model", async () => {
    process.env.GEMINI_API_KEY = "g-test";
    stubFetch(okBody);

    await gemini("hi");
    expect(calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer g-test");
    assertChatBody(JSON.parse(String(calls[0]!.init.body)), "gemini-2.0-flash");
  });

  test("throws when GEMINI_API_KEY is missing", async () => {
    await expect(gemini("hi")).rejects.toThrow(/API key not set/);
  });
});

describe("groq rewriter", () => {
  test("posts to api.groq.com with the default model", async () => {
    process.env.GROQ_API_KEY = "groq-test";
    stubFetch(okBody);

    await groq("hi");
    expect(calls[0]!.url).toBe(
      "https://api.groq.com/openai/v1/chat/completions",
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer groq-test");
    assertChatBody(
      JSON.parse(String(calls[0]!.init.body)),
      "llama-3.1-8b-instant",
    );
  });

  test("throws when GROQ_API_KEY is missing", async () => {
    await expect(groq("hi")).rejects.toThrow(/API key not set/);
  });
});

describe("custom rewriter", () => {
  test("uses TTS_REWRITE_API_KEY for auth", async () => {
    process.env.TTS_REWRITE_API_KEY = "custom-key";
    stubFetch(okBody);

    await custom("hi");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer custom-key");
  });

  test("throws when TTS_REWRITE_API_KEY is missing", async () => {
    await expect(custom("hi")).rejects.toThrow(/API key not set/);
  });
});
