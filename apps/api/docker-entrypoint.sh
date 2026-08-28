#!/bin/sh
# docker-entrypoint.sh

# 1. Run migrations in production safely from the database package directory
echo "Applying database migrations..."
cd /app/packages/db
node ../../node_modules/prisma/build/index.js migrate deploy
cd /app/apps/api

# 2. Start the application
echo "Starting application..."
exec node dist/index.js
