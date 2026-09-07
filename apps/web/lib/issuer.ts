import { loadEnv } from "@openokr/config";
import { withoutTrailingSlashes } from "@openokr/core";

/**
 * The instance this server is (P5-T08a, P5-T08b).
 *
 * One function rather than a constant, because the environment is read at call
 * time everywhere else in this application and a module-level read would be a
 * value captured before configuration is loaded.
 *
 * The trailing slash is stripped once, here, so nothing downstream has to think
 * about whether `https://okr.example` and `https://okr.example/` are the same
 * resource. Every grant is bound to this string and every token is compared
 * against it, so one spelling is the whole point.
 */
export function instanceIssuer(): string {
  return withoutTrailingSlashes(loadEnv().BETTER_AUTH_URL);
}
