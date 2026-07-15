export const PERSISTED_WORKBOOK_SCHEMA_VERSION = 1 as const;

export type PersistedWorkbookRecord = {
  schemaVersion: typeof PERSISTED_WORKBOOK_SCHEMA_VERSION;
  filename: string;
  bytes: ArrayBuffer;
  savedAt: string;
};

export type PersistedWorkbookLoadResult =
  | { status: "restored"; record: PersistedWorkbookRecord }
  | { status: "empty" | "invalid" | "unavailable" | "error" };

export type PersistedWorkbookSaveResult = "saved" | "unavailable" | "error";

const DATABASE_NAME = "family-stocks-audit";
const DATABASE_VERSION = 1;
const STORE_NAME = "workbooks";
const ACTIVE_WORKBOOK_KEY = "active-imported-workbook";

export function createPersistedWorkbookRecord(
  filename: string,
  bytes: ArrayBuffer,
  savedAt: string,
): PersistedWorkbookRecord {
  return {
    schemaVersion: PERSISTED_WORKBOOK_SCHEMA_VERSION,
    filename,
    bytes: bytes.slice(0),
    savedAt,
  };
}

export function isPersistedWorkbookRecord(
  value: unknown,
): value is PersistedWorkbookRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PersistedWorkbookRecord>;
  return (
    record.schemaVersion === PERSISTED_WORKBOOK_SCHEMA_VERSION &&
    typeof record.filename === "string" &&
    record.filename.length > 0 &&
    record.bytes instanceof ArrayBuffer &&
    record.bytes.byteLength > 0 &&
    typeof record.savedAt === "string" &&
    !Number.isNaN(Date.parse(record.savedAt))
  );
}

const openDatabase = async (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === "undefined") return null;

  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
};

const readActiveRecord = (database: IDBDatabase): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(ACTIVE_WORKBOOK_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not read saved workbook"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Saved-workbook read was aborted"));
  });

const writeActiveRecord = (
  database: IDBDatabase,
  record: PersistedWorkbookRecord,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record, ACTIVE_WORKBOOK_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Could not save workbook"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Saved-workbook write was aborted"));
  });

const deleteActiveRecord = (database: IDBDatabase): Promise<void> =>
  new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(ACTIVE_WORKBOOK_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Could not remove saved workbook"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Saved-workbook removal was aborted"));
  });

export async function loadPersistedWorkbook(): Promise<PersistedWorkbookLoadResult> {
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database) return { status: "unavailable" };
    const record = await readActiveRecord(database);
    if (record === undefined) return { status: "empty" };
    if (!isPersistedWorkbookRecord(record)) return { status: "invalid" };
    return {
      status: "restored",
      record: createPersistedWorkbookRecord(
        record.filename,
        record.bytes,
        record.savedAt,
      ),
    };
  } catch {
    return { status: "error" };
  } finally {
    database?.close();
  }
}

export async function savePersistedWorkbook(
  filename: string,
  bytes: ArrayBuffer,
  savedAt: string,
): Promise<PersistedWorkbookSaveResult> {
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database) return "unavailable";
    await writeActiveRecord(
      database,
      createPersistedWorkbookRecord(filename, bytes, savedAt),
    );
    return "saved";
  } catch {
    return "error";
  } finally {
    database?.close();
  }
}

export async function removePersistedWorkbook(): Promise<void> {
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database) return;
    await deleteActiveRecord(database);
  } catch {
    // Recovery must remain non-blocking when browser storage is unavailable.
  } finally {
    database?.close();
  }
}
