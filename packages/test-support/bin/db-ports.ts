/**
 * The host ports the test stack actually got (P5-T07c-a, after two collisions).
 *
 * **Chosen numbers keep colliding, so stop choosing.** The stack published a
 * fixed 55432, which failed the moment anything else on the host held it. Giving
 * each continuous-integration job its own pair moved the problem rather than
 * removing it: a shard then failed to bind 56434, a number nothing else in this
 * repository uses, on a runner that was supposed to be fresh. Whatever holds
 * these ports, the way not to fight it is to let Docker pick a free one and ask
 * afterwards which it picked.
 *
 * Set `TEST_DB_PORT=0` and `TEST_PGBOUNCER_PORT=0` before `db:up`, then run this
 * and feed its output into the environment. It prints exactly the two lines the
 * harness reads:
 *
 *     TEST_DB_PORT=49153
 *     TEST_PGBOUNCER_PORT=49154
 *
 * Locally the defaults still apply and this is not needed.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const COMPOSE = resolve(import.meta.dirname, "../docker/compose.yaml");

/**
 * The published host port for one container port.
 *
 * `docker compose port` answers `0.0.0.0:49153`, and on a host with IPv6 it can
 * answer twice, one line per family. The first line is enough: both map to the
 * same host port.
 */
function published(service: string, containerPort: number): string {
  const answer = execFileSync(
    "docker",
    ["compose", "-f", COMPOSE, "port", service, String(containerPort)],
    { encoding: "utf8" },
  );
  const first = answer.trim().split("\n")[0]?.trim() ?? "";
  const port = first.slice(first.lastIndexOf(":") + 1);
  if (!/^\d+$/.test(port)) {
    throw new Error(
      `docker compose port ${service} ${containerPort} answered "${answer.trim()}", which has no port in it.`,
    );
  }
  return port;
}

console.log(`TEST_DB_PORT=${published("postgres", 5432)}`);
console.log(`TEST_PGBOUNCER_PORT=${published("pgbouncer", 6432)}`);
