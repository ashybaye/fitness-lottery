# 🃏 30-Day Fitness Challenge Deck

A mobile-first, shared flashcard board of 30 fitness challenges. Anyone visiting the site
sees the same board. Cards can be opened to reveal a challenge, but only **1 card total**
can be opened per day across everyone sharing the board. Once a card is opened it stays
revealed permanently — there's no way to undo a single pick. A "Reset board" button lets
anyone start the whole 30-card deck over from scratch (with a confirmation prompt).

This is a fully static site (plain HTML/CSS/JS, no build step, no server) that stores its
shared state in **Firebase Firestore**, so it can be hosted for free on **GitHub Pages**.

## 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a new
   project (the free "Spark" plan is enough).
2. In the project, click the **`</>`** (Web) icon to register a new web app. You don't need
   Firebase Hosting — just registering the app is enough to get a config object.
3. Copy the `firebaseConfig` object shown and paste its values into `firebase-config.js`
   in this repo (replacing the placeholder `YOUR_...` values).
4. In the left sidebar, go to **Build → Firestore Database → Create database**. Choose
   **production mode** and any region close to you.

## 2. Deploy the security rules

1. In the Firebase console, go to **Build → Firestore Database → Rules**.
2. Replace the contents with everything in [`firestore.rules`](./firestore.rules) from this
   repo, then click **Publish**.

These rules allow public read/write (there's no login for this app) but constrain writes to
only valid state transitions (e.g. a card can only move `closed → opened`, which is
permanent in the normal flow; the `opened → closed` transition is reserved for the
"Reset board" action; challenge text can never be modified).

## 3. Run locally

Because this uses ES module imports, open it via a local static server rather than a
`file://` URL:

```bash
npx serve .
# or: python3 -m http.server 8000
```

Then open the printed URL in your browser. The first visitor to load the page will
automatically seed Firestore with the 30 challenge cards.

### Running the automated tests

The daily-limit open logic, the reset action, and `firestore.rules` are covered by tests
against the Firestore emulator (no real Firebase project needed):

```bash
npm install
npx firebase-tools emulators:exec --only firestore "npm run test:rules"
```

(Requires a Java runtime for the emulator; see the [Firebase emulator docs](https://firebase.google.com/docs/emulator-suite) if you don't have one.)

## 4. Push to GitHub and enable Pages

```bash
git remote add origin https://github.com/ashybaye/fitness-lottery.git
git push -u origin main
```

Then in the repo on GitHub: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. The included workflow at `.github/workflows/deploy-pages.yml` will build and
publish the site automatically on every push to `main`. Once it runs, your site will be live
at `https://ashybaye.github.io/fitness-lottery/`.

## How it works

- **`index.html` / `style.css`** — mobile-first markup and styling for the 30-card grid,
  including a flip animation when a card is opened, and a "Reset board" button in the header.
- **`app.js`** — Firebase init, live board rendering via Firestore's `onSnapshot`, and the
  open logic. Opening a card runs inside a **Firestore transaction** that also reads/writes
  a `meta/dailyCount` document, so the global "1 card per day" limit is enforced atomically
  even if multiple people tap a card at the same moment. Opened cards show a "Let's go! 💪"
  button (purely motivational — it doesn't change state). The "Reset board" button closes
  every currently-opened card and resets today's count back to 0, so the whole 30-card deck
  can start over.
- **`firebase-config.js`** — your project's public Firebase config (safe to publish; access
  control is handled by `firestore.rules`, not by secrecy of these values).
- **`firestore.rules`** — Firestore security rules enforcing valid state transitions.
- **`.github/workflows/deploy-pages.yml`** — GitHub Actions workflow that publishes this
  static site to GitHub Pages on every push to `main`.

## Data model

- `cards/{cardId}` — `{ id, order, text, status: 'closed' | 'opened', openedDate: 'YYYY-MM-DD' | null }`
- `meta/dailyCount` — `{ date: 'YYYY-MM-DD', count: 0..1 }` — how many cards have been opened
  on the current day, globally.

## Known limitations

- There's no authentication, so the security rules trust well-behaved clients for the daily
  counter rather than doing a fully tamper-proof server-side count. This is an accepted
  trade-off for a small, public, family/team-style shared board.
- "Today" is each visitor's local browser date. If users are in very different time zones,
  the daily reset will appear to happen at a different wall-clock time for each of them.
