// File: /api/chat.js
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Gunakan method POST.' });

    // Sekarang menerima 'history' dari frontend agar AI tidak pelupa
    const { prompt, model, history = [] } = req.body;
    const FIREBASE_PROJECT_ID = "kreaverse-ai-2605f";
    let aiModel = model ? model.trim() : "openrouter/free"; 

    // 1. Ambil API Key dari Firebase
    let activeKeys = [];
    try {
        const fbRes = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                structuredQuery: {
                    from: [{ collectionId: "api_keys" }],
                    where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "aktif" } } }
                }
            })
        });

        const fbData = await fbRes.json();
        if (Array.isArray(fbData) && fbData[0].document) {
            activeKeys = fbData.map(item => item.document.fields.key.stringValue.trim());
        }
    } catch (e) {
        return res.status(500).json({ error: `Firebase Error: ${e.message}` });
    }

    if (activeKeys.length === 0) {
        return res.status(500).json({ error: 'API Key Kosong di Dasbor.' });
    }

    // 2. BANGUN KEPRIBADIAN AI & MASUKKAN MEMORI
    const systemPrompt = {
        role: "system",
        content: "Anda adalah 'Kreaverse AI', asisten cerdas dan sopan dari website Kreaverse yang menggunakan layanan API resmi. Selalu sesuaikan bahasa dengan pengguna (jika pengguna memakai bahasa Indonesia, jawab dengan bahasa Indonesia, jika Inggris balas dengan Inggris). Jawablah dengan ringkas, padat, dan secepat mungkin tanpa basa-basi yang terlalu panjang."
    };

    // Format histori obrolan sebelumnya
    const formattedHistory = history.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.text || "gambar"
    }));

    // Gabungkan: System + Memori Lama + Pesan Baru
    const finalMessages = [systemPrompt, ...formattedHistory, { role: "user", content: prompt }];

    // 3. Hubungkan ke OpenRouter
    try {
        const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${activeKeys[0]}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://74s-projects.vercel.app', 
                'X-OpenRouter-Title': 'Kreaverse AI' 
            },
            body: JSON.stringify({
                model: aiModel,
                messages: finalMessages
            })
        });

        const aiData = await aiRes.json();

        if (!aiRes.ok) {
            return res.status(500).json({ error: `Server Sedang Sibuk: ${aiData.error?.message || 'Silakan coba model lain'}` });
        }

        return res.status(200).json({ reply: aiData.choices[0].message.content });

    } catch (e) {
        return res.status(500).json({ error: `Koneksi Terputus: ${e.message}` });
    }
}
