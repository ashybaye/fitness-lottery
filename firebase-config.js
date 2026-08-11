// Firebase project configuration.
//
// 1. Go to https://console.firebase.google.com/, create a project (free Spark plan is fine).
// 2. In the project, add a "Web app" (</> icon) — no need for Firebase Hosting.
// 3. Copy the config object it gives you and paste the values below.
// 4. In the left nav, go to Build > Firestore Database > Create database
//    (start in "production mode", any region is fine).
// 5. Deploy the security rules in firestore.rules (Firestore Database > Rules tab,
//    paste the contents of firestore.rules and click "Publish").
//
// This file is safe to commit/publish publicly — Firestore access is controlled by
// firestore.rules, not by keeping these values secret.

export const firebaseConfig = {
  apiKey: "AIzaSyCGQhZsRzVsPUgpO5wVjZRPHUuECw70y10",
  authDomain: "fitness-lottery.firebaseapp.com",
  projectId: "fitness-lottery",
  storageBucket: "fitness-lottery.firebasestorage.app",
  messagingSenderId: "576782634970",
  appId: "1:576782634970:web:07bdbef735e122ac45bae3"
};
