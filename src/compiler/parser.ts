import { tokenize, TokenType, tokenTypeName } from './tokenize.ts';
import type { Token } from './tokenize.ts';
import { DecaParseError } from './errors.ts';

export interface SourceLocation {
    start: { line: number; column: number };
    end: { line: number; column: number };
}

export interface ScriptBlock {
    content: string;
    loc: SourceLocation;
}

export interface StyleBlock {
    content: string;
    loc: SourceLocation;
}

export type TemplateNode = ElementNode | TextNode | ExpressionNode | ConditionalNode | ForNode;

export interface ElementNode {
    type: 'element';
    tag: string;
    attributes: Attribute[];
    children: TemplateNode[];
    selfClosing: boolean;
    loc: SourceLocation;
}

export interface TextNode {
    type: 'text';
    value: string;
    loc: SourceLocation;
}

export interface ExpressionNode {
    type: 'expression';
    value: string;
    loc: SourceLocation;
}

export interface ConditionalBranch {
    condition: string | null;
    children: TemplateNode[];
    loc: SourceLocation;
}

export interface ConditionalNode {
    type: 'conditional';
    branches: ConditionalBranch[];
    loc: SourceLocation;
}

export interface ForNode {
    type: 'for';
    binding: string;
    iterable: string;
    key: string;
    children: TemplateNode[];
    loc: SourceLocation;
}

export type Attribute = StaticAttribute | ExpressionAttribute;

export interface StaticAttribute {
    type: 'attribute';
    name: string;
    value: string | true;
    loc: SourceLocation;
}

export interface ExpressionAttribute {
    type: 'expression-attribute';
    name: string;
    value: string;
    loc: SourceLocation;
}

export interface ParsedComponentType {
    script: ScriptBlock | null;
    style: StyleBlock | null;
    template: TemplateNode[];
    requires: Set<string>;
}

