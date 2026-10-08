# 🃏 Fitness Challenge Deck

A mobile-first, shared flashcard board of fitness challenges. Anyone visiting the site
sees the same board. Cards can be opened to reveal a challenge, but only **1 card total**
can be opened per day across everyone sharing the board. Once a card is opened it stays
revealed permanently — there's no way to undo a single pick. A "Reset board" button lets
anyone start the whole deck over from scratch (with a confirmation prompt).

The challenges themselves live in a **published Google Sheet**, so you can edit the deck
without touching code or redeploying. Card *state* (which cards are open, the daily
counter) lives in **Firebase Firestore**.

This is a fully static site — plain HTML/CSS/JS, no build step, no server — so it can be
hosted for free on **GitHub Pages**.

## 1. Create the challenge sheet

1. Create a Google Sheet whose **first row is a header** with these two columns:

   | id | text |
   |----|------|
   | `mobility-40` | `🧘 40-minute mobility workout` |
   | `yoga-40` | `🧘 40-minute yoga session` |

   - **`id`** — a short, stable, unique slug. It becomes the card's Firestore document
     id, which is how a card keeps its opened/closed state when you edit the sheet.
   - **`text`** — the challenge shown on the card.

   To start from the deck that's already live, use **File → Import** and upload
   [`challenges.csv`](./challenges.csv) from this repo. It's an export of the current
   board, and its `id` values (`card-1` … `card-30`) match the existing Firestore
   document ids — so the first sync is a no-op and no already-opened card is lost.

   > ⚠️ If you build the sheet from scratch with different `id` values, the first sync
   > deletes every existing card and creates new closed ones, wiping the board's
   > progress. Keep the existing ids unless that's what you want.

2. Go to **File → Share → Publish to web**, pick that sheet, choose
   **Comma-separated values (.csv)**, and click **Publish**.
3. Copy the generated URL and paste it into `SHEET_CSV_URL` in
   [`sheet-config.js`](./sheet-config.js).

> Publishing makes that sheet readable by anyone who has the URL, and the URL ships in
> the site's JavaScript to every visitor. Don't put anything private in the sheet.

### How sheet edits reach the board

The first visitor after a cooldown window (5 minutes by default — `SYNC_COOLDOWN_MS` in
`sheet-config.js`) syncs the sheet into Firestore. Everyone else just reads the board.

| You do this in the sheet | The board does this |
|---|---|
| Edit a `text` cell | The card's challenge text updates, open or closed |
| Reorder rows | Card numbers change; an opened card stays opened |
| Add a row | A new closed card appears at that position |
| Delete a row | That card disappears, **even if it was already opened** |
| Change an `id` | Treated as deleting one card and creating another, losing its opened state |

If the sheet is unreachable or malformed, the board still renders from Firestore and
shows a banner explaining that it may be stale.

## 2. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a new
   project (the free "Spark" plan is enough).
2. In the project, click the **`</>`** (Web) icon to register a new web app. You don't need
   Firebase Hosting — just registering the app is enough to get a config object.
3. Copy the `firebaseConfig` object shown and paste its values into `firebase-config.js`
   in this repo (replacing the placeholder `YOUR_...` values).
4. In the left sidebar, go to **Build → Firestore Database → Create database**. Choose
   **production mode** and any region close to you.

## 3. Deploy the security rules

1. In the Firebase console, go to **Build → Firestore Database → Rules**.
2. Replace the contents with everything in [`firestore.rules`](./firestore.rules) from this
   repo, then click **Publish**.

