/**
 * Tests for the narrate HTTP server. Spins up the real server with a stubbed
 * synthesize function via module mocking.
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

const { startServer } = await import("./server.ts");

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  server = startServer(0); // port 0 = random available port
  baseUrl = `http://127.0.0.1:${server.port}`;
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
