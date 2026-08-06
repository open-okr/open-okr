# OpenOKR, single image (P1-T09).
#
# Multi-stage, because what builds the application and what runs it have almost
# nothing in common. The runtime stage carries a Next.js standalone server, the
# migration sources and a Node runtime. It does not carry pnpm, the monorepo,
# the test suites or a compiler.
#
# Built from the repository root, not this directory:
#     docker build -f deploy/docker/Dockerfile .

# A digest would pin this exactly, but it also has to be updated by hand every
# security release. The lifecycle helper's upgrade path re-pulls, and the image
# is rebuilt on every tag, so the tag is the right granularity here.
FROM node:22-alpine AS base
# libc6-compat: some native modules expect glibc symbols that Alpine's musl
# does not provide by default.
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ---------------------------------------------------------------------------
# Dependencies. Its own stage so a change to application source does not
# re-resolve the dependency graph.
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/web/package.json apps/web/
COPY packages/adapters/package.json packages/adapters/
COPY packages/agents/package.json packages/agents/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/importer/package.json packages/importer/
COPY packages/method/package.json packages/method/
COPY packages/test-support/package.json packages/test-support/
COPY packages/ui/package.json packages/ui/

# --frozen-lockfile fails rather than resolving something new: an image whose
# dependency graph differs from the committed lockfile is not the thing that
# was tested.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Build.
# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages ./packages
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# A build must not depend on a reachable database. This value is parsed by the
# environment schema and never connected to; the real one arrives at runtime.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
RUN pnpm --filter @openokr/web build

# ---------------------------------------------------------------------------
# Runtime.
# ---------------------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Never root. The uid is fixed so a bind-mounted volume has predictable
# ownership across hosts.
RUN addgroup --system --gid 1001 openokr \
  && adduser --system --uid 1001 --ingroup openokr openokr

# The standalone server, plus the two asset trees Next does not trace into it.
COPY --from=build --chown=openokr:openokr /repo/apps/web/.next/standalone ./
COPY --from=build --chown=openokr:openokr /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=openokr:openokr /repo/apps/web/public ./apps/web/public

# Migrations run from the image at boot, so the SQL and the runner ship with
# it. This is what makes an upgrade one `docker compose pull` and restart.
#
# No dependency install of its own: Next traces `pg` into the standalone
# output, because the application uses it, and the migration runner needs
# nothing else. A separate production install for this was 400MB of the
# workspace's packages to run a few hundred lines of SQL.
COPY --from=build --chown=openokr:openokr /repo/packages/db/migrations ./migrator/packages/db/migrations
COPY --from=build --chown=openokr:openokr /repo/packages/db/src ./migrator/packages/db/src

COPY --chown=openokr:openokr deploy/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# Kept at its repository path inside the image, so the relative imports in it
# resolve to the same files here and in a checkout. A path that is only correct
# in one of the two is a file nothing can typecheck or lint.
COPY --chown=openokr:openokr deploy/docker/migrate.ts ./migrator/deploy/docker/migrate.ts
RUN chmod +x /usr/local/bin/entrypoint.sh

# Storage for the local-disk driver. A volume mounts over this in compose;
# creating it here means the image also runs without one.
RUN mkdir -p /app/storage && chown openokr:openokr /app/storage
ENV OPENOKR_STORAGE_DIR=/app/storage

USER openokr
EXPOSE 3000

# Hits the readiness endpoint rather than the port. A process that is listening
# but cannot reach Postgres is not healthy, and compose should know that before
# it puts the proxy in front of it.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/web/server.js"]
