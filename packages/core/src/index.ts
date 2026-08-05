import { PACKAGE_NAME as DB } from "@openokr/db";
import { PACKAGE_NAME as METHOD } from "@openokr/method";

export const PACKAGE_NAME = "@openokr/core";
export const DEPENDS_ON = [DB, METHOD] as const;

export { type Auth, type AuthOptions, createAuth } from "./auth/auth.ts";
export { type CurrentSession, getCurrentSession } from "./auth/session.ts";
export {
  hashSessionToken,
  withHashedSessionTokens,
} from "./auth/session-hashing.ts";
