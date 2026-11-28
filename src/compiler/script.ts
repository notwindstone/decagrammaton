import {
  compileScript,
  type BindingMetadata,
  type SFCDescriptor,
} from "@vue/compiler-sfc";
import { DecaCompileError } from "./errors.ts";
import { parseSFC } from "./parse.ts";
import { parse, tokTypes } from "acorn";
import ts from "typescript";
export function transpileScript(script: string): string {
  const result = ts.transpileModule(script, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
  });
  if (result.diagnostics?.length)
    throw new DecaCompileError(
      result.diagnostics
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
        .join("\n"),
    );
  return result.outputText;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}
function applyEdits(source: string, edits: Edit[]) {
  const parts: string[] = [];
  let offset = 0;
  for (const { start, end, text } of edits.sort((a, b) => a.start - b.start)) {
    parts.push(source.slice(offset, start), text);
    offset = end;
  }
  return parts.join("") + source.slice(offset);
}

// Vue assigns fixed helper names. Bind authored symbols before Vue combines
// the two namespaces, while TypeScript can still distinguish their references.
function withSetupProgram<T>(
  source: string,
  inspect: (
    service: ts.LanguageService,
    program: ts.Program,
    ast: ts.SourceFile,
  ) => T,
): T {
  const file = "/setup.ts";
  const snapshot = ts.ScriptSnapshot.fromString(source);
  const service = ts.createLanguageService({
    getScriptFileNames: () => [file],
    getScriptVersion: () => "0",
    getScriptSnapshot: (path) => (path === file ? snapshot : undefined),
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => ({
      noLib: true,
      noResolve: true,
      target: ts.ScriptTarget.Latest,
    }),
    getDefaultLibFileName: () => "",
    fileExists: (path) => path === file,
    readFile: (path) => (path === file ? source : undefined),
  });
  try {
    const program = service.getProgram()!;
    const ast = program.getSourceFile(file)!;
    return inspect(service, program, ast);
  } finally {
    service.dispose();
  }
}

function protectBindings(source: string, names: Map<string, string>) {
  return withSetupProgram(source, (service, program, ast) => {
    const symbols = program
      .getTypeChecker()
      .getSymbolsInScope(ast, ts.SymbolFlags.Value | ts.SymbolFlags.Alias);
    const edits: Edit[] = [];
    for (const symbol of symbols) {
      const alias = names.get(symbol.name);
      const declaration = symbol.declarations?.[0] as
        ts.NamedDeclaration | undefined;
      if (!alias || !declaration?.name) continue;
      const references = service.findRenameLocations(
        ast.fileName,
        declaration.name.getStart(ast),
        false,
        false,
        true,
      );
      if (!references)
        throw new DecaCompileError(
          "Cannot resolve setup binding " + symbol.name,
        );
      for (const { textSpan, prefixText, suffixText } of references)
        edits.push({
          start: textSpan.start,
          end: textSpan.start + textSpan.length,
          text: (prefixText ?? "") + alias + (suffixText ?? ""),
        });
    }
    return applyEdits(source, edits);
  });
}

