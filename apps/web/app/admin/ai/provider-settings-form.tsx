"use client";

import {
  RefusedFields,
  SettingsSaveBar,
  UrlInput,
  useTranslations,
} from "@openokr/ui";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveProvider } from "./actions.ts";
import { NOTHING_YET } from "./form-state.ts";

/**
 * One provider's settings (use, members' own keys, base URL) with the card's
 * footer save bar (docs/design/settings-page-layout.md). Returns the body and
 * the footer as siblings, so the caller puts both inside the card.
 *
 * The key above it is not part of this form: storing, testing and removing a
 * key each apply at once and have their own buttons.
 */
export function ProviderSettingsForm({
  kind,
  enabled,
  allowUserKeys,
  baseUrl,
}: {
  readonly kind: string;
  readonly enabled: boolean;
  readonly allowUserKeys: boolean;
  readonly baseUrl: string;
}) {
  const { t } = useTranslations();
  const formId = `ai-provider-settings-${kind}`;
  const formRef = useRef<HTMLFormElement>(null);
  const saved = useRef({ enabled, allowUserKeys, baseUrl });
  const [state, formAction, pending] = useActionState(
    saveProvider,
    NOTHING_YET,
  );
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);

  const read = () => {
    const element = formRef.current;
    if (!element) {
      return;
    }
    const data = new FormData(element);
    const changed: string[] = [];
    if ((data.get("enabled") !== null) !== saved.current.enabled) {
      changed.push(t("admin.ai.useThisProvider"));
    }
    if ((data.get("allowUserKeys") !== null) !== saved.current.allowUserKeys) {
      changed.push(t("admin.ai.membersOwnKeys"));
    }
    if (String(data.get("baseUrl") ?? "").trim() !== saved.current.baseUrl) {
      changed.push(t("admin.ai.baseUrl"));
    }
    setUnsaved(changed);
  };

  // A save the server accepted is the new baseline, so the bar goes quiet.
  useEffect(() => {
    if (state !== NOTHING_YET && state.ok) {
      const element = formRef.current;
      if (element) {
        const data = new FormData(element);
        saved.current = {
          enabled: data.get("enabled") !== null,
          allowUserKeys: data.get("allowUserKeys") !== null,
          baseUrl: String(data.get("baseUrl") ?? "").trim(),
        };
      }
      setUnsaved([]);
    }
  }, [state]);

  return (
    <>
      <form
        ref={formRef}
        id={formId}
        action={formAction}
        onInput={read}
        onChange={read}
        onReset={() => setUnsaved([])}
        aria-busy={pending}
        className="grid grid-cols-12 gap-x-6 gap-y-4 p-3.5"
      >
        <input type="hidden" name="provider" value={kind} />
        <p className="col-span-12 text-xs font-semibold text-ink-3">
          {t("admin.ai.settingsHeading")}
        </p>
        {/* Each field shows what the server refused about it (U1b). */}
        <RefusedFields fields={state.fields}>
          <label className="col-span-12 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={enabled}
              className="size-4"
            />
            {t("admin.ai.useThisProvider")}
          </label>
          <div className="col-span-12 flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="allowUserKeys"
                defaultChecked={allowUserKeys}
                className="size-4"
              />
              {t("admin.ai.letMembersSupplyTheir")}
            </label>
            {/* Where the other half of this switch lives, since it is on the
                member's own account rather than here (M-36). */}
            <p className="pl-6 text-xs text-ink-3">
              {t("admin.ai.membersStoreTheirs")}
            </p>
          </div>
          {/* A whole http or https address, the server's rule: a local Ollama
              is plain http (guided-inputs §4.11). */}
          <UrlInput
            className="col-span-12"
            id={`${kind}-baseUrl`}
            label={t("admin.ai.baseUrlForA")}
            name="baseUrl"
            defaultValue={baseUrl}
            placeholder={t("admin.ai.leaveEmptyForThe")}
          />
        </RefusedFields>
      </form>
      <SettingsSaveBar
        mode="footer"
        formId={formId}
        unsaved={unsaved}
        saved={state.ok && state.message ? state.message : null}
        error={state.ok ? null : state.message || null}
        pending={pending}
      />
    </>
  );
}
