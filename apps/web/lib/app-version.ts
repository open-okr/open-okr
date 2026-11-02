import packageJson from "../package.json" with { type: "json" };

/**
 * The version this build is (docs/design/version-footer.md). The release pull
 * request bumps `apps/web/package.json`, and `check:docs` already pins the
 * pages that name a release to it, so this is the one number to read.
 */
export const RUNNING_VERSION: string = packageJson.version;
