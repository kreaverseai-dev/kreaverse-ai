const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 7860;

app.use(express.json());

// Sistem Header CORS Terbuka & Kebijakan Keamanan Jaringan
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Database User-Agent untuk Rotasi Penyamaran (Bypass TLS Fingerprinting)
const PREMIUM_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.231205.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "com.google.android.youtube/19.05.36 (Linux; U; Android 14; US; Pixel 8 Pro) gzip" // User-Agent Aplikasi Resmi YouTube
];

// Strategi Rotasi Player Client untuk menembus Blokir IP Hosting Google/Hugging Face
const YT_PLAYER_STRATEGIES = [
    "ios,android,web_embedded",
    "tv_simply,default,-tv",
    "web_safari,web_embedded,default",
    "android,web",
    "default,-web"
];

// Mencari rujukan terbaik berdasarkan tautan media
function dapatkanRefererDinamis(url) {
    const low = url.toLowerCase();
    if (low.includes('tiktok.com') || low.includes('vt.tiktok')) return 'https://www.tiktok.com/';
    if (low.includes('instagram.com')) return 'https://www.instagram.com/';
    if (low.includes('facebook.com')) return 'https://www.facebook.com/';
    if (low.includes('twitter.com') || low.includes('x.com')) return 'https://twitter.com/';
    if (low.includes('youtube.com') || low.includes('youtu.be')) return 'https://www.google.com/';
    return 'https://www.google.com/';
}

// Penyaring & Pemilih Format Media Terbaik (Smart Format Parser)
function dapatkanTautanFormatTerbaik(metadata) {
    let urlTerpilih = metadata.url || "";
    let extTerpilih = metadata.ext || "mp4";

    if (metadata.formats && metadata.formats.length > 0) {
        // Ambil format yang memiliki tautan HTTP langsung
        const validFormats = metadata.formats.filter(f => f.url && f.url.startsWith('http'));
        
        if (validFormats.length > 0) {
            // Cari format video yang sudah digabungkan murni dengan audionya secara default
            const mergedFormats = validFormats.filter(f => f.acodec !== 'none' && f.vcodec !== 'none');
            
            if (mergedFormats.length > 0) {
                // Urutkan berdasarkan resolusi tertinggi
                mergedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
                urlTerpilih = mergedFormats[0].url;
                extTerpilih = mergedFormats[0].ext || extTerpilih;
            } else {
                // Jika tidak ada yang pre-merged, ambil resolusi tertinggi yang tersedia
                validFormats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
                urlTerpilih = validFormats[0].url;
                extTerpilih = validFormats[0].ext || extTerpilih;
            }
        }
    }
    return { url: urlTerpilih, ext: extTerpilih };
}

// Pemetaan galat ramah sistem pengembang (Developer Error Map)
function petakanErrorSistem(stderr) {
    const err = String(stderr || "").toLowerCase();
    if (err.includes("confirm you are not a bot") || err.includes("captcha") || err.includes("403")) {
        return "IP Server diblokir sementara oleh penyedia platform (Bot Challenge). Silakan coba lagi atau gunakan server cadangan.";
    }
    if (err.includes("not comfortable for some audiences") || err.includes("age-gated") || err.includes("private")) {
        return "Media dilindungi pembatasan usia atau di-private oleh pengunggah. Silakan unggah cookies.txt ke GitHub Anda untuk membypass.";
    }
    if (err.includes("handshake operation timed out") || err.includes("connection reset") || err.includes("eof")) {
        return "Koneksi jaringan diputus secara paksa oleh platform. Retrying otomatis sedang dioptimalkan.";
    }
    return null;
}

app.get('/', (req, res) => {
    res.json({ status: "active", message: "Kreaverse AI Enterprise Downloader Engine is Running" });
});

app.get('/api/download', (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) {
        return res.status(400).json({ error: "Parameter 'url' is required" });
    }

    // Deteksi Kuki Keamanan secara Otomatis
    const cookieFile = path.join(__dirname, 'cookies.txt');
    const hasCookies = fs.existsSync(cookieFile);

    // FUNGSI EKSEKUSI UTAMA DENGAN RETRY LOOP DAN ROTASI PARAMETER (SELF-HEALING)
    async function jalankanEksekusi(strategyIndex = 0) {
        const userAgent = PREMIUM_USER_AGENTS[strategyIndex % PREMIUM_USER_AGENTS.length];
        const referer = dapatkanRefererDinamis(videoUrl);
        const playerClient = YT_PLAYER_STRATEGIES[strategyIndex % YT_PLAYER_STRATEGIES.length];

        const args = [
            '/usr/local/bin/yt-dlp',
            '--no-cache-dir',
            '--no-check-certificate',
            '--user-agent', userAgent,
            '--referer', referer,
            '-j',
            '--no-playlist',
            videoUrl
        ];

        // Jika ini tautan YouTube, terapkan penyamaran player client seluler bypass firewall
        if (videoUrl.toLowerCase().includes('youtube.com') || videoUrl.toLowerCase().includes('youtu.be')) {
            args.push('--extractor-args', `youtube:player_client=${playerClient}`);
        }

        // Masukkan kuki secara otomatis jika berkas cookies.txt terdeteksi di server
        if (hasCookies) {
            args.push('--cookies', cookieFile);
        }

        console.log(`[Attempt ${strategyIndex + 1}] Memproses URL menggunakan User-Agent ke-${strategyIndex} & Client: ${playerClient}`);

        execFile('python3', args, {
            maxBuffer: 1024 * 1024 * 12,
            timeout: 13000, // Timeout ketat 13 detik per percobaan agar tidak mematikan browser pengunjung
            killSignal: 'SIGKILL'
        }, async (error, stdout, stderr) => {
            
            if (error) {
                console.warn(`[Attempt ${strategyIndex + 1} Gagal] Stderr:`, stderr || error.message);
                
                // JIKA GAGAL, ROTASIKAN STRATEGI KE TINGKAT BERIKUTNYA SECARA OTOMATIS
                if (strategyIndex < YT_PLAYER_STRATEGIES.length - 1) {
                    return jalankanEksekusi(strategyIndex + 1);
                }
                
                // JIKA SEMUA RETRY STRATEGI HABIS & GAGAL TOTAL
                const humanError = petakanErrorSistem(stderr || error.message) || "Gagal menghubungi server platform sosial media.";
                return res.status(500).json({ 
                    error: "Failed to fetch metadata", 
                    details: humanError,
                    technical: stderr || error.message 
                });
            }

            try {
                const metadata = JSON.parse(stdout);
                const formatTerbaik = dapatkanTautanFormatTerbaik(metadata);

                // Kembalikan objek data yang telah disaring secara rapi dan instan
                return res.json({
                    title: metadata.title || "Kreaverse AI Media",
                    duration: metadata.duration ? `${Math.floor(metadata.duration / 60)}:${String(metadata.duration % 60).padStart(2,'0')}` : "0:00",
                    thumbnail: metadata.thumbnail || (metadata.thumbnails && metadata.thumbnails[0]?.url) || "https://i.postimg.cc/mZdwnfsm/Claude-ai-icon-svg.png",
                    url: formatTerbaik.url,
                    ext: formatTerbaik.ext,
                    provider: "Kreaverse Enterprise Server",
                    timestamp: Date.now()
                });
            } catch (parseError) {
                console.error("Gagal menyusun data:", parseError);
                return res.status(500).json({ error: "Failed to parse metadata" });
            }
        });
    }

    // Jalankan eksekusi lapis pertama
    jalankanEksekusi(0);
});

app.listen(PORT, () => {
    console.log(`Enterprise Downloader API running on port ${PORT}`);
});