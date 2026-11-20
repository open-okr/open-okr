"use server";

import { ACCESS_LEVELS, isCloudEnabled, writeSettings } from "@openokr/core";
import { isShippedLocale } from "@openokr/formats";
import { revalidatePath } from "next/cache";
import { requireAccessLevel } from "./access";
import { requireOperator } from "./operator";
import { getPool } from "./pool";
import { getKeyRing } from "./secrets";

async function save(
  form: FormData,
  actor: { userId: string; workspaceId?: string },
  source: "admin" | "operator",
): Promise<void> {
  const language = form.get("language");
  if (!isShippedLocale(language)) {
    return;
  }
  await writeSettings(
    getPool(),
    getKeyRing(),
    [{ key: "instance.language", value: language, source }],
    {
      action: "instance.language_set",
      payload: { ...actor, language, source },
    },
  );
  revalidatePath("/", "layout");
}

export async function saveSelfHostedLanguage(form: FormData): Promise<void> {
  const { userId, workspaceId } = await requireAccessLevel(ACCESS_LEVELS.full);
  if (await isCloudEnabled(getPool())) {
    return;
  }
  await save(form, { userId, workspaceId }, "admin");
}

export async function saveOperatorLanguage(form: FormData): Promise<void> {
  const { userId } = await requireOperator();
  await save(form, { userId }, "operator");
}
