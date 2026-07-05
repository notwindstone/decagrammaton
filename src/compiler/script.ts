export function extractTopLevelNames(script: string): Array<string> {
  const names: Array<string> = [];
  let braceDepth = 0;
  let i = 0;

  while (i < script.length) {
    const ch = script[i]!;

    if (ch === "/" && script[i + 1] === "/") {
      while (i < script.length && script[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && script[i + 1] === "*") {
      i += 2;
      while (i < script.length && !(script[i] === "*" && script[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < script.length && script[i] !== quote) {
        if (script[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }

    if (ch === "{") {
      braceDepth++;
      i++;
      continue;
    }

    if (ch === "}") {
      braceDepth--;
      i++;
      continue;
    }

    if (braceDepth > 0) {
      i++;
      continue;
    }

    if (matchKeyword(script, i, "let") || matchKeyword(script, i, "var") || matchKeyword(script, i, "const")) {
      const keyword = matchKeyword(script, i, "const") ? "const" : (matchKeyword(script, i, "let") ? "let" : "var");
      i += keyword.length;
      i = skipWhitespace(script, i);

      const name = readIdentifier(script, i);

      if (name) {
        names.push(name);
      }

      continue;
    }

    if (matchKeyword(script, i, "function")) {
      i += "function".length;
      i = skipWhitespace(script, i);

      const name = readIdentifier(script, i);

      if (name) {
        names.push(name);
      }

      continue;
    }

    i++;
  }

  return names;
}

function matchKeyword(source: string, pos: number, keyword: string): boolean {
  if (pos + keyword.length > source.length) return false;

  for (let j = 0; j < keyword.length; j++) {
    if (source[pos + j] !== keyword[j]) return false;
  }

  const after = source[pos + keyword.length];

  if (after && /[a-zA-Z0-9_$]/.test(after)) return false;

  const before = source[pos - 1];

  if (before && /[a-zA-Z0-9_$]/.test(before)) return false;

  return true;
}

function skipWhitespace(source: string, pos: number): number {
  while (pos < source.length && /\s/.test(source[pos]!)) pos++;

  return pos;
}

function readIdentifier(source: string, pos: number): string | null {
  const match = source.slice(pos).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);

  return match ? match[0] : null;
}

export function compileScript(
  script: string,
  globals: Array<string>,
): (...args: Array<unknown>) => Record<string, unknown> {
  const names = extractTopLevelNames(script);
  const body = `${script}\nreturn { ${names.join(", ")} };`;

  return new Function(...globals, body) as (...args: Array<unknown>) => Record<string, unknown>;
}
