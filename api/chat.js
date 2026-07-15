export default async function handler(req, res) {
    // 1. Setup CORS agar bisa diakses dari frontend tanpa diblokir browser
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // 2. Handle Preflight Request (Wajib untuk Vercel/Browser)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Gunakan POST.' });
    }

    try {
        // 3. Tangkap data dari frontend Kreaverse
        const { targetUrl, apiKey, headerName = 'Authorization', payload } = req.body;

        if (!targetUrl || !apiKey || !payload) {
            return res.status(400).json({ error: 'Parameter tidak lengkap dari frontend.' });
        }

        // 4. Teruskan request ke Server AI (NaraRouter, Groq, dll)
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [headerName]: `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        // 5. Ambil balasan dari Server AI
        const data = await response.json();

        // 6. Kembalikan balasan ke Kreaverse
        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.status(200).json(data);

    } catch (error) {
        console.error('Vercel API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}