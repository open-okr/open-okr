/** Thrown when the environment is invalid. Carries the offending variable names
 * so a caller can act on them without parsing the message.
 *
 * In a module of its own so `env.ts` and `caller-address.ts` can both throw it
 * without importing each other. */
export class EnvironmentError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[], message: string) {
    super(message);
    this.name = "EnvironmentError";
    this.variables = variables;
  }
}
