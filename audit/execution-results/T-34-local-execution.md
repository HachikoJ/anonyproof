# T-34 local atomic deletion acceptance

## Implemented boundary

`server/index.ts`, `DELETE /api/admin/feedback/:id`: one SQLite immediate transaction checks the existing authorized scope, deletes linked `feedback_comments` and all `notifications` recipients, deletes the parent feedback, updates statistics, and records the deletion audit. Any SQL failure rolls back all five tables. A repeated or unauthorized-scope deletion returns 404 without a deletion audit or statistics change. Existing administrator authentication, demo ownership, immutable template rules and Origin protection remain applicable.

The deletion audit retains `action=delete`, `target_id`, `created_at` and the existing generated audit ID. The compatibility `admin_ip NOT NULL` column is an empty string. No feedback body, comment, solution or notification text is copied to the audit.

Existing child tables have no foreign keys. This change explicitly deletes children under the write reservation rather than rebuilding existing tables or adopting historical data. No historical orphan cleanup, production DB, backup, deployment, server configuration or real user record was touched. Synthetic pre-existing unrelated orphans are deliberately retained and compared row-for-row.

## Reproduce

Run from the repository root with the existing Node 22 runtime:

```sh
export PATH="/tmp/anonyproof-runtime-22/node_modules/node/bin:$PATH"
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-34.test.ts tests/fix/T-01.test.ts tests/fix/T-41.test.ts tests/fix/T-26.test.ts
npx --no-install tsc --noEmit --strict --skipLibCheck --esModuleInterop --target ES2022 --module CommonJS --moduleResolution node $(rg --files server -g '*.ts' -g '!node_modules')
```

The test helper creates independent temporary synthetic DBs and starts the actual backend. Faults are SQLite fixture-only triggers; there is no production fault hook.

## Actual results

- Before repair: `T-34-before-independent-faults.txt`, exit 1, 2 passed and 8 failed, no skip. The earlier `T-34-before.txt` is retained; its reused failing target caused later 404 failures, so the subsequent independent-fixture run is the precise baseline.
- First repaired T-34 run: `T-34-tests.txt`, exit 0, 10 passed and 0 failed/skipped.
- Latest related run, including the added unrelated-orphan preservation assertions: `T-34-regressions.txt`, exit 0, 28 passed, 0 failed and 1 explicit existing T-41 deletion skip. T-34 itself has 10 passing assertions/test cases and no skip. The old T-41 skip is not counted as deletion acceptance.
- Actual full backend strict type check: `T-34-backend-type.txt`, exit 0.

The passing matrix proves removal of comments and both user/admin notification recipients; HTTP feedback/detail/comment/notification invisibility; one minimal deletion audit; retained feedback, shared templates and another identity's data unchanged; unauthenticated/user-cookie rejection; demo cross-identity rejection; repeated 404; exact business snapshots after six independent trigger failures (audit insert, comment deletion, admin notification deletion, user notification deletion, parent deletion and statistics update); and business health after failures.

`PRAGMA foreign_key_check` is empty for synthetic fixtures. Because legacy child tables have no declared foreign keys, that check alone cannot certify absence of historical orphans; explicit row assertions certify the deletion target's children are gone.

## Remaining acceptance / rollback

Local route and synthetic rollback acceptance have passed. Whole T-34 remains incomplete until the separately approved historical-asset workflow has a consistent snapshot, exact orphan counts and retention/disposal decision, executes only the approved historical cleanup, verifies resulting counts and checks an independent restore copy. Production deployment is also outside this local execution. The current fix is a reversible code change; historical deletion will require recovery from the approved consistent snapshot and cannot be recovered by reverting this route.
