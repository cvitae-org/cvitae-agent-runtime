/** Expected domain/storage failures retain their code across step execution. */
export class OperationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'OperationError';
  }
}
