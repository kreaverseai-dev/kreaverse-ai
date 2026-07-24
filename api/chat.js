export default async function handler(req, res) {
    // Hanya menerima metode POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, file, model } = req.body;
        
        // Mengambil API Key dari Vercel Environment Variables
        const apiKey = process.env.KIE_API_KEY; 
        
        if (!apiKey) {
            return res.status(500).json({ error: 'API Key belum dipasang di Vercel.' });
        }

        // Menyusun isi pesan (Teks + Gambar jika ada)
        let contentArray = [];

        // Jika ada file gambar, masukkan ke format Claude Vision
        if (file && file.type.startsWith('image/')) {
            contentArray.push({
                type: "image",
                source: {
                    type: "base64",
                    media_type: file.type,
                    data: file.data // Data base64 murni
                }
            });
        } else if (file) {
            // Jika file bukan gambar (misal MP3/ZIP), kita beri tahu AI nama filenya saja
            // Karena API chat standar biasanya hanya menerima gambar.
            contentArray.push({
                type: "text",
                text: `[Sistem: Pengguna melampirkan file bernama ${file.name} dengan tipe ${file.type}.]`
            });
        }

        // Masukkan teks pesan dari user
        if (message) {
            contentArray.push({
                type: "text",
                text: message
            });
        }

        // Menyusun Payload sesuai dokumentasi Kie.ai
        const payload = {
            model: model || "claude-opus-4-8",
            messages: [
                {
                    role: "user",
                    content: contentArray
                }
            ],
            max_tokens: 4096,
            stream: false // Kita matikan stream dulu agar lebih stabil
        };

        // Menembak API Kie.ai
        const response = await fetch('https://api.kie.ai/claude/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || 'Terjadi kesalahan dari Kie.ai');
        }

        // Mengambil teks balasan dari Claude
        const aiReply = data.content[0].text;

        // Mengirim balasan kembali ke Frontend
        return res.status(200).json({ reply: aiReply });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan pada server.' });
    }
}