export function compileSetup(descriptor: SFCDescriptor, id: string) {
  if (descriptor.script)
    throw new DecaCompileError(
      "Plain <script> is unsupported. Use <script setup>.",
    );
  let bindingName = "__deca_component__";
  if (!descriptor.scriptSetup)
    return {
      content: `const ${bindingName} = { setup() { return {} } };`,
      bindingName,
      identifiers: new Set([bindingName]),
      bindings: {} as BindingMetadata,
    };
  try {
    const setup = descriptor.scriptSetup;
    if ("lang" in setup.attrs && typeof setup.attrs.lang !== "string")
      throw new DecaCompileError("Missing <script setup> language.");
    if (setup.lang !== undefined && setup.lang !== "js" && setup.lang !== "ts")
      throw new DecaCompileError(
        `Unsupported <script setup> language: ${setup.lang}`,
      );
    const reserved = new Set<string>();
    const authored = parse(
      setup.lang === "ts" ? transpileScript(setup.content) : setup.content,
      {
        ecmaVersion: "latest",
        sourceType: "module",
        onToken(token) {
          if (
            token.type === tokTypes.name &&
            "value" in token &&
            typeof token.value === "string"
          )
            reserved.add(token.value);
        },
      },
    );
    if (reserved.has("defineEmits")) {
      withSetupProgram(setup.content, (_, program, ast) => {
        const checker = program.getTypeChecker();
        function inspect(node: ts.Node) {
          if (ts.isCallExpression(node)) {
            let callee = node.expression as ts.Expression;
            while (
              ts.isParenthesizedExpression(callee) ||
              ts.isNonNullExpression(callee) ||
              ts.isAsExpression(callee) ||
              ts.isSatisfiesExpression(callee) ||
              ts.isTypeAssertionExpression(callee) ||
              ts.isExpressionWithTypeArguments(callee)
            )
              callee = callee.expression;
            if (
              ts.isIdentifier(callee) &&
              callee.text === "defineEmits" &&
              !checker.getSymbolAtLocation(callee)
            )
              throw new DecaCompileError("defineEmits is unsupported.");
          }
          ts.forEachChild(node, inspect);
        }
        inspect(ast);
      });
    }
    while (reserved.has(bindingName)) bindingName += "_";
    // Use a distinct module specifier to identify Vue's import even when the
    // first authored statement also imports from decagrammaton/runtime.
    let helperModule = "decagrammaton:generated";
    while (
      authored.body.some(
        (stmt) =>
          stmt.type === "ImportDeclaration" &&
          stmt.source.value === helperModule,
      )
    )
      helperModule += "_";
    const options = {
      id,
      fs: ts.sys,
      genDefaultAs: bindingName,
      templateOptions: { compilerOptions: { runtimeModuleName: helperModule } },
    };
    const compiled = compileScript(descriptor, options);
    const original = ts.createSourceFile(
      "compiled.ts",
      compiled.content,
      ts.ScriptTarget.Latest,
      true,
    );
    const first = original.statements[0];
    const privateNames = new Map<string, string>();
    if (
      ts.isImportDeclaration(first) &&
      ts.isStringLiteral(first.moduleSpecifier) &&
      first.moduleSpecifier.text === helperModule
    ) {
      const named = first.importClause!.namedBindings!;
      if (!ts.isNamedImports(named))
        throw new DecaCompileError("Unexpected helper import.");
      for (const spec of named.elements) {
        const helper = spec.propertyName!.text;
        if (helper !== "defineComponent" && helper !== "mergeDefaults")
          throw new DecaCompileError(
            "Unsupported Vue runtime helper " + helper,
          );
        const local = spec.name.text;
        if (Object.hasOwn(compiled.bindings ?? {}, local)) {
          let alias = local + "_";
          while (reserved.has(alias) || descriptor.source.includes(alias))
            alias += "_";
          privateNames.set(local, alias);
        }
      }
    }
    let lowered = compiled.content;
    if (privateNames.size) {
      const edits: Edit[] = [
        {
          start: setup.loc.start.offset,
          end: setup.loc.end.offset,
          text: protectBindings(setup.content, privateNames),
        },
      ];
      const used = [...privateNames].filter(
        ([name]) => compiled.imports?.[name]?.isUsedInTemplate,
      );
      if (descriptor.template && used.length) {
        const end = descriptor.template.loc.end.offset;
        edits.push({
          start: end,
          end,
          text: "{{ [" + used.map(([, alias]) => alias).join(", ") + "] }}",
        });
      }
      const protectedDescriptor = parseSFC(
        applyEdits(descriptor.source, edits),
        descriptor.filename,
      );
      lowered = compileScript(protectedDescriptor, options).content;
    }
    let content = transpileScript(lowered);
    if (privateNames.size) {
      // Rename the now-unambiguous generated imports by symbol, then restore
      // the authored names (including the setup result's shorthand keys).
      const helperNames = new Map(
        [...privateNames].map(([name, temp]) => {
          let alias = temp + "_";
          while (reserved.has(alias)) alias += "_";
          return [name, alias];
        }),
      );
      content = protectBindings(content, helperNames);
    }
    const ast = ts.createSourceFile(
      "setup.js",
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    const restore = new Map(
      [...privateNames].map(([name, temp]) => [temp, name]),
    );
    const identifiers = new Set<string>();
    const edits: Edit[] = [];
    function collect(node: ts.Node) {
      if (ts.isIdentifier(node)) {
        const name = restore.get(node.text);
        identifiers.add(name ?? node.text);
        if (name)
          edits.push({ start: node.getStart(ast), end: node.end, text: name });
      } else if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const spec = node.moduleSpecifier;
        if (spec.text === "vue")
          throw new DecaCompileError(
            "Import reactive APIs from decagrammaton.",
          );
        if (spec.text === helperModule)
          edits.push({
            start: spec.getStart(ast),
            end: spec.end,
            text: '"decagrammaton/runtime"',
          });
      }
      ts.forEachChild(node, collect);
    }
    collect(ast);
    return {
      content: applyEdits(content, edits),
      bindingName,
      identifiers,
      bindings: compiled.bindings ?? {},
      deps: compiled.deps,
    };
  } catch (error) {
    throw new DecaCompileError((error as Error).message);
  }
}
