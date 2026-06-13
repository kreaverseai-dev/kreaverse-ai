// api/lyricshot.js

const OPENAI_COMPATIBLE_PROVIDERS = {
    "openai": { url: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-4o-mini" },
    "deepseek": { url: "https://api.deepseek.com/v1/chat/completions", defaultModel: "deepseek-chat" },
    "groq": { url: "https://api.groq.com/openai/v1/chat/completions", defaultModel: "llama3-8b-8192" },
    "openrouter": { url: "https://openrouter.ai/api/v1/chat/completions", defaultModel: "google/gemini-2.5-flash" },
    "mistral": { url: "https://api.mistral.ai/v1/chat/completions", defaultModel: "mistral-tiny" },
    "together": { url: "https://api.together.xyz/v1/chat/completions", defaultModel: "meta-llama/Llama-3-8b-chat-hf" }
};

function extractCleanJson(text) {
    if (typeof text !== 'string') return text;
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        return text.substring(firstBracket, lastBracket + 1);
    }
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
        const { lyrics, style, providerId, model } = req.body;

        if (!lyrics) {
            return res.status(400).json({ error: "Lirik tidak boleh kosong." });
        }

        // 1. Tarik semua data API Key berstatus aktif dari Firestore
        const firebaseUrl = "https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/api_keys";
        const fbRes = await fetch(firebaseUrl);
        const fbData = await fbRes.json();
        
        let activeDocs = [];
        if (fbData.documents) {
            activeDocs = fbData.documents.filter(doc => 
                doc.fields && doc.fields.status && doc.fields.status.stringValue.toLowerCase() === "aktif"
            );
            
            // Urutkan berdasarkan prioritas terkecil (tertinggi)
            activeDocs.sort((a, b) => {
                const pA = a.fields.priority ? parseInt(a.fields.priority.integerValue || a.fields.priority.stringValue) : 99;
                const pB = b.fields.priority ? parseInt(b.fields.priority.integerValue || b.fields.priority.stringValue) : 99;
                return pA - pB;
            });
        }

        if (activeDocs.length === 0) {
            return res.status(500).json({ error: "Layanan pembuatan storyboard sedang tidak tersedia (Jalur sibuk)." });
        }

        // 2. Susun Antrean Pencobaan Jalur API (Failover Queue)
        let attemptDocs = [];
        
        // Cari apakah ada provider yang dipilih secara manual oleh pengguna
        const selectedDoc = activeDocs.find(doc => doc.name.endsWith(providerId));
        if (selectedDoc) {
            attemptDocs.push(selectedDoc); // Masukkan pilihan utama pengguna sebagai antrean #1
        }
        
        // Gabungkan dengan sisa provider aktif lainnya sebagai jalur cadangan (Backup Routes)
        const backups = activeDocs.filter(doc => !doc.name.endsWith(providerId));
        attemptDocs = [...attemptDocs, ...backups];

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

        let success = false;
        let finalResponseText = "";
        let finalStatus = 500;
        let matchedProviderName = "";
        let isFirstAttempt = true;

        // 3. Jalankan Loop Failover Cerdas (Mencoba satu persatu sampai berhasil)
        for (const doc of attemptDocs) {
            const providerName = doc.fields.provider.stringValue.toLowerCase().trim();
            const apiKey = doc.fields.key.stringValue.trim();
            const customBaseUrl = doc.fields.base_url?.stringValue || doc.fields.baseUrl?.stringValue || null;
            const customEndpointPath = doc.fields.endpoint_path?.stringValue || doc.fields.endpointPath?.stringValue || doc.fields.endpoint?.stringValue || null;
            const customModelId = doc.fields.id_model?.stringValue || doc.fields.model?.stringValue || null;

            let responseText = "";
            let responseStatus = 200;
            let calledUrl = "";

            try {
                if (customBaseUrl && customEndpointPath) {
                    const cleanBase = customBaseUrl.endsWith('/') ? customBaseUrl.slice(0, -1) : customBaseUrl;
                    const cleanPath = customEndpointPath.startsWith('/') ? customEndpointPath : '/' + customEndpointPath;
                    calledUrl = `${cleanBase}${cleanPath}`;
                    
                    // Gunakan model pilihan pengguna di percobaan pertama, jika dialihkan gunakan model cadangan pertama
                    const modelToUse = (isFirstAttempt && model) ? model : (customModelId ? customModelId.split(',')[0].trim() : "gemini-2.5-flash");

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
                        calledUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
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
                    }
                }

                // Cek apakah HTTP status sukses (200-299)
                if (responseStatus >= 200 && responseStatus < 300) {
                    success = true;
                    finalResponseText = responseText;
                    matchedProviderName = providerName;
                    break; // Keluar dari loop pencobaan karena berhasil!
                } else {
                    console.warn(`Jalur ${providerName} mengembalikan HTTP ${responseStatus}. Mengalihkan secara senyap ke jalur cadangan...`);
                }

            } catch (fetchErr) {
                console.error(`Jalur ${providerName} mengalami kendala jaringan:`, fetchErr);
            }
            isFirstAttempt = false;
        }

        // 4. Penguraian Respon Sukses Akhir
        if (!success) {
            // Masking Error agar tidak menyebutkan kata "Saldo", "Limit", atau "Key error" ke pengguna
            return res.status(500).json({ 
                error: "Maaf, seluruh jalur pembuatan storyboard kami saat ini sedang padat. Tim teknis sedang melakukan pengalihan server. Silakan coba kembali beberapa saat lagi." 
            });
        }

        let responseData = JSON.parse(finalResponseText);
        let aiText = "";

        if (matchedProviderName.includes("betabotz")) {
            aiText = responseData.result || responseData.response || responseData;
        } else if (matchedProviderName.includes("google") || matchedProviderName.includes("gemini")) {
            aiText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } else {
            aiText = responseData.choices?.[0]?.message?.content || responseData.result || responseData.response || finalResponseText;
        }

        if (typeof aiText === 'string') {
            const cleanJsonText = extractCleanJson(aiText);
            try {
                aiText = JSON.parse(cleanJsonText);
            } catch (parseError) {
                return res.status(500).json({ error: "Gagal menyusun format adegan visual.", details: aiText });
            }
        }

        return res.status(200).json(aiText);

    } catch (error) {
        console.error("Vercel LyricShot API Error:", error);
        return res.status(500).json({ error: "Terjadi kesalahan internal pada server kami." });
    }
}