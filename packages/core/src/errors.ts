/** Bad input from a user or client. Safe to show the message as-is. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
