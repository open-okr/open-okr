import { PACKAGE_NAME as ADAPTERS } from "@openokr/adapters";
import { PACKAGE_NAME as CORE } from "@openokr/core";
import { PACKAGE_NAME as DB } from "@openokr/db";
import { PACKAGE_NAME as METHOD } from "@openokr/method";

export const PACKAGE_NAME = "@openokr/agents";
export const DEPENDS_ON = [ADAPTERS, CORE, DB, METHOD] as const;

export {
  type ProcessNextTaskInput,
  type ProcessNextTaskResult,
  processNextTask,
  readRunState,
} from "./run-executor.ts";
export {
  CHAMPION_CYCLE_CRON,
  CHAMPION_CYCLE_JOB,
  CHAMPION_DAILY_CRON,
  CHAMPION_DAILY_JOB,
  CHAMPION_HOURLY_CRON,
  CHAMPION_HOURLY_JOB,
  CHAMPION_WEEKLY_CRON,
  CHAMPION_WEEKLY_JOB,
  registerAgentSchedules,
} from "./schedule.ts";
export {
  type ExtractStructuredInput,
  extractStructured,
  StructuredExtractionError,
} from "./structured-extraction.ts";
