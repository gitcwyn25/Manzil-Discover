#!/bin/sh
set -eu
mkdir -p /persist/data/logs /persist/uploads/files /persist/uploads/covers \
  /persist/uploads/avatars /persist/uploads/photos /persist/uploads/journey /persist/uploads/places
chown -R node:node /persist/data /persist/uploads
exec /usr/local/bin/trek-entrypoint
