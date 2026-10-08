// Where the card content comes from.
//
// The board's challenges live in a Google Sheet, not in this repo. To wire yours up:
//
//   1. Create a sheet whose first row is exactly:  id | text
//      - `id` is a short, stable, unique slug (e.g. `yoga-40`). It becomes the card's
//        Firestore document id, so keep it stable — changing it is treated as deleting
//        one card and creating another, which loses that card's opened state.
//      - `text` is the challenge shown on the card.
//   2. File → Share → Publish to web → pick that sheet → Comma-separated values (.csv).
//   3. Paste the generated URL below.
//
// `challenges.csv` in this repo is an export of the deck that's already live, ready to
// import into a new sheet via File → Import. Its ids match the existing Firestore
// document ids, so importing it as-is keeps every opened card's state.
//
// Note: publishing makes that sheet readable by anyone who has the URL, and the URL ships
// in this file to every visitor. Don't put anything private in the sheet.

export const SHEET_CSV_URL = "PASTE_YOUR_PUBLISHED_CSV_URL_HERE";

// How long to wait before any visitor's browser re-fetches the sheet. The first visitor
// after this window syncs; everyone else just reads the already-synced board from
// Firestore. Lower it while you're actively editing the sheet.
export const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

export function isSheetConfigured(url = SHEET_CSV_URL) {
  return typeof url === "string" && /^https?:\/\//.test(url);
}
