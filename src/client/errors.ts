export class HerdrError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number,
    stderr: string,
  ) {
    super(`herdr ${args.join(" ")} failed (${exitCode}): ${stderr}`);
    this.name = "HerdrError";
  }
}

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitError";
  }
}
