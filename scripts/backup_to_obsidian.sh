#!/usr/bin/env bash
# Makes a zip snapshot of the project (no .git) and puts it into the Obsidian vault folder
# "12. Projects" — an extra safety layer independent of GitHub/GitLab accounts (the vault is
# synced to cloud storages, a disk, flash drives and a phone). Run it on every push:
#   bash scripts/backup_to_obsidian.sh
#   bash scripts/backup_to_obsidian.sh --dest "D:/Backups"     # another folder
#
# The archive is `git archive` of HEAD, so it needs no zip tool, can never contain .git, and
# is exactly the committed (= pushed) tree. File name: GeoPuzzle_<date>_<time>_<commit>.zip.
# If an archive of the same commit already exists nothing new is written.
set -euo pipefail

DEST='C:\Users\Skycader\Documents\Obsidian Vault\12. Projects'
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SRC"
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git project: $SRC" >&2; exit 1; }

# Accept Windows-style destinations ("C:\...") in Git Bash / MSYS.
if command -v cygpath >/dev/null 2>&1; then DEST_U="$(cygpath -u "$DEST")"; else DEST_U="$DEST"; fi
mkdir -p "$DEST_U"

HASH="$(git rev-parse --short=8 HEAD)"
existing="$(find "$DEST_U" -maxdepth 1 -name "GeoPuzzle_*_${HASH}.zip" | head -n 1)"
if [ -n "$existing" ]; then
  echo "backup already exists for commit $HASH: $existing"
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "warning: uncommitted changes are NOT in the archive (it holds commit $HASH exactly)" >&2
fi

OUT="$DEST_U/GeoPuzzle_$(date +%Y-%m-%d_%H%M)_${HASH}.zip"
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT
git archive --format=zip --prefix=GeoPuzzle/ -o "$TMP" HEAD
[ -s "$TMP" ] || { echo "backup FAILED: empty archive" >&2; exit 1; }
mv "$TMP" "$OUT"
trap - EXIT

echo "backup OK: $OUT ($(du -h "$OUT" | cut -f1), commit $HASH)"
