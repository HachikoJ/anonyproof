# T-36 extraction baseline after proxy fixture adaptation

Local Node v22.23.3 baseline recorded on 2026-10-09 UTC. This is local evidence, not remote CI or production acceptance. Product code was not edited by this baseline task.

| Gate | Actual result | Evidence |
| --- | --- | --- |
| Full numbered tests | Exit 0; 208 tests, 207 passed, 0 failed, 1 skipped; 136.346 seconds | `T-36-baseline-after-proxy-fixture.txt` |
| Frontend types | Exit 2; five TS2345 errors in `tests/fix/T-24.test.ts` | `T-36-baseline-frontend-types.txt` |
| Backend npm types | Exit 2; same five TS2345 errors | `T-36-baseline-backend-types.txt` |
| CI strict backend types | Exit 0 | `T-36-baseline-ci-strict-backend-types.txt` |
| Git diff check | Exit 0 | `T-36-baseline-diff-check.txt` |

The type failures are calls to `createProxyBoundary` at T-24.test.ts lines 11, 13, 14, 15 and 72. The test objects omit `NODE_ENV`, which is required by the merged `NodeJS.ProcessEnv` type. No type failure was repaired in this read-only baseline task. T-36 must not treat these two failed gates as passed.

The single skipped test is T-41's historical delete rollback placeholder: “Deletion transaction is independently verified by T-34.test.ts; historical asset handling remains separately gated.” A skip is not a pass. The active T-34 cases passed in this run.

The start HEAD was `a6b8b7ce832b14760c114c4685746202dafba5ee`; the end HEAD was `6fdbb05bf7314931e42663a4f6f4e2835742bc3c`. The commit also recorded FIX_PLAN and prior evidence files. The only source-code differences are the two adapted fixture files, which were already modified when testing started. Their current SHA256 values match the start values exactly:

- `tests/fix/T-22.integration.test.ts`: `938ee6303732218492f53f3eed36a37f2fcfaf2fc8214d5ecf3a592c7fd575f6` — unchanged.
- `tests/fix/T-33.test.ts`: `dd1a88b524d63287d61b0804ffdd91bc18488f7108b0965c3cd51fa7115e9c98` — unchanged.

The original `sourcesUnchangedDuringBaseline=false` is preserved because Git HEAD/diff membership changed. The added `sourceContentUnchanged=true` records the separate content check over the original file set; it does not rewrite the original result or claim every gate passed. Detailed commands, exit codes, log hashes, skip details, timestamps and original-result preservation path are in `T-36-baseline-after-proxy-fixture-result.json`.

## Follow-up type gate repair

The original failed logs and result fields above remain unchanged. A separate test-only follow-up explicitly sets `NODE_ENV: 'test'` on the five direct `createProxyBoundary` synthetic environment objects in `tests/fix/T-24.test.ts`, without casts or product edits. Those objects did not use NODE_ENV at runtime. The T-24/T-22/T-33 associated tests were rerun: 14 passed, 0 failed, 0 skipped. Frontend types, backend npm types, CI strict backend types and diff check each then returned exit 0.

Follow-up evidence: `T-24-fixture-types-after-result.json` and its five referenced logs. The 207-pass numbered baseline was not repeated because this explicit unused environment-field addition changes no HTTP behavior; the affected T-24 cases were rerun. This records a 207-pass/1-skip full HTTP baseline plus the subsequent successful type gates, rather than rewriting the original type failures as passes.
