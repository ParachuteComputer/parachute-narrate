/**
 * Tests for `REWRITE_PROMPT`. Not asserting the literal string —
 * those tests are noise that lock in incidental wording. Asserting the
 * load-bearing rules: every clause we discovered through empirical
 * iteration should still be in the prompt, since silently dropping any
 * one of them would regress voice output for a known case.
 */

import { describe, test, expect } from "bun:test";
import { REWRITE_PROMPT } from "./prompt.ts";

describe("REWRITE_PROMPT", () => {
  test("is a non-empty string", () => {
    expect(typeof REWRITE_PROMPT).toBe("string");
    expect(REWRITE_PROMPT.length).toBeGreaterThan(200);
  });

  test("instructs the model to rewrite (not summarize)", () => {
    expect(REWRITE_PROMPT).toMatch(/rewrite/i);
    expect(REWRITE_PROMPT).toMatch(/not.*(summarize|digest)/i);
  });

  test("forbids reading code blocks literally", () => {
    // Without this rule Gemma 4 reads shell command flags one-by-one.
    expect(REWRITE_PROMPT.toLowerCase()).toContain("code");
    expect(REWRITE_PROMPT).toMatch(/(literal|literally|flag-by-flag)/i);
  });

  test("forbids reading literal backticks", () => {
    // Without this rule the model reads "backtick af underscore heart backtick".
    expect(REWRITE_PROMPT).toMatch(/backtick/i);
  });

  test("instructs metadata skipping", () => {
    // Without this rule the model reads "Captured notes: 42 total" labels.
    expect(REWRITE_PROMPT).toMatch(/metadata/i);
  });

  test("instructs brand normalization", () => {
    // Without this rule the model says "huggingface" instead of "Hugging Face".
    expect(REWRITE_PROMPT).toMatch(/(brand|Hugging Face)/i);
  });

  test("instructs preservation of voice and second-person", () => {
    expect(REWRITE_PROMPT).toMatch(/second-person/i);
    expect(REWRITE_PROMPT).toMatch(/(voice|specifics|meaning)/i);
  });

  test("forbids preamble or meta-commentary in the output", () => {
    expect(REWRITE_PROMPT).toMatch(/no preamble/i);
    expect(REWRITE_PROMPT).toMatch(/no meta-comment/i);
  });
});