const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
    'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export class Parser {
    private readonly filename: string;
    private tokens: Array<Token> = [];
    private position: number;

    constructor(filename: string) {
        this.filename = filename;
        this.position = 0;
    }

    put(source: string): Parser {
        this.tokens = tokenize(source, this.filename);

        return this;
    }

    parse(): ParsedComponentType {
        const script = this.parseScript();
        const requires = script ? extractRequires(this.tokens) : new Set<string>();
        const style = this.parseStyle();
        const template = this.parseTemplate();

        this.skipWhitespaceText();
        this.expect(TokenType.EOF);

        return { script, style, template, requires };
    }

    private parseScript(): ScriptBlock | null {
        if (this.current().type !== TokenType.ScriptStart) {
            return null;
        }

        const startToken = this.current();

        this.position++;

        const contentToken = this.consume(TokenType.ScriptContent);
        const endToken = this.expect(TokenType.ScriptEnd);

        return {
            content: contentToken?.value ?? '',
            loc: this.loc(startToken, endToken),
        };
    }

    private parseStyle(): StyleBlock | null {
        if (this.current().type !== TokenType.StyleStart) {
            return null;
        }

        const startToken = this.current();

        this.position++;

        const contentToken = this.consume(TokenType.StyleContent);
        const endToken = this.expect(TokenType.StyleEnd);

        return {
            content: contentToken?.value ?? '',
            loc: this.loc(startToken, endToken),
        };
    }

    private parseTemplate(): TemplateNode[] {
        this.skipWhitespaceText();

        if (this.current().type === TokenType.TagOpen) {
            const nameTokPos = this.position + 1;
            const nameTok = this.tokens[nameTokPos];

            if (nameTok && nameTok.type === TokenType.TagName && nameTok.value === 'template') {
                this.expect(TokenType.TagOpen);
                this.expect(TokenType.TagName);

                if (this.current().type !== TokenType.TagClose) {
                    this.error('<template> tag does not allow any attributes');
                }

                this.expect(TokenType.TagClose);

                const children = this.parseChildren('template');

                this.expect(TokenType.EndTagOpen);
                const closeNameTok = this.expect(TokenType.TagName);

                if (closeNameTok.value !== 'template') {
                    this.error(`Expected </template>, got </${closeNameTok.value}>`);
                }

                this.expect(TokenType.TagClose);

                return processDirectives(children, this.filename);
            }
        }

        this.error('Expected <template> tag');
    }

    private parseChildren(parentTag: string | null): Array<TemplateNode> {
        const children: Array<TemplateNode> = [];

        while (this.position < this.tokens.length) {
            const token = this.current();

            if (token.type === TokenType.EOF) break;

            if (token.type === TokenType.EndTagOpen) {
                if (parentTag === null) {
                    this.error('Unexpected closing tag');
                }
                break;
            }

            if (token.type === TokenType.Text) {
                this.position++;
                if (token.value.trim().length > 0 || children.length > 0) {
                    children.push({
                        type: 'text',
                        value: token.value,
                        loc: this.loc(token, token),
                    });
                }
            } else if (token.type === TokenType.ExpressionStart) {
                children.push(this.parseExpression());
            } else if (token.type === TokenType.TagOpen) {
                children.push(this.parseElement());
            } else if (token.type === TokenType.ScriptStart) {
                this.error('Only one script tag is allowed, and it must be at the top');
            } else if (token.type === TokenType.StyleStart) {
                this.error('Only one style tag is allowed');
            } else {
                this.error(`Unexpected token ${tokenTypeName(token.type)}`);
            }
        }

        return children;
    }

    private parseExpression(): ExpressionNode {
        const startToken = this.expect(TokenType.ExpressionStart);
        const content = this.expect(TokenType.ExpressionContent);
        const endToken = this.expect(TokenType.ExpressionEnd);

        return {
            type: 'expression',
            value: content.value.trim(),
            loc: this.loc(startToken, endToken),
        };
    }

    private parseElement(): ElementNode {
        const openTok = this.expect(TokenType.TagOpen);
        const nameTok = this.expect(TokenType.TagName);
        const tag = nameTok.value;
        const attributes = this.parseAttributes();
        const selfCloseToken = this.consume(TokenType.TagSelfClose);

        if (selfCloseToken) {
            return {
                type: 'element',
                tag,
                attributes,
                children: [],
                selfClosing: true,
                loc: this.loc(openTok, selfCloseToken),
            };
        }

        this.expect(TokenType.TagClose);

        if (VOID_ELEMENTS.has(tag)) {
            return {
                type: 'element',
                tag,
                attributes,
                children: [],
                selfClosing: true,
                loc: this.loc(openTok, this.tokens[this.position - 1]!),
            };
        }

        const children = this.parseChildren(tag);

        this.expect(TokenType.EndTagOpen);
        const closeNameTok = this.expect(TokenType.TagName);

        if (closeNameTok.value !== tag) {
            throw new DecaParseError(
                `Mismatched closing tag: expected </${tag}>, got </${closeNameTok.value}>`,
                this.filename,
                closeNameTok.line,
                closeNameTok.column,
            );
        }

        const closeTagTok = this.expect(TokenType.TagClose);

        return {
            type: 'element',
            tag,
            attributes,
            children: processDirectives(children, this.filename),
            selfClosing: false,
            loc: this.loc(openTok, closeTagTok),
        };
    }

    private parseAttributes(): Array<Attribute> {
        const attrs: Array<Attribute> = [];

        while (this.current().type === TokenType.AttributeName) {
            const nameTok = this.current();
            this.position++;

            if (this.consume(TokenType.AttributeEquals)) {
                if (this.current().type === TokenType.AttributeValue) {
                    const valTok = this.current();
                    this.position++;
                    attrs.push({
                        type: 'attribute',
                        name: nameTok.value,
                        value: valTok.value,
                        loc: this.loc(nameTok, valTok),
                    });
                } else if (this.current().type === TokenType.ExpressionStart) {
                    this.position++;
                    const contentTok = this.expect(TokenType.ExpressionContent);
                    const exprEndTok = this.expect(TokenType.ExpressionEnd);
                    attrs.push({
                        type: 'expression-attribute',
                        name: nameTok.value,
                        value: contentTok.value.trim(),
                        loc: this.loc(nameTok, exprEndTok),
                    });
                } else {
                    this.error("Expected attribute value after '='");
                }
            } else {
                attrs.push({
                    type: 'attribute',
                    name: nameTok.value,
                    value: true,
                    loc: this.loc(nameTok, nameTok),
                });
            }
        }

        return attrs;
    }

    private skipWhitespaceText(): void {
        while (
            this.current().type === TokenType.Text &&
            this.current().value.trim().length === 0
        ) {
            this.position++;
        }
    }

    private current(): Token {
        return this.tokens[this.position]!;
    }

    private expect(type: TokenType): Token {
        const tok = this.current();

        if (tok.type !== type) {
            this.error(`Expected ${tokenTypeName(type)}, got ${tokenTypeName(tok.type)} ('${tok.value}')`);
        }

        this.position++;
        return tok;
    }

    private consume(type: TokenType): Token | null {
        if (this.current().type === type) {
            return this.tokens[this.position++]!;
        }

        return null;
    }

    private error(msg: string): never {
        const tok = this.current();
        throw new DecaParseError(msg, this.filename, tok.line, tok.column);
    }

    private loc(startTok: Token, endTok?: Token): SourceLocation {
        const end = endTok ?? this.tokens[this.position - 1]!;

        return {
            start: { line: startTok.line, column: startTok.column },
            end: { line: end.line, column: end.column },
        };
    }
}

