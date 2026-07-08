import { DecaParseError } from './errors.ts';

export const TokenType = {
    ScriptStart: 0,
    ScriptContent: 1,
    ScriptEnd: 2,

    StyleStart: 3,
    StyleContent: 4,
    StyleEnd: 5,

    TagOpen: 6,
    TagClose: 7,
    TagSelfClose: 8,
    EndTagOpen: 9,
    TagName: 10,

    AttributeName: 11,
    AttributeEquals: 12,
    AttributeValue: 13,

    ExpressionStart: 14,
    ExpressionContent: 15,
    ExpressionEnd: 16,

    Text: 17,
    EOF: 18,
} as const;

export type TokenType = (typeof TokenType)[keyof typeof TokenType];

export interface Token {
    type: TokenType;
    value: string;
    line: number;
    column: number;
}

const State = {
    Text: 0,
    ScriptOpen: 1,
    ScriptBody: 2,
    StyleOpen: 3,
    StyleBody: 4,
    Tag: 5,
    EndTag: 6,
    TagAttrs: 7,
    AttrName: 8,
    AttrValue: 9,
    AttrExpression: 10,
    Expression: 11,
} as const;

type State = (typeof State)[keyof typeof State];

const tokenTypeNames: Record<TokenType, string> = Object.fromEntries(
    Object.entries(TokenType).map(([k, v]) => [v, k])
) as Record<TokenType, string>;

export function tokenTypeName(type: TokenType): string {
    return tokenTypeNames[type] ?? `Unknown(${type})`;
}

function isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isTagNameChar(ch: string): boolean {
    const c = ch.charCodeAt(0);
    return (c >= 97 && c <= 122)   // a-z
        || (c >= 65 && c <= 90)    // A-Z
        || (c >= 48 && c <= 57)    // 0-9
        || c === 45                // -
        || c === 95;               // _
}

function isAttrNameChar(ch: string): boolean {
    return isTagNameChar(ch) || ch === ':' || ch === '@' || ch === '.';
}

