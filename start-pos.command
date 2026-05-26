#!/bin/bash
# ---------------------------------------------------------------
# Hardware POS — Kiosk Print Mode Launcher
# Double-click this file to launch the POS with direct printing
# (no Chrome/Brave print dialog — prints to default printer)
# ---------------------------------------------------------------

POS_URL="http://localhost:5173"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Start the dev server in the background if not already running
if ! lsof -i :5173 > /dev/null 2>&1; then
  echo "Starting POS dev server..."
  cd "$PROJECT_DIR"
  npm run dev &
  DEV_PID=$!
  # Wait for the server to be ready
  echo "Waiting for server to start..."
  for i in {1..30}; do
    if lsof -i :5173 > /dev/null 2>&1; then
      echo "Server is ready!"
      break
    fi
    sleep 1
  done
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
echo "✓ POS launched with direct printing enabled."
echo "  Any print action will go straight to your default printer."
echo "  Set your barcode/receipt printer as default in System Settings."
echo ""
echo "Press Ctrl+C to stop the server, or close this window."
wait
