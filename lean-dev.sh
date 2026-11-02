#!/bin/sh
# Runs the dev server on a small Mac (8 GB) so it stays usable for other work.
#   ./lean-dev.sh preflight        memory check only
#   ./lean-dev.sh start [minutes]  start next dev at low priority, stop itself after N minutes (default 15)
#   ./lean-dev.sh stop             stop it and report memory
#   ./lean-dev.sh status           what runs and what it costs
#   ./lean-dev.sh clean            delete build caches (.turbo/cache, .next, test-results)
# Env: FORCE=1 starts despite a red preflight. QOS=background is gentler still (slower compiles).
# macOS only: it relies on taskpolicy and memory_pressure. Elsewhere use `pnpm dev`.
# Postgres must answer on localhost:5432; a Homebrew postgresql@17 is started if it does not.
[ "$(uname)" = Darwin ] || { echo "lean-dev.sh is macOS only. Use pnpm dev."; exit 1; }
REPO=$(cd "$(dirname "$0")" && pwd)
STATE=${TMPDIR:-/tmp}/openokr-lean-dev
LOG=$STATE/dev.log
mkdir -p "$STATE"
[ -d /opt/homebrew/opt/postgresql@17/bin ] && export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH

swap_pct() { sysctl vm.swapusage | awk '{t=$4; u=$7; sub("M","",t); sub("M","",u); if (t>0) printf "%d", u*100/t; else print 0}'; }
free_pct() { memory_pressure | awk -F': ' '/free percentage/ {sub("%","",$2); print $2}'; }
web_pids() { pgrep -f "$REPO/apps/web/node_modules/.bin/../next/dist/bin/next dev|next-server" ; }
rss_mb() { ps -o rss= -p "$(web_pids | tr '\n' ',' | sed 's/,$//')" 2>/dev/null | awk '{s+=$1} END {printf "%d", s/1024}'; }

preflight() {
  s=$(swap_pct); f=$(free_pct)
  echo "memory free ${f}%, swap used ${s}%"
  if [ "${f:-0}" -lt 15 ]; then
    echo "RED: the Mac is already short of memory. Close heavy apps (browser tabs, Docker) first, or FORCE=1."
    return 3
  fi
  # Swap empties slowly after memory is freed, so it warns rather than stops.
  [ "${s:-0}" -gt 85 ] && echo "note: swap is ${s}% used; it drains on its own once memory is free"
  pgrep -q -f com.docker.backend && echo "note: Docker Desktop is open; quit it unless you need Mailpit or the demo instance"
  docker ps --format '{{.Names}}' 2>/dev/null | grep -q . && echo "note: Docker containers are running: $(docker ps --format '{{.Names}}' | tr '\n' ' ')"
  return 0
}

case "$1" in
  preflight) preflight ;;
  start)
    preflight || [ "$FORCE" = 1 ] || exit 3
    pg_isready -q -h localhost -p 5432 || brew services start postgresql@17 >/dev/null
    for i in 1 2 3 4 5 6 7 8 9 10; do pg_isready -q -h localhost -p 5432 && break; sleep 1; done
    pg_isready -q -h localhost -p 5432 || { echo "Postgres is not answering on 5432"; exit 4; }
    if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then echo "port 3000 is already in use"; exit 5; fi
    minutes=${2:-15}
    cd "$REPO/apps/web" || exit 6
    # Straight to next, without the pnpm and turbo wrappers: two fewer Node processes.
    # taskpolicy: CPU and disk yield to the apps you are using.
    NODE_OPTIONS=--max-old-space-size=2048 nohup taskpolicy -c "${QOS:-utility}" ./node_modules/.bin/next dev --port 3000 > "$LOG" 2>&1 &
    echo $! > "$STATE/pid"
    for i in $(seq 1 90); do grep -q "Ready in" "$LOG" && break; sleep 1; done
    grep -q "Ready in" "$LOG" || { echo "did not start, see $LOG"; tail -5 "$LOG"; exit 7; }
    ( sleep $((minutes * 60)); "$0" stop >/dev/null 2>&1 ) > /dev/null 2>&1 &
    echo $! > "$STATE/watchdog"
    echo "dev ready on http://localhost:3000 (QoS ${QOS:-utility}, heap cap 2 GB, stops itself in ${minutes} min). Log: $LOG"
    ;;
  stop)
    [ -f "$STATE/watchdog" ] && kill "$(cat "$STATE/watchdog")" 2>/dev/null; rm -f "$STATE/watchdog"
    pids=$(web_pids)
    [ -n "$pids" ] && kill $pids 2>/dev/null
    sleep 2; pids=$(web_pids); [ -n "$pids" ] && kill -9 $pids 2>/dev/null
    rm -f "$STATE/pid"
    echo "dev stopped. $(preflight | head -1)"
    ;;
  status)
    if [ -n "$(web_pids)" ]; then echo "dev running, $(rss_mb) MB"; else echo "dev not running"; fi
    pg_isready -h localhost -p 5432
    preflight | head -1
    ;;
  clean)
    cd "$REPO" || exit 6
    du -sh .turbo/cache apps/web/.next 2>/dev/null
    [ -n "$(web_pids)" ] && { echo "stop dev first"; exit 8; }
    rm -rf .turbo/cache apps/web/.next test-results packages/*/.turbo apps/*/.turbo
    echo "caches removed"; df -h / | tail -1
    ;;
  *) sed -n '2,10p' "$0" ;;
esac
