"use server";

import { isShippedLocale } from "@openokr/formats";
import { revalidatePath } from "next/cache";
import {
  setVisitorLanguageChosenCookie,
  setVisitorLanguageCookie,
} from "../../../lib/visitor-language-cookie";

export async function setVisitorLanguage(form: FormData): Promise<void> {
  const choice = form.get("language");
  if (!isShippedLocale(choice)) {
    return;
  }
  await setVisitorLanguageCookie(choice);
  // Tells the next successful sign-in that this was a deliberate pick, so it
  // can become the member's language.
  await setVisitorLanguageChosenCookie();
  revalidatePath("/", "layout");
}
