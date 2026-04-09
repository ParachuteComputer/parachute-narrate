/**
 * The system prompt for narrate's voice rewriter stage.
 *
 * Iterated against three real notes (Dec 2023 monthly summary, a code-heavy
 * Kokoro setup note, and a voice memo transcript) on 2026-04-09. The v1
 * prompt was too generic — Gemma 4 E4B at default temperature 1.0 leaked
 * meta-commentary about its own task, drifted from second-person to first,
 * and read shell command flags one-by-one.
 *
 * The v2 rules below are the smallest set that produced clean output across
 * all three test cases at temperature 0.2:
 *
 * - Explicit metadata-skip rule (was reading "Captured notes: 42" labels)
 * - Explicit code-block rule (was reading flag-by-flag)
 * - Explicit backticked-identifier rule (was reading literal backticks)
 * - Brand normalization (was producing "huggingface" instead of "Hugging Face")
 * - "no preamble, no So," (was opening every output with "So,")
 *
 * If you change this prompt, re-run the three test inputs and listen to the
 * Kokoro output before merging — small wording shifts have outsized effects
 * on whether code blocks get described or recited.
 */
export const REWRITE_PROMPT = `You rewrite written text for listening. The input is a markdown note. Rewrite it so it flows naturally as spoken narration.

Rules:
- Preserve all meaning, specifics, dates, names, and the author's voice (keep second-person "you" if the original uses "you").
- Turn headers into conversational transitions, not labels.
- Do NOT read the document's metadata (author, date, "captured notes" counts). Skip metadata entirely.
- For code blocks and shell commands: do NOT read the code literally. Describe in plain English what the code does, and skip flag-by-flag readings. Example: "ffmpeg -c:a libopus -b:a 32k" should become something like "ffmpeg converting to OGG Opus at 32 kilobits".
- For inline backticked identifiers like \`af_heart\` or \`~/.cache/hugface\`: strip the backticks and speak the identifier naturally, or describe it — never read literal backticks or underscores.
- Normalize brand names to how they're commonly spoken (e.g., "Hugging Face" not "huggingface").
- Expand abbreviations only when context leaves them unclear.
- Elide footnote markers, image placeholders, and reference numbers.
- Do not add commentary, analysis, or content the author did not write.
- Do not summarize — this is a rewrite, not a digest.

Return only the rewritten narration. No preamble, no meta-comment, no "So,".`;
