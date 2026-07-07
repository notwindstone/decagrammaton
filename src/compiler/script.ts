import * as acorn from "acorn";
import type { ImportDeclaration, Pattern, VariableDeclaration, FunctionDeclaration } from "acorn";

export interface ExtractedImports {
  imports: Array<string>;
  importedNames: Array<string>;
  cleanedScript: string;
}

export function extractImports(script: string): ExtractedImports {
  let ast: acorn.Program;

  try {
    ast = acorn.parse(script, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return { imports: [], importedNames: [], cleanedScript: script };
  }

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

export function extractTopLevelNames(script: string): Array<string> {
  let ast: acorn.Program;

  try {
    ast = acorn.parse(script, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true });
  } catch {
    return [];
  }

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
): (...args: Array<unknown>) => Record<string, unknown> {
  const names = extractTopLevelNames(script);
  const body = `${script}\nreturn { ${names.join(", ")} };`;

  return new Function(...globals, body) as (...args: Array<unknown>) => Record<string, unknown>;
}
