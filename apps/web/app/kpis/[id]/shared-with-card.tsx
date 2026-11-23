"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  EntityPicker,
  SelectInput,
  useTranslations,
} from "@openokr/ui";
import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { memberOption } from "../../../lib/entity-options.ts";
import { searchHumans } from "../../../lib/member-search.ts";
import { shareKpi, unshareKpi } from "../actions.ts";

interface KpiShareEntry {
  readonly memberId: string;
  readonly name: string;
  readonly kind: "human" | "guest" | "placeholder";
  readonly status: string;
  readonly level: "view" | "edit";
  readonly sharedAt: string;
  readonly roleLevel: number | null;
}

export interface SharedWithCardProps {
  readonly kpiId: string;
  readonly canFull: boolean;
  readonly owner?: {
    readonly memberId: string;
    readonly name: string;
    readonly kind?: string;
  } | null;
  readonly shares?: readonly KpiShareEntry[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly availableMembers?: readonly {
    readonly id: string;
    readonly name: string;
    readonly role?: string;
    readonly email?: string;
    readonly kind?: string;
    readonly avatarUrl?: string | null;
  }[];
}

export function SharedWithCard({
  kpiId,
  canFull,
  owner = null,
  shares = [],
  loading = false,
  error = null,
  onRetry,
  availableMembers = [],
}: SharedWithCardProps) {
  const { t } = useTranslations();
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [shareLevel, setShareLevel] = useState<"view" | "edit">("view");
  const [pending, startTransition] = useTransition();
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) {
    return (
      <Card data-testid="shared-with-skeleton">
        <CardHeader>
          <div className="h-4 w-32 animate-pulse rounded bg-line" />
        </CardHeader>
        <CardBody className="flex flex-col gap-2.5">
          <div className="h-4 w-48 animate-pulse rounded bg-line" />
          <div className="h-4 w-64 animate-pulse rounded bg-line" />
        </CardBody>
      </Card>
    );
  }

