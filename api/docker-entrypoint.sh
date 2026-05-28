#!/bin/sh
set -e

# Apply any pending migrations against the configured DATABASE_URL before boot.
npx prisma migrate deploy

exec node --enable-source-maps dist/main.js
