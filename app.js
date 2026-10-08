// Fitness Challenge Deck — app wiring.
//
// Card *content* comes from a published Google Sheet (sheet-config.js, sheet-source.js).
// Card *state* — which cards are open, and the global 1-per-day counter — lives in
// Firestore (board-store.js). On load, the first visitor after a cooldown window
// reconciles the sheet into Firestore (card-sync.js); everyone else just reads the board.
//
// A sheet problem is never fatal: the board still renders whatever Firestore holds, with
// a banner explaining that it may be stale.

import { SHEET_CSV_URL, SYNC_COOLDOWN_MS, isSheetConfigured } from "./sheet-config.js";
import { fetchChallenges, hashChallenges } from "./sheet-source.js";
import { diffCards, isDiffEmpty, isSyncDue } from "./card-sync.js";
import {
  DAILY_LIMIT,
  applyCardDiff,
  openCard,
  readStoredCards,
  readSyncMeta,
  resetBoard,
  subscribeCards,
  subscribeDailyCount,
  todayStr,
} from "./board-store.js";
import * as ui from "./board-ui.js";

let latestCards = [];
let latestDailyCount = null;

function remainingToday() {
  const today = todayStr();
  const usedToday =
    latestDailyCount && latestDailyCount.date === today ? latestDailyCount.count : 0;
  return Math.max(0, DAILY_LIMIT - usedToday);
}

function rerender() {
  const remaining = remainingToday();
  ui.renderBoard(latestCards, { remainingToday: remaining, onOpen: handleOpen });
  ui.renderStatus({ remainingToday: remaining, cards: latestCards });
}

async function handleOpen(card) {
  try {
    await openCard(card.id);
    return true;
  } catch (err) {
    ui.showToast(err.message || "Could not open card.");
    return false;
  }
}

async function handleReset() {
  if (!ui.confirmReset(latestCards.length)) return;

  try {
    await resetBoard();
    ui.showToast(`Board reset! All ${latestCards.length} cards are closed again.`);
  } catch (err) {
    console.error(err);
    ui.showToast(err.message || "Could not reset the board.");
  }
}

/**
 * Pulls the sheet into Firestore when the cooldown has elapsed. Safe to run from every
 * visitor: concurrent syncs compute the same diff, so the writes are idempotent.
 *
 * @returns {Promise<string|null>} A notice to show the user, or null when all is well.
 */
async function syncFromSheet() {
  if (!isSheetConfigured(SHEET_CSV_URL)) {
    return "⚙️ No challenge sheet configured yet — set SHEET_CSV_URL in sheet-config.js.";
  }

  if (!isSyncDue(await readSyncMeta(), { cooldownMs: SYNC_COOLDOWN_MS })) return null;

  const sheetCards = await fetchChallenges(SHEET_CSV_URL);
  const sourceHash = hashChallenges(sheetCards);
  const diff = diffCards(sheetCards, await readStoredCards());

  // Even an empty diff is written, so the next visitor honours the cooldown.
  await applyCardDiff(diff, { sourceHash });

  if (!isDiffEmpty(diff)) ui.showToast("Board updated from the challenge sheet.");
  return null;
}

async function init() {
  ui.bindResetButton(handleReset);

  subscribeCards(
    (cards) => {
      latestCards = cards;
      rerender();
    },
    (err) => {
      console.error(err);
      ui.renderLoadError(
        "Could not load the board. Check firebase-config.js and your Firestore setup."
      );
    }
  );

  subscribeDailyCount(
    (meta) => {
      latestDailyCount = meta;
      rerender();
    },
    (err) => console.error(err)
  );

  try {
    const notice = await syncFromSheet();
    if (notice) ui.showSyncNotice(notice);
  } catch (err) {
    console.error("Sheet sync failed:", err);
    ui.showSyncNotice(`⚠️ ${err.message} Showing the last synced board.`);
  }
}

init();
