// Build-time compiler error. Thrown during transform/codegen so an unknown tag,
// event, or unsupported expression fails the build loudly rather than silently
// emitting broken or unsafe output.
export class DecaCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecaCompileError";
  }
}
