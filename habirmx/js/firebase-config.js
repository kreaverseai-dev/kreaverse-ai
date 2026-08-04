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

// Jadikan variabel Firebase GLOBAL
window.auth = getAuth(app);
window.db = getFirestore(app);
window.rtdb = getDatabase(app);

// Variabel Global User
window.currentUser = null;
window.currentUserData = null; 
window.isAdmin = false;
window.isLoggedIn = localStorage.getItem('kreaverse_logged_in') === 'true';
window.userEmail = localStorage.getItem('kreaverse_user_email');

// Ekspor fungsi Firebase ke window
window.doc = doc; window.collection = collection; window.getDocs = getDocs; window.addDoc = addDoc;
window.onSnapshot = onSnapshot; window.updateDoc = updateDoc; window.query = query; window.where = where;
window.deleteDoc = deleteDoc; window.getDoc = getDoc; window.ref = ref; window.set = set;
window.onValue = onValue; window.onDisconnect = onDisconnect; window.rtdbTimestamp = rtdbTimestamp;

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

// PENYALA MESIN UTAMA (Cek Login & Panggil Data)
onAuthStateChanged(window.auth, (user) => {
    if (user) {
        window.currentUser = user;
        window.isLoggedIn = true;
        window.userEmail = user.email;
        localStorage.setItem('kreaverse_logged_in', 'true');
        localStorage.setItem('kreaverse_user_email', user.email);
        
        // Panggil fungsi untuk memuat Model AI dan Library Lagu
        if(typeof window.loadDynamicModels === 'function') window.loadDynamicModels();
        if(typeof window.initLibraryAndProgress === 'function') window.initLibraryAndProgress();
        
        // Ambil data user dari Firestore
        const userQuery = query(collection(window.db, "users"), where("email", "==", user.email.toLowerCase()));
        onSnapshot(userQuery, (snap) => {
            snap.forEach(docSnap => {
                window.currentUserData = { id: docSnap.id, ...docSnap.data() };
                if (window.currentUserData.role === 'admin') window.isAdmin = true;
                
                // Update UI Saldo/Kredit
                const walletContainer = document.getElementById('walletWidgetContainer');
                if (walletContainer) {
                    const kredit = window.currentUserData.kredit !== undefined ? window.currentUserData.kredit : (window.currentUserData.dailyQuota || 0);
                    walletContainer.innerHTML = `
                        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; text-align: left; box-shadow: 0 8px 20px rgba(0,0,0,0.04);">
                            <div style="font-weight: 800; font-size: 0.9rem; color: #0f172a; margin-bottom: 8px;">Saldo Anda</div>
                            <div style="font-size: 1.4rem; font-weight: 900; color: #0f172a; font-family: monospace;">${kredit.toLocaleString('id-ID')} Kredit</div>
                        </div>
                    `;
                }
            });
        });
    } else {
        window.currentUser = null;
        window.isLoggedIn = false;
        window.isAdmin = false;
        localStorage.removeItem('kreaverse_logged_in');
        localStorage.removeItem('kreaverse_user_email');
        
        // Tetap muat model AI meskipun belum login agar tombol bisa diklik
        if(typeof window.loadDynamicModels === 'function') window.loadDynamicModels();
    }
});