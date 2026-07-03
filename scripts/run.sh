#!/usr/bin/env bash
# NextResume — dev runner.
# Usage:
#   ./scripts/run.sh            # dev mode on :3000
#   ./scripts/run.sh -p 4000    # dev mode on a custom port
#   ./scripts/run.sh --prod     # build + start production locally
#   ./scripts/run.sh --clean    # nuke .next cache before starting

set -e

cd "$(dirname "$0")/.."

PORT=3000
MODE=dev
CLEAN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)  PORT="$2"; shift 2 ;;
    --prod)     MODE=prod; shift ;;
    --clean)    CLEAN=1; shift ;;
    -h|--help)
      grep -E "^# " "$0" | sed 's/^# //'
      exit 0 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

# --- checks -------------------------------------------------------------
if [[ ! -f .env.local ]]; then
  echo "⚠  .env.local missing. AI + Stripe calls will fail."
  echo "   Create it with NOVITA_API_KEY at minimum."
  echo ""
fi

if [[ ! -d node_modules ]]; then
  echo "📦 installing deps..."
  npm install --no-audit --no-fund
fi

# --- port cleanup -------------------------------------------------------
PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
if [[ -n "$PIDS" ]]; then
  echo "🔪 killing existing process on :$PORT ($PIDS)"
  kill -9 $PIDS 2>/dev/null || true
  sleep 0.5
fi

# --- clean cache --------------------------------------------------------
if [[ "$CLEAN" == "1" ]]; then
  echo "🧹 clearing .next + node_modules/.cache"
  rm -rf .next node_modules/.cache
fi

# --- boot ---------------------------------------------------------------
if [[ "$MODE" == "prod" ]]; then
  echo "🏗  building for production..."
  npx next build
  echo "▶  starting prod server on http://localhost:$PORT"
  exec npx next start -p "$PORT"
else
  echo "▶  starting dev server on http://localhost:$PORT"
  exec npx next dev -p "$PORT"
fi
