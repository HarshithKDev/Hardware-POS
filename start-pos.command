#!/bin/bash
# ---------------------------------------------------------------
# Hardware POS — Kiosk Print Mode Launcher
# Double-click this file to launch the POS with direct printing
# (no Chrome/Brave print dialog — prints to default printer)
#
# Recommended: open the live (Vercel) app directly — no local server needed.
#   Set POS_URL below (or export it before running), e.g.
#   POS_URL="https://your-pos.vercel.app"
#
# If POS_URL is empty, a local PRODUCTION build is served (not the dev server,
# which is slower and behaves differently from what runs in the shop).
# ---------------------------------------------------------------

POS_URL="${POS_URL:-}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
POS_PORT=4173

if [ -z "$POS_URL" ]; then
  if ! lsof -i :$POS_PORT > /dev/null 2>&1; then
    cd "$PROJECT_DIR"
    echo "Building production version..."
    npm run build || { echo "Build failed."; exit 1; }
    echo "Starting local production server..."
    npx vite preview --port $POS_PORT --strictPort &
    echo "Waiting for server to start..."
    for i in {1..30}; do
      if lsof -i :$POS_PORT > /dev/null 2>&1; then
        echo "Server is ready on port $POS_PORT!"
        break
      fi
      sleep 1
    done
  fi
  POS_URL="http://localhost:${POS_PORT}"
fi

# Detect and launch browser with --kiosk-printing
if [ -d "/Applications/Brave Browser.app" ]; then
  echo "Launching Brave with kiosk printing..."
  open -a "Brave Browser" --args --kiosk-printing "$POS_URL"
elif [ -d "/Applications/Google Chrome.app" ]; then
  echo "Launching Chrome with kiosk printing..."
  open -a "Google Chrome" --args --kiosk-printing "$POS_URL"
else
  echo "No supported browser found. Please install Brave or Chrome."
  exit 1
fi

echo ""
echo "✓ POS launched with direct printing enabled at $POS_URL"
echo "  Any print action will go straight to your default printer."
echo "  Set your barcode/receipt printer as default in System Settings."
echo ""
echo "Press Ctrl+C to stop the server, or close this window."
wait
