#!/usr/bin/env bash
# Converts a Diet Pro Access database (dp20.mdb) into the CSV layout that
# `dietpro import -csv` expects. Requires mdbtools (`brew install mdbtools`,
# `apt install mdbtools`).
#
#   scripts/mdb-to-csv.sh path/to/dp20.mdb out-dir
set -euo pipefail
mdb="${1:?usage: $0 dp20.mdb out-dir}"
out="${2:?usage: $0 dp20.mdb out-dir}"
command -v mdb-tables >/dev/null || { echo "mdbtools is not installed" >&2; exit 1; }
mkdir -p "$out"
mdb-tables -1 "$mdb" | while IFS= read -r table; do
  [ -n "$table" ] || continue
  # Four-digit years, matching the original Access export.
  mdb-export -D '%m/%d/%Y' -T '%m/%d/%Y %H:%M:%S' "$mdb" "$table" > "$out/$table.csv"
  echo "exported $table"
done
