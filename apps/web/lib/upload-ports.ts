/**
 * The process-wide image processor and virus scanner (completeness review
 * M-24).
 *
 * **The image processor is always there.** sharp ships in the image with its
 * platform's libvips, so re-encoding needs no service and no setting: every
 * uploaded image is decoded and written again before it is stored.
 *
 * **The scanner is there only when somebody names one.** `scan.clamd.host` is
 * empty by default, and empty means no scan. It is resolved when a scan is
 * delivered rather than once at boot, because it is a stored setting that can
 * change while the process runs, and building a driver is one object: clamd
 * is reached over a fresh connection per file either way.
 *
 * Cached on `globalThis` for the reason `getStorage()` is: Next.js reloads
 * modules in development and would otherwise build one per reload.
 */
import {
  ClamdScanner,
  type ImageProcessor,
  SharpImageProcessor,
} from "@openokr/adapters";
import {
  readSettingsFrom,
  resolveClamdSettings,
  type ScanFile,
} from "@openokr/core";
import { getPool } from "./pool";

const globals = globalThis as typeof globalThis & {
  openokrImages?: ImageProcessor;
};

export function getImageProcessor(): ImageProcessor {
  globals.openokrImages ??= new SharpImageProcessor();
  return globals.openokrImages;
}

/** The configured scanner as a function, or null when there is none. */
export async function getFileScanner(): Promise<ScanFile | null> {
  const settings = await resolveClamdSettings(readSettingsFrom(getPool()));
  if (!settings) {
    return null;
  }
  const scanner = new ClamdScanner(settings);
  return (body) => scanner.scan(body);
}
