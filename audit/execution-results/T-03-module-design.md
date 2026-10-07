# T-03 module integration contract — 2026-10-07

This module stage is locally verified; server reader/writer integration and end-to-end acceptance remain pending. No production database, historical content, deployment secret or environment file was accessed.

## Explicit version discriminators

The reader must pass the persisted field version to `decrypt(value, context, version)`. Version 0 returns the original string without inspecting its prefix or JSON shape. This includes historical plaintext beginning `apc:` and literal text that looks exactly like a valid envelope, even under another key. Version 1 requires the authenticated envelope, matching key identifier and matching field context. Missing or unknown versions, missing prefix, malformed envelopes or authentication failures throw a content-free error. There is no fallback from version 1 to plaintext.

Proposed additive columns for the reader integration:

```sql
ALTER TABLE feedbacks ADD COLUMN original_content_storage_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedbacks ADD COLUMN solution_storage_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedback_comments ADD COLUMN content_storage_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN content_storage_version INTEGER NOT NULL DEFAULT 0;
```

Apply each only when absent. These additions classify existing rows as legacy without altering their content. Feedback body and solution use separate flags: updating an old solution must not implicitly migrate its old body. A notification's title and body share one flag because they are created together and neither field currently has an update operation.

New writes set the affected flag to `codec.storageVersion`: 1 with a configured independent key, 0 for the keyless synthetic demo. Any nonempty new sensitive formal field must be encrypted before persistence. Empty unused solution remains a version 0 empty sentinel until first actual solution write. The obsolete client `encrypted_content` package must not be persisted for new formal submissions because it contains its own key; use a nonsensitive server-storage marker for that compatibility field.

## Key marker and binding

`assertDatabaseKey(db)` creates `content_encryption_metadata(id, key_id, key_check)`. Its fixed version 1 `key_check` is an authenticated known string bound to `content_encryption_metadata:key_check`. It contains no content key. Missing/wrong key or corrupted check fails before replacing any marker. Markerless databases inspect only explicitly version 1 fields for key compatibility; old schemas and version 0 collisions are preserved. Unknown field versions fail validation even with a valid key marker.

Call key configuration early and database verification after additive schema checks, before accepting HTTP traffic. Persist field contexts deterministically, including table/field and the relevant feedback ID; use additional stable recipient/type identity for notifications. Read and write paths must construct identical contexts. Never include mutable state, IP, content or current time unless the exact value is persisted and included on reads.

## Reader and writer rollback points

1. Reader-only commit: add compatible field flags and authorized decode paths. Preserve old writes and content; test legacy collisions and manually constructed version 1 fixtures. Returning to the pre-reader binary is safe only while there are no version 1 business writes.
2. Writer commit: encrypt new content and set flags atomically with each business write. Keep accepting existing request fields during the compatibility period. Existing historical version 0 content stays untouched; T-32 owns migration.
3. After version 1 business writes exist, roll back only to the compatible reader and disable formal writes. Preserve the version columns, encrypted content, key marker and external key. The old pre-reader binary cannot correctly read new records.
4. Restore database and key from separate authorized locations and verify the marker before opening traffic. Missing or mismatched key requires the correct external key; never replace the key or stored ciphertext to make startup succeed. Key destruction renders sealed content unrecoverable.

T-41 owns complete multitable transaction acceptance. T-03 must additionally prepare or encrypt all affected content inside the accepted transaction so an encryption failure cannot produce a successful response or partial business writes. T-04 remains a separate client fallback and failure-path task.

## Local evidence

Node 22.23.3; `tsx --test --test-concurrency=1 tests/fix/T-03.test.ts`: 10/10 module cases passed. Both frontend/backend type checks passed. Tests use in-memory fixture databases and explicit synthetic keys; vectors include a standard AES-256-GCM ciphertext with an independently calculated tag for the documented AAD, 2,000 nonce samples, key mismatch, tag/cipher/nonce corruption, version checks, exact legacy prefix collisions and mixed old-body/new-solution records. API, WAL/export/log confidentiality scans, browser flows and restoration remain for the integration stage.
