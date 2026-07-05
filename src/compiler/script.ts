export interface ExtractedImports {
  imports: Array<string>;
  importedNames: Array<string>;
  cleanedScript: string;
}

export function extractImports(script: string): ExtractedImports {
  const imports: Array<string> = [];
  const importedNames: Array<string> = [];
  const removals: Array<{ start: number; end: number }> = [];
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

    if (!matchKeyword(script, i, "import")) {
      i++;
      continue;
    }

    if (script[i + "import".length] === "(") {
      i += "import".length;
      continue;
    }

    const start = i;
    i += "import".length;
    i = skipWhitespace(script, i);

    const afterImport = script[i];

    if (afterImport === '"' || afterImport === "'") {
      const quote = afterImport;
      i++;
      while (i < script.length && script[i] !== quote) i++;
      i++;
      i = skipPastSemicolon(script, i);

      imports.push(script.slice(start, i));
      removals.push({ start, end: i });
      continue;
    }

    if (afterImport === "{") {
      i++;
      const names = readNamedImports(script, i);
      i = names.end;
      i = skipWhitespace(script, i);

      if (matchKeyword(script, i, "from")) {
        i += "from".length;
        i = skipWhitespace(script, i);
        i = skipStringLiteral(script, i);
        i = skipPastSemicolon(script, i);

        imports.push(script.slice(start, i));
        importedNames.push(...names.bindings);
        removals.push({ start, end: i });
      }

      continue;
    }

    if (afterImport === "*") {
      i++;
      i = skipWhitespace(script, i);

      if (matchKeyword(script, i, "as")) {
        i += "as".length;
        i = skipWhitespace(script, i);
        const name = readIdentifier(script, i);

        if (name) {
          i += name.length;
          i = skipWhitespace(script, i);

          if (matchKeyword(script, i, "from")) {
            i += "from".length;
            i = skipWhitespace(script, i);
            i = skipStringLiteral(script, i);
            i = skipPastSemicolon(script, i);

            imports.push(script.slice(start, i));
            importedNames.push(name);
            removals.push({ start, end: i });
          }
        }
      }

      continue;
    }

    const defaultName = readIdentifier(script, i);

    if (defaultName) {
      i += defaultName.length;
      i = skipWhitespace(script, i);

      if (script[i] === ",") {
        i++;
        i = skipWhitespace(script, i);
        const bindings = [defaultName];

        if (script[i] === "{") {
          i++;
          const names = readNamedImports(script, i);
          i = names.end;
          bindings.push(...names.bindings);
        } else if (script[i] === "*") {
          i++;
          i = skipWhitespace(script, i);

          if (matchKeyword(script, i, "as")) {
            i += "as".length;
            i = skipWhitespace(script, i);
            const nsName = readIdentifier(script, i);

            if (nsName) {
              i += nsName.length;
              bindings.push(nsName);
            }
          }
        }

        i = skipWhitespace(script, i);

        if (matchKeyword(script, i, "from")) {
          i += "from".length;
          i = skipWhitespace(script, i);
          i = skipStringLiteral(script, i);
          i = skipPastSemicolon(script, i);

          imports.push(script.slice(start, i));
          importedNames.push(...bindings);
          removals.push({ start, end: i });
        }

        continue;
      }

      if (matchKeyword(script, i, "from")) {
        i += "from".length;
        i = skipWhitespace(script, i);
        i = skipStringLiteral(script, i);
        i = skipPastSemicolon(script, i);

        imports.push(script.slice(start, i));
        importedNames.push(defaultName);
        removals.push({ start, end: i });
      }

      continue;
    }

    i++;
  }

  let cleanedScript = "";
  let lastEnd = 0;

  for (const { start, end } of removals) {
    cleanedScript += script.slice(lastEnd, start);
    lastEnd = end;
  }

  cleanedScript += script.slice(lastEnd);

  return { imports, importedNames, cleanedScript };
}

function readNamedImports(source: string, pos: number): { bindings: Array<string>; end: number } {
  const bindings: Array<string> = [];

  while (pos < source.length && source[pos] !== "}") {
    pos = skipWhitespace(source, pos);

    if (source[pos] === "}") break;

    if (source[pos] === ",") {
      pos++;
      continue;
    }

    const name = readIdentifier(source, pos);

    if (!name) {
      pos++;
      continue;
    }

    pos += name.length;
    pos = skipWhitespace(source, pos);

    if (matchKeyword(source, pos, "as")) {
      pos += "as".length;
      pos = skipWhitespace(source, pos);
      const alias = readIdentifier(source, pos);

      if (alias) {
        bindings.push(alias);
        pos += alias.length;
      }
    } else {
      bindings.push(name);
    }
  }

  if (pos < source.length && source[pos] === "}") pos++;

  return { bindings, end: pos };
}

function skipStringLiteral(source: string, pos: number): number {
  const quote = source[pos];

  if (quote !== '"' && quote !== "'") return pos;

  pos++;

  while (pos < source.length && source[pos] !== quote) {
    if (source[pos] === "\\") pos++;
    pos++;
  }

  if (pos < source.length) pos++;

  return pos;
}

function skipPastSemicolon(source: string, pos: number): number {
  const saved = pos;
  pos = skipWhitespace(source, pos);

  if (pos < source.length && source[pos] === ";") return pos + 1;

  return saved;
}

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
