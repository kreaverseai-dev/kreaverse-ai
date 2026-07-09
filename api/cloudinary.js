// File: /api/cloudinary.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    const { fileBase64 } = req.body;

    if (!fileBase64) {
        return res.status(400).json({ error: 'File tidak ditemukan dalam request.' });
    }

    // Mengambil konfigurasi dari Vercel Environment Variables
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME; 
    const uploadPreset = process.env.CLOUDINARY_PRESET;

    if (!cloudName || !uploadPreset) {
        return res.status(500).json({ error: 'Konfigurasi Cloudinary (Env) belum diatur di Vercel.' });
    }

    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;

    try {
        const response = await fetch(cloudinaryUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                file: fileBase64,
                upload_preset: uploadPreset
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || 'Gagal mengunggah ke Cloudinary');
        }

        // Kembalikan URL file yang sudah diunggah
        return res.status(200).json({ url: data.secure_url, format: data.format });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
