// Fungsi utama untuk menembak API Vercel kita sendiri
async function callCodeOTP(endpoint, payload = null) {
    try {
        const response = await fetch('/api/codeotp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                endpoint: endpoint, 
                payload: payload 
            })
        });
        return await response.json();
    } catch (error) {
        console.error("Error:", error);
        return { status: false, message: "Terjadi kesalahan jaringan" };
    }
}

// 1. Fungsi Cek Profil & Saldo
async function cekProfil() {
    const result = await callCodeOTP('/v1/profil');
    
    if (result.status) {
        document.getElementById('profil-info').innerText = 
            `Halo ${result.data.name}, Saldo Anda: Rp ${result.data.balance}`;
    } else {
        alert("Gagal mengambil profil: " + result.message);
    }
}

// 2. Fungsi Buat Pesanan
async function buatPesanan() {
    const priceId = document.getElementById('input-price-id').value;
    if (!priceId) return alert("Masukkan Price ID dulu!");

    document.getElementById('hasil-pesanan').innerText = "Sedang memesan nomor...";
    
    // Panggil endpoint /v1/pesanan dengan payload price_id
    const result = await callCodeOTP('/v1/pesanan', { price_id: parseInt(priceId) });

    if (result.status) {
        const orderData = result.data;
        document.getElementById('hasil-pesanan').innerText = 
            `Berhasil! Nomor Anda: ${orderData.phone} (Order ID: ${orderData.order_id})`;
        
        // Mulai mengecek SMS secara otomatis setiap 5 detik
        cekSmsBerkala(orderData.order_id);
    } else {
        document.getElementById('hasil-pesanan').innerText = "Gagal: " + result.message;
    }
}

// 3. Fungsi Cek SMS Otomatis (Polling)
let intervalCekSms;
async function cekSmsBerkala(orderId) {
    document.getElementById('status-sms').innerText = "Menunggu SMS masuk... ⏳";
    
    // Cek setiap 5 detik (5000 ms)
    intervalCekSms = setInterval(async () => {
        const result = await callCodeOTP('/v1/pesanan/sms', { order_id: orderId });
        
        if (result.status && result.data.status === "success") {
            // Jika SMS masuk!
            document.getElementById('status-sms').innerText = 
                `🎉 SMS MASUK! Kode OTP Anda: ${result.data.sms_code}`;
            
            // Hentikan pengecekan otomatis
            clearInterval(intervalCekSms);
        } else {
            console.log("Belum ada SMS, mengecek lagi...");
        }
    }, 5000);
}

// Panggil cek profil saat halaman pertama kali dibuka
cekProfil();