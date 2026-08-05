import { getAuth } from "../../../../lib/auth";

/**
 * Every authentication endpoint: sign up, sign in, sign out, password reset,
 * the second-factor challenge and the passkey ceremonies. Better Auth owns
 * the routing beneath this catch-all.
 *
 * The instance is resolved per request rather than at module load, so
 * importing this route does not open a database connection.
 */
export const GET = (request: Request) => getAuth().handler(request);
export const POST = (request: Request) => getAuth().handler(request);
