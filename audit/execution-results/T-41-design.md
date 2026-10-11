# T-41 implementation boundary and fault evidence — 2026-10-07

T-12/T-13/T-14/T-19 prerequisites are implemented. This preparation adds fixture tests and documentation only. It does not change routes, helpers, the encryption codec, the plan or dependencies; no commit or deployment was made.

## Minimum route changes

1. `POST /api/feedback`: preserve authentication and input validation. In one existing `better-sqlite3` synchronous transaction, insert the feedback, update the business `stats` row and create its required admin notification. Return `{success, id, timestamp}` only after the transaction commits. Any statistics or notification error must propagate to the existing controlled 500 response and roll back all business writes.
2. `addFeedbackComment()` for both user/admin routes: preserve authorization and validation. In one synchronous transaction, insert the comment and create its required notification. Return the generated comment ID from the transaction, then construct the HTTP response after commit. No separate transaction/commit for the notification.
3. `PUT /api/admin/feedback/:id/status`: inside one transaction, read the current authorized record, compare actual state/solution, append the audit action, update status/solution and create any required status notification. Do not send HTTP responses inside the transaction. If the record disappeared or became inaccessible, return the normal not-found outcome without business writes. Repeated identical status and solution must not create another notification. Existing audit semantics for an attempted repeated authorized operation can remain; the test does not require suppressing that audit.
4. `createNotification()`: remove its error-swallowing catch. Keep its explicitly justified synthetic-template recipient exclusion. Actual notification insertion errors propagate into the caller's transaction. Do not convert a required-notification failure into a successful response.
5. Leave optional access logging in its separate connection/transaction and existing caught `finish` handler. Its failure must not undo a committed business operation or make the successful response fail. Business `stats` and administrator audit writes remain required transaction members.

Prefer `.immediate()` for these write transactions so current-record comparison occurs after acquiring the SQLite write reservation. Keep all statements on the same existing route DB connection. Do not put network requests, awaits or response writes inside the transaction. No queue, new transaction framework, idempotency table or architectural extraction is needed.

T-03 can prepare/encrypt its affected fields within these accepted transactions; any cipher/key error then propagates and rolls back the same operation. T-03 version/at-rest confidentiality and T-04 client fallback acceptance remain separate. T-42 owns request replay deduplication; it is not implemented or inferred from this work.

## Deletion dependency

`DELETE /api/admin/feedback/:id` currently writes its delete audit, removes only the feedback and updates stats separately. T-34 owns the approved deletion semantics, dependent comments/notifications and the deletion transaction. The prepared T-41 deletion fault matrix is explicitly skipped until T-34 implementation/confirmation permits activation; it must not be counted as a passed acceptance. It checks failure at audit insertion, comment deletion, notification deletion, parent deletion and stats update, preserving all related rows and fields on every failure. This preparation does not change or execute the deletion policy.

## Actual pre-fix test evidence

Command, using project-local Node 22.23.3:

```sh
export PATH="/tmp/anonyproof-runtime-22/node_modules/node/bin:$PATH"
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-41.test.ts
```

Actual exit 1; 15 cases including subtests: 5 passed, 9 failed, 1 explicitly skipped. `T-41-before-tests.txt` preserves the real failure output. Failures reproduce:

- `stats` UPDATE failure leaves the feedback row behind.
- Required notification INSERT failures return 200 for feedback, user comments, admin comments and status changes.
- Feedback status UPDATE failure leaves an `update_status` audit row behind.
- Later success/count checks also fail after these partial writes; these are consequences of the above injected failures.

The optional access-log failure case passes with feedback/comment/status success, correct business counts and health 200. The fixture exclusively uses a fresh temporary DB and explicit synthetic content key; faults are SQLite triggers carrying `T41_FIXTURE_ONLY`. There is no production fault header, public debug route, real environment read or production database access.

Both `npm run type-check` and `npm --prefix server run type-check` passed after creating the tests. A first fixture cleanup ordering error was corrected before capturing the retained pre-fix evidence; retained output represents the corrected executable tests.

## Integration sequence and rollback

After T-01 releases `server/index.ts`, implement feedback transaction and run its fault/success cases; then comment transaction and both actor cases; then status transaction and repeated-state cases. Keep the final route changes in an independent T-41 commit after all executable acceptance passes. Do not count skipped deletion acceptance as complete.

Rollback to the pre-transaction code changes no already committed content or schema. It restores the known partial-write defect, so retain the accepted transaction version when T-03 starts writing encrypted content. Every committed implementation step should preserve existing successful API response shapes and the compatibility reader.
