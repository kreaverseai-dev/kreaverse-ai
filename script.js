// ==================== KREAVERSE AI - FULL LOGIC ====================
document.addEventListener('DOMContentLoaded', async () => {
    // -------------------- FIREBASE INIT --------------------
    const firebaseConfig = {
        apiKey: "AIzaSyBcazofp421OVLbZ8TJj7YQ1jy54-4bJTo",
        authDomain: "kreaverse-ai-2605f.firebaseapp.com",
        projectId: "kreaverse-ai-2605f",
        storageBucket: "kreaverse-ai-2605f.firebasestorage.app",
        messagingSenderId: "49169205894",
        appId: "1:49169205894:web:11849f14e4559df1e95f07",
        databaseURL: "https://kreaverse-ai-2605f-default-rtdb.asia-southeast1.firebasedatabase.app"
    };
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    const rtdb = firebase.database();

    // -------------------- DOM ELEMENTS --------------------
    const menuBtn = document.getElementById('menuHamburgerBtn');
    const sidebar = document.getElementById('mainSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const closeSidebar = document.getElementById('closeSidebarBtn');
    const notifBell = document.getElementById('notifBellBtn');
    const notifCountBadge = document.getElementById('notifCountBadge');
    const sidebarNotif = document.getElementById('sidebarNotifBadge');
    const greetingEl = document.getElementById('greeting-text');
    const chatInput = document.getElementById('homeChatInput');
    const sendBtn = document.getElementById('sendMessageBtn');
    const micBtn = document.getElementById('micBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileUploadInput');
    const modelSelector = document.getElementById('modelSelectorBtn');
    const selectedModelSpan = document.getElementById('selectedModelLabel');
    const modelDropdown = document.getElementById('modelDropdown');
    const starLogo = document.getElementById('starLogoAnim');
    const upgradePill = document.getElementById('upgradePill');
    const userNameSpan = document.getElementById('sidebarUserName');
    const userPlanSpan = document.getElementById('sidebarUserPlan');
    const userAvatar = document.getElementById('sidebarAvatar');
    const mainContainer = document.getElementById('mainContainer');
    const nameModal = document.getElementById('nameModal');
    const nameInput = document.getElementById('userNameInput');
    const saveNameBtn = document.getElementById('saveNameBtn');
    const upgradeBadgeChat = document.getElementById('upgradeBadgeChat');
    const upgradeBadgeMedia = document.getElementById('upgradeBadgeMedia');

    // -------------------- GLOBAL STATE --------------------
    let currentUser = null;          // { uid, email, name, tier, isLoggedIn }
    let unreadCount = 0;
    let greetingAnimationTimer = null;
    let defaultGreetingText = "";
    let currentModel = "Claude 4.8";
    let isKeyboardVisible = false;

    // -------------------- HELPER FUNCTIONS --------------------
    function getTimeGreeting() {
        const hour = new Date().getHours();
        if (hour < 11) return "Selamat Pagi";
        if (hour < 15) return "Selamat Siang";
        if (hour < 18) return "Selamat Sore";
        return "Selamat Malam";
    }

    function updateGreetingUI() {
        const timeGreet = getTimeGreeting();
        const name = currentUser?.name || "Pengguna";
        defaultGreetingText = `${timeGreet},<br>${name}`;
        greetingEl.innerHTML = defaultGreetingText;
    }

    // Animasi 20 detik dengan 5 kalimat berbeda
    const fancyMessages = [
        "Apa misi Anda malam ini? ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨",
        "Siap membantu kreativitas Anda ÃÂÃÂÃÂÃÂ°ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ",
        "Ide cemerlang sedang menunggu ÃÂÃÂÃÂÃÂ°ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¡",
        "Jelajahi imajinasi tanpa batas ÃÂÃÂÃÂÃÂ°ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ",
        "Kreaverse siap menginspirasi ÃÂÃÂÃÂÃÂ°ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨"
    ];
    let fancyInterval = null;

    function startFancyGreeting() {
        if (fancyInterval) clearInterval(fancyInterval);
        let step = 0;
        // Tampilkan pesan pertama langsung
        greetingEl.innerHTML = fancyMessages[step % fancyMessages.length];
        step++;
        fancyInterval = setInterval(() => {
            if (step < fancyMessages.length) {
                greetingEl.style.opacity = '0';
                setTimeout(() => {
                    greetingEl.innerHTML = fancyMessages[step];
                    greetingEl.style.opacity = '1';
                    step++;
                }, 150);
            } else {
                clearInterval(fancyInterval);
                fancyInterval = null;
                // Kembali ke salam permanen
                greetingEl.style.opacity = '0';
                setTimeout(() => {
                    updateGreetingUI();
                    greetingEl.style.opacity = '1';
                }, 200);
            }
        }, 4000); // setiap 4 detik, total 20 detik
    }

    // Reset animasi saat refresh atau login
    function resetGreetingAnimation() {
        if (fancyInterval) clearInterval(fancyInterval);
        updateGreetingUI();
        startFancyGreeting(); // hanya berjalan sekali setelah load
    }

    // -------------------- AUTH STATE & PRESENCE (REAL-TIME) --------------------
    firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
            // User login via Firebase Auth
            const userDoc = await db.collection("users").doc(user.uid).get();
            const userData = userDoc.data() || {};
            currentUser = {
                uid: user.uid,
                email: user.email,
                name: userData.nama || user.displayName || "Pengguna",
                tier: userData.tier || "free",
                isLoggedIn: true
            };
            localStorage.setItem("kreaverse_logged_in", "true");
            localStorage.setItem("kreaverse_user_id", user.uid);
            localStorage.setItem("kreaverse_user_email", user.email);
            localStorage.setItem("kreaverse_user_name", currentUser.name);
            
            // Set presence online di Realtime Database
            const userStatusRef = rtdb.ref(`/presence/${user.uid}`);
            await userStatusRef.set({
                state: "online",
                last_changed: firebase.database.ServerValue.TIMESTAMP,
                user_agent: navigator.userAgent
            });
            userStatusRef.onDisconnect().set({
                state: "offline",
                last_changed: firebase.database.ServerValue.TIMESTAMP
            });
            
            // Load notifikasi
            loadNotifications(user.uid);
            // Update UI
            updateSidebarUser();
            updateGreetingUI();
            resetGreetingAnimation();
            // Sembunyikan badge "Tingkatkan" untuk user login
            upgradeBadgeChat.classList.add('hidden');
            upgradeBadgeMedia.classList.add('hidden');
        } else {
            // Guest
            currentUser = {
                uid: null,
                email: null,
                name: "Pengguna",
                tier: "guest",
                isLoggedIn: false
            };
            localStorage.removeItem("kreaverse_logged_in");
            localStorage.removeItem("kreaverse_user_id");
            // Tampilkan badge "Tingkatkan" untuk guest
            upgradeBadgeChat.classList.remove('hidden');
            upgradeBadgeMedia.classList.remove('hidden');
            updateSidebarUser();
            updateGreetingUI();
            resetGreetingAnimation();
        }
    });

    async function loadNotifications(uid) {
        if (!uid) return;
        const notifRef = db.collection("users").doc(uid).collection("notifications").where("isRead", "==", false);
        const snapshot = await notifRef.get();
        unreadCount = snapshot.size;
        updateNotifBadges(unreadCount);
        
        // Listener real-time
        notifRef.onSnapshot((snap) => {
            unreadCount = snap.size;
            updateNotifBadges(unreadCount);
        });
    }

    function updateNotifBadges(count) {
        const display = count > 0 ? (count > 9 ? "9+" : count.toString()) : null;
        if (display) {
            notifCountBadge.innerText = display;
            notifCountBadge.classList.remove("hidden");
            if (sidebarNotif) {
                sidebarNotif.innerText = display;
                sidebarNotif.classList.remove("hidden");
            }
        } else {
            notifCountBadge.classList.add("hidden");
            if (sidebarNotif) sidebarNotif.classList.add("hidden");
        }
    }

    function updateSidebarUser() {
        if (currentUser?.isLoggedIn) {
            userNameSpan.innerText = currentUser.name;
            userPlanSpan.innerText = currentUser.email || "user@kreaverse.ai";
            userAvatar.innerText = currentUser.name.charAt(0).toUpperCase();
        } else {
            userNameSpan.innerText = "Pengguna";
            userPlanSpan.innerText = "Belum Login";
            userAvatar.innerText = "P";
        }
    }

    // -------------------- SIDEBAR & CLICK-OUTSIDE --------------------
    function openSidebar() {
        sidebar.classList.add('open');
        overlay.classList.add('visible');
    }
    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
    }
    menuBtn.addEventListener('click', openSidebar);
    closeSidebar.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);
    // Click-outside via overlay sudah, tapi pastikan juga klik di luar sidebar menutup
    document.addEventListener('click', (e) => {
        if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
            closeSidebar();
        }
    });

    // -------------------- NOTIFIKASI BELL -> redirect ke inbox --------------------
    notifBell.addEventListener('click', () => {
        if (!currentUser?.isLoggedIn) {
            showToast("Harap login dulu untuk melihat pengumuman", "warning");
            setTimeout(() => window.location.href = '/login/', 1200);
            return;
        }
        window.location.href = '/inbox/';
    });

    // -------------------- KLAIM NAMA (MODAL) --------------------
    function showNameModal() {
        nameModal.classList.remove('hidden');
        nameInput.value = currentUser?.name || "";
    }
    saveNameBtn.addEventListener('click', async () => {
        const newName = nameInput.value.trim();
        if (!newName) return;
        if (currentUser?.isLoggedIn && currentUser.uid) {
            await db.collection("users").doc(currentUser.uid).update({ nama: newName });
            currentUser.name = newName;
            localStorage.setItem("kreaverse_user_name", newName);
        } else {
            // Guest: simpan ke localStorage
            localStorage.setItem("guest_name", newName);
            currentUser.name = newName;
        }
        updateSidebarUser();
        updateGreetingUI();
        nameModal.classList.add('hidden');
        showToast(`Halo ${newName}, selamat datang!`, "success");
    });
    // Tampilkan modal jika guest atau belum punya nama
    if (!currentUser?.isLoggedIn && !localStorage.getItem("guest_name")) {
        setTimeout(showNameModal, 500);
    } else if (currentUser?.isLoggedIn && !currentUser.name) {
        setTimeout(showNameModal, 500);
    }

    // -------------------- CHAT & REDIRECT (WAJIB LOGIN) --------------------
    function redirectToChat() {
        if (!currentUser?.isLoggedIn) {
            showToast("Silakan login untuk memulai chat", "warning");
            setTimeout(() => window.location.href = '/login/', 1000);
            return;
        }
        const msg = chatInput.value.trim();
        if (msg) localStorage.setItem("pending_chat_msg", msg);
        window.location.href = '/chat/';
    }
    sendBtn.addEventListener('click', redirectToChat);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            redirectToChat();
        }
    });
    // Textarea auto-resize
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 180) + 'px';
        if (this.value.trim().length > 0) {
            micBtn.classList.add('hidden');
            sendBtn.classList.remove('hidden');
        } else {
            micBtn.classList.remove('hidden');
            sendBtn.classList.add('hidden');
        }
    });
    // Mic dummy
    micBtn.addEventListener('click', () => showToast("Fitur suara segera hadir", "info"));

    // -------------------- UPLOAD FILE --------------------
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            showToast(`File ${fileInput.files[0].name} siap dikirim`, "info");
            sendBtn.classList.remove('hidden');
        }
    });

    // -------------------- MODEL DROPDOWN (Claude, Gemini, ChatGPT) --------------------
    const models = [
        { name: "Claude 4.8", icon: "fa-solid fa-brain", desc: "Model terbaru dengan penalaran kuat" },
        { name: "Claude 4.7", icon: "fa-solid fa-brain", desc: "Seimbang & cepat" },
        { name: "Gemini 3.5", icon: "fa-brands fa-google", desc: "Responsif, multimodal" },
        { name: "ChatGPT 5.5", icon: "fa-regular fa-message", desc: "Kreatif & ekspresif" }
    ];
    function renderDropdown() {
        modelDropdown.innerHTML = models.map(m => `
            <div class="model-opt" data-model="${m.name}">
                <i class="${m.icon}"></i> <span>${m.name}</span>
                <small style="color:#888; margin-left:8px;">${m.desc}</small>
            </div>
        `).join('');
        document.querySelectorAll('.model-opt').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                const newModel = opt.getAttribute('data-model');
                currentModel = newModel;
                selectedModelSpan.innerText = newModel;
                modelDropdown.classList.add('hidden');
                showToast(`Model diubah ke ${newModel}`, "success");
            });
        });
    }
    renderDropdown();
    modelSelector.addEventListener('click', (e) => {
        e.stopPropagation();
        modelDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', () => modelDropdown.classList.add('hidden'));

    // -------------------- ANIMASI BINTANG --------------------
    starLogo.addEventListener('click', () => {
        starLogo.style.transform = 'scale(1.2) rotate(360deg)';
        setTimeout(() => starLogo.style.transform = '', 300);
        showToast("ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨ Kreaverse AI siap membantu ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨", "info");
    });

    // -------------------- HANDLE KEYBOARD (MOBILE) --------------------
    let originalPaddingBottom = "";
    window.addEventListener('resize', () => {
        const visualHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const diff = window.innerHeight - visualHeight;
        if (diff > 100 && !isKeyboardVisible) {
            isKeyboardVisible = true;
            mainContainer.classList.add('keyboard-visible');
            // Sembunyikan sementara header dan notifikasi? (tidak diminta di revisi, tapi biar tidak tabrak)
            // yang diminta: slider dan paket gratis + notifikasi hilang saat keyboard muncul? revisi poin 2: "Sileder dan Paket gratis -> dan Notifikasi Otomatis hilang"
            document.querySelector('.kreaverse-header').style.opacity = '0';
            document.querySelector('.kreaverse-header').style.pointerEvents = 'none';
        } else if (diff < 50 && isKeyboardVisible) {
            isKeyboardVisible = false;
            mainContainer.classList.remove('keyboard-visible');
            document.querySelector('.kreaverse-header').style.opacity = '1';
            document.querySelector('.kreaverse-header').style.pointerEvents = 'auto';
        }
    });

    // -------------------- TOAST CUSTOM --------------------
    function showToast(msg, type = "info") {
        let toast = document.getElementById('dynamicToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'dynamicToast';
            toast.style.position = 'fixed';
            toast.style.bottom = '20px';
            toast.style.left = '50%';
            toast.style.transform = 'translateX(-50%)';
            toast.style.backgroundColor = '#191919';
            toast.style.color = 'white';
            toast.style.padding = '10px 20px';
            toast.style.borderRadius = '40px';
            toast.style.zIndex = '9999';
            toast.style.fontSize = '0.85rem';
            toast.style.fontWeight = '500';
            toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
            toast.style.backdropFilter = 'blur(8px)';
            document.body.appendChild(toast);
        }
        toast.innerText = msg;
        toast.style.opacity = '1';
        setTimeout(() => {
            toast.style.opacity = '0';
        }, 2500);
    }

    // -------------------- FIREBASE AUTH REDIRECT UNTUK MENU --------------------
    document.querySelectorAll('.auth-required').forEach(link => {
        link.addEventListener('click', (e) => {
            if (!currentUser?.isLoggedIn) {
                e.preventDefault();
                showToast("Login dulu untuk akses fitur ini", "warning");
                setTimeout(() => window.location.href = '/login/', 1000);
            }
        });
    });
    // OTP menu khusus: hanya teks yang bisa diklik, badge tidak
    const otpLink = document.getElementById('otpMenuLink');
    if (otpLink) {
        otpLink.addEventListener('click', (e) => {
            if (!currentUser?.isLoggedIn) {
                e.preventDefault();
                showToast("Silakan login untuk menggunakan OTP", "warning");
            }
        });
    }

    // -------------------- PAKET GRATIS -> UBAH TEKS JADI "Coba Kreaverse" (sudah di HTML) --------------------
    // Upgrade pill sudah di HTML dengan teks "Coba Kreaverse", link ke /harga/

    // -------------------- INITIAL --------------------
    resetGreetingAnimation();
    updateSidebarUser();
    
    // Cek admin menu
    if (currentUser?.email === "habistudio.ai@unlimited.com") {
        const adminLink = document.getElementById('adminMenuLink');
        if (adminLink) adminLink.classList.remove('hidden');
    }
    
    // Simpan referensi global untuk notifikasi
    window.showToast = showToast;
});