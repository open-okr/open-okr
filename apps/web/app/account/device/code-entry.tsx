"use client";

import {
  DEVICE_USER_CODE_GROUPS,
  formatDeviceUserCode,
} from "@openokr/formats";
import { Button, CodeInput, useTranslations } from "@openokr/ui";
import { useState } from "react";

/**
 * Typing the code a terminal printed, for somebody who cannot open its link
 * (docs/design/guided-inputs.md §4.5): the terminal is on another machine, or
 * its link did not survive being copied.
 *
 * **It does not submit itself.** The page that opens next says which terminal
 * is asking and what for, and nothing is granted until a button there is
 * pressed, so filling the last cell only enables Continue. The form is a plain
 * GET to this same page, with the code written the way it was issued.
 */
export function DeviceCodeEntry() {
  const { t } = useTranslations();
  const [code, setCode] = useState("");
  const total = DEVICE_USER_CODE_GROUPS.reduce((sum, size) => sum + size, 0);

  return (
    <form
      method="get"
      action="/account/device"
      className="flex flex-col items-start gap-3"
    >
      <CodeInput
        label={t("account.device.codeEntry.label")}
        groups={DEVICE_USER_CODE_GROUPS}
        characters="device"
        value={code}
        onChange={setCode}
      />
      <input type="hidden" name="code" value={formatDeviceUserCode(code)} />
      <Button
        type="submit"
        variant="primary"
        size="sm"
        disabled={code.length < total}
      >
        {t("account.device.codeEntry.continue")}
      </Button>
    </form>
  );
}
