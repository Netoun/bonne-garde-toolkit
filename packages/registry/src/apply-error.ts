export class ApplyError extends Error {
  /**
   * The modules `--force` did not reach, because the call plans them again without naming them, and
   * whose files are in the way: naming them in the same call is what resolves it.
   */
  readonly nameToForce: string[];

  constructor(message: string, nameToForce: string[] = []) {
    super(message);
    this.name = "ApplyError";
    this.nameToForce = nameToForce;
  }
}