export function tokenize(source: string, filename?: string): Token[] {
    const tokens: Token[] = [];
    let state: State = State.Text;
    let pos = 0;
    let line = 1;
    let column = 0;

    let buffer = '';
    let bufferLine = 1;
    let bufferColumn = 0;

    let braceDepth = 0;

    function ch(offset = 0): string {
        return source[pos + offset] ?? '';
    }

    function advance(): string {
        const c = source[pos++];
        if (c === '\n') {
            line++;
            column = 0;
        } else {
            column++;
        }
        return c;
    }

    function emit(type: TokenType, value: string, l: number, c: number) {
        tokens.push({ type, value, line: l, column: c });
    }

    function flushBuffer(type: TokenType) {
        if (buffer.length > 0) {
            emit(type, buffer, bufferLine, bufferColumn);
            buffer = '';
        }
    }

    function startBuffer() {
        buffer = '';
        bufferLine = line;
        bufferColumn = column;
    }

    function error(msg: string): never {
        throw new DecaParseError(msg, filename, line, column);
    }

    function lookaheadMatch(str: string): boolean {
        for (let i = 0; i < str.length; i++) {
            if (source[pos + i] !== str[i]) return false;
        }
        return true;
    }

    function advanceN(n: number): string {
        let result = '';
        for (let i = 0; i < n; i++) result += advance();
        return result;
    }

    startBuffer();

    while (pos < source.length) {
        switch (state) {
            case State.Text: {
                if (ch() === '<') {
                    flushBuffer(TokenType.Text);

                    if (lookaheadMatch('<!--')) {
                        advanceN(4); // <!--
                        while (pos < source.length && !lookaheadMatch('-->')) {
                            advance();
                        }
                        if (pos >= source.length) error('Unclosed comment');
                        advanceN(3); // -->
                        startBuffer();
                    } else if (lookaheadMatch('</')) {
                        const afterSlash = source.slice(pos + 2, pos + 10).toLowerCase();
                        if (afterSlash.startsWith('script') || afterSlash.startsWith('style')) {
                            break;
                        }
                        const startLine = line;
                        const startCol = column;
                        advanceN(2);
                        emit(TokenType.EndTagOpen, '</', startLine, startCol);
                        state = State.EndTag;
                        startBuffer();
                    } else if (lookaheadMatch('<script')) {
                        const charAfterScript = source[pos + 7];
                        if (charAfterScript === '>' || charAfterScript === ' ' || charAfterScript === '\t'
                            || charAfterScript === '\n' || charAfterScript === '\r' || charAfterScript === undefined) {
                            const startLine = line;
                            const startCol = column;
                            state = State.ScriptOpen;
                            startBuffer();
                            bufferLine = startLine;
                            bufferColumn = startCol;
                        } else {
                            const startLine = line;
                            const startCol = column;
                            advance(); // <
                            emit(TokenType.TagOpen, '<', startLine, startCol);
                            state = State.Tag;
                            startBuffer();
                        }
                    } else if (lookaheadMatch('<style')) {
                        const charAfterStyle = source[pos + 6];
                        if (charAfterStyle === '>' || charAfterStyle === ' ' || charAfterStyle === '\t'
                            || charAfterStyle === '\n' || charAfterStyle === '\r' || charAfterStyle === undefined) {
                            const startLine = line;
                            const startCol = column;
                            state = State.StyleOpen;
                            startBuffer();
                            bufferLine = startLine;
                            bufferColumn = startCol;
                        } else {
                            const startLine = line;
                            const startCol = column;
                            advance(); // <
                            emit(TokenType.TagOpen, '<', startLine, startCol);
                            state = State.Tag;
                            startBuffer();
                        }
                    } else {
                        const startLine = line;
                        const startCol = column;
                        advance(); // <
                        emit(TokenType.TagOpen, '<', startLine, startCol);
                        state = State.Tag;
                        startBuffer();
                    }
                } else if (ch() === '{') {
                    flushBuffer(TokenType.Text);
                    const startLine = line;
                    const startCol = column;
                    advance();
                    emit(TokenType.ExpressionStart, '{', startLine, startCol);
                    state = State.Expression;
                    braceDepth = 0;
                    startBuffer();
                } else {
                    if (buffer.length === 0) startBuffer();
                    buffer += advance();
                }
                break;
            }

            case State.ScriptOpen: {
                while (pos < source.length && ch() !== '>') {
                    buffer += advance();
                }
                if (pos >= source.length) error('Unclosed <script> tag');
                buffer += advance(); // >
                emit(TokenType.ScriptStart, buffer, bufferLine, bufferColumn);
                state = State.ScriptBody;
                startBuffer();
                break;
            }

            case State.ScriptBody: {
                if (lookaheadMatch('</script>')) {
                    flushBuffer(TokenType.ScriptContent);
                    const startLine = line;
                    const startCol = column;
                    const tag = advanceN(9);
                    emit(TokenType.ScriptEnd, tag, startLine, startCol);
                    state = State.Text;
                    startBuffer();
                } else {
                    if (buffer.length === 0) startBuffer();
                    buffer += advance();
                }
                break;
            }

            case State.StyleOpen: {
                while (pos < source.length && ch() !== '>') {
                    buffer += advance();
                }
                if (pos >= source.length) error('Unclosed <style> tag');
                buffer += advance(); // >
                emit(TokenType.StyleStart, buffer, bufferLine, bufferColumn);
                state = State.StyleBody;
                startBuffer();
                break;
            }

            case State.StyleBody: {
                if (lookaheadMatch('</style>')) {
                    flushBuffer(TokenType.StyleContent);
                    const startLine = line;
                    const startCol = column;
                    const tag = advanceN(8);
                    emit(TokenType.StyleEnd, tag, startLine, startCol);
                    state = State.Text;
                    startBuffer();
                } else {
                    if (buffer.length === 0) startBuffer();
                    buffer += advance();
                }
                break;
            }

            case State.Tag: {
                if (isTagNameChar(ch())) {
                    buffer += advance();
                } else {
                    flushBuffer(TokenType.TagName);
                    state = State.TagAttrs;
                }
                break;
            }

            case State.EndTag: {
                if (isTagNameChar(ch())) {
                    buffer += advance();
                } else {
                    flushBuffer(TokenType.TagName);
                    while (pos < source.length && isWhitespace(ch())) advance();
                    if (ch() !== '>') error(`Expected '>' to close end tag`);
                    const startLine = line;
                    const startCol = column;
                    advance();
                    emit(TokenType.TagClose, '>', startLine, startCol);
                    state = State.Text;
                    startBuffer();
                }
                break;
            }

            case State.TagAttrs: {
                if (isWhitespace(ch())) {
                    advance();
                } else if (ch() === '>') {
                    const startLine = line;
                    const startCol = column;
                    advance();
                    emit(TokenType.TagClose, '>', startLine, startCol);
                    state = State.Text;
                    startBuffer();
                } else if (ch() === '/' && ch(1) === '>') {
                    const startLine = line;
                    const startCol = column;
                    advanceN(2);
                    emit(TokenType.TagSelfClose, '/>', startLine, startCol);
                    state = State.Text;
                    startBuffer();
                } else if (isAttrNameChar(ch())) {
                    state = State.AttrName;
                    startBuffer();
                } else {
                    error(`Unexpected character '${ch()}' in tag attributes`);
                }
                break;
            }

            case State.AttrName: {
                if (isAttrNameChar(ch())) {
                    buffer += advance();
                } else if (ch() === '=') {
                    flushBuffer(TokenType.AttributeName);
                    const startLine = line;
                    const startCol = column;
                    advance();
                    emit(TokenType.AttributeEquals, '=', startLine, startCol);
                    state = State.AttrValue;
                } else {
                    flushBuffer(TokenType.AttributeName);
                    state = State.TagAttrs;
                }
                break;
            }

            case State.AttrValue: {
                if (ch() === '"' || ch() === "'") {
                    const quote = ch();
                    const startLine = line;
                    const startCol = column;
                    advance();
                    let val = '';
                    while (pos < source.length && ch() !== quote) {
                        val += advance();
                    }
                    if (pos >= source.length) error(`Unclosed attribute value`);
                    advance();
                    emit(TokenType.AttributeValue, val, startLine, startCol);
                    state = State.TagAttrs;
                } else if (ch() === '{') {
                    const startLine = line;
                    const startCol = column;
                    advance();
                    emit(TokenType.ExpressionStart, '{', startLine, startCol);
                    state = State.AttrExpression;
                    braceDepth = 0;
                    startBuffer();
                } else {
                    error(`Expected quote or '{' for attribute value, got '${ch()}'`);
                }
                break;
            }

            case State.AttrExpression: {
                if (ch() === '{') {
                    braceDepth++;
                    buffer += advance();
                } else if (ch() === '}') {
                    if (braceDepth === 0) {
                        flushBuffer(TokenType.ExpressionContent);
                        const startLine = line;
                        const startCol = column;
                        advance();
                        emit(TokenType.ExpressionEnd, '}', startLine, startCol);
                        state = State.TagAttrs;
                    } else {
                        braceDepth--;
                        buffer += advance();
                    }
                } else {
                    if (buffer.length === 0) startBuffer();
                    buffer += advance();
                }
                break;
            }

            case State.Expression: {
                if (ch() === '{') {
                    braceDepth++;
                    buffer += advance();
                } else if (ch() === '}') {
                    if (braceDepth === 0) {
                        flushBuffer(TokenType.ExpressionContent);
                        const startLine = line;
                        const startCol = column;
                        advance();
                        emit(TokenType.ExpressionEnd, '}', startLine, startCol);
                        state = State.Text;
                        startBuffer();
                    } else {
                        braceDepth--;
                        buffer += advance();
                    }
                } else {
                    if (buffer.length === 0) startBuffer();
                    buffer += advance();
                }
                break;
            }
        }
    }

    if (state === State.ScriptBody) error('Unclosed <script> tag');
    if (state === State.StyleBody) error('Unclosed <style> tag');
    if (state === State.Expression || state === State.AttrExpression) error('Unclosed expression');
    if (state === State.Tag || state === State.TagAttrs || state === State.AttrName || state === State.AttrValue) {
        error('Unclosed tag');
    }

    flushBuffer(TokenType.Text);
    emit(TokenType.EOF, '', line, column);

    return tokens;
}
