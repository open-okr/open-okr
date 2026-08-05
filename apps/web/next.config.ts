import type { NextConfig } from "next";

// Workspace packages ship TypeScript source, so Next must transpile them.
const nextConfig: NextConfig = {
  transpilePackages: [
    "@openokr/adapters",
    "@openokr/agents",
    "@openokr/config",
    "@openokr/core",
    "@openokr/db",
    "@openokr/method",
    "@openokr/ui",
  ],
};

export default nextConfig;
