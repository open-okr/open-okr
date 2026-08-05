import { PACKAGE_NAME as ADAPTERS } from "@openokr/adapters";
import { PACKAGE_NAME as AGENTS } from "@openokr/agents";
import { PACKAGE_NAME as CORE } from "@openokr/core";
import { PACKAGE_NAME as METHOD } from "@openokr/method";
import { PACKAGE_NAME as UI } from "@openokr/ui";

export const APP_NAME = "OpenOKR";

// Importing every direct workspace dependency proves the graph resolves at runtime.
export const WORKSPACE_PACKAGES = [ADAPTERS, AGENTS, CORE, METHOD, UI] as const;
