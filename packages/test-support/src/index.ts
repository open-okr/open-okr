import { PACKAGE_NAME as CORE } from "@openokr/core";
import { PACKAGE_NAME as DB } from "@openokr/db";

export const PACKAGE_NAME = "@openokr/test-support";
export const DEPENDS_ON = [CORE, DB] as const;

export {
  applyAutoQuarantine,
  EMPTY_REPORT,
  type FlakyEntry,
  type FlakyReport,
  isQuarantined,
  mergeReports,
  type QuarantinedTest,
  type QuarantineList,
  shouldFailBuild,
  summariseReport,
  testId,
} from "./flaky";
export { FlakyReporter, type FlakyReporterOptions } from "./flaky-reporter";
export {
  cellBoolean,
  cellJson,
  cellList,
  cellNumber,
  type GoldenRow,
  type GoldenTable,
  loadGoldenTable,
  loadGoldenTables,
  parseGoldenTables,
} from "./golden-table";
