import { PACKAGE_NAME as ADAPTERS } from "@openokr/adapters";
import { PACKAGE_NAME as CORE } from "@openokr/core";
import { PACKAGE_NAME as METHOD } from "@openokr/method";

export const PACKAGE_NAME = "@openokr/agents";
export const DEPENDS_ON = [ADAPTERS, CORE, METHOD] as const;

export {
  type ExtractStructuredInput,
  extractStructured,
  StructuredExtractionError,
} from "./structured-extraction.ts";
