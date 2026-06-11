const express = require('express');
const { execFile } = require('child_process');
const app = express();
const PORT = process.env.PORT || 7860;

app.use(express.json());

// Izinkan CORS agar dapat diakses oleh browser klien secara langsung
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
});

app.get('/', (req, res) => {
    res.json({ status: "active", message: "Kreaverse AI Downloader API is Running" });
});

app.get('/api/download', (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) {
        return res.status(400).json({ error: "Parameter 'url' is required" });
    }

    // Eksekusi secara aman menggunakan interpreter python3 secara langsung untuk mengatasi blokir perizinan kontainer
    execFile('python3', ['/usr/local/bin/yt-dlp', '--no-cache-dir', '-j', '--no-playlist', videoUrl], { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
            console.error("=== YT-DLP EXECUTION ERROR ===");
            console.error("Error:", error);
            console.error("Stderr:", stderr);
            return res.status(500).json({ error: "Failed to fetch metadata", details: stderr || error.message });
        }

        try {
            const metadata = JSON.parse(stdout);
            const streamUrl = metadata.url || (metadata.formats && metadata.formats[metadata.formats.length - 1]?.url);
            
            res.json({
                title: metadata.title || "Unknown Title",
                duration: metadata.duration || 0,
                thumbnail: metadata.thumbnail || (metadata.thumbnails && metadata.thumbnails[0]?.url) || "",
                url: streamUrl || "",
                ext: metadata.ext || "mp4"
            });
        } catch (parseError) {
            console.error("Failed to parse metadata:", parseError);
            res.status(500).json({ error: "Failed to parse metadata" });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Downloader API running on port ${PORT}`);
});