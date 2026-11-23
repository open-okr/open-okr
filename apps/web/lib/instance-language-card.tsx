import { isShippedLocale, LOCALES } from "@openokr/formats";
import { Button, Card, CardBody, CardHeader, SelectInput } from "@openokr/ui";
import { getTranslations } from "./translations";

export async function InstanceLanguageCard({
  language,
  save,
}: {
  readonly language: string;
  readonly save: (form: FormData) => Promise<void>;
}) {
  const { t } = await getTranslations();
  const title = t("admin.general.instanceLanguage");
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </CardHeader>
      <CardBody>
        <form action={save} className="flex items-end gap-2">
          <SelectInput
            label={t("admin.general.instanceLanguageChoice")}
            hideLabel
            name="language"
            defaultValue={language}
          >
            {LOCALES.filter((entry) => entry.shipped).map((entry) => (
              <option key={entry.code} value={entry.code} lang={entry.code}>
                {t(entry.endonymKey)}
              </option>
            ))}
            {!isShippedLocale(language) ? (
              <option value={language} disabled>
                {t("admin.general.generalSettingsForm.unavailableLanguage", {
                  code: language,
                })}
              </option>
            ) : null}
          </SelectInput>
          <Button type="submit">{t("common.save")}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
