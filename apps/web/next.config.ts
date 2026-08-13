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
  /**
   * Hostnames other than `localhost` that may request dev-only assets.
   *
   * Next blocks cross-origin requests to `/_next/*` in development by default,
   * which is right: without it any page you visit could pull this dev server's
   * internals. The cost is that developing on any other hostname fails in a way
   * that looks like a styling bug rather than a security control. Every asset
   * returns 403, so the page renders as raw unstyled HTML, and the reason is a
   * warning in the terminal nobody is reading.
   *
   * Two ordinary setups need this. A local domain through a reverse proxy, and
   * a phone on the same network hitting the LAN address, which is the only way
   * to check the mobile tab bar on a real device.
   *
   * Comma-separated, from the environment rather than hardcoded, because the
   * hostname is one developer's choice and not a property of the project. It has
   * no effect on a production build.
   */
  allowedDevOrigins: (process.env.OPENOKR_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== ""),
};

export default nextConfig;
