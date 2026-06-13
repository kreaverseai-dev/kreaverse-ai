// api/lyricshot.js

async function uploadToCloudinary(base64Str, clAccounts) {
    if (!base64Str) return null;
    for (const account of clAccounts) {
        try {
            const res = await fetch(`https://api.cloudinary.com/v1_1/${account.cloudName}/image/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file: base64Str,
                    upload_preset: account.uploadPreset
                })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.secure_url) return data.secure_url;
            }
        } catch (err) {
            console.error("Cloudinary Rotation Fail:", err);
        }
    }
    return null;
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { lyrics, ratio, style, providerId, providerNaskahId, modelNaskah, modelVideo, faceImage, hijabImage, bajuImage, sepatuImage, aksesorisImage, fullModelImage } = req.body;

        if (!lyrics) {
            return res.status(400).json({ error: "Lirik tidak boleh kosong." });
        }

        const lines = lyrics.split(/(?:\r?\n|(?<=[a-z\.\s])(?=[A-Z])|(?=\([A-Za-z]))/g)
                            .map(line => line.trim())
                            .filter(line => line.length > 0);
        const totalClipsCount = lines.length;

        // 1. Tarik semua kunci aktif & akun Cloudinary aktif dari Firebase
        const firebaseUrl = "https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/api_keys";
        const fbRes = await fetch(firebaseUrl);
        const fbData = await fbRes.json();

        const clRes = await fetch("https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/cloudinary");
        const clData = await clRes.json();
        
        const activeCloudinaries = [];
        if (clData.documents) {
            const activeClDocs = clData.documents.filter(doc => doc.fields?.status?.stringValue?.toLowerCase() === "aktif");
            activeClDocs.forEach(doc => {
                activeCloudinaries.push({
                    cloudName: doc.fields?.cloud_name?.stringValue || doc.fields?.cloudName?.stringValue || "",
                    uploadPreset: doc.fields?.upload_preset?.stringValue || doc.fields?.uploadPreset?.stringValue || ""
                });
            });
        }
        if (activeCloudinaries.length === 0) {
            return res.status(500).json({ error: "Penyimpanan media (Cloudinary) tidak aktif." });
        }

        let activeKeys = [];
        if (fbData.documents) {
            activeKeys = fbData.documents.filter(doc => doc.fields?.status?.stringValue?.toLowerCase() === "aktif");
            activeKeys.sort((a, b) => {
                const pA = a.fields?.priority ? parseInt(a.fields.priority.integerValue || a.fields.priority.stringValue || 99) : 99;
                const pB = b.fields?.priority ? parseInt(b.fields.priority.integerValue || b.fields.priority.stringValue || 99) : 99;
                return pA - pB;
            });
        }

        // Ambil daftar semua kunci aktif untuk Naskah & Video
        const naskahDocs = activeKeys.filter(doc => doc.name.endsWith(providerNaskahId) || doc.fields?.provider?.stringValue?.toLowerCase().includes("gemini") || doc.fields?.provider?.stringValue?.toLowerCase().includes("openrouter"));
        const videoDocs = activeKeys.filter(doc => doc.name.endsWith(providerId) || doc.fields?.provider?.stringValue?.toLowerCase().includes("magic") || doc.fields?.provider?.stringValue?.toLowerCase().includes("leonardo"));

        if (naskahDocs.length === 0) return res.status(500).json({ error: "Kunci API Naskah aktif tidak ditemukan." });
        if (videoDocs.length === 0) return res.status(500).json({ error: "Kunci API Video aktif tidak ditemukan." });

        // 2. Unggah gambar aset menggunakan rotasi Cloudinary otomatis
        const [faceUrl, hijabUrl, bajuUrl, sepatuUrl, aksesorisUrl, fullModelUrl] = await Promise.all([
            uploadToCloudinary(faceImage, activeCloudinaries),
            uploadToCloudinary(hijabImage, activeCloudinaries),
            uploadToCloudinary(bajuImage, activeCloudinaries),
            uploadToCloudinary(sepatuImage, activeCloudinaries),
            uploadToCloudinary(aksesorisImage, activeCloudinaries),
            uploadToCloudinary(fullModelImage, activeCloudinaries)
        ]);

        // 3. Susun instruksi naskah dengan total jumlah klip dinamis berdasarkan lirik
        const systemPrompt = `Anda adalah sutradara video klip profesional. Tugas Anda adalah menganalisis lirik lagu yang diberikan dan membaginya menjadi beberapa adegan storyboard yang berurutan.
PENTING: Jumlah adegan dalam array JSON harus sama persis berjumlah ${totalClipsCount} adegan (tidak kurang, tidak lebih). Setiap adegan mewakili baris lirik lagunya secara berurutan.
Tentukan jenis shot, deskripsi visual yang detail dengan gaya visual "${style}", serta berikan prompt video yang berfokus pada pergerakan kamera dan ekspresi model untuk AI generator.

Respon Anda WAJIB dalam format JSON murni yang valid tanpa tambahan markdown ataupun penjelasan di luar JSON. Format JSON harus berupa array objek dengan struktur seperti ini:
[
  {
    "scene": 1,
    "lyrics_segment": "Teks baris lirik pertama di sini",
    "shot_type": "Close-up / Wide Shot / etc.",
    "visual_description": "Deskripsi gerakan kamera dan aktor secara detail",
    "video_prompt": "Prompt ringkas bahasa Inggris tentang pergerakan kamera dan aktor"
  }
]`;

        // 3. Eksekusi Naskah menggunakan Rotasi Kunci LLM otomatis (Bypass limit & saldo)
        let aiText = "";
        let naskahSuccess = false;
        for (const doc of naskahDocs) {
            const key = doc.fields?.key?.stringValue?.trim();
            const provName = doc.fields?.provider?.stringValue?.toLowerCase() || "";
            try {
                let geminiRes;
                if (provName.includes("gemini")) {
                    geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: `${systemPrompt}\n\nLirik Lagu:\n${lyrics}` }] }],
                            generationConfig: { responseMimeType: "application/json" }
                        })
                    });
                } else {
                    // OpenRouter
                    geminiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${key}`
                        },
                        body: JSON.stringify({
                            model: modelNaskah || "google/gemini-2.5-flash",
                            messages: [{ role: "user", content: `${systemPrompt}\n\nLirik Lagu:\n${lyrics}` }]
                        })
                    });
                }

                if (geminiRes.ok) {
                    const geminiData = await geminiRes.json();
                    let rawText = provName.includes("gemini") ? 
                        geminiData.candidates?.[0]?.content?.parts?.[0]?.text : 
                        geminiData.choices?.[0]?.message?.content;

                    if (rawText) {
                        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                        aiText = JSON.parse(rawText);
                        naskahSuccess = true;
                        break;
                    }
                }
            } catch (err) {
                console.error("LLM Key Fail, trying next...", err);
            }
        }

        if (!naskahSuccess) return res.status(500).json({ error: "Gagal membuat naskah. Semua API Key naskah habis saldo." });

        // 4. Proses render video per adegan menggunakan Rotasi Kunci Video otomatis (Bypass limit & saldo)
        const renderedScenes = [];

        for (const scene of aiText) {
            let finalVideoUrl = "";
            
            for (const doc of videoDocs) {
                const key = doc.fields?.key?.stringValue?.trim();
                const provName = doc.fields?.provider?.stringValue?.toLowerCase() || "";
                
                let apiEndpoint = "";
                let payload = {};

                if (provName.includes("magic")) {
                    apiEndpoint = "https://api.magichour.ai/v1/face-swap";
                    let clothingInstruction = "Wearing modern hijab and a flowing elegant gamis abaya dress, with no pants, elegantly draped";
                    if (aksesorisUrl) clothingInstruction += " and styled with accessories";

                    payload = {
                        assets: {
                            image: faceUrl || "https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg",
                            clothing: bajuUrl || null,
                            hijab: hijabUrl || null,
                            shoes: sepatuUrl || null,
                            accessories: aksesorisUrl || null
                        },
                        prompt: `${scene.video_prompt}, ${clothingInstruction}, ${style}`,
                        aspect_ratio: ratio === "9:16" ? "9:16" : "16:9",
                        duration: 10,
                        silent: true
                    };

                    try {
                        const videoRes = await fetch(apiEndpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${key}`
                            },
                            body: JSON.stringify(payload)
                        });

                        if (videoRes.ok) {
                            const videoData = await videoRes.json();
                            finalVideoUrl = videoData.video_url || videoData.url || "";
                            break; // Sukses, keluar dari loop key untuk adegan ini!
                        }
                    } catch (e) {
                        console.error("Magic Hour Key failed:", e);
                    }

                } else if (provName.includes("leonardo")) {
                    apiEndpoint = "https://cloud.leonardo.ai/api/rest/v1/generations-image-to-video";
                    payload = {
                        modelId: modelVideo || "kino-xl",
                        prompt: `${scene.video_prompt}, high quality cinematic style, ${style}`,
                        imageUrl: fullModelUrl || "https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg",
                        motionStrength: 5,
                        aspectRatio: ratio === "9:16" ? "9:16" : "16:9",
                        duration: 10
                    };

                    try {
                        const videoRes = await fetch(apiEndpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${key}`
                            },
                            body: JSON.stringify(payload)
                        });

                        if (videoRes.ok) {
                            const videoData = await videoRes.json();
                            finalVideoUrl = videoData.video_url || videoData.url || "";
                            break; // Sukses, keluar dari loop key untuk adegan ini!
                        }
                    } catch (e) {
                        console.error("Leonardo Key failed:", e);
                    }
                }
            }

            renderedScenes.push({
                scene: scene.scene,
                lyrics_segment: scene.lyrics_segment,
                shot_type: scene.shot_type,
                visual_description: scene.visual_description,
                video_url: finalVideoUrl || "https://assets.mixkit.co/videos/preview/mixkit-cinematic-shot-of-the-rainy-city-at-night-34139-large.mp4" // Fallback video jika seluruh kunci API habis
            });
        }

        return res.status(200).json(renderedScenes);

    } catch (error) {
        console.error("Internal Server Error:", error);
        return res.status(500).json({ error: "Kesalahan internal pada pemrosesan server." });
    }
}