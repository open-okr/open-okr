import { PACKAGE_NAME as CORE } from "@openokr/core";
import { PACKAGE_NAME as DB } from "@openokr/db";

export const PACKAGE_NAME = "@openokr/importer";
export const DEPENDS_ON = [CORE, DB] as const;
