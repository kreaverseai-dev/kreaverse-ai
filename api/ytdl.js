import { Readable } from 'stream';

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
        const contentLength = response.headers.get('content-length');

        // SOLUSI ERROR 500 VERCEL: Jika data adalah JSON (Fetch API Awal), kembalikan sebagai JSON
        if (contentType.includes('application/json')) {
            const data = await response.json();
            return res.status(200).json(data);
        }
        
        // SOLUSI OPTIMAL STREAMING: Alirkan data secara langsung (chunk-by-chunk) ke client.
        // Metode ini mencegah RAM server penuh dan mengatasi kegagalan unduh karena batasan muatan biner Vercel.
        res.setHeader('Content-Type', contentType);
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        const body = response.body;
        if (body) {
            if (typeof body.pipe === 'function') {
                body.pipe(res);
            } else {
                Readable.fromWeb(body).pipe(res);
            }
        } else {
            res.end();
        }

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: "Gagal memproses target: " + error.message });
        }
    }
}