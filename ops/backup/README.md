# OGC Platform backups (VM 2)

Staging only, synthetic data. VM 2 = GCP project `pure-girder-515601-g9`, VM `ogc`, zone `asia-southeast1-c`.

## What runs

- `/etc/cron.d/ogc-backup-nightly`: at 02:30 center time (19:30 UTC), `root` runs `/usr/local/sbin/ogc-backup`
  (this script, `ops/backup/ogc-backup.sh`, installed from a pinned commit) with `OGC_BACKUP_BUCKET`.
- It dumps `ogc` and `iios_mock` (`pg_dump -Fc`, as `postgres`) to `/var/backups/ogc/<db>-<UTC>.dump`
  plus `ogc-backup-<UTC>.sha256`. Files are root-only (600, folder 700). Each dump must pass
  `pg_restore --list` before it is kept. Local copies older than 7 days are removed.
- Then it uploads the three files to `gs://ogc-backups-pure-girder-515601-g9/<UTC>/`:
  - with the VM's own service account `ogc-backup-writer`, which has `roles/storage.objectCreator`
    on this bucket only;
  - each upload asks GCS to refuse an existing name (`ifGenerationMatch=0`), and the stored size must
    match the local file;
  - the VM cannot list, read, overwrite or delete objects.
- The bucket is in `asia-southeast1`, with uniform access and public access prevented:
  - a **30-day retention policy**: no one can delete an object earlier;
  - a lifecycle rule deletes it at 31 days;
  - GCS encrypts at rest;
  - only the project owner reads it.
- Output goes to `/var/log/ogc-backup.log`; `/var/backups/ogc/last-ok` holds the last successful run.
- The data disk also has the daily snapshot schedule `ogc-platform-daily` (7 days, same project).

Worst case without the VM: about one day of data (one dump per night).

## Check a backup (does not touch the running databases)

The OPS-1 block (deploy log, wave 108) restores into throwaway databases `restore_check_*` and
compares every table with the running database. Rules learned there:

- Copy the dump into a folder owned by `postgres` and let `pg_restore` read the file.
- Never pipe a dump into `pg_restore --list`. It stops after the table of contents, the writer gets
  SIGPIPE (exit 141), and `pipefail` ends the block silently.
- Run blocks with `set -Eeuo pipefail` and `trap '…' ERR`, so a failure always prints its line.

## Restore for real (owner runs, staging)

Run on VM 2 inside `( set -Eeuo pipefail … )` with the usual project guard. Every step keeps the old
database until the end.

1. Get the dump.
   - From the VM: `/var/backups/ogc/ogc-<UTC>.dump`.
   - From the bucket, on your machine:
     `gcloud storage cp gs://ogc-backups-pure-girder-515601-g9/<UTC>/ogc-<UTC>.dump .`
     then copy it to the VM.
   - Check it: `sha256sum -c ogc-backup-<UTC>.sha256`.
2. Stop the services: `sudo systemctl stop ogc-api ogc-iios`.
3. Restore into a new database, keeping owners and grants (no `--no-owner`):
   `sudo -u postgres psql -c 'create database ogc_new owner ogc_owner'`, then
   `sudo -u postgres pg_restore --exit-on-error -d ogc_new <file>`.
4. Swap the names:
   `sudo -u postgres psql -c 'alter database ogc rename to ogc_old_<UTC>' -c 'alter database ogc_new rename to ogc'`.
5. Run the live release's migrate (`/etc/ogc/migrate.env`, as in a deploy). A dump from an older
   release gets the newer migrations here.
6. Start the services: `sudo systemctl start ogc-iios ogc-api`. Check `/v1/health` and sign in on
   https://app.ogc.eduos.vn.
7. When satisfied, `drop database ogc_old_<UTC>`.

`iios_mock` follows the same steps. Its owner is its own role, the database is `iios_mock`, and the
IIOS mock runs its own migrations when it starts.

Rehearsed on a copy of VM 2's state (24/11):

- the restore keeps `ogc_owner` as owner;
- migrate reports "applied 0 (none), already 18";
- `ogc_app` sees the classes only with `app.org_id` set (RLS still forced).
