import { loadEnv } from "@openokr/config";
import type { ShippedLocaleCode } from "@openokr/formats";
import { cookies } from "next/headers";
import {
  VISITOR_LANGUAGE_CHOSEN_COOKIE,
  VISITOR_LANGUAGE_COOKIE,
} from "./locale";

// One place for the attributes, so the sign-in picker and the in-app switcher
// cannot drift apart.
function attributes() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(loadEnv().BETTER_AUTH_URL).protocol === "https:",
  };
}

/** Remembers the language for the next sign-in page (one year). */
export async function setVisitorLanguageCookie(
  code: ShippedLocaleCode,
): Promise<void> {
  (await cookies()).set(VISITOR_LANGUAGE_COOKIE, code, {
    ...attributes(),
    maxAge: 365 * 24 * 60 * 60,
  });
}

export async function clearVisitorLanguageCookie(): Promise<void> {
  (await cookies()).delete(VISITOR_LANGUAGE_COOKIE);
}

/** Marks an explicit pick on the sign-in page. Session cookie, no maxAge. */
export async function setVisitorLanguageChosenCookie(): Promise<void> {
  (await cookies()).set(VISITOR_LANGUAGE_CHOSEN_COOKIE, "1", attributes());
}
