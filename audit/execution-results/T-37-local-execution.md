# T-37 local execution handoff

This is partial acceptance evidence. Do not mark T-37 complete until the native browser cases below are actually executed and recorded.

## Changes

- Administrative summary API: default limit 50, max 100, `(created_at DESC, id DESC)` cursor, cursor bound to normalized filters and authorized demo context, category/status/search on the entire authorized collection, separate global counts and filtered total.
- Fixed summary whitelist; body is the first 160 Unicode code points. Original text and solution are fetched through the existing authorized detail endpoint.
- Current admin UI uses server filters, cursor previous/next pages, global overview, separately fetched full detail, and notification/URL targets outside the current page without adding rows to that page.
- Parameter-free old clients retain legacy fields with a hard `LIMIT 100`; they cannot recover the old unbounded route by rolling the UI back.
- Index `idx_feedback_admin_cursor` supports stable ordered list reads. Encrypted body search deliberately scans/decrypts one row at a time, retains only a page, and creates no plaintext search index.

## Actually verified

Node 22 was selected with `export PATH="/tmp/anonyproof-runtime-22/node_modules/node/bin:$PATH"`.

- `npx --no-install tsx --test tests/fix/T-37.test.ts`: exit 0, 6 passed, 0 failed, 0 skipped; `T-37-final-tests.txt`.
- `npm run type-check`: exit 0; `T-37-type-final.txt`. Earlier attempt found the refresh button passing a MouseEvent to the new cursor argument, corrected with an explicit callback; failed output retained in `T-37-type.txt`.
- Backend strict check: `npx --no-install tsc --noEmit --target es2020 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck --strict $(rg --files server -g '*.ts' -g '!node_modules')`: exit 0; `T-37-server-type.txt`.
- Once both T-37 and T-38 UIs were ready, coordinator approved one shared build: `API_PROXY_TARGET=http://127.0.0.1:4000 npm run build`: exit 0; `T-37-T-38-production-build.txt`. Raw terminal formatting is retained outside the repository per `T-37-T-38-build-log-formatting.json`.
- `git diff --check -- app/foorpynona/page.tsx server/utils/adminFeedbackPagination.ts tests/fix/T-37.test.ts tests/fix/T-37.browser.ts`: exit 0.
- Point-in-time `lsof` found no listeners on 4000/3028/3030/3032/3034; result retained in `T-37-T-38-ports-before-browser.json`. Recheck before starting fixtures.

## Browser acceptance remaining

Harness `tests/fix/T-37.browser.ts` has not been started or accepted by this subtask. With the above built target and ports free, start `npx --no-install tsx tests/fix/T-37.browser.ts` (do not add `--build` concurrently). It launches only loopback synthetic backend 4000, production Next 3028, and edge 3030. URL, owned PID, and synthetic database path are emitted in `T-37-browser-fixture.json`; graceful SIGTERM stops these owned processes and preserves their output in the temp fixture directory. Synthetic password is declared in the harness and is not a production credential.

1. Login at `http://127.0.0.1:3030/anonyproof/foorpynona`. Expect total 1000, each status 250, list text `1000 条 · 当前页 50 条`, page 1.
2. Click `下一页`; expect page 2 and distinct 50 rows. `上一页` restores page 1. Previous disabled on first page; next disabled once a filter yields one result.
3. Fill search (label 搜索 / placeholder 内容或设备标识) with `NEEDLE-cross-page`. Expect one record T37-0007, full collection overview still 1000. Set 类型 投诉 / 状态 暂无法处理; matching total remains 1. A conflicting status produces 0.
4. Open that row. Full detail must include `FULL-BODY-END-7`, absent from the list's 160-point summary. Type a synthetic processing explanation of at least 10 characters, click `标记已办结`, and observe updated detail/global resolved=251/noSolution=249; filtered no_solution list becomes empty while the selected full detail remains available.
5. From default page 1 (T37-0007 is outside it), open 通知 then `T37 非当前页通知`. Expect T37-0007 full detail; no extra row is inserted into the currently displayed page, filters/page stay coherent, notification read request succeeds. Reload the resulting `?feedback=T37-0007` URL and confirm off-page detail survives authorized reload.
6. Inspect actual edge network evidence `T-37-browser-network.json`: paginated rowCount <= 50, correct full/filtered counts, full-detail length > 160, status/mark-read requests 200; no actual browser execution is implied merely by harness existence.

## Ownership / remaining integration

No FIX_PLAN status edits, commits, pushes, production operations or real database operations were performed by this subtask. T-39 now owns comments loading/request invalidation in both pages; main owns administrative 401 state cleanup. Those later changes require their own validation/rebuild before claiming the final worktree is accepted.
