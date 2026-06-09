export default async function handler(req, res) {
    // Mengizinkan CORS agar bisa diakses dari frontend
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { targetUrl } = req.query;

    if (!targetUrl) {
        return res.status(400).json({ error: "Parameter targetUrl wajib diisi." });
    }

    try {
        // SOLUSI DEP0169: Memastikan URL valid menggunakan API 'new URL()' modern 
        const safeUrl = new URL(targetUrl).href;

        // Mengambil data dari API tujuan (Bisa berupa JSON, MP3, atau MP4)
        const response = await fetch(safeUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const contentType = response.headers.get('content-type') || '';

        // SOLUSI ERROR 500 VERCEL: Jika data adalah JSON (Fetch API Awal), kembalikan sebagai JSON
        if (contentType.includes('application/json')) {
            const data = await response.json();
            return res.status(200).json(data);
        }
        
        // SOLUSI ERROR 500 VERCEL: Jika data adalah File Video/Audio, alirkan sebagai Buffer Binary
        // Ini yang membuat API Anda sebelumnya Error 500 (karena file video dipaksa dibaca sebagai JSON)
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        return res.status(200).send(buffer);

    } catch (error) {
        res.status(500).json({ error: "Gagal memproses target: " + error.message });
    }
}