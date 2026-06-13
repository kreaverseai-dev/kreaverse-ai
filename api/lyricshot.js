// api/lyricshot.js

// 1. Daftar Provider yang menggunakan standar format OpenAI (OpenAI-Compatible)
const OPENAI_COMPATIBLE_PROVIDERS = {
    "openai": {
        url: "https://api.openai.com/v1/chat/completions",
        defaultModel: "gpt-4o-mini"
    },
    "deepseek": {
        url: "https://api.deepseek.com/v1/chat/completions",
        defaultModel: "deepseek-chat"
    },
    "groq": {
        url: "https://api.groq.com/openai/v1/chat/completions",
        defaultModel: "llama3-8b-8192"
    },
    "openrouter": {
        url: "https://openrouter.ai/api/v1/chat/completions",
        defaultModel: "google/gemini-2.5-flash"
    },
    "mistral": {
        url: "https://api.mistral.ai/v1/chat/completions",
        defaultModel: "mistral-tiny"
    },
    "together": {
        url: "https://api.together.xyz/v1/chat/completions",
        defaultModel: "meta-llama/Llama-3-8b-chat-hf"
    }
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { lyrics, style } = req.body;

        if (!lyrics) {
            return res.status(400).json({ error: "Lirik tidak boleh kosong." });
        }

        // 2. Ambil Kunci API Aktif Tertinggi dari Firebase
        const firebaseUrl = "https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/api_keys";
        const fbRes = await fetch(firebaseUrl);
        const fbData = await fbRes.json();
        
        let activeDoc = null;
        if (fbData.documents) {
            const activeDocs = fbData.documents.filter(doc => 
                doc.fields && doc.fields.status && doc.fields.status.stringValue.toLowerCase() === "aktif"
            );
            
            activeDocs.sort((a, b) => {
                const pA = a.fields.priority ? parseInt(a.fields.priority.integerValue || a.fields.priority.stringValue) : 99;
                const pB = b.fields.priority ? parseInt(b.fields.priority.integerValue || b.fields.priority.stringValue) : 99;
                return pA - pB;
            });

            if (activeDocs.length > 0) {
                activeDoc = activeDocs[0];
            }
        }

        if (!activeDoc) {
            return res.status(500).json({ error: "Tidak ada API Key berstatus 'aktif' ditemukan di database Firebase." });
        }

        const providerName = activeDoc.fields.provider.stringValue.toLowerCase().trim();
        const apiKey = activeDoc.fields.key.stringValue.trim();

        // System Prompt untuk instruksi Storyboard
        const systemPrompt = `Anda adalah sutradara video klip profesional. Tugas Anda adalah menganalisis lirik lagu yang diberikan dan membaginya menjadi beberapa adegan storyboard yang berurutan.
Tentukan jenis shot, deskripsi visual yang detail dengan gaya visual "${style}", serta berikan prompt gambar dan prompt video untuk AI generator.

Respon Anda WAJIB dalam format JSON murni yang valid tanpa tambahan markdown ataupun penjelasan di luar JSON. Format JSON harus berupa array objek dengan struktur seperti ini:
[
  {
    "scene": 1,
    "lyrics_segment": "Potongan lirik adegan ini",
    "shot_type": "Close-up / Wide Shot / etc.",
    "visual_description": "Deskripsi adegan visual secara detail",
    "image_prompt": "Prompt detail untuk generate gambar",
    "video_prompt": "Prompt detail untuk generate video"
  }
]`;

        let responseText = "";
        let responseStatus = 200;

        // 3. Cari tahu apakah provider yang aktif termasuk dalam standar OpenAI-Compatible
        const compatibleProviderKey = Object.keys(OPENAI_COMPATIBLE_PROVIDERS).find(p => providerName.includes(p));

        if (compatibleProviderKey) {
            // JALUR UNIVERSAL (Otomatis mendukung OpenAI, DeepSeek, Groq, OpenRouter, Mistral, dll.)
            const providerConfig = OPENAI_COMPATIBLE_PROVIDERS[compatibleProviderKey];
            
            const aiRes = await fetch(providerConfig.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: providerConfig.defaultModel,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `Lirik Lagu:\n${lyrics}` }
                    ]
                })
            });
            responseStatus = aiRes.status;
            responseText = await aiRes.text();

        } else if (providerName.includes("betabotz")) {
            // JALUR KHUSUS BETABOTZ (karena struktur payload request-nya sedikit berbeda)
            const betabotzRes = await fetch("https://api.betabotz.eu.org/api/search/openai-custom", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `Lirik Lagu:\n${lyrics}` }
                    ],
                    apikey: apiKey
                })
            });
            responseStatus = betabotzRes.status;
            responseText = await betabotzRes.text();

        } else if (providerName.includes("google") || providerName.includes("gemini")) {
            // JALUR KHUSUS GOOGLE GEMINI (karena format request-nya berbeda sendiri)
            const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: `${systemPrompt}\n\nLirik Lagu:\n${lyrics}` }]
                    }]
                })
            });
            responseStatus = geminiRes.status;
            responseText = await geminiRes.text();

        } else {
            return res.status(400).json({ error: `Provider '${providerName}' yang aktif belum didukung oleh script LyricShot AI.` });
        }

        // 4. Penguraian Respon berdasarkan tipe provider
        let responseData;
        try { 
            responseData = JSON.parse(responseText); 
        } catch (e) { 
            return res.status(responseStatus).json({ error: `Gagal membaca respon dari server ${providerName}.`, details: responseText }); 
        }

        let aiText = "";
        if (compatibleProviderKey) {
            aiText = responseData.choices?.[0]?.message?.content || "";
        } else if (providerName.includes("betabotz")) {
            aiText = responseData.result || responseData.response || responseData;
        } else if (providerName.includes("google") || providerName.includes("gemini")) {
            aiText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }

        // 5. Bersihkan format markdown JSON dari AI jika ada, lalu kirim kembali ke browser
        if (typeof aiText === 'string') {
            aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
            try {
                aiText = JSON.parse(aiText);
            } catch (parseError) {
                return res.status(500).json({ error: "Format hasil AI tidak dapat diterjemahkan ke JSON.", details: aiText });
            }
        }

        return res.status(200).json(aiText);

    } catch (error) {
        console.error("Vercel LyricShot API Error:", error);
        return res.status(500).json({ error: "Vercel Internal Error: " + error.message });
    }
}