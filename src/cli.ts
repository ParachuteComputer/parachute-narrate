#!/usr/bin/env bun

/**
 * narrate — text-to-speech CLI.
 *
 * Mirrors parachute-scribe's CLI shape: plain argv parsing, no framework.
 *
 * Commands:
 *   narrate generate <text>             Synthesize speech. -o <file> writes to disk.
 *   narrate providers                   List configured/available providers.
 *   narrate --help                      Show usage.
 *   narrate --version                   Show package version.
 */

import { synthesize } from "./synthesize.ts";
import { getTtsProvider } from "./tts-provider.ts";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(flag: string, shortFlag?: string): string | undefined {
  for (const f of shortFlag ? [flag, shortFlag] : [flag]) {
    const idx = args.indexOf(f);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  }
  return undefined;
}

function hasFlag(flag: string, shortFlag?: string): boolean {
  return args.includes(flag) || (shortFlag !== undefined && args.includes(shortFlag));
}

function usage() {
  console.log(`narrate — text-to-speech synthesis

Usage:
  narrate generate <text>               Synthesize text to audio
  narrate providers                     List configured TTS providers
  narrate --help                        Show this help
  narrate --version                     Show package version

Options for \`generate\`:
  -o, --output <file>                   Write OGG Opus output to <file>
                                        (default: stdout, binary)
      --voice <id>                      Voice id (provider-specific)
      --raw                              Skip markdown preprocessing

Environment:
  TTS_PROVIDER                          kokoro | elevenlabs | none (default: none)
  TTS_VOICE                             Shared fallback voice id
  ELEVENLABS_API_KEY                    Required for TTS_PROVIDER=elevenlabs
  ELEVENLABS_MODEL                      Optional, default eleven_multilingual_v2
  KOKORO_MODEL                          Optional, default prince-canuma/Kokoro-82M
  KOKORO_VOICE                          Optional, default af_heart
  KOKORO_BIN                            Optional launcher binary (default: uvx)
  KOKORO_TIMEOUT_MS                     Optional subprocess timeout (default: 300000)

Examples:
  narrate generate "Hello, world." -o hello.ogg
  narrate generate "Testing" --voice af_bella -o out.ogg
  narrate providers
`);
}

async function getVersion(): Promise<string> {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = await Bun.file(pkgUrl).json();
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

switch (command) {
  case "help":
  case "--help":
  case "-h":
  case undefined:
    usage();
    break;

  case "--version":
  case "-v":
    console.log(await getVersion());
    break;

  case "providers":
    cmdProviders();
    break;

  case "generate":
    await cmdGenerate();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
}

function cmdProviders() {
  const env = process.env;
  const provider = getTtsProvider(env);
  if (provider) {
    console.log(`Active: ${provider.name} (TTS_PROVIDER=${env.TTS_PROVIDER})`);
  } else {
    console.log("Active: none");
  }
  console.log("");
  console.log("Known providers:");
  console.log("  kokoro      Local, via Python + mlx-audio. No API key needed.");
  console.log("  elevenlabs  Cloud. Requires ELEVENLABS_API_KEY + a voice id.");
  console.log("");
  console.log("Set TTS_PROVIDER=<name> to activate one.");
}

async function cmdGenerate() {
  // Collect positional text args (everything that isn't a flag or flag value).
  const textParts: string[] = [];
  const reservedFlagValues = new Set<number>();
  const flagsWithValue = new Set(["-o", "--output", "--voice"]);

  for (let i = 1; i < args.length; i++) {
    if (flagsWithValue.has(args[i]!)) {
      reservedFlagValues.add(i + 1);
      continue;
    }
    if (reservedFlagValues.has(i)) continue;
    if (args[i]!.startsWith("-")) continue;
    textParts.push(args[i]!);
  }

  const text = textParts.join(" ").trim();
  if (!text) {
    console.error("narrate generate: missing <text> argument");
    console.error("Usage: narrate generate <text> [-o <file>] [--voice <id>]");
    process.exit(1);
  }

  const outputPath = getFlag("--output", "-o");
  const voice = getFlag("--voice") ?? process.env.TTS_VOICE;
  const raw = hasFlag("--raw");

  let result;
  try {
    result = await synthesize(text, {
      voice,
      skipMarkdownPreprocessing: raw,
    });
  } catch (err) {
    console.error(`narrate generate: ${(err as Error).message}`);
    process.exit(1);
  }

  if (outputPath) {
    await Bun.write(outputPath, result.audio);
    console.error(
      `narrate: wrote ${result.audio.byteLength} bytes to ${outputPath} (provider=${result.provider}, voice=${result.voice ?? "default"})`,
    );
  } else {
    // Write binary to stdout.
    process.stdout.write(result.audio);
  }
}
