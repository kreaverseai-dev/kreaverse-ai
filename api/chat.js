export default async function handler(req, res) {
    // Izinkan akses CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { targetUrl, headers, payload } = req.body;

        if (!targetUrl || !payload) {
            return res.status(400).json({ error: 'Data targetUrl atau payload tidak lengkap' });
        }

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: JSON.stringify(payload)
        };

        const apiResponse = await fetch(targetUrl, fetchOptions);
        const data = await apiResponse.json();

        res.status(apiResponse.status).json(data);
    } catch (error) {
        console.error('API Proxy Error:', error);
        res.status(500).json({ error: error.message });
    }
}