  if (error) {
    return (
      <Card role="alert">
        <CardBody className="flex flex-col items-start gap-2.5">
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-bad" aria-hidden="true" />
            <h2 className="text-sm font-bold text-ink">
              {t("kpis.shares.title")}
            </h2>
          </span>
          <p className="text-sm text-ink-3">{error}</p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (onRetry) {
                onRetry();
              } else {
                router.refresh();
              }
            }}
          >
            {t("common.retry")}
          </Button>
        </CardBody>
      </Card>
    );
  }

  const handleShare = () => {
    if (!selectedMemberId) return;
    setActionError(null);
    startTransition(async () => {
      const res = await shareKpi(kpiId, selectedMemberId, shareLevel);
      if (res.error) {
        setActionError(res.error);
      } else {
        setPanelOpen(false);
        setSelectedMemberId(null);
        setShareLevel("view");
        router.refresh();
      }
    });
  };

  const handleLevelChange = (memberId: string, nextLevel: "view" | "edit") => {
    setActionError(null);
    startTransition(async () => {
      const res = await shareKpi(kpiId, memberId, nextLevel);
      if (res.error) {
        setActionError(res.error);
      } else {
        router.refresh();
      }
    });
  };

  const handleUnshare = (memberId: string) => {
    setActionError(null);
    startTransition(async () => {
      const res = await unshareKpi(kpiId, memberId);
      if (res.error) {
        setActionError(res.error);
      } else {
        setConfirmRemoveId(null);
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 className="text-sm font-bold text-ink">{t("kpis.shares.title")}</h2>
        {canFull ? (
          <Button
            type="button"
            size="sm"
            data-testid="open-share-panel"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {t("kpis.shares.share")}
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {actionError ? (
          <p className="text-xs text-bad" role="alert">
            {actionError}
          </p>
        ) : null}

        {/* Share form / side panel */}
        {canFull && panelOpen ? (
          <div
            data-testid="share-panel"
            className="flex flex-col gap-2.5 rounded-md border border-line bg-surface p-3"
          >
            <h3 className="text-xs font-bold text-ink">
              {t("kpis.shares.shareWith")}
            </h3>
            <div className="flex flex-wrap items-center gap-2.5">
              <EntityPicker
                id="share-member-picker"
                label={t("kpis.shares.member")}
                value={selectedMemberId}
                options={availableMembers.map((m) =>
                  memberOption(m, t("common.agent")),
                )}
                search={searchHumans}
                onValueChange={(val) => setSelectedMemberId(val)}
                className="w-56"
                inputClassName="text-xs"
              />
              <SelectInput
                id="share-level-input"
                data-testid="share-level-input"
                label={t("kpis.shares.level")}
                value={shareLevel}
                onChange={(e) =>
                  setShareLevel(e.target.value as "view" | "edit")
                }
                className="flex-row items-center gap-2"
                inputClassName="h-6.5 w-auto text-xs text-ink-2"
              >
                <option value="view">{t("kpis.shares.levelView")}</option>
                <option value="edit">{t("kpis.shares.levelEdit")}</option>
              </SelectInput>
              <Button
                type="button"
                size="sm"
                variant="primary"
                pending={pending}
                disabled={pending || !selectedMemberId}
                onClick={handleShare}
              >
                {t("kpis.shares.saveShare")}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Owner line */}
        {owner ? (
          <div
            data-testid="kpi-owner-line"
            className="flex items-center justify-between py-1 text-xs"
          >
            <span className="font-medium text-ink">{owner.name}</span>
            <Chip tone="neutral">{t("kpis.rule.owner")}</Chip>
          </div>
        ) : null}

        {/* Shares list */}
        {shares.length === 0 ? (
          <p className="text-sm text-ink-3">{t("kpis.shares.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {shares.map((share) => {
              const coversEdit =
                share.level === "edit" &&
                share.roleLevel !== null &&
                share.roleLevel >= 70;
              const isConfirming = confirmRemoveId === share.memberId;

              return (
                <li
                  key={share.memberId}
                  data-testid={`share-row-${share.memberId}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium text-ink">
                      {share.name}
                    </span>
                    {coversEdit ? (
                      <span className="text-[11px] text-ink-3">
                        {t("kpis.shares.alreadyHasEditThroughRole")}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    {canFull ? (
                      <>
                        <SelectInput
                          id={`level-select-${share.memberId}`}
                          data-testid="share-level-select"
                          label={t("kpis.shares.level")}
                          hideLabel
                          value={share.level}
                          disabled={pending}
                          onChange={(e) =>
                            handleLevelChange(
                              share.memberId,
                              e.target.value as "view" | "edit",
                            )
                          }
                          className="flex-row items-center"
                          inputClassName="h-6.5 w-auto text-xs text-ink-2"
                        >
                          <option value="view">
                            {t("kpis.shares.levelView")}
                          </option>
                          <option value="edit">
                            {t("kpis.shares.levelEdit")}
                          </option>
                        </SelectInput>

                        {isConfirming ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-ink-3">
                              {t("kpis.shares.removeConfirm", {
                                name: share.name,
                              })}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              className="text-bad"
                              pending={pending}
                              onClick={() => handleUnshare(share.memberId)}
                            >
                              {t("common.confirm")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={pending}
                              onClick={() => setConfirmRemoveId(null)}
                            >
                              {t("common.cancel")}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            data-testid="remove-share"
                            disabled={pending}
                            onClick={() => setConfirmRemoveId(share.memberId)}
                          >
                            {t("kpis.shares.remove")}
                          </Button>
                        )}
                      </>
                    ) : (
                      <Chip tone="neutral">
                        {share.level === "edit"
                          ? t("kpis.shares.levelEdit")
                          : t("kpis.shares.levelView")}
                      </Chip>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
