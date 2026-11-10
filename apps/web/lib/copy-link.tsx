"use client";

import { CopyButton, useTranslations } from "@openokr/ui";
import { Link2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * "Copy link" on a page of one of the seven addressable aggregates
 * (docs/design/short-ids.md S6).
 *
 * The page hands over a path; the address is this tab's own origin in front
 * of it, read once mounted, so a link copied from an instance reached by
 * another name (a tunnel, a private address) opens where the person copied it.
 * Until then the path alone, which is what a click before hydration would get
 * and is still an address on the same instance.
 */
export function CopyLink({ path }: { readonly path: string }) {
  const { t } = useTranslations();
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  return (
    <CopyButton
      text={`${origin}${path}`}
      variant="ghost"
      size="sm"
      title={t("copy.linkTitle")}
      data-testid="copy-link"
      data-path={path}
    >
      <Link2 aria-hidden="true" className="size-3.5" />
      {t("copy.link")}
    </CopyButton>
  );
}