These rules allow public read/write (there's no login for this app) but constrain writes
to valid shapes. In particular, a card update must be *either* a state transition
(`closed → opened`, or `opened → closed` for the reset action) *or* a content sync from
the sheet (`text`/`order` change) — never both. So a sheet sync can't flip a card open,
and opening a card can't smuggle in different challenge text.

## 4. Run locally

Because this uses ES module imports, open it via a local static server rather than a
`file://` URL:

```bash
npx serve .
# or: python3 -m http.server 8000
```

### Running the automated tests

The CSV parser, the sheet reader, and the sheet→Firestore diff are pure logic and need
nothing installed:

```bash
npm install
npm test
```

The open transaction, the reset action, and `firestore.rules` are covered by tests against
the Firestore emulator (no real Firebase project needed):

```bash
npx firebase-tools emulators:exec --only firestore "npm run test:rules"
```

(Requires a Java runtime for the emulator; see the [Firebase emulator docs](https://firebase.google.com/docs/emulator-suite) if you don't have one.)

## 5. Push to GitHub and enable Pages

```bash
git remote add origin https://github.com/ashybaye/fitness-lottery.git
git push -u origin main
```

Then in the repo on GitHub: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. The included workflow at `.github/workflows/deploy-pages.yml` will build and
publish the site automatically on every push to `main`. Once it runs, your site will be live
at `https://ashybaye.github.io/fitness-lottery/`.

## How it works

Content flows one way — sheet → Firestore → board — while card state stays in Firestore:

```
Google Sheet ──CSV──▶ sheet-source.js ──▶ card-sync.js ──diff──▶ board-store.js ──▶ Firestore
                                                                                        │
                                                                        live snapshots  ▼
                                                                                   board-ui.js
```

| File | Responsibility |
|---|---|
| `index.html` / `style.css` | Mobile-first markup and styling for the card grid, the flip animation, the zoom modal, and the "Reset board" button |
| `sheet-config.js` | Your published CSV URL and the sync cooldown |
| `csv.js` | A small RFC 4180 CSV parser (quoted fields, embedded commas and newlines) |
| `sheet-source.js` | Fetches and validates the sheet into an ordered `{ id, text, order }` list |
| `card-sync.js` | Pure diff of sheet content against stored cards, plus the cooldown and batch-size rules |
| `board-store.js` | The only module that talks to Firestore: live subscriptions, the open transaction, reset, and applying a sheet diff |
| `board-ui.js` | All DOM work: rendering the board, status line, zoom modal, toast, and sync banner |
| `app.js` | Wiring: run the sync, subscribe to the board, connect the UI handlers |
| `challenges.csv` | An export of the live 30-card deck, ready to import into a sheet; also used as a test fixture |
| `firebase-config.js` | Your project's public Firebase config (safe to publish; access control is handled by `firestore.rules`, not by secrecy of these values) |
| `firestore.rules` | Security rules enforcing valid writes |
| `.github/workflows/deploy-pages.yml` | Publishes this static site to GitHub Pages on every push to `main` |

Opening a card runs inside a **Firestore transaction** that also reads and writes
`meta/dailyCount`, so the global "1 card per day" limit holds even if several people tap a
card at the same moment. A sheet sync applies all its creates, updates, and deletes in a
single batch, so the board never renders a half-synced deck. Two visitors syncing at once
compute the same diff, so the writes are idempotent.

## Data model

- `cards/{sheetId}` — `{ id, order, text, status: 'closed' | 'opened', openedDate: 'YYYY-MM-DD' | null }`
  The document id is the `id` from the sheet. `text` and `order` are owned by the sheet;
  `status` and `openedDate` are owned by the app.
- `meta/dailyCount` — `{ date: 'YYYY-MM-DD', count: 0..1 }` — how many cards have been opened
  on the current day, globally.
- `meta/sheetSync` — `{ lastSyncedAt: <epoch ms>, sourceHash: <string> }` — when the board
  last pulled from the sheet, and a fingerprint of what it pulled.

## Known limitations

- There's no authentication, so the security rules trust well-behaved clients for the daily
  counter rather than doing a fully tamper-proof server-side count. This is an accepted
  trade-off for a small, public, family/team-style shared board.
- Because removing a sheet row has to remove its card, the rules allow any client to delete
  a card. Rules can't see the sheet, so this can't be narrowed further. The "Reset board"
  button already lets anyone wipe board state, so this doesn't widen the threat model much.
- For the same reason, any client can rewrite a card's `text` and `order`. The rules still
  prevent that write from changing a card's open/closed state.
- "Today" is each visitor's local browser date. If users are in very different time zones,
  the daily reset will appear to happen at a different wall-clock time for each of them.
- Sheet edits appear only after a visitor loads the page and the cooldown has elapsed —
  there's no push from Google Sheets to the board.
