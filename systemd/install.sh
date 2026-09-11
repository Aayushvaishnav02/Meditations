#!/usr/bin/env bash
# Install user-level systemd timers for the journal rollups (EndeavourOS/Linux).
# No root required: units live in ~/.config/systemd/user/.
set -euo pipefail

UNIT_DIR="${HOME}/.config/systemd/user"
mkdir -p "$UNIT_DIR"

for unit in journal-daily.service journal-daily.timer \
            journal-weekly.service journal-weekly.timer \
            journal-monthly.service journal-monthly.timer; do
  cp "$(dirname "$0")/$unit" "$UNIT_DIR/"
done

systemctl --user daemon-reload
systemctl --user enable --now journal-daily.timer journal-weekly.timer journal-monthly.timer

echo "Installed. Status:"
systemctl --user list-timers 'journal-*' --no-pager
echo
echo "Logs: journalctl --user -u journal-daily.service"
echo "Note: rollups only run while the backend API is reachable on port 8000."
