/**
 * Voice rewriter via the local `claude` CLI subprocess (`claude -p`).
 *
 * Uses the user's logged-in Claude Code session (OAuth + keychain) — no
 * API key needed, runs against the user's subscription quota. Verified
 * end-to-end on 2026-04-09 against a real reader note; produced cleaner
 * code-block descriptions than Gemma 4 E4B but with ~45s cold-start
 * overhead.
 *
 * Tradeoffs vs the direct-API path in `./claude.ts`:
 *
 *   + Free at the point of use (subscription).
 *   + No API key wiring.
 *   - ~2-45s cold start while Claude Code spins up its session.
 *   - Each call loads the user's CLAUDE.md / memory / hooks unless we
 *     explicitly isolate it. We isolate by:
 *       1. cwd = "/tmp" (no project CLAUDE.md picked up).
 *       2. `--disable-slash-commands` (no skill loading).
 *       3. `--append-system-prompt REWRITE_PROMPT` (still gets Claude's
 *          baseline behavior + our rules layered on top).
 *
 * `--bare` is NOT used here even though it would give cleaner isolation,
 * because `--bare` explicitly refuses to read OAuth/keychain auth and
 * requires `ANTHROPIC_API_KEY`. If you have an API key you should use
 * `./claude.ts` instead — `--bare` offers no advantage over a direct fetch.
 *
 * The spawn surface is injectable (see `ClaudeCliDeps`) so tests can stub
 * out `Bun.spawn` without monkey-patching globals. Same pattern as
 * `tts-provider.ts`'s `KokoroSpawner`.
 */

import { REWRITE_PROMPT } from "./prompt.ts";

/**
 * Subset of `Bun.spawn`'s return shape that this module actually consumes.
 * Lets tests return a minimal fake without re-implementing all of Bun's
 * Subprocess interface.
 */
export interface ClaudeCliSubprocess {
  stdin: { write(chunk: string): void; end(): void };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

export type ClaudeCliSpawn = (
  argv: string[],
  options: { stdin: "pipe"; stdout: "pipe"; stderr: "pipe"; cwd: string },
) => ClaudeCliSubprocess;

export interface ClaudeCliDeps {
  /** Spawn function. Defaults to `Bun.spawn`. Tests pass a stub. */
  spawn?: ClaudeCliSpawn;
  /** Working directory for the subprocess. Defaults to `/tmp`. */
  cwd?: string;
  /** CLI binary name / path. Defaults to `"claude"`. */
  bin?: string;
}

const DEFAULT_CWD = "/tmp";
const DEFAULT_BIN = "claude";

/**
 * Build a rewriter function bound to the given dependencies. Exposed so
 * tests can inject a stub spawner. Most callers should import the
 * default `rewrite` function below.
 */
export function makeClaudeCliRewriter(
  deps: ClaudeCliDeps = {},
): (text: string) => Promise<string> {
  const spawn = deps.spawn ?? (Bun.spawn as unknown as ClaudeCliSpawn);
  const cwd = deps.cwd ?? DEFAULT_CWD;
  const bin = deps.bin ?? DEFAULT_BIN;

  return async function rewrite(text: string): Promise<string> {
    const proc = spawn(
      [
        bin,
        "-p",
        "--disable-slash-commands",
        "--append-system-prompt",
        REWRITE_PROMPT,
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe", cwd },
    );

    proc.stdin.write(text);
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      throw new Error(
        `claude -p exited with code ${exitCode}: ${stderr.slice(0, 1000)}`,
      );
    }
    return stdout.trim();
  };
}

/**
 * Default rewriter using the real `Bun.spawn` and `cwd: "/tmp"`. This is
 * what the registry in `./rewriters.ts` exposes.
 */
export const rewrite = makeClaudeCliRewriter();
