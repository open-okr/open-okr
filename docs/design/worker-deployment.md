# Worker deployment: web and background work apart, draining, and data changes on upgrade

Status: proposed 11 November 2026 for release 0.8.0 (plan H10, section 3.3). **Approved by Akmal on 11 November 2026, Q1 to Q7 as recommended**, including the change to PLAN §5.1 that Q1 and Q7 make. It changes the deployment shape, so it is designed first. The row says "split into rows when designed": section 7 is that split.

Today one Deployment serves pages and also runs the outbox relay and the scheduler in every pod. Nothing pauses before a pod stops, nothing waits for background work to finish, and nothing in the chart runs the data changes. This design adds an opt-in worker Deployment for the relay and the scheduler, an opt-in autoscaler for the web pods, a pause and a real drain when any pod stops, and a hook that runs the data changes after each install and upgrade. An operator who changes nothing keeps one Deployment.

## 0. What exists today

Next.js paths are in the installed 16.4.5 and pg-boss paths in 12.38.1, both under `node_modules/.pnpm/<package>/node_modules/<package>/dist`.

| Piece | Where | Today |
|---|---|---|
| The web Deployment | `deploy/helm/templates/deployment.yaml` | One Deployment, `replicas: {{ .Values.replicaCount }}` (default 1), rolling update with `maxUnavailable: 0`, `maxSurge: 1`. No `lifecycle`, no `terminationGracePeriodSeconds` (so Kubernetes' 30 seconds), no autoscaler. Sets neither `OPENOKR_RELAY` nor `OPENOKR_SCHEDULER`, so every pod runs both |
| Labels | `_helpers.tpl` (`openokr.selectorLabels`), `service.yaml:15-16`, `pdb.yaml` | The Deployment, the Service and the PDB all select `app.kubernetes.io/name` plus `app.kubernetes.io/instance`. A Deployment's selector cannot be changed after install |
| The PDB | `pdb.yaml:1` | Rendered only when `replicaCount > 1` |
| Storage rule | `_validate.tpl:50-52` | Refuses more than one replica on a `ReadWriteOnce` volume unless a bucket is named. Several replicas with persistence off is allowed and warned about in `NOTES.txt` |
| The migration hook | `migration-job.yaml` | `pre-install,pre-upgrade`, weight -5, named per revision, `backoffLimit: 4`, kept on failure for its log |
| The process | `deploy/docker/Dockerfile` (`CMD ["node", "apps/web/server.js"]`), `entrypoint.sh` (`exec "$@"`) | Node is PID 1 and receives SIGTERM itself |
| Next's own signal handler | `next/dist/server/lib/start-server.js:306-380` | Registered unless `NEXT_MANUAL_SIG_HANDLE` is set. On SIGTERM it calls `server.close()`, which stops accepting connections at once and waits for every open one, then `nextServer.close()`, then `process.exit(143)`. Nothing else is awaited |
| The relay's stop | `apps/web/lib/relay.ts:525-531` | `process.once("SIGTERM", () => { void relay.stop(); })`. The promise is dropped |
| The relay | `packages/adapters/src/relay.ts` | Polls every second (`:216`), claims up to 50 rows (`:215`) with `FOR UPDATE SKIP LOCKED` (`:669`) under a lease of 120 seconds (`apps/web/lib/relay.ts:72`), dispatches them one after another. `stop()` waits for the whole batch in flight (`:530-537`) |
| The scheduler's stop | `apps/web/lib/scheduler.ts:914-921` | `process.once("SIGTERM", () => { void queue.stop(); })`. Dropped too |
| pg-boss stop | `pg-boss/dist/index.js:258-297`, `manager.js:1129-1159` | `stop()` defaults to graceful with a 30-second timeout, then fails every active job ("pg-boss shut down while active"). `PgBossJobQueue.stop()` passes no timeout (`packages/adapters/src/drivers/jobs/pg-boss.ts:51-59`) |
| pg-boss queue defaults | `pg-boss/dist/plans.js:85-94` | A job expires 15 minutes after it starts; a failed or expired job is retried twice. The queues are created with only `policy: "short"`, so these apply |
| pg-boss cron | `pg-boss/dist/timekeeper.js:46`, `:170-182` | One instance at a time runs the cron pass, every 30 seconds. An occurrence is due for 60 seconds; one that no instance saw in that window is skipped (the default `missed` policy) |
| Error and span flush | `apps/web/lib/error-reporting.ts:97-102` | Its own `process.once("SIGTERM")`, flushing for up to 2 seconds. The telemetry driver's `stop()` (`otel.ts:326`) is never called on a signal |
| Live streams | `apps/web/lib/keep-alive.ts` (H11) | Five live routes hold a stream open and speak every 25 seconds, so a stream stays open as long as a tab does |
| Realtime | `packages/adapters/src/drivers/realtime/postgres.ts:156-158` | Postgres `pg_notify`. A publish from any process reaches every process's listeners |
| The copilot | `apps/web/app/api/copilot/route.ts:25-31`, `:110` | With `OPENOKR_RELAY` on in the answering process, the run goes through the outbox and the reader can rejoin it. With it off, the answer is drafted inline, and closing the tab loses it |
| `/api/status` | `apps/web/app/api/status/route.ts:94-108`, `apps/web/lib/scheduler-health.ts:35-38` | The relay is judged by the outbox's oldest pending row, which is the same on every pod. The scheduler is judged by the shared stamp `scheduler.last_run_at` (H12), except that a pod with the scheduler off always answers `operational` |
| `/api/health`, Admin General | `apps/web/app/api/health/route.ts:27`, `apps/web/app/admin/general/page.tsx:148` | Both read this pod's own `schedulerState()` |
| Outbox gauges | `packages/adapters/src/relay.ts:304-318` | `openokr_outbox_pending` and `openokr_outbox_oldest_pending_seconds` are registered by the `OutboxRelay` constructor, so only a process running a relay serves them |
| The data-change runner | `packages/db/src/data-change.ts:186-310`, `packages/db/src/bin/data-change.ts` | Session advisory lock taken with the blocking `pg_advisory_lock` (`:207`), one transaction per batch, a ledger with a cursor, so a stop at any point loses at most the batch in flight. The command calls `loadEnv()` (`bin/data-change.ts:19`), which in production refuses to start without the real `BETTER_AUTH_SECRET` |
| Data changes on Compose | `deploy/docker/openokr` (`data-change`, `status`) | `./openokr data-change` runs the command in the app container. `./openokr upgrade` does not run it |
| Data changes on Helm | `deploy/helm/`, `docs/install/kubernetes.md`, `deploy/helm/README.md` | Nothing. No template, and no page says how. The only way is `pnpm db:change` from a checkout that can reach the database, or a `kubectl exec` nobody has written down |
| The policy | `docs/specification/PLAN.md` §5.1 | "Data changes run separately through the data-change runner, on the administrator's schedule, and `status` reports what is pending. An upgrade is never held open by a long backfill" |
| Compose | `deploy/docker/compose.yaml` | One `app` container, no `stop_grace_period`, so Docker's 10 seconds |
| The `--reuse-values` check | `deploy/helm/check.sh:603-685` | Nulls every key added since each earlier release and renders. It proves the chart renders, not that it renders the same thing |

### 0.1 What happens to work in flight when a pod stops today

Which column a pod meets is luck: any open tab holds a live stream, and H11's heartbeat keeps it open.

| Work | No connection open | A live stream open |
|---|---|---|
| New requests | `server.close()` refuses them at once, while the load balancer may still be sending for a few seconds. Those requests fail (502 at the ingress or the ALB) | The same |
| The relay row being dispatched | Next exits within milliseconds. The row is left claimed, so it waits out the 120-second lease and is delivered again. If its side effect happened (an email sent), it happens twice | `relay.stop()` waits for the batch. If the batch ends inside 30 seconds, it is recorded. If not, SIGKILL at 30 seconds, as on the left |
| The up to 49 other rows of that batch | Each waits the full 120-second lease, and each has had an attempt counted for nothing | Delivered before the kill, or as on the left |
| A scheduled job (a Champion run, the Coach's nightly sweep) | Left `active` until it expires 15 minutes later, then retried from its first workspace | pg-boss waits up to its own 30 seconds, and the SIGKILL at 30 seconds races its step that hands the job back. Usually as on the left |
| Error reports held in memory | The flush starts and is cut | Flushed |
| Spans | Lost | Lost |
| The pod | Gone at once | Gone at 30 seconds, by SIGKILL |

### 0.2 Is running several at once safe?

| Process | Safe in several pods? | Why |
|---|---|---|
| Relay | Yes | A claim is `FOR UPDATE SKIP LOCKED` plus a lease, and P1-T04's concurrency test proves several relays deliver each row once. Past eight relays a late one gets a short batch (`CLAIM_CANDIDATE_BATCHES`, `relay.ts:244`). The cost is polling: each relay runs a ranking query every second |
| Scheduler | Yes | pg-boss lets one instance run the cron pass and hands each job to one worker. Runs take a per-workspace advisory lock for the audit chain. The cost is polling too: each process polls each of its 20 queues, up to every 2 seconds, and holds a pg-boss pool of up to 10 connections |
| Data-change runner | Yes, one runs | A session advisory lock: a second run waits, then finds nothing to do |

So today an instance with six web pods runs six relays and six schedulers, all polling. A worker of one or two pods does the same work for a third of the queries or less.

### 0.3 What the plan row understates

1. **The drain the comments promise does not happen.** `relay.ts:525` and `scheduler.ts:914` say a stop finishes the work in flight. Both drop the promise, and Next's handler exits without waiting for them (0.1).
2. **Every rollout can drop requests.** With no pause, a pod stops listening the moment it gets SIGTERM, while the endpoint change is still travelling to kube-proxy, the ingress controller or the AWS Load Balancer Controller.
3. **Turning the relay off on the serving pods degrades the copilot.** The route answers inline when its own process does not drain the outbox, so the documented way to move the relay elsewhere (`relay.ts:28`) loses background runs and rejoining. The route says so (`copilot/route.ts:25-31`).
4. **Other readers assume the work runs in the answering pod.** With the relay off, `/api/metrics` loses the two outbox gauges. With the scheduler off, `/api/status` says `operational` whatever happens (H12's build note: "H10 is where that changes"), `/api/health` says `off`, and Admin General can never show the scheduler notice.
5. **The worker needs the same storage as the web pods.** The relay builds exports (`relay.ts:145`), reads uploads to scan them (`:152`) and deletes an erased workspace's files (`:159`), and the scheduler reaps orphaned uploads (`scheduler.ts:692`). With per-pod storage, a scan finds no bytes and quarantines every upload, and an export lands where no web pod can serve it.
6. **A worker with the web pods' labels would receive web traffic.** The Service selects name and instance only. The web Deployment's selector cannot be narrowed on upgrade, so the worker has to differ in those two labels.
7. **A data-change Job needs the auth secret.** `data-change.ts` loads the whole server environment, so a Job given only `openokr.commonEnv` stops on "BETTER_AUTH_SECRET: is still the development placeholder", exactly as the erasure job did until O3.
8. **A hook that runs data changes changes PLAN §5.1**, which says they run "on the administrator's schedule" (Q1).
9. **The autoscaler's CPU target is a share of the request,** and the request is `100m`. A serving pod at idle sits near that, so a 70 percent target would scale out at once.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **One image, one entry point.** The worker runs the same `node apps/web/server.js` as the web pods, with the relay and the scheduler on. Its HTTP server answers only its probes and `/api/metrics`, because no Service routes to it | `relay.ts` and `scheduler.ts` already explain it: a second entry point would ship the AI, mail and socket drivers a second time or need a bundler |
| D2 | **A third value, `elsewhere`, for `OPENOKR_RELAY` and `OPENOKR_SCHEDULER`** (Q4). It means "not in this process; another process of this instance runs it". `off` keeps its meaning: not here, and perhaps nowhere. `on` stays the default | The copilot and the status endpoint must tell "runs on the worker" from "turned off on purpose" (0.3, items 3 and 4). A value the 0.7 image does not know is a boot error naming the variable, which is the right failure for a mismatched chart and image |
| D3 | **What `elsewhere` changes**, and nothing else: see 1.3 | Each reader in 0.3 item 4 has one answer |
| D4 | **The server owns SIGTERM** (Q3). The image sets `NEXT_MANUAL_SIG_HANDLE=true`, so Next registers no handler. A new `apps/web/lib/shutdown.ts` installs one handler for SIGTERM and SIGINT, first thing in `register()`, before any step that can fail. The relay, the scheduler, error reporting and telemetry each register a stop step with it instead of their own `process.once`. Without the variable (`pnpm dev`, `next start`) the coordinator runs the same steps and leaves the exit to Next, as today | Next's handler exits without awaiting anything (0.1), and it cannot be told to wait. A Node process that is PID 1 ignores SIGTERM unless something handles it, so the handler goes in before anything else |
| D5 | **What a stop does**: 1.1. The process exits with code 0 once the steps finish or `OPENOKR_SHUTDOWN_SECONDS` passes, whichever is first, and writes one line naming what it waited for and anything it left | A bound the operator knows, so the grace period can be set from it |
| D6 | **The relay stops between rows, not between batches.** `stop()` lets the row in flight finish and releases the rest of the batch: `available_at = now()` and `attempts = attempts - 1`, so another relay takes them on its next poll and a deploy never counts toward dead-lettering | Waiting for 50 rows, any of them a copilot run, does not fit a budget of seconds; leaving them claimed costs each one two minutes |
| D7 | **pg-boss gets the budget less three seconds**, then hands every active job back as failed. Another scheduler retries it at once (two retries, the queue default). A Champion or Coach run retried this way starts again from its first workspace; nudges are deduplicated per subject per member per day, so the repeat sends nothing twice | A job that is cut by the exit instead sits `active` for 15 minutes |
| D8 | **`OPENOKR_SHUTDOWN_SECONDS`**, default 20, a whole number from 1 to 300, environment only. Declared in `packages/config/src/env.ts` and in TECHNICAL-PLAN §4.14's Instance row beside `OPENOKR_DB_POOL_MAX` | Long enough for a mail, a webhook or a short AI step; short enough that a rollout of six pods does not crawl. Anything longer is cut and retried, which is what a crash does today |
| D9 | **Chart: a pause before SIGTERM, and a grace period derived from it.** The web container gets `lifecycle.preStop.exec.command: ["sleep", "<shutdown.preStopSeconds>"]`, default 10. The pod gets `terminationGracePeriodSeconds` = pause + drain + 15, default 45. Not a separate value | The pause covers the time the endpoint change takes to reach whatever sends traffic. `exec` with `sleep` works on Kubernetes 1.27, the chart's floor, where the native `sleep` action may not. The grace period counts from deletion and includes the pause; 15 seconds covers the error flush (2 s), the span flush (5 s) and slack. Deriving it means the two cannot disagree |
| D10 | **The worker is opt-in**: `worker.enabled: false`. With it on, a second Deployment `<fullname>-worker` runs both on, and the web Deployment gets both `elsewhere` | The default is today's shape (1.4) |
| D11 | **The worker's pods carry `app.kubernetes.io/name: <name>-worker`** plus the instance label and `app.kubernetes.io/component: worker`. So the Service, the web Deployment, its PDB and the backup job's affinity never select them | The web Deployment's selector is immutable (0.3, item 6). Narrowing the Service instead would drop every old pod from it mid-upgrade |
| D12 | **One environment, two Deployments.** The web Deployment's environment moves into a helper, `openokr.serverEnv`, used by both. Only the two flags differ. The worker uses the same service account, so workload identity for S3 (H9) works, and mounts the same storage, CA bundle and temporary volumes | A variable added to one and forgotten in the other is the O3 failure again. `check.sh` diffs the two lists |
| D13 | **The worker needs shared storage** (Q6): a bucket, or persistence with `ReadWriteMany`. Anything else is refused at render time with the same remedies the replica rule names | 0.3, item 5 |
| D14 | **The worker's replica count defaults to 1** (Q5), with its own PDB (`minAvailable: 1`) only above 1. No pause, because nothing routes to it; its grace period is drain + 15 | Several are safe (0.2). One is enough for the work. During a node drain one worker leaves a gap, and a cron occurrence inside a gap longer than a minute is skipped |
| D15 | **The worker refuses a conflicting `extraEnv`.** With `worker.enabled`, an `extraEnv` naming `OPENOKR_RELAY` or `OPENOKR_SCHEDULER` is refused at render time | `extraEnv` reaches both Deployments, so an old `OPENOKR_SCHEDULER=off` would silently stop the worker's scheduler |
| D16 | **An optional autoscaler on the web Deployment only**: `autoscaling.enabled: false`. With it on, an `autoscaling/v2` HorizontalPodAutoscaler on CPU, optionally memory; the Deployment renders no `replicas`; the PDB renders when `minReplicas > 1`; the storage rule applies to `maxReplicas` | The worker's load does not follow traffic. A scale-down deletes a pod like any other, so it gets the pause and the drain |
| D17 | **A data-change hook** (Q1): a Job `<fullname>-data-change-<revision>`, `post-install,post-upgrade`, on by default, running `data-change.ts --max-seconds 240` with the migration hook's environment plus `BETTER_AUTH_SECRET` by reference | After the pods are up with `--wait`, or during the rollout without it. Both are safe: data changes are written to run while either release serves (PLAN §5.1, `data-change-conventions.md`) |
| D18 | **The runner gains a time budget** (Q2). With `--max-seconds`, it takes the lock with `pg_try_advisory_lock` (another run going means "nothing to do here", exit 0), stops after the batch that crosses the budget, prints which scripts are not complete as `--status` does, and exits 0. A script that throws still exits 1. Without the flag, today's behaviour, for `pnpm db:change` and `./openokr data-change` | Helm waits up to `--timeout` (5 minutes by default) for each hook. 240 seconds plus the pod's start fits inside it. A budget that ends the run cleanly between batches loses nothing, where Helm's timeout or `activeDeadlineSeconds` would cut a batch and fail the release |
| D19 | **Values reused from 0.7 render as a fresh install would.** Each new block is read as `.Values.<block> \| default dict` and its keys with `dig`, and each `dig` default equals the `values.yaml` default. Never `\| default` on a key that may be `0` or `false`, because `default` reads both as unset and would turn `dataChanges.enabled: false` back on | `--reuse-values`, which the upgrade rehearsal and the restore runbook use, carries none of the new keys |
| D20 | **The defaults keep one Deployment.** Worker off, autoscaler off, `replicas: 1`. What does change for everybody is the pause, the grace period, the drain and the data-change hook | 1.4 lists the exact difference |

### 1.1 A stop, step by step

With the defaults, for a web pod in the single-Deployment shape:

| Second | What happens |
|---|---|
| 0 | The pod is marked for deletion. Endpoints drop it. The `sleep 10` starts; the server keeps answering whatever still arrives |
| 10 | SIGTERM. The coordinator logs `stopping: draining for up to 20s`. In parallel: the relay finishes the row in flight and releases the rest (D6); pg-boss stops fetching and waits for active jobs (D7); the coordinator waits for the actions in flight to reach none (`currentConcurrentActions()`, `packages/core/src/tenancy/admission.ts:190`) |
| 10 to 30 | Each step ends as its work does. At 27, pg-boss hands back any job still active |
| at most 30 | Error reports flush (2 s at most) and spans flush (5 s at most). One line: `stopped after 4.2s: relay idle, 1 scheduled job handed back, 0 actions in flight`. Exit 0. Live streams close with the process and each browser's EventSource reconnects to another pod |
| 45 | SIGKILL, only if something above hung |

A worker pod has no pause: SIGTERM at second 0, the same steps, SIGKILL at 35.

### 1.2 What runs where

| Shape | Web pods | Worker pods | Who answers `/api/status` |
|---|---|---|---|
| Default, worker off | Relay `on`, scheduler `on` | None | Any web pod, judging the shared stamp or its own, as today |
| Worker on | Relay `elsewhere`, scheduler `elsewhere` | Relay `on`, scheduler `on` | Any web pod, judging the shared stamp (1.3) |
| Compose | One container, both `on` | None | That container |
| An operator's own `off` | As set | None | As today: `operational` for the scheduler |

### 1.3 What `elsewhere` changes

| Reader | `on` | `off` | `elsewhere` |
|---|---|---|---|
| `startRelay`, `startScheduler` | Start | Log `disabled by ...=off` | Log `runs elsewhere (...=elsewhere)`, start nothing |
| Copilot (`copilot/route.ts:110`) | Background run | Inline, as today | Background run. The worker's relay drafts it and publishes over `pg_notify`, which the web pod's stream is listening to |
| `/api/status`, scheduler | Today's rule | `operational`, as today | The shared stamp by age, against the same two thresholds. No stamp yet: grace from this process's start, as a scheduler's boot gives today. The stamp cannot be read: `unavailable`, which the database component already says |
| `/api/health` | `scheduler: running` and so on | `off` | `elsewhere`. Status code unchanged |
| Admin General notice | Shown when this pod's scheduler failed | Never | Shown when the shared judgement is `unavailable`, with its own sentence: no scheduler has completed a run for four hours, check the worker. New message keys in English and Malay |
| `/api/metrics` | Outbox gauges, from the relay | No outbox gauges, as today | Outbox gauges, registered without a relay, so a scrape of the Service still shows the queue |
| `/api/status`, relay | Unchanged everywhere: the oldest pending row is the same on every pod | | |

### 1.4 What an operator who changes nothing gets

Rendered with no values, the manifest differs from 0.7.0's in exactly these places:

| Added | Effect |
|---|---|
| `lifecycle.preStop` sleeping 10 seconds on the web container | A pod keeps answering for 10 seconds after it is told to stop |
| `terminationGracePeriodSeconds: 45` | A stuck pod is killed at 45 seconds rather than 30 |
| `OPENOKR_SHUTDOWN_SECONDS: "20"` | The drain's bound |
| The data-change hook Job | Data changes run after the install and after each upgrade, for up to four minutes |

Still one Deployment, `replicas: 1`, both flags unset (so `on`), no worker, no autoscaler.

### 1.5 The data-change hook, the migration hook and a rolling upgrade

| Step | `helm upgrade --wait` | Without `--wait` |
|---|---|---|
| 1 | Pre-upgrade: the migration hook. With C1's option A (`docs/design/short-ids.md`), it may run a data change a migration names, first | The same |
| 2 | The new manifest is applied; pods of both releases serve against the new schema while it rolls (PLAN §5.1) | The same |
| 3 | Helm waits for the new pods | Nothing waits |
| 4 | Post-upgrade: the data-change hook, with the new image | Starts at once, while the rollout is still going. Safe, because a data change must tolerate either release serving |
| 5 | The hook ends: every script complete, or the budget passed (exit 0, what is left is in its log), or a script failed (exit 1) | The same |

- **When the budget passes**, the hook exits 0 with the cursor saved. What is left runs at the next upgrade's hook, or now with `kubectl exec deploy/<fullname> -- node --experimental-strip-types --no-warnings /app/migrator/packages/db/src/bin/data-change.ts`, which the install guide gains. That is `./openokr data-change` on Kubernetes: the web pod already has the hook's database settings (`openokr.commonEnv`) and the auth secret. Nothing on screen waits for a data change, by the conventions every script follows.
- **When a script fails**, the hook fails and the release is marked failed, as a failed migration does today, and its Job is kept for the log. With `--atomic` (named `--rollback-on-failure` in Helm 4) Helm then rolls the pods back. That is safe under PLAN §5.1, because the previous release runs against the new schema, but it rolls back an application for a backfill's bug. The install guide says so.
- **A rollback** runs no post-upgrade hook, so the older image never runs the newer scripts. The ledger keeps their rows, which the older runner ignores.
- **With C1's option A**, the migration hook can take as long as data change 0034 takes on an instance that skipped it, under the same `--timeout`. That is C1's to size; this hook then finds 0034 complete.

## 2. Values added to the chart

```yaml
# Background work on its own pods (plan 0.8.0 H10). Off keeps today's shape:
# every pod serves pages and also runs the outbox relay and the scheduler.
# On, the web pods only serve, and these pods run both. Needs shared storage:
# a bucket, or persistence with ReadWriteMany, because the relay builds
# exports and scans uploads, and the scheduler removes orphaned ones.
worker:
  enabled: false
  # One is enough for the work. Two keep a node drain from leaving a minute
  # with no scheduler, in which a due run is skipped.
  replicaCount: 1
  # Empty means the same as `resources`.
  resources: {}
  # Not shared with the web pods, whose affinity rules may name their labels.
  affinity: {}

# An autoscaler on the web Deployment. With it on, replicaCount is ignored.
# The target is a share of resources.requests.cpu, so raise that from 100m
# first, and keep maxReplicas times OPENOKR_DB_POOL_MAX (20) under the
# database's max_connections. Needs metrics-server.
autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 6
  targetCPUUtilizationPercentage: 70
  # 0 means CPU only.
  targetMemoryUtilizationPercentage: 0

# How a pod stops. The grace period is preStopSeconds + drainSeconds + 15.
shutdown:
  # Keeps answering while the load balancer stops sending. 0 removes the pause.
  preStopSeconds: 10
  # How long a stopping process may finish work in flight
  # (OPENOKR_SHUTDOWN_SECONDS). Longer work is cut and retried.
  drainSeconds: 20

# Runs the data changes after every install and upgrade, in a Job that
# stops cleanly at the budget and says what is left. The next upgrade, or
# `kubectl exec` (docs/install/kubernetes.md), finishes it.
dataChanges:
  enabled: true
  # Under Helm's default --timeout of 5m. 0 runs to the end, under whatever
  # --timeout you pass.
  timeBudgetSeconds: 240
```

| Key | Default | Rendered as |
|---|---|---|
| `worker.enabled` | `false` | `worker-deployment.yaml`, `worker-pdb.yaml`; `OPENOKR_RELAY` and `OPENOKR_SCHEDULER` on both Deployments |
| `worker.replicaCount` | `1` | The worker's `replicas`; its PDB above 1 |
| `worker.resources` | `{}` | The worker container's resources, or `resources` when empty |
| `worker.affinity` | `{}` | The worker pod's affinity |
| `autoscaling.enabled` | `false` | `hpa.yaml`; no `replicas` on the web Deployment |
| `autoscaling.minReplicas` / `maxReplicas` | `2` / `6` | The autoscaler's bounds. Refused when max is below min or min below 1 |
| `autoscaling.targetCPUUtilizationPercentage` | `70` | The CPU metric |
| `autoscaling.targetMemoryUtilizationPercentage` | `0` | A memory metric when above 0 |
| `shutdown.preStopSeconds` | `10` | The web container's `preStop`; none at 0 |
| `shutdown.drainSeconds` | `20` | `OPENOKR_SHUTDOWN_SECONDS` on every server pod; part of both grace periods |
| `dataChanges.enabled` | `true` | `data-change-job.yaml` |
| `dataChanges.timeBudgetSeconds` | `240` | `--max-seconds`, and `activeDeadlineSeconds` of budget plus 120 as a backstop. Neither at 0 |

The hook Job: `backoffLimit: 0` (a retry learns nothing the next upgrade would not), `ttlSecondsAfterFinished: 86400` and `before-hook-creation` like the migration hook, so the last run's log stays readable. The default service account with no token mounted, like the migration hook, because it talks to Postgres and nothing else. `migrationResources`, the CA bundle mount, `/tmp`.

**Switching the autoscaler on in a running release.** Helm 3 removes the `replicas` field it used to set, and Kubernetes reads a missing field as one replica until the autoscaler's next pass, about 15 seconds later. The README says to do it in a quiet moment, or to scale the Deployment to `minReplicas` by hand first.

### 2.1 OKRGoal's values

| Value | Set to | Why |
|---|---|---|
| `worker.enabled` | `true` | Its storage is S3, so the worker is allowed |
| `worker.replicaCount` | `2` | No skipped run during node maintenance |
| `autoscaling.enabled` | `true`, 2 to 6 | With `resources.requests.cpu` raised to `500m`, and six times 20 connections checked against the RDS class's `max_connections` |
| `shutdown.preStopSeconds` | `20` | The AWS Load Balancer Controller deregisters a target only after it has seen the endpoint change and called AWS, which is slower than kube-proxy. Start at 20 and watch the ALB's 5xx count during a rollout |
| Prometheus | Scrape every pod, not the Service | The job, nudge and agent series are counted where the scheduler and relay run, which is now the worker |

## 3. Compose

| Change | Why |
|---|---|
| `stop_grace_period: 30s` on `app` | Docker's 10 seconds would kill the 20-second drain. The image already carries the coordinator and `NEXT_MANUAL_SIG_HANDLE` (D4), so the drain itself needs nothing from Compose |
| `./openokr upgrade` runs the data changes after `wait_for_health` (Q7) | The same reason as the hook: nothing runs them today, and C1 needs 0034 run. To the end, not to a budget: the operator is watching the terminal, and stopping it loses nothing. `OPENOKR_SKIP_DATA_CHANGE=1` skips it and prints what is pending instead |
| No worker service | One container on one host has nothing to scale apart. An operator who wants a second container can still run the image with `OPENOKR_RELAY=on` and `OPENOKR_SCHEDULER=on` beside an app set to `elsewhere` |
| No pause | Caddy has one upstream; a restart is a short outage whatever the pause |

## 4. Acceptance criteria

Grouped by the row that delivers them (section 7).

**H10a, draining on SIGTERM** (unit unless marked):

- Given a relay dispatching the first of five claimed rows, when it is stopped, then the first row is delivered and marked, and the other four have `available_at` at or before now and the attempt count they had before the claim.
- Given those four released rows, when a second relay polls, then it claims all four.
- Given a dispatch that does not finish within the budget, when the budget passes, then the process exits, and the row is claimed again only after its lease.
- Given a pg-boss job still running at the budget less three seconds, when the stop reaches it, then the job is in the `retry` state, and a second queue's worker runs it.
- Given an action in flight, when SIGTERM arrives, then the process exits only after the action finishes or the budget passes.
- Given nothing in flight, when SIGTERM arrives, then the process exits within one second with code 0, and logs one `stopped` line naming each step's outcome.
- Given `NEXT_MANUAL_SIG_HANDLE` unset, when SIGTERM arrives, then the coordinator runs its steps and does not call `process.exit` (Next's handler does).
- Given the built image, when it starts, then `NEXT_MANUAL_SIG_HANDLE` is `true` in the server's environment.
- Given `OPENOKR_SHUTDOWN_SECONDS=0`, `301` or `soon`, when the server boots, then it refuses, naming the variable.
- Given the Compose stack with a drain under 20 seconds, when `docker compose stop app` runs, then the container's log ends with the `stopped` line, not a kill. (smoke test)

**H10b, the pause and the grace period** (`check.sh` unless marked):

- Given no values, when the chart renders, then the web container has `preStop` `sleep 10`, the pod has `terminationGracePeriodSeconds: 45`, and the container has `OPENOKR_SHUTDOWN_SECONDS` `"20"`.
- Given `shutdown.preStopSeconds=0`, then there is no `lifecycle`, and the grace period is 35.
- Given `shutdown.drainSeconds=40`, then the variable is `"40"` and the grace period is 65.
- Given values reused from v0.7.0, then the same three settings render as with no values.
- Given two replicas and a client pod requesting `/api/health` through the Service every 100 milliseconds, when one replica is deleted, then no request fails. (`cluster-test.sh`)

**H10c, data changes after install and upgrade**:

- Given no values, when the chart renders, then a Job `openokr-data-change-1` (`check.sh` renders the release `openokr`) has `helm.sh/hook: post-install,post-upgrade`, `backoffLimit: 0`, the command ending `data-change.ts --max-seconds 240`, `activeDeadlineSeconds: 360`, and `DATABASE_URL`, `OPENOKR_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` each by `secretKeyRef`. (`check.sh`)
- Given `dataChanges.enabled=false`, then no such Job renders; given values reused from v0.7.0, then it does. (`check.sh`)
- Given `dataChanges.timeBudgetSeconds=0`, then the command has no `--max-seconds` and the Job no `activeDeadlineSeconds`. (`check.sh`)
- Given a script with batches left when the budget passes, when its current batch commits, then the runner stops, prints that script as `in progress`, and exits 0; and given a second run, then it resumes from the saved cursor. (unit, `packages/db`)
- Given another session holds the data-change lock, when the runner starts with `--max-seconds`, then it says another run is going and exits 0 without waiting. (unit)
- Given a script that throws, when the hook runs, then it exits 1 naming the script, and the ledger keeps the last committed batch. (unit)
- Given a fresh install and an upgrade in kind, when each finishes, then the hook's log says every registered script is complete. (`cluster-test.sh`)

**H10d, `elsewhere`** (unit):

- Given `OPENOKR_RELAY=elsewhere`, when the server boots, then no relay starts, and a copilot question is enqueued as a background run.
- Given `OPENOKR_RELAY=off`, then the copilot answers inline, as today.
- Given `OPENOKR_SCHEDULER=elsewhere` and the thresholds at 2 and 4 hours: a shared stamp a minute old is `operational`; three hours old is `degraded`; five hours old is `unavailable`; no stamp with the process up ten minutes is `operational`; no stamp with it up five hours is `unavailable`.
- Given `OPENOKR_SCHEDULER=off`, then `operational` whatever the stamp, as today.
- Given `elsewhere` and an `unavailable` judgement, when an administrator opens Admin General, then the scheduler notice shows the worker sentence; given `operational`, then no notice.
- Given `elsewhere`, then `/api/health` answers 200 with `scheduler: "elsewhere"`.
- Given `OPENOKR_RELAY=elsewhere`, when `/api/metrics` is read with the scrape token, then it includes `openokr_outbox_pending` and `openokr_outbox_oldest_pending_seconds`.
- Given `OPENOKR_RELAY=sometimes`, when the server boots, then it refuses, naming the variable.

**H10e, the worker Deployment**:

- Given no values, then no worker Deployment renders, and the web Deployment sets neither `OPENOKR_RELAY` nor `OPENOKR_SCHEDULER`. (`check.sh`)
- Given `worker.enabled` with a bucket, then `openokr-worker` renders with `worker.replicaCount` replicas, both flags `on`, no `lifecycle`, a grace period of 35, the web pods' service account, and the web Deployment has both flags `elsewhere`. (`check.sh`)
- Given the same, then the worker's environment names, less the two flags, equal the web container's. (`check.sh`)
- Given the same, then the worker's pod labels match neither the Service's selector nor the web PDB's. (`check.sh`)
- Given `worker.enabled` with persistence `ReadWriteOnce` and no bucket, or persistence off and no bucket, then the render fails naming the remedies. (`check.sh`)
- Given `worker.enabled` and an `extraEnv` entry `OPENOKR_SCHEDULER`, then the render fails naming the variable. (`check.sh`)
- Given `worker.replicaCount=2`, then a worker PDB with `minAvailable: 1` renders. (`check.sh`)
- Given a kind install with the worker on and a bucket in a stand-in object store, when it is ready, then the worker's log says `relay: started` and `scheduler: started`, each web pod's log says both run elsewhere, every audit row is chained within two minutes of a sign-up, and `/api/status` through the Service reports every component `operational`. (`cluster-test.sh`)

**H10f, the autoscaler** (`check.sh`):

- Given `autoscaling.enabled` with a bucket, then an `autoscaling/v2` HorizontalPodAutoscaler targets the web Deployment with 2 to 6 replicas and a CPU target of 70, and the web Deployment has no `replicas` field.
- Given `autoscaling.targetMemoryUtilizationPercentage=80`, then a memory metric is added.
- Given `autoscaling.enabled` with persistence `ReadWriteOnce` and no bucket, then the render fails; given `maxReplicas=1` and `minReplicas=2`, then it fails.
- Given `autoscaling.enabled` and `minReplicas=2`, then the web PDB renders; given no values, then no autoscaler and `replicas: 1`.

**H10g, Compose upgrade** (smoke test):

- Given `./openokr upgrade`, when the app is healthy again, then the helper runs the data changes and prints what ran.
- Given `OPENOKR_SKIP_DATA_CHANGE=1`, then it runs none and prints the pending list `./openokr status` prints.

## 5. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/adapters/test/relay.test.ts` (existing) | D6: the row in flight finishes; the rest are released with their attempt back; a second relay takes them; the deadline |
| Unit | `packages/adapters/test/jobs.test.ts` (existing) | D7: the timeout reaches pg-boss; a job past it is in `retry` |
| Unit | `apps/web/test/shutdown.test.ts` | D4, D5: steps run together, the bound, waiting for actions, the log line, exit code, no exit without `NEXT_MANUAL_SIG_HANDLE` |
| Unit | `apps/web/test/instrumentation.test.ts` (existing) | The coordinator is installed before anything that can fail |
| Unit | `packages/config/test/env.test.ts` (existing) | `elsewhere` for both variables; `OPENOKR_SHUTDOWN_SECONDS` and its refusals |
| Unit | `apps/web/test/relay.test.ts`, `scheduler.test.ts` (existing) | Nothing starts with `elsewhere`; the log lines |
| Unit | `apps/web/test/scheduler-health.test.ts` (existing) | 1.3's status rows |
| Unit | `apps/web/test/status-endpoint.test.ts`, `health-route.test.ts`, `metrics-route.test.ts` (existing) | `elsewhere` end to end through each route |
| Unit | `apps/web/test/copilot-route-mode.test.ts` | Background run for `on` and `elsewhere`, inline for `off` |
| Unit | `apps/web/test/instance-health-notice.test.tsx` | The worker sentence; none when operational |
| Unit | `packages/db/test/data-change.test.ts` (existing) | D18: the budget between batches, the resume, the try-lock, exit codes |
| Deployment | `deploy/helm/check.sh` | Every `check.sh` criterion in section 4, the reused-values cases by name, and the hook's environment the way O3's check reads the erasure job's |
| Deployment | `deploy/helm/cluster-test.sh` | The hook's log after install and upgrade; a pod deleted under a request loop from a client pod; then an upgrade with `--reuse-values --set worker.enabled=true` and a stand-in object store (like the stand-in Postgres, not part of the chart), with the worker's and web pods' logs, the audit chain and `/api/status`. The failure dump gains the worker's and the hook's logs |
| Deployment | `.github/workflows/upgrade.yml` (no change) | The nightly Helm leg upgrades from each baseline with `--reuse-values`, so it runs the hook and the pause from values that lack both |
| Deployment | `deploy/docker/smoke-test.sh` | H10a's stop line; H10g's two cases |
| End to end | None | The only screen change is the notice in a failure state, which one process in `on` mode cannot reach. As with D1's Demo pill, the unit test carries it |

## 6. What this does not do

- No worker for Compose, and no third Compose service.
- No autoscaler for the worker, and none on queue depth.
- No separate worker entry point or bundle (D1).
- No change to how a scheduled job is shaped. A Champion run still walks every workspace in one job, so a job cut at the budget starts again from its first workspace. One job per workspace would drain more finely and is a later change.
- No change to pg-boss's `missed` policy. Catching up a skipped occurrence is another way to cover a single worker's gap.
- No change to the migration hook. Whether it runs a data change a migration names is C1's decision.
- No direct database connection for pg-boss or the listener (H7), and no read replicas.
- No `ServiceMonitor` or `PodMonitor` in the chart, and no default `topologySpreadConstraints`.
- No change to `/api/health`'s status codes, the relay's lease or the outbox's retry policy.
- No closing of live streams before exit. The browser reconnects, as it does after any network blip.

## 7. Proposed rows

Order: H10a, then H10b; H10c whenever, earlier is better for C1; H10d before H10e; H10f and H10g whenever.

| # | Change | Touches | Size | Gate | Acceptance |
|---|---|---|---|---|---|
| H10a | **Draining on SIGTERM.** The coordinator; the relay stopping between rows; pg-boss's timeout; error and span flush on stop; `OPENOKR_SHUTDOWN_SECONDS`; `NEXT_MANUAL_SIG_HANDLE` in the image and in `e2e/start-server.sh`; `stop_grace_period` in Compose | `apps/web/lib/shutdown.ts` (new), `relay.ts`, `scheduler.ts`, `error-reporting.ts`, `telemetry.ts`, `instrumentation.ts`, `instrumentation.node.ts`; `packages/adapters/src/relay.ts`, `drivers/jobs/pg-boss.ts`; `packages/config/src/env.ts`; `deploy/docker/Dockerfile`, `compose.yaml`; TECHNICAL-PLAN §4.14; `docs/admin/operations.md`; `.env.example`; a changeset | M | This design, Q3 | Section 4, H10a |
| H10b | **The pause and the grace period.** `shutdown.*` on the web Deployment | `deploy/helm/values.yaml`, `templates/deployment.yaml`, `_helpers.tpl`, `check.sh`, `cluster-test.sh`, `README.md`; `docs/install/kubernetes.md` | S | This design | Section 4, H10b |
| H10c | **Data changes after install and upgrade.** The runner's budget and try-lock; the hook Job; how to finish by hand | `packages/db/src/data-change.ts`, `src/bin/data-change.ts`; `deploy/helm/templates/data-change-job.yaml` (new), `values.yaml`, `NOTES.txt`, `check.sh`, `cluster-test.sh`, `README.md`; `docs/install/kubernetes.md`; `docs/runbooks/upgrade.md`; `docs/design/data-change-conventions.md`; PLAN §5.1 if Q1 is A; a changeset | M | This design, Q1, Q2 | Section 4, H10c |
| H10d | **`elsewhere`.** The third value and every reader in 1.3; the outbox gauges without a relay | `packages/config/src/env.ts`; `apps/web/lib/relay.ts`, `scheduler.ts`, `scheduler-health.ts`; `apps/web/app/api/copilot/route.ts`, `api/status/route.ts`, `api/health/route.ts`, `admin/general/page.tsx`, `instance-health-notice.tsx`; `packages/adapters/src/relay.ts` (a static gauge registration); the English and Malay message files; `docs/design/status-and-capacity.md` §2.6; `docs/design/copilot-background-runs.md`; `docs/runbooks/observability.md`; a changeset | M | This design, Q4 | Section 4, H10d |
| H10e | **The worker Deployment.** The shared environment helper, the worker and its PDB, labels, the two refusals, the install notes, the stand-in object store in the cluster test | `deploy/helm/templates/_helpers.tpl` (`openokr.serverEnv`, worker labels), `deployment.yaml`, `worker-deployment.yaml` and `worker-pdb.yaml` (new), `_validate.tpl`, `NOTES.txt`, `values.yaml`, `check.sh`, `cluster-test.sh`, `README.md`; `docs/install/kubernetes.md`; `docs/runbooks/incident.md` (row 9, the worker's logs); a changeset | M | This design, Q5, Q6; after H10d | Section 4, H10e |
| H10f | **The autoscaler** on the web Deployment | `deploy/helm/templates/hpa.yaml` (new), `deployment.yaml`, `pdb.yaml`, `_validate.tpl`, `values.yaml`, `check.sh`, `README.md`; `docs/install/kubernetes.md` | S | This design | Section 4, H10f |
| H10g | **`./openokr upgrade` runs the data changes** | `deploy/docker/openokr`, `smoke-test.sh`; `docs/install/compose.md`; `docs/runbooks/upgrade.md` | S | Q7 | Section 4, H10g |

Every row runs `sh deploy/helm/check.sh` when it touches the chart, and the deployment scripts in CLAUDE.md when it touches `deploy/`.

## 8. Questions for Akmal

**Q1. Should the chart run the data changes after every install and upgrade by default?**

| Option | What happens |
|---|---|
| A. On by default, inside a time budget; `dataChanges.enabled: false` turns it off | Nothing is left for an operator to remember. PLAN §5.1's "on the administrator's schedule" gains a sentence: the chart runs them after each upgrade unless turned off, and never for longer than its budget |
| B. Off by default; an operator opts in | PLAN §5.1 stands as written. Every Helm operator still has to know to run them, which today nobody can find out how to do |
| C. A plain Job per revision, not a hook, running to the end | Never holds Helm and never fails a release, but Helm does not report on it either, and a slow one is deleted mid-batch by the next upgrade (safe, but quiet) |

**Recommended: A.** It is the change the row asks for, the budget keeps "never held open by a long backfill" true, and C1 already leans this way. It is a PLAN change, which is yours.

**Q2. What should the hook do when time runs out, and when a script fails?**

| Option | What happens |
|---|---|
| A. Out of time: stop between batches, exit 0, log what is left. A script fails: exit 1, the release is failed, as a failed migration does | A slow backfill never fails a release; a broken one always does. With `--atomic` a broken one also rolls the pods back |
| B. Exit 0 in both cases | A release is never failed by a data change. A broken script shows only in the hook's log and the ledger |
| C. No budget; rely on `--timeout` | A long backfill fails the release at five minutes, halfway through a batch |

**Recommended: A.**

**Q3. Should the server take SIGTERM over from Next.js?**

| Option | What happens |
|---|---|
| A. Yes, with `NEXT_MANUAL_SIG_HANDLE=true` and the coordinator (D4) | The relay and the scheduler drain inside a known bound. Live streams close at exit rather than holding the pod until SIGKILL |
| B. No; add only the pause and the grace period | Requests stop failing during a rollout. Background work still stops whenever Next exits, which is at once or at SIGKILL (0.1) |
| C. A custom server entry instead of Next's `server.js` | Full control, including the HTTP server's own close. It replaces the server the Docker image and the e2e suite both run, for little more than A gives |

**Recommended: A.**

**Q4. How do the web pods learn that the work runs on the worker?**

| Option | What happens |
|---|---|
| A. A third value, `elsewhere`, on the two existing variables | Each variable keeps one meaning per value. The chart sets it; a hand-run second container can too |
| B. One new variable, `OPENOKR_PROCESS_ROLE` = `all`, `web` or `worker` | One word per pod, but it overlaps the two existing variables, and the precedence between them has to be invented |
| C. Detect it: a relay heartbeat in `system_settings`, and judge the scheduler's stamp whenever it is off here | Nothing to set, but an instance that ran a scheduler once and then turned it off on purpose reads as down forever |

**Recommended: A.**

**Q5. How many worker pods by default?**

| Option | What happens |
|---|---|
| A. 1, with a PDB only above 1 | Cheapest. A node drain can leave a gap of over a minute, and an hourly or nightly run due inside it is skipped until its next occurrence |
| B. 2 | No gap, at the cost of a second server process on every install that turns the worker on |

**Recommended: A** for the chart's default, and 2 for OKRGoal (2.1). Anyone turning the worker on is already scaling and can choose.

**Q6. May the worker run without shared storage?**

| Option | What happens |
|---|---|
| A. No: a bucket, or persistence with `ReadWriteMany`, or the render fails | The rule the replica count already follows. A self-hosted install on the default volume cannot turn the worker on until it moves storage |
| B. Allow `ReadWriteOnce` with an affinity that places the worker beside the web pod | Works only with one web replica, which is the case where a worker helps least |
| C. Allow per-pod storage with a warning | With a virus scanner set, every upload is quarantined, and every export is unreachable |

**Recommended: A.**

**Q7. Should `./openokr upgrade` run the data changes on Compose too?**

| Option | What happens |
|---|---|
| A. Yes, after the health wait, to the end; `OPENOKR_SKIP_DATA_CHANGE=1` skips it | Compose and Helm agree, and C1's 0034 is run on both |
| B. No; `upgrade` ends by printing what is pending | PLAN §5.1 unchanged for Compose. The operator still has to run `./openokr data-change` |

**Recommended: A,** answered the same way as Q1. If Q1 is B, then B here too.

## 9. What the specification gains, in the same change

- PLAN §5.1: the data-change sentence, if Q1 is A (H10c).
- TECHNICAL-PLAN §4.14, the Instance row: `OPENOKR_SHUTDOWN_SECONDS`, 20, environment only; `OPENOKR_RELAY` and `OPENOKR_SCHEDULER` listed with `on`, `off` and `elsewhere` (H10a, H10d).
- `docs/design/status-and-capacity.md` §2.6: the three modes (H10d). `docs/design/copilot-background-runs.md`: `elsewhere` keeps background runs (H10d).
- `docs/design/data-change-conventions.md`: the budget, and that a script may be stopped between any two batches by it (H10c).
- `docs/install/kubernetes.md`: "Stopping a pod" (the pause, the drain, what a load balancer needs), "Background work on its own pods", "The autoscaler", "Data changes" with the `kubectl exec` line. `deploy/helm/README.md`: every value in section 2.
- `docs/runbooks/upgrade.md`: the Helm half of "Backfills never hold up a boot". `docs/runbooks/observability.md`: scrape every pod; which series live on the worker. `docs/runbooks/incident.md`, row 9: where the scheduler runs.
- `docs/admin/operations.md`: `elsewhere` beside `off`.
- REQUIREMENTS.md, METHOD.md, DATABASE.md and TECHNICAL-PLAN §7.2: nothing. No table, rule or import mapping changes.

## 10. As built

Where the build moved from the sections above, and why.

### H10a, draining on SIGTERM

| # | Written | Built | Why |
|---|---|---|---|
| H10a-B1 | The coordinator logs `stopping: draining for up to 20s` and `stopped after 4.2s: ...` | `shutdown: SIGTERM, draining for up to 20s` and `shutdown: stopped after 1.4s: relay idle, scheduler idle, 0 actions in flight, error reports flushed, telemetry flushed`, on standard output. Each step's own words, the drain steps first, then the flush steps | Every other line the server writes names its part (`relay:`, `scheduler:`). The flush steps are named too, because D5's line names what was waited for |
| H10a-B2 | Installed first thing in `register()` | `takeSignals()` in `instrumentation.node.ts`, called first after that module loads and before the environment is checked. Skipped during `next build` | A build worker is stopped by its parent with a signal, and the build sets no `NEXT_MANUAL_SIG_HANDLE`, so a handler that does not exit would keep it alive |
| H10a-B3 | The coordinator waits for `currentConcurrentActions()` to reach none | `waitForActions()` in `lib/shutdown.ts`, registered by `lib/telemetry.ts` beside the span flush | `shutdown.ts` imports only the environment schema, so it stays light enough to install before anything else. `telemetry.ts` already reads the same count for its gauge |
| H10a-B4 | Steps, then exit | Drain steps run together within the budget; then flush steps run together within 10 seconds of their own; then the line and the exit. A step that throws is named with its reason, one still going at its bound as `still running at the bound`; neither stops the others. A second signal joins the first stop | The flushes send what the drain reported. Their own bound is inside D9's 15 seconds |
| H10a-B5 | `NEXT_MANUAL_SIG_HANDLE` decides the exit | Any non-empty value counts, as in Next's own test (`!process.env.NEXT_MANUAL_SIG_HANDLE`) | Whenever Next registered nothing, something has to exit |
| H10a-B6 | The relay releases the rest | `OutboxRelay.stop()` takes the unstarted rows of the batch in one synchronous splice and hands them back (`available_at = now()`, `attempts = greatest(attempts - 1, 0)`) before it waits for the row in flight. It answers `{ released, waited }`. `drainOnce()` holds itself as the drain in flight, and claims nothing once stopped until `start()` | A dispatch that outlives the bound then strands only itself. Releasing first is what the third H10a criterion needs |
| H10a-B7 | pg-boss gets the budget less three seconds | The jobs port's `stop` takes `{ timeoutMs }`. The pg-boss driver counts the jobs whose handler is running as `running`, so after a stop it says how many it handed back. The floor is pg-boss's own one second | The scheduler's line says `1 scheduled job handed back` from that count |
| H10a-B8 | `OPENOKR_SHUTDOWN_SECONDS`, 1 to 300 | Checked as text, then turned into a number | A coerced `soon` or `2.5` fails as a type error with no input, which `parseEnv` reads as "is missing" |
| H10a-B9 | The smoke test checks the stop line | After its `docker compose restart app`: the variable is `true` in the container, and the log holds the drain line and the `stopped` line | The restart is the one stop the smoke test already makes |

### H10b, the pause and the grace period

| # | Written | Built | Why |
|---|---|---|---|
| H10b-B1 | The three settings and their `check.sh` cases | As written, through three helpers in `_helpers.tpl` (`openokr.preStopSeconds`, `openokr.drainSeconds`, `openokr.terminationGraceSeconds`), each read with `dig` and the `values.yaml` default. The reused-values case renders with `--set shutdown=null`, which is exactly what values from 0.7.0 lack, beside the generic loop that nulls every key added since each release | One place for each number, so the web Deployment and, at H10e, the worker cannot disagree |
| H10b-B2 | Not in the design | `shutdown.drainSeconds` outside 1 to 300 or not a whole number, and a negative or fractional `shutdown.preStopSeconds`, are refused at render time | The server refuses the first at boot, which would leave every pod crash-looping; the chart says so before anything reaches the cluster |
| H10b-B3 | `OPENOKR_SHUTDOWN_SECONDS` on the container | Set before `extraEnv`, so an `extraEnv` entry of the same name wins at run time but leaves the grace period on `shutdown.drainSeconds`. The README names the value, not the variable | Refusing it, as D15 refuses the two flags, was not asked for; the value is the documented way |
| H10b-B4 | A client pod requesting `/api/health` every 100 ms while a replica is deleted | `kubectl run` with the image under test, already loaded and carrying Node: a new connection per request (`agent: false`), which is what kube-proxy routes, for 45 seconds. A replica with the release's labels and no component label is deleted five seconds in. The run passes when at least 100 requests were sent and none failed, then waits for the replacement. The failure dump gains the loop's output | A kept-alive connection would test the client's reuse of a socket to a pod that is leaving, not the pause |

### H10c, data changes after install and upgrade

| # | Written | Built | Why |
|---|---|---|---|
| H10c-B1 | The runner gains a budget | `runDataChangesWithin(client, { scripts, maxSeconds })` beside `runDataChanges`, which the migrator (C1) and erasure keep calling unchanged: blocking lock, no budget. It answers `{ ran, stopped, outcomes }` | The migrator must wait for the lock, never skip a data change a migration needs |
| H10c-B2 | Stops after the batch that crosses the budget | The clock is read after each batch commits, and before a script not yet complete starts, ahead of its ledger row. So a script the budget never reached still reads `not yet run`, and one it stopped reads `in progress` with its cursor | The status the run ends with says exactly what is left |
| H10c-B3 | The command's exit codes | In `packages/db/src/data-change-command.ts`, so they are tested against a real database without a process: 0 for a run, a status, a budget reached or another run holding the lock; 1 for a script that throws, with `Data change failed:`, the runner's sentence naming the script and batch, and the cause's message (never its detail, which can carry a row's values); 2 for a usage error, decided before anything connects | A failure used to be an uncaught error with a stack trace. Exit 2 matches the other commands |
| H10c-B4 | Prints what is left as `--status` does | A run with `--max-seconds` always ends with the `--status` text, so a run that finished ends `Data changes: all N complete.`, which `cluster-test.sh` reads from `job/<release>-openokr-data-change-1` after the install and `-2` after the upgrade. The text now names the next `helm upgrade` and the install guide for Kubernetes. A run without the flag prints what it did, as before | One line to look for in the hook's log |
| H10c-B5 | The hook Job | As §2 says, with hook weight 5 and its pods labelled like the migration hook's, `component: data-change`. Its environment is `openokr.commonEnv` and the auth secret; not `OPENOKR_APP_ROLE`, which only the migrator reads. The Service's target port is the named `http`, which these pods do not declare, so it never routes to them | The same shape as the hook an operator already knows |
| H10c-B6 | Not in the design | A negative or fractional `dataChanges.timeBudgetSeconds` is refused at render time. The install notes always say the data changes run and give the `kubectl exec` line, and say plainly when `dataChanges.enabled` is false | The line is the one thing an operator needs when the budget is reached |
| H10c-B7 | §1.5, C1 | Unchanged: Helm runs the pre-upgrade migration hook to the end before the post-upgrade hook starts, so when the migrator ran 0034 first, this hook finds it complete. A `kubectl exec` run started while the hook holds the lock waits for it; the hook started while one runs says so and exits 0 | The two locks never contend, and the try-lock is only on the hook's side |

### H10d, `elsewhere`

| # | Written | Built | Why |
|---|---|---|---|
| H10d-B1 | Each reader in §1.3 reads the variable | One light module, `apps/web/lib/background-work.ts`: `relayMode()`, `schedulerMode()` and `outboxDrained()` (on or elsewhere). `relayEnabled()` and `schedulerEnabled()` keep their names and now mean "runs in this process", `on` only. The copilot route reads `outboxDrained()` from the light module rather than importing the relay host | The relay host loads every channel driver, and the copilot route needed one boolean from it |
| H10d-B2 | `/api/status` and Admin General judge the shared stamp | Both read `apps/web/lib/scheduler-status.ts`: `schedulerStatus()` gathers the reading for `judgeScheduler`, and `schedulerNotice()` answers `failed`, `elsewhere` or none. `judgeScheduler` takes `mode` in place of `enabledHere`, plus `sharedUnreadable` and `processStartedAt`, the process's start from `process.uptime()` | One judgement, so the page and the endpoint cannot disagree. With `on`, an unreadable stamp still falls back to this pod's own reading, as H12 left it |
| H10d-B3 | The notice says "no scheduler has completed a run for four hours" | "for longer than the status check allows, four hours unless that was changed". Shown on `unavailable` only, as written, not on `degraded`. The title is the `failed` notice's; the two sentences under it are new keys, `admin.general.scheduler.elsewhereWhat` and `elsewhereFix`, in English and Malay. The fix names the worker Deployment and its `scheduler:` log lines | The threshold is a setting (`status.schedulerUnavailableSeconds`), and the catalogue has named holes but no plural, so a number in the sentence could read "1 hours" |
| H10d-B4 | A static gauge registration for the two outbox gauges | `OutboxRelay.registerGauges(pool, metrics, rowsPerMinute)` registers all four outbox gauges, the two named plus the two rate-held ones, and the constructor calls it. `pendingCount(pool)` became static beside `oldestPendingSeconds` | The rate-held pair is part of the same picture (R11), and a web pod serving two of four would make a dashboard row half empty |
| H10d-B5 | `/api/status`, end to end | `apps/web/test/status-route.test.ts` calls the route with the pool, the stamp and the thresholds stood in, beside the existing shape test that cannot | The existing file says it cannot call the route because the route needs a database; with the stand-ins it can |
| H10d-B6 | `docs/runbooks/observability.md`: scrape every pod | A new section, "Which process counts what": the outbox gauges on every process, the delivery series and the job, nudge and agent series where the relay and the scheduler run, the request series on the web pods | Which series live on the worker is what decides how to scrape |

### H10e, the worker Deployment

| # | Written | Built | Why |
|---|---|---|---|
| H10e-B1 | `openokr.serverEnv`, used by both | Everything the web container's `env` held, from `openokr.commonEnv` to the error DSN, moved into the helper unchanged; each Deployment adds its two flags after it, the web pods only with the worker on. A default render is byte for byte what it was, less one comment's wording | D20: the defaults keep one Deployment and no flag |
| H10e-B2 | The worker mounts the same storage | Without a bucket, the same claim, which the refusal guarantees is `ReadWriteMany`. **With a bucket, an `emptyDir` at `/app/storage`** rather than the claim | With a bucket the claim holds nothing, and the default `ReadWriteOnce` claim would hold the worker to whichever node a web pod mounted it on. `check.sh` asserts both |
| H10e-B3 | A worker PDB above one replica | Also only while `podDisruptionBudget.enabled`, the switch the web PDB already honours. `minAvailable: 1`, not `podDisruptionBudget.minAvailable` | An operator who turned PDBs off meant all of them; the web value counts web replicas |
| H10e-B4 | The worker's pod | Container `worker`, port `http` declared for the probes and a pod scrape, the web pods' probes, security contexts, `imagePullSecrets`, `nodeSelector`, `tolerations`, `podAnnotations` and `podLabels`. Its own `worker.affinity`; `worker.resources`, else `resources`. Rolling update with `maxUnavailable: 0`, so a new worker starts before the old one stops | Node placement and pod metadata apply to any pod of the release; affinity rules can name the web pods' labels |
| H10e-B5 | `extraEnv` naming a flag is refused | Each `extraEnv` entry that is a map is checked by `name`. `extraEnvFrom` cannot be read at render time; the README says to keep both variables out of it | A Secret's keys are not in the values |
| H10e-B6 | The cluster test's steps | After the backup steps: a stand-in object store (`quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z`, its bucket made with the image's own `mc`), then `helm upgrade --reuse-values --set worker.enabled=true` with the bucket. It waits for `scheduler: started` and `relay: started` in the worker's log and both `runs elsewhere` lines in each web pod of the new revision. **The audit row is written by copying the newest one with its chain position cleared**, as the stand-in database's superuser, and the test waits up to two minutes for no unchained row. Then `/api/status` through a fresh port-forward to the Service must be operational in every component. The failure dump gains the worker's and the object store's logs | Registration closes behind the first account, so no second sign-up can write one, and every row the first wrote was chained by the web pods' own schedulers before the worker existed. A row written once only the worker runs a scheduler is chained by the worker or by nothing |
| H10e-B7 | The install notes | A paragraph naming the worker Deployment, its replica count, the `kubectl logs` line and "scrape every pod" | The worker's log is where an operator looks when mail or the agents go quiet |

### H10f, the autoscaler

| # | Written | Built | Why |
|---|---|---|---|
| H10f-B1 | The storage rule applies to `maxReplicas`; the PDB renders when `minReplicas > 1` | Two helpers, `openokr.mostWebReplicas` (the ceiling, or `replicaCount`) and `openokr.fewestWebReplicas` (the floor, or `replicaCount`), read by the storage rule, the web PDB and the install notes' emptyDir warning. The storage refusal names `autoscaling.maxReplicas` when the autoscaler is on | One place decides how many web pods there can be, so a fourth reader cannot count `replicaCount` while the autoscaler owns it |
| H10f-B2 | Refused when max is below min or min below 1 | One message for both, and two more not in the design: a CPU target below 1, and a negative memory target | Kubernetes refuses them only once the release has started to roll |
| H10f-B3 | Not in the design | No `behavior` block: the autoscaler's own scale-down window (five minutes) is kept | A tuned window is a deployment's choice, and `extra` values for it were not asked for |
