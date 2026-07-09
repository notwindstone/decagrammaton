import { DecaCompileError } from "../errors.ts";

// Rewrite a template expression so its free identifiers resolve against the
// component's runtime context object (`_ctx`).
//
// Slice 2 scope: the counter only needs bare single identifiers (`count`,
// `inc`). We emit `_ctx.<id>` for those and THROW on anything more complex
// (member access, calls, operators). This is intentional — a real free-variable
// prefixer (acorn-based, skipping locals/globals/string contents) is its own
// focused step in a later slice. Failing loud here keeps the spine honest.

const BARE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function rewriteExpression(expression: string): string {
  const trimmed = expression.trim();

  if (!BARE_IDENTIFIER.test(trimmed)) {
    throw new DecaCompileError(
      `Unsupported template expression: ${JSON.stringify(expression)}. ` +
        `Slice 2 supports bare identifiers only (e.g. "count"). ` +
        `Complex expressions are added in a later slice.`,
    );
  }

  return `_ctx.${trimmed}`;
}
