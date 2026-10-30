export class ApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyError";
  }
}
