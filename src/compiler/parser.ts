import { tokenize, TokenType, tokenTypeName } from './tokenize.ts';
import type { Token } from './tokenize.ts';
import { DecaParseError } from './errors.ts';
import type { ParsedComponentType } from "../types/component/parsed-component.type.ts";

export interface SourceLocation {
    start: { line: number; column: number };
    end: { line: number; column: number };
}

export interface ScriptBlock {
    content: string;
    loc: SourceLocation;
}

export type TemplateNode = ElementNode | TextNode | ExpressionNode;

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
        const template = this.parseChildren(null);

        this.expect(TokenType.EOF);

        return { script, template };
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
            children,
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
