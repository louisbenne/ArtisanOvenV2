#!/bin/sh
# Nightly pg_dump → /backups, keeping last 14 days.
# Mount Backblaze B2 or any S3-compatible bucket at /backups for off-site copies.

set -e

DATE=$(date +%Y-%m-%d)
FILE="/backups/artisanoven-${DATE}.sql.gz"

pg_dump -h db -U artisanoven -d artisanoven | gzip > "$FILE"
echo "[backup] Wrote $FILE"

# Prune files older than 30 days.
find /backups -name "*.sql.gz" -mtime +14 -delete
echo "[backup] Pruned old backups."
