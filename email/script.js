document.addEventListener('DOMContentLoaded', async () => {
    const emailAddressInput = document.getElementById('email-address');
    const copyBtn = document.getElementById('copy-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const inboxContainer = document.getElementById('inbox-container');

    let currentToken = '';
    let currentAccountId = '';
    let seenMessageIds = new Set();
    let serviceWorkerReg = null;

    // 1. Inisialisasi Service Worker & Notifikasi
    if ('serviceWorker' in navigator && 'Notification' in window) {
        try {
            serviceWorkerReg = await navigator.serviceWorker.register('sw.js');
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.log('Izin notifikasi tidak diberikan.');
            }
        } catch (error) {
            console.error('Service Worker gagal didaftarkan:', error);
        }
    }

    // 2. Setup Akun Mail.tm
    async function setupEmail() {
        try {
            // Ambil domain aktif
            const domainRes = await fetch('https://api.mail.tm/domains');
            const domainData = await domainRes.json();
            const domain = domainData['hydra:member'][0].domain;

            // Generate kredensial
            const randomString = Math.random().toString(36).substring(2, 8);
            const address = `kreaverse-ai-${randomString}@${domain}`;
            const password = `KreaversePass!${randomString}`;

            // Buat Akun
            const accountRes = await fetch('https://api.mail.tm/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, password })
            });
            const accountData = await accountRes.json();
            currentAccountId = accountData.id;

            // Ambil Token JWT
            const tokenRes = await fetch('https://api.mail.tm/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, password })
            });
            const tokenData = await tokenRes.json();
            currentToken = tokenData.token;

            // Tampilkan di UI
            emailAddressInput.value = address;
            
            // Mulai polling pesan
            fetchMessages();
            setInterval(fetchMessages, 7000); // Cek setiap 7 detik

        } catch (error) {
            Swal.fire({
                title: 'Koneksi Gagal',
                text: 'Gagal terhubung ke server email. Coba muat ulang halaman.',
                icon: 'error',
                confirmButtonColor: '#D97757',
                background: document.documentElement.getAttribute('data-theme') === 'dark' ? '#242424' : '#FFF',
                color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#E5E5E5' : '#1F1F1F'
            });
        }
    }

    // 3. Ambil Pesan Masuk
    async function fetchMessages() {
        if (!currentToken) return;

        try {
            const res = await fetch('https://api.mail.tm/messages', {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            const data = await res.json();
            const messages = data['hydra:member'];

            renderMessages(messages);
            checkForNewMessages(messages);
            
        } catch (error) {
            console.error('Gagal mengambil pesan:', error);
        }
    }

    // 4. Render ke UI
    function renderMessages(messages) {
        if (messages.length === 0) {
            inboxContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-inbox"></i><br>
                    Menunggu pesan masuk...
                </div>
            `;
            return;
        }

        inboxContainer.innerHTML = '';
        messages.forEach(msg => {
            const div = document.createElement('div');
            div.className = 'email-item';
            div.innerHTML = `
                <div class="email-sender">${msg.from.address}</div>
                <div class="email-subject">${msg.subject}</div>
                <div class="email-snippet">${msg.intro}</div>
            `;
            div.addEventListener('click', () => showEmailDetail(msg.id));
            inboxContainer.appendChild(div);
        });
    }

    // 5. Cek Pesan Baru & Tampilkan Notifikasi Push
    function checkForNewMessages(messages) {
        messages.forEach(msg => {
            if (!seenMessageIds.has(msg.id)) {
                seenMessageIds.add(msg.id);
                
                // Memicu notifikasi via Service Worker
                if (Notification.permission === 'granted' && serviceWorkerReg) {
                    serviceWorkerReg.showNotification('Pesan Baru: Kreaverse Email', {
                        body: `Dari: ${msg.from.address}\nSubjek: ${msg.subject}`,
                        icon: 'https://cdn-icons-png.flaticon.com/512/732/732200.png',
                        vibrate: [200, 100, 200]
                    });
                }
            }
        });
    }

    // 6. Tampilkan Detail Pesan (SweetAlert)
    async function showEmailDetail(msgId) {
        Swal.fire({
            title: 'Memuat pesan...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading(),
            background: document.documentElement.getAttribute('data-theme') === 'dark' ? '#242424' : '#FFF',
        });

        try {
            const res = await fetch(`https://api.mail.tm/messages/${msgId}`, {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            const data = await res.json();

            Swal.fire({
                title: data.subject,
                html: `<div style="text-align: left; font-size: 14px; margin-top: 10px; border-top: 1px solid #E5E5E5; padding-top: 10px;">
                        <b>Dari:</b> ${data.from.address}<br><br>
                        ${data.html ? data.html[0] : (data.text || 'Tidak ada isi pesan.')}
                       </div>`,
                width: '600px',
                confirmButtonColor: '#D97757',
                confirmButtonText: 'Tutup',
                background: document.documentElement.getAttribute('data-theme') === 'dark' ? '#242424' : '#FFF',
                color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#E5E5E5' : '#1F1F1F'
            });
        } catch (error) {
            Swal.fire('Error', 'Gagal memuat detail pesan.', 'error');
        }
    }

    // 7. Event Listeners
    copyBtn.addEventListener('click', () => {
        if (!emailAddressInput.value) return;
        navigator.clipboard.writeText(emailAddressInput.value);
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
        setTimeout(() => copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>', 2000);
    });

    refreshBtn.addEventListener('click', () => {
        refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memperbarui...';
        fetchMessages().then(() => {
            setTimeout(() => refreshBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Perbarui Kotak Masuk', 1000);
        });
    });

    // Eksekusi awal
    setupEmail();
});
