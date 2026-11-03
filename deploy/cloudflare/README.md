# Cloudflare deployment and restore

The Worker routes the app to one named container. The container uses a private R2 checkpoint
through an authenticated Worker endpoint. The checkpoint includes SQLite metadata and saved
manifests, simulation traces and thumbnails. The application fails startup if it cannot
restore that data. Use a separate Worker and bucket for staging.

## Deploy

1. Authenticate Wrangler and start a Docker-compatible daemon. The account must have Containers and R2 enabled.
2. Create the private bucket `protolab-production` if it does not already exist.
3. For a first migration, use SQLite's online backup API to copy `protolab.sqlite` and take a copy of
   `store/`. Verify SQLite integrity and that all version manifests referenced by the database
   exist in the copied store. Archive those two entries at the root of a gzip-compressed tar file.
   Upload it with Wrangler to both `checkpoints/current.tar.gz` and a unique
   `checkpoints/import-<timestamp>.tar.gz` key. Leave the import copy in place.
4. Deploy with `npx wrangler deploy --secrets-file /path/to/private-secrets.json`. The initial
   deployment requires `MODEL_API_KEY`, `PROTOLAB_CHECKPOINT_TOKEN` (a random 32-byte hex token),
   and `PROTOLAB_CHECKPOINT_URL` (the canonical HTTPS Worker URL plus `/_internal/checkpoint`).
   Wrangler retains existing secrets on subsequent deployments. Keep this file outside the
   repository and build context.
5. Run `npm run preflight -- --api <url> --web <url>`. Rehearse a fresh build from a signed-out
   browser, then verify the same build and the imported replay links after a container restart.

Existing private inventions are still owned by their original browser session. A new origin
creates a new session. To carry ownership, transfer the browser's `protolab.session` Local Storage
value from the old origin to the new origin in the same trusted browser, then reload the new
origin. Treat the value like a password and keep it out of links, logs, or shared screenshots.

## Recovery

Download the current checkpoint to a fresh directory before restoring any older one. Verify the
gzip archive, SQLite integrity, and referenced manifest paths. Stop traffic to the writing
container before replacing `checkpoints/current.tar.gz`, and start a fresh container afterward.
A running instance can otherwise overwrite the replacement with its next checkpoint.
The pre-migration import remains at its separate R2 key. Archives contain private creations and
session identifiers, so keep the bucket and backups private.

The archive checkpoint is designed for a single writer and small demo data. It uploads the whole
archive for each checkpoint and has a 90 MiB cap. For longer-term use, move version traces to
immutable R2 objects and checkpoint metadata independently.
