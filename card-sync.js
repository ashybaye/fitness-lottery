// Reconciles the sheet's content against the cards already stored in Firestore.
//
// Content lives in the sheet; state (status / openedDate) lives in Firestore. So a diff
// here only ever touches `text` and `order`:
//
//   create — an id in the sheet that Firestore doesn't have yet, added as 'closed'
//   update — an id in both, whose text or row position changed
//   delete — an id Firestore has that the sheet no longer lists
//
// Cards are matched by their sheet `id`, so rows can be reordered or inserted without an
// already-opened card's state landing on a different challenge. Renaming an id is
// therefore a delete plus a create, and loses that card's opened state.
//
// This module is deliberately free of Firebase and DOM dependencies so it can be unit
// tested directly. board-store.js turns a diff into actual Firestore writes.

// Firestore allows at most 500 writes in a single batched commit.
export const MAX_BATCH_WRITES = 500;

// Every sync also writes the meta/sheetSync bookkeeping doc in the same batch.
const SYNC_META_WRITES = 1;

/**
 * @param {{ id: string, text: string, order: number }[]} sheetCards
 * @param {{ id: string, text: string, order: number }[]} storedCards
 * @returns {{ creates: object[], updates: object[], deletes: string[] }}
 */
export function diffCards(sheetCards, storedCards) {
  const stored = new Map(storedCards.map((card) => [card.id, card]));
  const creates = [];
  const updates = [];

  for (const card of sheetCards) {
    const existing = stored.get(card.id);

    if (!existing) {
      creates.push({
        id: card.id,
        order: card.order,
        text: card.text,
        status: "closed",
        openedDate: null,
      });
      continue;
    }

    const changes = {};
    if (existing.text !== card.text) changes.text = card.text;
    if (existing.order !== card.order) changes.order = card.order;
    if (Object.keys(changes).length > 0) updates.push({ id: card.id, changes });
  }

  const inSheet = new Set(sheetCards.map((card) => card.id));
  const deletes = storedCards.map((card) => card.id).filter((id) => !inSheet.has(id));

  return { creates, updates, deletes };
}

/**
 * @param {{ creates: object[], updates: object[], deletes: string[] }} diff
 * @returns {boolean} True when the sheet and Firestore already agree.
 */
export function isDiffEmpty(diff) {
  return diff.creates.length === 0 && diff.updates.length === 0 && diff.deletes.length === 0;
}

export function countDiffWrites(diff) {
  return diff.creates.length + diff.updates.length + diff.deletes.length;
}

/**
 * Guards against a sheet edit too large to apply atomically. Throws rather than writing a
 * partial board.
 */
export function assertDiffFitsBatch(diff) {
  const writes = countDiffWrites(diff) + SYNC_META_WRITES;

  if (writes > MAX_BATCH_WRITES) {
    throw new Error(
      `This sheet change needs ${writes} writes, over Firestore's ${MAX_BATCH_WRITES}-write ` +
        "batch limit. Apply it to the sheet in smaller steps."
    );
  }
}

/**
 * Whether a visitor's browser should re-fetch the sheet, or trust the last sync.
 *
 * @param {{ lastSyncedAt?: number } | null | undefined} syncMeta Contents of meta/sheetSync.
 * @param {{ now?: number, cooldownMs: number }} options
 */
export function isSyncDue(syncMeta, { now = Date.now(), cooldownMs }) {
  const lastSyncedAt = syncMeta?.lastSyncedAt;
  if (typeof lastSyncedAt !== "number" || !Number.isFinite(lastSyncedAt)) return true;

  // A clock skewed into the future would otherwise suppress syncing indefinitely.
  if (lastSyncedAt > now) return true;

  return now - lastSyncedAt >= cooldownMs;
}
