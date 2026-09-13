#!/usr/bin/env bash
# Launch the Journal dev stack: backend (:8000) and frontend (:5173).
# Usage: ./dev.sh [--backend | --frontend]   (default: both)
# Ports: BACKEND_PORT / FRONTEND_PORT env vars. Occupied ports are refused —
# no silent drift over a stale instance.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_BACKEND=1
RUN_FRONTEND=1
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

case "${1:-}" in
  --backend)  RUN_FRONTEND=0 ;;
  --frontend) RUN_BACKEND=0 ;;
  -h|--help)  sed -n '2,3p' "$0"; exit 0 ;;
  "") ;;
  *) echo "unknown option: $1 (use --backend, --frontend)" >&2; exit 2 ;;
esac

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
refuse_busy_port() {
  echo "dev.sh: port $1 is already in use — kill the stale instance first:" >&2
  echo "  fuser -k $1/tcp   # or: pkill -f 'uvicorn app.main:app'; pkill -f 'node_modules/.bin/vite'" >&2
  echo "  or pick another port: BACKEND_PORT=$2 FRONTEND_PORT=$3 ./dev.sh" >&2
  exit 1
}
(( RUN_BACKEND )) && port_busy "$BACKEND_PORT" && refuse_busy_port "$BACKEND_PORT" 8001 5174
(( RUN_FRONTEND )) && port_busy "$FRONTEND_PORT" && refuse_busy_port "$FRONTEND_PORT" 8001 5174

PIDS=()
READY_PID=""
cleanup() {
  trap - EXIT INT TERM
  for pid in "${PIDS[@]:-}" "${READY_PID:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

BACKEND_PID=""
if (( RUN_BACKEND )); then
  (
    cd "$ROOT/backend"
    if command -v uv >/dev/null 2>&1; then
      exec uv run uvicorn app.main:app --reload --host 127.0.0.1 --port "$BACKEND_PORT"
    elif [[ -x .venv/bin/uvicorn ]]; then
      exec .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port "$BACKEND_PORT"
    else
      echo "dev.sh: no 'uv' on PATH and backend/.venv is missing — run 'uv sync' in backend/" >&2
      exit 1
    fi
  ) &
  BACKEND_PID=$!
  PIDS+=("$BACKEND_PID")
fi

if (( RUN_FRONTEND )); then
  (cd "$ROOT/frontend" && exec npm run dev -- --port "$FRONTEND_PORT" --strictPort) &
  PIDS+=("$!")
fi

# Readiness probe watches OUR backend pid, so a stale listener can't fake it.
if (( RUN_BACKEND )) && command -v curl >/dev/null 2>&1; then
  (
    for _ in $(seq 1 60); do
      kill -0 "$BACKEND_PID" 2>/dev/null || exit 0
      if curl -fsS --noproxy '*' -o /dev/null "http://127.0.0.1:$BACKEND_PORT/api/health" 2>/dev/null; then
        echo "dev.sh: backend ready  → http://127.0.0.1:$BACKEND_PORT"
        exit 0
      fi
      sleep 0.5
    done
    echo "dev.sh: warning: backend not answering /api/health yet" >&2
  ) &
  READY_PID=$!
  disown "$READY_PID"
fi
if (( RUN_FRONTEND )); then
  echo "dev.sh: frontend starting → http://localhost:$FRONTEND_PORT"
fi

# A child exiting (crash) tears down the rest; SIGINT/TERM land in the trap
# within one poll. jobs -r counts zombies as finished, unlike kill -0.
status=0
while :; do
  if (( $(jobs -r | wc -l) < ${#PIDS[@]} )); then
    echo "dev.sh: a service exited — shutting down" >&2
    status=1
    break
  fi
  sleep 1
done
exit "$status"
