/**
 * narrate HTTP server — OpenAI-compatible TTS endpoint.
 *
 * Accepts `POST /v1/audio/speech` with `{ model?, voice?, input }` and
 * returns OGG Opus audio bytes. Compatible with the OpenAI TTS API shape.
 */

import { synthesize } from "./synthesize.ts";

const DEFAULT_PORT = 3100;

export function startServer(port?: number) {
  const p = port ?? Number(process.env.PORT ?? DEFAULT_PORT);

  console.log(`narrate listening on :${p}`);
  console.log(`  TTS_PROVIDER: ${process.env.TTS_PROVIDER ?? "(not set)"}`);

  Bun.serve({
    hostname: "0.0.0.0",
    port: p,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
        return handleSpeech(req);
      }

      if (url.pathname === "/health") {
        return Response.json({ ok: true });
      }

      return new Response("Not found", { status: 404 });
    },
  });
}

async function handleSpeech(req: Request): Promise<Response> {
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
    console.error("Speech synthesis error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
