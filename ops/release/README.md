# OGC Release Toolkit (`ops/release/`)

NON-PRODUCTION release hardening for the **synthetic public demo** at `ogc.eduos.vn`.
Fail-closed shell + Node scripts for a commit-pinned, verifiable, atomically-promoted,
rollback-able release of the static SPA (mock adapter). No secrets, no production
credentials, no backend/DB. Built under OGC-ENG-AUTH-017 Track B.

## Scripts
| Script | Purpose |
|---|---|
| `lib.sh` | Shared fail-closed helpers: `assert_safe_abs` (reject empty/relative/`/`/`..`), `assert_full_sha` (40-hex only), `assert_not_live` (refuse the live VM root unless `OGC_LIVE=1`). |
| `release-checkout.sh <repo> <sha> <dest>` | Non-destructive, SHA-pinned snapshot via `git archive` (never touches the source working tree). Writes `.release-sha`. |
| `build-manifest.sh <src> <manifest_out>` | Build `apps/web` with the **mock adapter only** (rejects any other `OGC_BUILD_MODE`); emit a SHA-256 asset manifest. |
| `make-manifest.mjs` / `verify-artifact.mjs` | Manifest generation / independent re-hash verification. |
| `verify-artifact.sh <dist> <manifest>` | Fail-closed integrity check: rejects invalid manifest, non-mock mode, missing / size- or sha-mismatched assets. |
| `verify-https.sh <https-url> [substr]` | Certificate-validating HTTPS check (never `-k`); confirms 200 + expected substring. Optional `OGC_CACERT` validates against a provided CA. |
| `smoke-routes.mjs [dist]` | Playwright browser smoke of major routes (landing, login, staff/teacher/learner/guardian/catalog) on a locally served dist. |
| `promote.sh <root> <sha>` | Atomic symlink promotion (temp symlink + rename in the same fs); records the previous sha; never deletes release dirs. |
| `rollback.sh <root> [sha]` | Atomic rollback to an explicit sha or the recorded `.previous`; prints before/after evidence. |

## Tests
`node ops/release/test/release.test.mjs` — happy paths **and** failure scenarios (bad sha,
unsafe paths, tampered/missing assets, invalid manifest, non-mock mode, untrusted cert,
non-200, non-HTTPS, missing release dir, live-root refusal, promote→rollback rehearsal).
Wired into `ci/local-ci.sh` and `.github/workflows/ci.yml`. The browser smoke self-skips
where Playwright is unavailable (non-blocking), like the repo's E2E gates.

## End-to-end release-candidate flow (dev / staging — NOT the live VM)
```bash
STAGE=/tmp/ogc-stage ; SHA=<40-hex>
ops/release/release-checkout.sh "$PWD" "$SHA" "$STAGE/work/$SHA"
ops/release/build-manifest.sh   "$STAGE/work/$SHA" "$STAGE/manifests/$SHA.json"
ops/release/verify-artifact.sh  "$STAGE/work/$SHA/apps/web/dist" "$STAGE/manifests/$SHA.json"
node ops/release/smoke-routes.mjs "$STAGE/work/$SHA/apps/web/dist"
mkdir -p "$STAGE/releases/$SHA" && cp -a "$STAGE/work/$SHA/apps/web/dist/." "$STAGE/releases/$SHA/"
ops/release/promote.sh "$STAGE" "$SHA"      # atomic swap in staging
ops/release/rollback.sh "$STAGE"            # rehearse rollback to the previous release
```

## Live promotion (ON THE VM, explicit owner approval only)
The toolkit **refuses** the live root `/var/www/ogc` unless `OGC_LIVE=1` is set by an
operator on the VM. A live promotion is an explicit, owner-approved step — Claude never
runs `promote.sh`/`rollback.sh` against the real VM (AUTH-017). The hardened live flow
replaces the earlier ad-hoc `git reset --hard` + manual `cp`/`ln`:
Layout on `eduos@ogc`:
- `/opt/ogc/src` — git object source only. `git fetch` it; never check out or build in it
  (its working tree may sit on an old commit — that is fine, `git archive` reads by SHA).
- `~/ogc-stage/work/<sha>` — SHA-pinned snapshot + build (`.release-sha` inside).
- `~/ogc-stage/manifests/<sha>.json` — the manifest of every release that went live.
- `/var/www/ogc/releases/<sha>` + `current` / `.previous` — the live root.

```bash
# on eduos@ogc, after owner approval, for a CI-passed SHA on main:
SHA=<40-hex> ; W=~/ogc-stage/work/$SHA ; M=~/ogc-stage/manifests/$SHA.json
git -C /opt/ogc/src fetch origin main
/opt/ogc/src/ops/release/release-checkout.sh /opt/ogc/src "$SHA" "$W"
"$W"/ops/release/build-manifest.sh  "$W" "$M"
"$W"/ops/release/verify-artifact.sh "$W/apps/web/dist" "$M"
node "$W"/ops/release/smoke-routes.mjs "$W/apps/web/dist"                    # self-skips without Playwright
sudo mkdir -p /var/www/ogc/releases/$SHA && sudo cp -a "$W/apps/web/dist/." /var/www/ogc/releases/$SHA/
"$W"/ops/release/verify-artifact.sh /var/www/ogc/releases/$SHA "$M"         # the copy, not just the build
sudo OGC_LIVE=1 "$W"/ops/release/promote.sh /var/www/ogc $SHA && sudo systemctl reload nginx
"$W"/ops/release/verify-https.sh https://ogc.eduos.vn "assets/"              # cert-validating
# rollback if needed: sudo OGC_LIVE=1 "$W"/ops/release/rollback.sh /var/www/ogc && sudo systemctl reload nginx
```
Run every script from the snapshot `"$W"`, so the toolkit version matches the release.

## Boundaries (AUTH-017)
Synthetic SPA (mock) only · no backend/DB/real data · no security-gate changes · no
automatic deployment · public promotion requires explicit owner approval.
