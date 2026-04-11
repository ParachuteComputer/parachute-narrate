# @openparachute/narrate

Text-to-speech for [Parachute](https://parachute.computer). Programmatic library + CLI for high-quality speech synthesis.

Takes text in, returns OGG Opus audio out. The opposite direction of [`@openparachute/scribe`](https://github.com/ParachuteComputer/parachute-scribe).

## Quick start

Requires [Bun](https://bun.sh) and `ffmpeg` on PATH.

```bash
git clone https://github.com/ParachuteComputer/parachute-narrate
cd parachute-narrate
bun install
```

Generate speech:

```bash
TTS_PROVIDER=kokoro bun src/cli.ts generate "Hello, world." -o hello.ogg
```

## How it works

```
Text --> Markdown preprocessor --> Rewriter (optional) --> TTS provider --> ffmpeg encoder --> OGG Opus
```

Markdown is stripped before synthesis so the provider doesn't literally read "hashtag asterisk asterisk bold". The optional rewriter runs the text through an LLM to make it sound natural when read aloud.

## CLI

```bash
narrate generate <text> -o out.ogg        # Synthesize to file
narrate generate <text>                   # Write binary OGG to stdout
narrate generate <text> --voice af_bella  # Specify voice
narrate generate <text> --raw             # Skip markdown preprocessing
narrate providers                         # Show active/available providers
narrate --version                         # Show version
```

## Library

```ts
import { synthesize } from "@openparachute/narrate";

const { audio, mime, provider } = await synthesize("# Hello\n\n**world**");
await Bun.write("hello.ogg", audio);
```

Lower-level pieces are re-exported:

```ts
import {
  getTtsProvider,
  markdownToSpeech,
  encodeOggOpus,
  getRewriter,
} from "@openparachute/narrate";
```

### Synthesize options

```ts
const result = await synthesize(text, {
  voice: "af_heart",                  // Provider-specific voice id
  skipMarkdownPreprocessing: true,    // Pass text through verbatim
  rewriter: async (t) => t,          // Inject a custom rewriter
  rewriter: null,                     // Explicitly disable rewriting
  env: { TTS_PROVIDER: "kokoro" },   // Override env for provider resolution
});
```

### Result

```ts
{
  audio: Buffer,              // OGG Opus bytes
  mime: "audio/ogg",
  voice: string | undefined,
  provider: string,           // "kokoro", "elevenlabs"
  rewritten?: string,         // Post-rewrite text (only if rewriter ran)
  rewriterUsed: string,       // "none", "injected", "ollama", "claude", ...
}
```

## TTS providers

| Provider | Type | Notes |
|----------|------|-------|
| `kokoro` | Local | Zero-cost via [mlx-audio](https://github.com/Blaizzy/mlx-audio). Mac (Apple Silicon). Requires `uvx` on PATH. |
| `elevenlabs` | Cloud | High quality. Requires `ELEVENLABS_API_KEY`. |

### Kokoro setup

Kokoro uses Python via `uvx` (from [uv](https://docs.astral.sh/uv/)). First run downloads the model (~400MB), subsequent runs are cached.

```bash
# Install uv (if not already)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Test it works
TTS_PROVIDER=kokoro narrate generate "Hello" -o test.ogg
```

### ElevenLabs setup

```bash
export ELEVENLABS_API_KEY=your_key_here
export TTS_PROVIDER=elevenlabs
narrate generate "Hello" -o test.ogg
```

## Rewriter (optional)

Pre-synthesis LLM pass that makes text sound natural when read aloud. Strips code-block literalism, normalizes brand names, removes meta-commentary. Opt-in via `TTS_REWRITE_PROVIDER`.

| Provider | Type | Notes |
|----------|------|-------|
| `claude` | Cloud | Requires `ANTHROPIC_API_KEY`. |
| `claude-cli` | Local | Shells out to `claude -p`. Requires Claude Code on PATH. |
| `ollama` | Local | Default model: `gemma4:e4b`. Requires Ollama running. |
| `openai` | Cloud | Any OpenAI-compatible. Requires `OPENAI_API_KEY`. |
| `gemini` | Cloud | Requires `GEMINI_API_KEY`. |
| `groq` | Cloud | Requires `GROQ_API_KEY`. |
| `custom` | Cloud | Any OpenAI-compatible endpoint. |
| `none` | - | Skip rewriting. Default. |

A quality gate rejects rewrites with output/input length ratios outside `[0.5, 1.5]` (configurable via `TTS_REWRITE_MIN_RATIO` / `TTS_REWRITE_MAX_RATIO`).

## Environment variables

```bash
# TTS provider
TTS_PROVIDER=kokoro              # kokoro | elevenlabs | none
TTS_VOICE=af_heart               # Shared fallback voice id

# ElevenLabs
ELEVENLABS_API_KEY=...
ELEVENLABS_MODEL=eleven_multilingual_v2

# Kokoro
KOKORO_BIN=uvx                   # Launcher binary
KOKORO_MODEL=prince-canuma/Kokoro-82M
KOKORO_VOICE=af_heart            # Falls back to TTS_VOICE
KOKORO_TIMEOUT_MS=300000         # Subprocess timeout (5 min)

# Rewriter (optional)
TTS_REWRITE_PROVIDER=none        # none | claude | claude-cli | ollama | openai | gemini | groq | custom
TTS_REWRITE_MODEL=...            # Override default model
TTS_REWRITE_MAX_RATIO=1.5        # Max output/input length ratio
TTS_REWRITE_MIN_RATIO=0.5        # Min output/input length ratio

# Rewriter API keys (as needed)
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=gemma4:e4b
```

## Error classes

Typed errors for structured error handling:

```ts
import {
  NarrateError,                   // Base class — catches all narrate errors
  NarrateEmptyInputError,         // Input empty after preprocessing
  NarrateNoProviderError,         // No TTS provider configured
  NarrateProviderError,           // Provider/encoder failure (has .providerName, .cause)
  NarrateRewriterDegenerateError, // Rewriter output ratio out of bounds
} from "@openparachute/narrate";
```

## How vault uses narrate

[Parachute Vault](https://github.com/ParachuteComputer/parachute-vault) optionally imports narrate via `await import("@openparachute/narrate")`. When installed, vault gains:

- `POST /v1/audio/speech` — OpenAI-compatible TTS endpoint
- TTS hook — notes tagged `#reader` automatically get synthesized audio attached

To enable: install narrate alongside vault via `bun link` or npm, then configure `TTS_PROVIDER` in `~/.parachute/.env`.

## Requirements

- [Bun](https://bun.sh)
- `ffmpeg` on PATH (for OGG Opus encoding)
- A TTS provider: `uvx` for Kokoro, or an ElevenLabs API key

## Testing

```bash
bun test src/
```

Tests stub providers and ffmpeg. The `audio-encoding.test.ts` suite requires a real `ffmpeg` binary.

## License

[AGPL-3.0](./LICENSE)
