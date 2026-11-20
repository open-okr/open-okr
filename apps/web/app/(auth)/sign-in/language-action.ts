"use server";

import { loadEnv } from "@openokr/config";
import { isShippedLocale } from "@openokr/formats";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { VISITOR_LANGUAGE_COOKIE } from "../../../lib/locale";

export async function setVisitorLanguage(form: FormData): Promise<void> {
  const choice = form.get("language");
  if (!isShippedLocale(choice)) {
    return;
  }
  (await cookies()).set(VISITOR_LANGUAGE_COOKIE, choice, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 365 * 24 * 60 * 60,
    secure: new URL(loadEnv().BETTER_AUTH_URL).protocol === "https:",
  });
  revalidatePath("/", "layout");
}
