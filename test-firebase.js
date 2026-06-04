const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyCkdDVOju7dxXUZ_Utu77FrQWSYbZJtMY8",
  authDomain: "c54-casino.firebaseapp.com",
  projectId: "c54-casino",
  storageBucket: "c54-casino.firebasestorage.app",
  messagingSenderId: "35134990771",
  appId: "1:35134990771:web:4a18cc3914a0c7fc8d43c6",
  measurementId: "G-HL3HFBCXSL"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
db.settings({
    experimentalForceLongPolling: true,
    experimentalAutoDetectLongPolling: false,
    merge: true
});

async function test() {
  console.log("Fetching teenPattiGames...");
  try {
    const snap = await db.collection('teenPattiGames').orderBy('createdAt','desc').get();
    console.log(`Success! Found ${snap.size} documents.`);
  } catch (err) {
    console.error("Firebase Error:", err.message || err);
  }
  process.exit(0);
}

test();
