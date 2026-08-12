import { join } from "node:path";
import type { NextConfig } from "next";

// Workspace packages ship TypeScript source, so Next must transpile them.
const nextConfig: NextConfig = {
  // Emits a self-contained server with only the files it actually uses, so the
  // Docker image carries neither the monorepo nor its node_modules. Without
  // this the deployable image is several hundred megabytes of build tooling.
  output: "standalone",
  // The tracing root is the workspace root, not this app: standalone tracing
  // has to follow symlinks into ../../packages to collect the workspace
  // packages this app imports.
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  transpilePackages: [
    "@openokr/adapters",
    "@openokr/agents",
    "@openokr/config",
    "@openokr/core",
    "@openokr/db",
    "@openokr/method",
    "@openokr/ui",
  ],
  // Next's own dev-only overlay (route/bundler info, preferences), never
  // shipped to production. Off by explicit request: its own UI is not
  // OpenOKR's design system and is not this codebase's to fix.
  devIndicators: false,
};

export default nextConfig;
