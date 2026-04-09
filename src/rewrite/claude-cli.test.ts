/**
 * Tests for the `claude -p` subprocess rewriter.
 *
 * Uses the injectable spawner — never spawns a real `claude` process. The
 * goal here is to lock in the argv shape (which flags are passed and in
 * what order) and verify that stdin gets piped + stdout returned trimmed.
 */

import { describe, test, expect } from "bun:test";
import {
  makeClaudeCliRewriter,
  type ClaudeCliSpawn,
  type ClaudeCliSubprocess,
} from "./claude-cli.ts";
import { REWRITE_PROMPT } from "./prompt.ts";

interface SpawnCall {
  argv: string[];
  cwd: string;
  stdinChunks: string[];
}

interface FakeSpawnResult {
  call: SpawnCall;
  spawn: ClaudeCliSpawn;
}

/**
 * Build a fake spawner that records argv + stdin and returns the given
 * stdout/stderr/exitCode. Returns both the fake and a `call` ref the
 * test can inspect after the rewriter runs.
 */
function makeFakeSpawn(opts: {
  stdout: string;
  stderr?: string;
  exitCode?: number;
}): FakeSpawnResult {
  const call: SpawnCall = { argv: [], cwd: "", stdinChunks: [] };

  const spawn: ClaudeCliSpawn = (argv, options) => {
    call.argv = argv;
    call.cwd = options.cwd;

    const proc: ClaudeCliSubprocess = {
      stdin: {
        write: (chunk: string) => {
          call.stdinChunks.push(chunk);
        },
        end: () => {},
      },
      stdout: new Response(opts.stdout).body!,
      stderr: new Response(opts.stderr ?? "").body!,
      exited: Promise.resolve(opts.exitCode ?? 0),
    };
    return proc;
  };

  return { call, spawn };
}

describe("claude-cli rewriter", () => {
  test("spawns `claude -p` with the expected argv shape", async () => {
    const { spawn, call } = makeFakeSpawn({
      stdout: "rewritten output\n",
    });
    const rewrite = makeClaudeCliRewriter({ spawn });

    const out = await rewrite("hello world");
    expect(out).toBe("rewritten output");

    expect(call.argv[0]).toBe("claude");
    expect(call.argv[1]).toBe("-p");
    // --disable-slash-commands prevents skill loading on each invocation.
    expect(call.argv).toContain("--disable-slash-commands");
    // --append-system-prompt + REWRITE_PROMPT, in that order.
    const apsIdx = call.argv.indexOf("--append-system-prompt");
    expect(apsIdx).toBeGreaterThan(-1);
    expect(call.argv[apsIdx + 1]).toBe(REWRITE_PROMPT);
  });

  test("defaults cwd to /tmp to avoid picking up ambient CLAUDE.md", async () => {
    const { spawn, call } = makeFakeSpawn({ stdout: "ok" });
    const rewrite = makeClaudeCliRewriter({ spawn });

    await rewrite("hi");
    expect(call.cwd).toBe("/tmp");
  });

  test("honors a custom cwd override", async () => {
    const { spawn, call } = makeFakeSpawn({ stdout: "ok" });
    const rewrite = makeClaudeCliRewriter({ spawn, cwd: "/var/empty" });

    await rewrite("hi");
    expect(call.cwd).toBe("/var/empty");
  });

  test("honors a custom bin override", async () => {
    const { spawn, call } = makeFakeSpawn({ stdout: "ok" });
    const rewrite = makeClaudeCliRewriter({
      spawn,
      bin: "/opt/claude/bin/claude",
    });

    await rewrite("hi");
    expect(call.argv[0]).toBe("/opt/claude/bin/claude");
  });

  test("pipes the input text to stdin", async () => {
    const { spawn, call } = makeFakeSpawn({ stdout: "ok" });
    const rewrite = makeClaudeCliRewriter({ spawn });

    await rewrite("the input text");
    expect(call.stdinChunks).toEqual(["the input text"]);
  });

  test("trims trailing whitespace from stdout", async () => {
    const { spawn } = makeFakeSpawn({ stdout: "  hello\n\n" });
    const rewrite = makeClaudeCliRewriter({ spawn });

    const out = await rewrite("hi");
    expect(out).toBe("hello");
  });

  test("throws on non-zero exit code with stderr in the message", async () => {
    const { spawn } = makeFakeSpawn({
      stdout: "",
      stderr: "auth: not logged in",
      exitCode: 1,
    });
    const rewrite = makeClaudeCliRewriter({ spawn });

    await expect(rewrite("hi")).rejects.toThrow(
      /claude -p exited with code 1.*auth: not logged in/,
    );
  });
});
