import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, collection, getDocs, addDoc, onSnapshot, updateDoc, query, where, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getDatabase, ref, set, onValue, onDisconnect, serverTimestamp as rtdbTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAO8JV4jkJmbHChYvjUCS7wqfVbKr94tHM",
    authDomain: "kreaverse-ai0107.firebaseapp.com",
    databaseURL: "https://kreaverse-ai0107-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "kreaverse-ai0107",
    storageBucket: "kreaverse-ai0107.firebasestorage.app",
    messagingSenderId: "1048550433011",
    appId: "1:1048550433011:web:0cf2e4074b20fe09909786"
};

const app = initializeApp(firebaseConfig);

// Jadikan variabel Firebase GLOBAL agar bisa dibaca oleh file JS lainnya
window.auth = getAuth(app);
window.db = getFirestore(app);
window.rtdb = getDatabase(app);

// Variabel Global User
window.currentUser = null;
window.currentUserData = null; 
window.isAdmin = false;
window.isLoggedIn = localStorage.getItem('kreaverse_logged_in') === 'true';
window.userEmail = localStorage.getItem('kreaverse_user_email');

// Auto Inject Token untuk Keamanan Backend
const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if (typeof resource === 'string' && resource.includes('/api/habirmx')) {
        config = config || {};
        config.headers = config.headers || {};
        if (window.auth && window.auth.currentUser) {
            try {
                const token = await window.auth.currentUser.getIdToken();
                config.headers['Authorization'] = `Bearer ${token}`;
            } catch (e) { console.warn("Gagal mengambil token:", e); }
        }
    }
    return originalFetch(resource, config);
};

// Ekspor fungsi Firebase ke window agar bisa dipakai di file lain
window.doc = doc;
window.collection = collection;
window.getDocs = getDocs;
window.addDoc = addDoc;
window.onSnapshot = onSnapshot;
window.updateDoc = updateDoc;
window.query = query;
window.where = where;
window.deleteDoc = deleteDoc;
window.getDoc = getDoc;
window.ref = ref;
window.set = set;
window.onValue = onValue;
window.onDisconnect = onDisconnect;
window.rtdbTimestamp = rtdbTimestamp;
window.onAuthStateChanged = onAuthStateChanged;