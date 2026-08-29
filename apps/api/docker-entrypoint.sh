#!/bin/sh
# docker-entrypoint.sh

# 1. Run migrations in production safely from the database package directory
echo "Applying database migrations..."
cd /app/packages/db
node ../../node_modules/prisma/build/index.js migrate deploy

# 2. Optionally seed the database when RUN_SEED is set to true
if [ "$RUN_SEED" = "true" ]; then
  echo "Seeding production database..."
  node dist/scripts/seed-database.js
fi

cd /app/apps/api

# 3. Start the application
echo "Starting application..."
exec node dist/index.js
