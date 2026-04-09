# parachute-narrate

Text-to-speech service for [Parachute](https://parachute.computer). Programmatic library + CLI for high-quality speech synthesis.

Mirrors [`parachute-scribe`](https://github.com/ParachuteComputer/parachute-scribe)'s shape — scribe handles audio → text, narrate handles text → audio.

## Status

Early development. Extracted from parachute-vault's TTS hook infrastructure to stand alone as a reusable library.

## Design

- **Library**: `import { synthesize } from "parachute-narrate"` — programmatic API returning OGG Opus bytes.
- **CLI**: `narrate generate "hello world" -o out.ogg` — scriptable from the terminal.
- **Providers**: Kokoro-82M (local via mlx-audio), ElevenLabs (cloud). More coming.
- **Preprocessing**: markdown-to-speech stripper built in — reader notes don't read literal asterisks.

## License

[AGPL-3.0](./LICENSE).