function extractRequires(tokens: Array<Token>): Set<string> {
    const requires = new Set<string>();
    const scriptStartToken = tokens.find(t => t.type === TokenType.ScriptStart);

    if (!scriptStartToken) return requires;

    const tagText = scriptStartToken.value;
    const regex = /requires\s*=\s*"([^"]*)"/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(tagText)) !== null) {
        requires.add(match[1]!);
    }

    return requires;
}

function getDirectiveAttr(attrs: Array<Attribute>, name: string): Attribute | undefined {
    return attrs.find(a => a.name === name);
}

function getDirectiveValue(attr: Attribute): string | null {
    if (attr.type === 'expression-attribute') return attr.value;
    if (attr.type === 'attribute' && typeof attr.value === 'string') return attr.value;
    return null;
}

function stripDirectiveAttrs(attrs: Array<Attribute>): Array<Attribute> {
    return attrs.filter(a =>
        a.name !== ':if' &&
        a.name !== ':else-if' &&
        a.name !== ':else' &&
        a.name !== ':for' &&
        a.name !== ':key'
    );
}

function processDirectives(children: Array<TemplateNode>, filename?: string): Array<TemplateNode> {
    const result: Array<TemplateNode> = [];

    for (let i = 0; i < children.length; i++) {
        const child = children[i]!;

        if (child.type !== 'element') {
            result.push(child);
            continue;
        }

        const forAttr = getDirectiveAttr(child.attributes, ':for');
        const keyAttr = getDirectiveAttr(child.attributes, ':key');

        if (forAttr) {
            if (!keyAttr) {
                throw new DecaParseError(
                    ':for requires a :key attribute',
                    filename,
                    child.loc.start.line,
                    child.loc.start.column,
                );
            }

            const forValue = getDirectiveValue(forAttr);
            const keyValue = getDirectiveValue(keyAttr);

            if (!forValue || !keyValue) {
                throw new DecaParseError(
                    ':for and :key must have expression values',
                    filename,
                    child.loc.start.line,
                    child.loc.start.column,
                );
            }

            const forMatch = forValue.match(/^(.+?)\s+in\s+(.+)$/);

            if (!forMatch) {
                throw new DecaParseError(
                    ':for must use "binding in iterable" syntax',
                    filename,
                    child.loc.start.line,
                    child.loc.start.column,
                );
            }

            result.push({
                type: 'for',
                binding: forMatch[1]!.trim(),
                iterable: forMatch[2]!.trim(),
                key: keyValue,
                children: [{
                    ...child,
                    attributes: stripDirectiveAttrs(child.attributes),
                }],
                loc: child.loc,
            });

            continue;
        }

        const ifAttr = getDirectiveAttr(child.attributes, ':if');

        if (ifAttr) {
            const condition = getDirectiveValue(ifAttr);

            if (!condition) {
                throw new DecaParseError(
                    ':if must have an expression value',
                    filename,
                    child.loc.start.line,
                    child.loc.start.column,
                );
            }

            const branches: ConditionalBranch[] = [{
                condition,
                children: [{
                    ...child,
                    attributes: stripDirectiveAttrs(child.attributes),
                }],
                loc: child.loc,
            }];

            while (i + 1 < children.length) {
                let nextIndex = i + 1;

                while (nextIndex < children.length) {
                    const candidate = children[nextIndex]!;
                    if (candidate.type === 'text' && candidate.value.trim().length === 0) {
                        nextIndex++;
                        continue;
                    }
                    break;
                }

                const next = children[nextIndex];

                if (!next || next.type !== 'element') break;

                const elseIfAttr = getDirectiveAttr(next.attributes, ':else-if');
                const elseAttr = getDirectiveAttr(next.attributes, ':else');

                if (elseIfAttr) {
                    const elseIfCond = getDirectiveValue(elseIfAttr);

                    if (!elseIfCond) {
                        throw new DecaParseError(
                            ':else-if must have an expression value',
                            filename,
                            next.loc.start.line,
                            next.loc.start.column,
                        );
                    }

                    branches.push({
                        condition: elseIfCond,
                        children: [{
                            ...next,
                            attributes: stripDirectiveAttrs(next.attributes),
                        }],
                        loc: next.loc,
                    });
                    i = nextIndex;
                } else if (elseAttr) {
                    branches.push({
                        condition: null,
                        children: [{
                            ...next,
                            attributes: stripDirectiveAttrs(next.attributes),
                        }],
                        loc: next.loc,
                    });
                    i = nextIndex;
                    break;
                } else {
                    break;
                }
            }

            result.push({
                type: 'conditional',
                branches,
                loc: {
                    start: branches[0]!.loc.start,
                    end: branches[branches.length - 1]!.loc.end,
                },
            });

            continue;
        }

        result.push(child);
    }

    return result;
}
