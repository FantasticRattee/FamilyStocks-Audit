import assert from "node:assert/strict";
import test from "node:test";

import {
  createPersistedWorkbookRecord,
  isPersistedWorkbookRecord,
} from "../app/dashboard/persisted-workbook";

test("creates an isolated, versioned record for the latest imported workbook", () => {
  const sourceBytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const record = createPersistedWorkbookRecord(
    "latest-audit.xlsx",
    sourceBytes,
    "2026-07-16T01:39:00.000Z",
  );

  assert.equal(record.filename, "latest-audit.xlsx");
  assert.equal(record.savedAt, "2026-07-16T01:39:00.000Z");
  assert.notEqual(record.bytes, sourceBytes);
  assert.deepEqual([...new Uint8Array(record.bytes)], [1, 2, 3, 4]);
  assert.equal(isPersistedWorkbookRecord(record), true);
  assert.equal(
    isPersistedWorkbookRecord({ ...record, schemaVersion: 999 }),
    false,
  );
});
