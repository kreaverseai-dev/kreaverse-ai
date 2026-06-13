// api/lyricshot.js

// Daftar Provider Standar OpenAI (Jika tidak menggunakan custom config dari dashboard)
const OPENAI_COMPATIBLE_PROVIDERS = {
    "openai": { url: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-4o-mini" },
    "deepseek": { url: "https://api.deepseek.com/v1/chat/completions", defaultModel: "deepseek-chat" },
    "groq": { url: "https://api.groq.com/openai/v1/chat/completions", defaultModel: "llama3-8b-8192" },
    "openrouter": { url: "https://openrouter.ai/api/v1/chat/completions", defaultModel: "google/gemini-2.5-flash" },
    "mistral": { url: "https://api.mistral.ai/v1/chat/completions", defaultModel: "mistral-tiny" },
    "together": { url: "https://api.together.xyz/v1/chat/completions", defaultModel: "meta-llama/Llama-3-8b-chat-hf" }
};

// Fungsi Pintar untuk membuang teks basa-basi AI dan mengambil hanya bagian JSON [ ... ]
function extractCleanJson(text) {
    if (typeof text !== 'string') return text;
    
    // Cari posisi kurung siku pertama dan terakhir
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        return text.substring(firstBracket, lastBracket + 1);
    }
    
    // Cari posisi kurung kurawal pertama dan terakhir
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return text.substring(firstBrace, lastBrace + 1);
    }
    
    return text;
}

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

        // 1. Ambil Kunci API Aktif Tertinggi dari Firebase
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

        // Ambil konfigurasi kustom (Base URL, Endpoint Path, Model ID) dari dashboard jika tersedia
        const customBaseUrl = activeDoc.fields.base_url?.stringValue || activeDoc.fields.baseUrl?.stringValue || null;
        const customEndpointPath = activeDoc.fields.endpoint_path?.stringValue || activeDoc.fields.endpointPath?.stringValue || activeDoc.fields.endpoint?.stringValue || null;
        const customModelId = activeDoc.fields.id_model?.stringValue || activeDoc.fields.model?.stringValue || null;

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
        let calledUrl = "";

        // 2. Tentukan Jalur Panggilan API
        if (customBaseUrl && customEndpointPath) {
            // JALUR DINAMIS DASHBOARD
            const cleanBase = customBaseUrl.endsWith('/') ? customBaseUrl.slice(0, -1) : customBaseUrl;
            const cleanPath = customEndpointPath.startsWith('/') ? customEndpointPath : '/' + customEndpointPath;
            calledUrl = `${cleanBase}${cleanPath}`;
            
            const modelToUse = customModelId ? customModelId.split(',')[0].trim() : "gemini-1.5-flash";

            const customRes = await fetch(calledUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: modelToUse,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `Lirik Lagu:\n${lyrics}` }
                    ]
                })
            });
            responseStatus = customRes.status;
            responseText = await customRes.text();

        } else {
            // JALUR HARDCODE CADANGAN
            const compatibleProviderKey = Object.keys(OPENAI_COMPATIBLE_PROVIDERS).find(p => providerName.includes(p));

            if (compatibleProviderKey) {
                const providerConfig = OPENAI_COMPATIBLE_PROVIDERS[compatibleProviderKey];
                calledUrl = providerConfig.url;
                const aiRes = await fetch(calledUrl, {
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
                calledUrl = "https://api.betabotz.eu.org/api/search/openai-custom";
                const betabotzRes = await fetch(calledUrl, {
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
                calledUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;
                const geminiRes = await fetch(`${calledUrl}?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: `${systemPrompt}\n\nLirik Lagu:\n${lyrics}` }]
                        }],
                        generationConfig: {
                            responseMimeType: "application/json"
                        }
                    })
                });
                responseStatus = geminiRes.status;
                responseText = await geminiRes.text();

            } else {
                return res.status(400).json({ error: `Provider '${providerName}' tidak terdeteksi konfigurasinya.` });
            }
        }

        // 3. Penguraian Respon Dasar
        let responseData;
        try { 
            responseData = JSON.parse(responseText); 
        } catch (e) { 
            return res.status(responseStatus).json({ 
                error: `Gagal membaca JSON dari server ${providerName} (HTTP ${responseStatus}). URL: ${calledUrl}`, 
                details: responseText 
            }); 
        }

        // === PROTEKSI: JIKA SERVER AI MENGEMBALIKAN ERROR HTTP (Seperti 400, 401, 403, 404, 429) ===
        if (responseStatus < 200 || responseStatus >= 300) {
            const errorMsg = responseData.error?.message || responseData.error || responseText;
            const cleanErrorMsg = typeof errorMsg === 'object' ? JSON.stringify(errorMsg) : errorMsg;
            return res.status(responseStatus).json({ 
                error: `HTTP ${responseStatus}: ${cleanErrorMsg} (URL: ${calledUrl})`
            });
        }

        // Ambil isi teks kasar berdasarkan asal provider
        let aiText = "";
        if (customBaseUrl && customEndpointPath) {
            aiText = responseData.choices?.[0]?.message?.content || responseData.result || responseData.response || responseText;
        } else {
            const compatibleProviderKey = Object.keys(OPENAI_COMPATIBLE_PROVIDERS).find(p => providerName.includes(p));
            if (compatibleProviderKey) {
                aiText = responseData.choices?.[0]?.message?.content || "";
            } else if (providerName.includes("betabotz")) {
                aiText = responseData.result || responseData.response || responseData;
            } else if (providerName.includes("google") || providerName.includes("gemini")) {
                aiText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
            }
        }

        // 4. Ekstrak Hanya Bagian JSON yang valid
        if (typeof aiText === 'string') {
            const cleanJsonText = extractCleanJson(aiText);
            try {
                aiText = JSON.parse(cleanJsonText);
            } catch (parseError) {
                return res.status(500).json({ error: "Gagal memotong teks obrolan AI ke JSON bersih.", details: aiText });
            }
        }

        return res.status(200).json(aiText);

    } catch (error) {
        console.error("Vercel LyricShot API Error:", error);
        return res.status(500).json({ error: "Vercel Internal Error: " + error.message });
    }
}