import * as acorn from "acorn";
import * as ts from "typescript";
import type { ImportDeclaration, Pattern, VariableDeclaration, FunctionDeclaration } from "acorn";
import { DecaParseError } from "./errors.ts";

export interface ExtractedImports {
  imports: Array<string>;
  importedNames: Array<string>;
  cleanedScript: string;
}

/**
 * Parse a script body with acorn, converting acorn's SyntaxError into a
 * DecaParseError. Line/column are relative to the `<script>` body, not the
 * whole `.deca` file. Callers pass the script through {@link transpileScript}
 * first, so anything reaching here is expected to be valid JS.
 */
function parseModule(script: string, filename?: string): acorn.Program {
  try {
    return acorn.parse(script, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
    });
  } catch (err) {
    const loc = (err as { loc?: { line: number; column: number } }).loc;
    const message = (err as Error).message?.replace(/\s*\(\d+:\d+\)\s*$/, "") ?? "Failed to parse script";
    throw new DecaParseError(message, filename, loc?.line, loc?.column);
  }
}

/**
 * Transpile a TypeScript `<script lang="ts">` body down to plain JS so acorn
 * (a JS-only parser) can handle it. `verbatimModuleSyntax` is required: the
 * script's imports are referenced from the template, not the script body, so
 * TypeScript would otherwise elide them as "unused" and break component wiring.
 */
export function transpileScript(script: string): string {
  return ts.transpileModule(script, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
  }).outputText;
}

export function extractImports(script: string, filename?: string): ExtractedImports {
  const ast = parseModule(script, filename);

  const imports: Array<string> = [];
  const importedNames: Array<string> = [];
  const removals: Array<{ start: number; end: number }> = [];

  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") continue;

    const decl = node as ImportDeclaration;
    imports.push(script.slice(decl.start, decl.end));

    for (const spec of decl.specifiers) {
      importedNames.push(spec.local.name);
    }

    removals.push({ start: decl.start, end: decl.end });
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

function collectBindingNames(pattern: Pattern, names: Array<string>): void {
  switch (pattern.type) {
    case "Identifier":
      names.push(pattern.name);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") {
          collectBindingNames(prop.argument as Pattern, names);
        } else {
          collectBindingNames(prop.value as Pattern, names);
        }
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (element) collectBindingNames(element, names);
      }
      break;
    case "AssignmentPattern":
      collectBindingNames(pattern.left, names);
      break;
    case "RestElement":
      collectBindingNames(pattern.argument as Pattern, names);
      break;
  }
}

export function extractTopLevelNames(script: string, filename?: string): Array<string> {
  const ast = parseModule(script, filename);

  const names: Array<string> = [];

  for (const node of ast.body) {
    if (node.type === "VariableDeclaration") {
      const decl = node as VariableDeclaration;

      for (const declarator of decl.declarations) {
        collectBindingNames(declarator.id as Pattern, names);
      }
    } else if (node.type === "FunctionDeclaration") {
      const decl = node as FunctionDeclaration;
      if (decl.id) names.push(decl.id.name);
    }
  }

  return names;
}

export function compileScript(
  script: string,
  globals: Array<string>,
  filename?: string,
): (...args: Array<unknown>) => Record<string, unknown> {
  const names = extractTopLevelNames(script, filename);
  const body = `${script}\nreturn { ${names.join(", ")} };`;

  return new Function(...globals, body) as (...args: Array<unknown>) => Record<string, unknown>;
}
