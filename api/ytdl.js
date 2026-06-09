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
        // Mengambil data dari API tujuan (misal: Neoxr / Botcahx)
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const data = await response.json();
        
        // Mengembalikan data ke frontend Kreaverse
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: "Gagal mengambil data dari server tujuan: " + error.message });
    }
}