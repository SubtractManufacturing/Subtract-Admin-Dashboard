export class CustomerMergeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CustomerMergeError";
  }
}
