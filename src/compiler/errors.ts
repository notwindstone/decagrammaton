export class DecaParseError extends Error {
    filename?: string;
    line?: number;
    column?: number;

    constructor(message: string, filename?: string, line?: number, column?: number) {
        const loc = [filename, line !== undefined ? `${line}:${column ?? 0}` : undefined]
            .filter(Boolean)
            .join(':');
        super(loc ? `${message} (${loc})` : message);
        this.name = 'DecaParseError';
        this.filename = filename;
        this.line = line;
        this.column = column;
    }
}
