import packageJson from "../package.json" with { type: "json" };

/**
 * The version this build is (docs/design/version-footer.md). The release pull
 * request bumps `apps/web/package.json`, and `check:docs` already pins the
 * pages that name a release to it, so this is the one number to read.
 */
export const RUNNING_VERSION: string = packageJson.version;

/**
 * METHOD.md as this release shipped it, for a screen that sends a reader to
 * the whole method. The tag rather than `main`, because `main` may already
 * describe practice this instance does not run. A link, not a fetch: an
 * air-gapped instance shows it and its reader cannot follow it, and nothing
 * leaves the server either way.
 */
export function methodDocumentUrl(section?: string): string {
  const anchor = section ? `#${section}` : "";
  return `https://github.com/open-okr/open-okr/blob/v${RUNNING_VERSION}/docs/specification/METHOD.md${anchor}`;
}
