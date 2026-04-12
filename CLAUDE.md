# @openparachute/narrate

Text-to-speech library + CLI for [Parachute](https://parachute.computer). Takes
text in, returns OGG Opus audio bytes out. The opposite direction of sister
repo `@openparachute/scribe` (audio → text).

## Purpose

One small, composable package for high-quality speech synthesis. Ships a
programmatic entry point (`synthesize`) for embedding into other tools and a
`narrate` CLI for one-off generation from a terminal. Extracted from the
`@openparachute/vault` `#reader` → audio hook so the TTS pipeline can stand alone
and be reused outside the vault.

## Architecture

Three load-bearing modules:

- `src/tts-preprocess.ts` — `markdownToSpeech()`: strips markdown syntax so
  the provider doesn't literally read "hashtag asterisk asterisk bold". Pure
  function, trivially unit-testable.
- `src/tts-provider.ts` — `TtsProvider` interface + concrete implementations
  for Kokoro (local) and ElevenLabs (cloud). `getTtsProvider(env)` is the
  factory that reads env vars and returns a configured provider or `null`.
- `src/audio-encoding.ts` — `encodeOggOpus()`: shells out to ffmpeg to encode
  anything ffmpeg can read into 48 kbps mono OGG Opus, tuned for speech
  (`-application voip`). 60x smaller than raw WAV; native on Android/iOS.

`src/synthesize.ts` wires the three together into a single end-to-end call.
`src/index.ts` is the public programmatic surface; `src/cli.ts` is the
thin argv-parsing CLI.

Mirrors sister repo `@openparachute/scribe`'s shape (library + CLI + HTTP
server). `narrate serve` starts a localhost-only OpenAI-compatible TTS endpoint
on port 3100 that vault's webhook trigger system can target.

## Providers

### Kokoro (local)

Zero-cost local synthesis via [mlx-audio](https://github.com/Blaizzy/mlx-audio)
running `prince-canuma/Kokoro-82M`. Requires `uvx` (from
[uv](https://docs.astral.sh/uv/)) on PATH; the first run downloads the model
(~400MB) and subsequent runs are cached. Output is WAV which we then encode
to OGG Opus.

### ElevenLabs (cloud)

Commercial. High quality, requires an API key. Returns mp3 which we then
encode to OGG Opus.

## Environment variables

```
TTS_PROVIDER           kokoro | elevenlabs | none          (default: none)
TTS_VOICE              Shared fallback voice id
ELEVENLABS_API_KEY     Required for TTS_PROVIDER=elevenlabs
ELEVENLABS_MODEL       Default: eleven_multilingual_v2
KOKORO_BIN             Launcher binary. Default: uvx
KOKORO_MODEL           HF repo id. Default: prince-canuma/Kokoro-82M
KOKORO_VOICE           Voice preset. Default: af_heart. Falls back to TTS_VOICE.
KOKORO_PYTHON_ARGS     Space-separated extra args for the generate.py call
KOKORO_TIMEOUT_MS      Subprocess timeout ms. Default: 300000 (5 min)
```

### Optional voice rewriter (pre-synthesis stage)

The rewriter is a pre-synthesis pass that runs the input text through an LLM
to make it sound natural when read aloud — strips code-block literalism,
normalizes brand names, removes meta-commentary, etc. It is **opt-in** and
**not yet wired into `synthesize`**; the scaffolding ships in `src/rewrite/`
and is exported via `getRewriter(env)`. Integration into the pipeline is a
follow-up PR.

```
TTS_REWRITE_PROVIDER   none | claude | claude-cli | ollama | openai
                       | gemini | groq | custom              (default: none)
TTS_REWRITE_MODEL      Override the default model for the chosen provider
TTS_REWRITE_URL        Endpoint URL for TTS_REWRITE_PROVIDER=custom
TTS_REWRITE_API_KEY    Bearer token for TTS_REWRITE_PROVIDER=custom
```

Reuses existing provider env vars when present:
`ANTHROPIC_API_KEY`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `GROQ_API_KEY`. The Ollama default model is `gemma4:e4b`
(narrate diverges from scribe's `llama3.1` deliberately — gemma4 produces
better voice rewrites once `think:false` and `temperature:0.2` are pinned).
The `claude-cli` provider shells out to a local `claude -p` subprocess and
needs Claude Code installed on PATH.

## Dependencies

- **Runtime**: [Bun](https://bun.sh) (`Bun.spawn`, `Bun.file`, `bun:test`).
- **System**: `ffmpeg` on PATH (for OGG Opus encoding); `uvx` on PATH if you
  want Kokoro.

No npm runtime dependencies. TypeScript is declared as a peerDependency.

## Programmatic use

```ts
import { synthesize } from "@openparachute/narrate";

const { audio } = await synthesize("# Hello\n\n**world**");
await Bun.write("hello.ogg", audio);
```

Lower-level pieces are re-exported if you need them:

```ts
import { getTtsProvider, markdownToSpeech, encodeOggOpus } from "@openparachute/narrate";
```

## How @openparachute/vault consumes narrate

Vault has its own `#reader` → audio hook that listens for reader-tagged notes
and attaches synthesized audio. After this package is published, vault's hook
will call `await import("@openparachute/narrate")` instead of maintaining its own
copies of the provider / preprocess / encode modules. Vault owns the
hook-integration concerns (two-phase marker, attachment storage, retry
semantics); narrate owns the pure audio pipeline.

## CLI

```bash
narrate generate "Hello, world." -o hello.ogg
narrate generate "Testing" --voice af_bella -o out.ogg
narrate providers
narrate --help
```

The CLI writes binary audio to stdout by default, or to `-o <file>` if
specified. Runs `synthesize` under the hood — same pipeline as the
programmatic API.

## Testing

```bash
bun install
bun test src/
```

The `audio-encoding.test.ts` suite shells out to the real `ffmpeg` binary —
it will fail if ffmpeg is not on PATH. This is intentional: the encoder is a
hard ffmpeg dependency, so the tests document what "working" means.

The `tts-provider.test.ts` suite uses an injectable spawner stub, so it never
spawns Python / Kokoro. Don't bring mlx-audio into the CI loop.

## Status

Early. v0.1 is the library + CLI extraction. Next milestones (rough):

- Publish to npm as `@openparachute/narrate` (public).
- Swap vault's in-process copies to `await import("@openparachute/narrate")`.
- Additional providers if/when we need them (XTTS, F5, etc.).
