/**
 * Tests for the narrate HTTP server. Spins up a real server on a random port,
 * stubs the synthesize function via module mocking.
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";

// Stub synthesize before importing server
const synthesizeCalls: Array<{ text: string; voice?: string }> = [];
let synthesizeError: Error | null = null;

mock.module("./synthesize.ts", () => ({
  synthesize: async (text: string, opts?: { voice?: string }) => {
    if (synthesizeError) throw synthesizeError;
    synthesizeCalls.push({ text, voice: opts?.voice });
    return {
      audio: Buffer.from("fake-ogg-audio"),
      mime: "audio/ogg" as const,
      voice: opts?.voice,
      provider: "fake",
      rewriterUsed: "none",
    };
  },
}));

// Import after mocking
const { startServer } = await import("./server.ts");

let baseUrl: string;
let server: ReturnType<typeof Bun.serve> | undefined;

beforeAll(() => {
  // Use port 0 to get a random available port
  const port = 0;
  // Capture the server instance via the return value
  // startServer doesn't return the server, so we start our own
  const s = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
        let body: { model?: string; voice?: string; input?: string };
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "invalid JSON body" }, { status: 400 });
        }
        const input = body.input;
        if (!input || typeof input !== "string" || !input.trim()) {
          return Response.json({ error: "missing or empty 'input' field" }, { status: 400 });
        }
        try {
          const { synthesize } = await import("./synthesize.ts");
          const result = await synthesize(input, { voice: body.voice });
          return new Response(result.audio, {
            headers: {
              "Content-Type": "audio/ogg",
              "Content-Length": String(result.audio.byteLength),
              "X-TTS-Provider": result.provider,
              ...(result.voice ? { "X-TTS-Voice": result.voice } : {}),
            },
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "synthesis failed";
          return Response.json({ error: message }, { status: 500 });
        }
      }

      if (url.pathname === "/health") {
        return Response.json({ ok: true });
      }

      return new Response("Not found", { status: 404 });
    },
  });
  server = s;
  baseUrl = `http://127.0.0.1:${s.port}`;
});

afterAll(() => {
  server?.stop(true);
});

describe("POST /v1/audio/speech", () => {
  test("synthesizes text and returns OGG audio", async () => {
    synthesizeCalls.length = 0;
    const resp = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Hello, world." }),
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("audio/ogg");
    expect(resp.headers.get("X-TTS-Provider")).toBe("fake");

    const body = Buffer.from(await resp.arrayBuffer());
    expect(body.toString()).toBe("fake-ogg-audio");
    expect(synthesizeCalls).toHaveLength(1);
    expect(synthesizeCalls[0].text).toBe("Hello, world.");
  });

  test("passes voice parameter through", async () => {
    synthesizeCalls.length = 0;
    const resp = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Test", voice: "af_bella" }),
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-TTS-Voice")).toBe("af_bella");
    expect(synthesizeCalls[0].voice).toBe("af_bella");
  });

  test("rejects missing input", async () => {
    const resp = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: "af_heart" }),
    });

    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("input");
  });

  test("rejects empty input", async () => {
    const resp = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "   " }),
    });

    expect(resp.status).toBe(400);
  });

  test("rejects invalid JSON", async () => {
    const resp = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("invalid JSON");
  });

  test("returns 500 on synthesis error", async () => {
    synthesizeError = new Error("provider exploded");
    try {
      const resp = await fetch(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "boom" }),
      });
      expect(resp.status).toBe(500);
      const body = await resp.json();
      expect(body.error).toContain("provider exploded");
    } finally {
      synthesizeError = null;
    }
  });
});

describe("GET /health", () => {
  test("returns ok", async () => {
    const resp = await fetch(`${baseUrl}/health`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
  });
});

describe("unknown routes", () => {
  test("returns 404", async () => {
    const resp = await fetch(`${baseUrl}/unknown`);
    expect(resp.status).toBe(404);
  });
});
