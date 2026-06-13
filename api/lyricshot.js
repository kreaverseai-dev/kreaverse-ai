// api/lyricshot.js

async function uploadToCloudinary(base64Str) {
    if (!base64Str) return null;
    try {
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "kreaverse-ai0107";
        const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || "ml_default";
        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file: base64Str,
                upload_preset: uploadPreset
            })
        });
        const data = await res.json();
        return data.secure_url || null;
    } catch (err) {
        console.error("Cloudinary Upload Error:", err);
        return null;
    }
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { lyrics, ratio, style, providerId, faceImage, hijabImage, bajuImage, sepatuImage, aksesorisImage, fullModelImage } = req.body;

        if (!lyrics) {
            return res.status(400).json({ error: "Lirik tidak boleh kosong." });
        }

        const lines = lyrics.split('\n').filter(line => line.trim().length > 0);
        const totalClipsCount = lines.length;

        // 1. Ambil API Key Gemini / OpenRouter dari Firebase Firestore
        const firebaseUrl = "https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/api_keys";
        const fbRes = await fetch(firebaseUrl);
        const fbData = await fbRes.json();
        
        let geminiKey = null;
        let videoApiKey = null;
        let selectedProviderName = "";
        
        if (fbData.documents) {
            const activeDocs = fbData.documents.filter(doc => 
                doc.fields && doc.fields.status && doc.fields.status.stringValue.toLowerCase() === "aktif"
            );

            // Temukan Key Gemini/OpenRouter untuk penulisan naskah lirik
            const geminiDoc = activeDocs.find(doc => doc.fields.provider.stringValue.toLowerCase().includes("gemini") || doc.fields.provider.stringValue.toLowerCase().includes("openrouter"));
            if (geminiDoc) geminiKey = geminiDoc.fields.key.stringValue.trim();

            // Temukan Key Video pilihan pengguna
            const videoDoc = activeDocs.find(doc => doc.name.endsWith(providerId)) || activeDocs.find(doc => doc.fields.provider.stringValue.toLowerCase().includes("magic") || doc.fields.provider.stringValue.toLowerCase().includes("leonardo"));
            if (videoDoc) {
                videoApiKey = videoDoc.fields.key.stringValue.trim();
                selectedProviderName = videoDoc.fields.provider.stringValue.toLowerCase();
            }
        }

        if (!geminiKey) return res.status(500).json({ error: "API Key Gemini atau OpenRouter tidak aktif di database." });
        if (!videoApiKey) return res.status(500).json({ error: "API Key Video tidak ditemukan." });

        // 2. Unggah gambar aset ke Cloudinary secara paralel
        const [faceUrl, hijabUrl, bajuUrl, sepatuUrl, aksesorisUrl, fullModelUrl] = await Promise.all([
            uploadToCloudinary(faceImage),
            uploadToCloudinary(hijabImage),
            uploadToCloudinary(bajuImage),
            uploadToCloudinary(sepatuImage),
            uploadToCloudinary(aksesorisImage),
            uploadToCloudinary(fullModelImage)
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

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `${systemPrompt}\n\nLirik Lagu:\n${lyrics}` }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });

        const geminiData = await geminiRes.json();
        let aiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        
        if (typeof aiText === 'string') {
            aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
            aiText = JSON.parse(aiText);
        }

        // 4. Proses render video per adegan menggunakan provider terpilih
        const renderedScenes = [];

        for (const scene of aiText) {
            let finalVideoUrl = "";
            let apiEndpoint = "";
            let payload = {};

            if (selectedProviderName.includes("magic")) {
                apiEndpoint = "https://api.magichour.ai/v1/face-swap";
                
                // Gabungkan instruksi pakaian, hijab, aksesoris, dan model di prompt
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

                const videoRes = await fetch(apiEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${videoApiKey}`
                    },
                    body: JSON.stringify(payload)
                });

                if (videoRes.ok) {
                    const videoData = await videoRes.json();
                    finalVideoUrl = videoData.video_url || videoData.url || "";
                }

            } else if (selectedProviderName.includes("leonardo")) {
                apiEndpoint = "https://cloud.leonardo.ai/api/rest/v1/generations-image-to-video";
                payload = {
                    modelId: "kino-xl",
                    prompt: `${scene.video_prompt}, high quality cinematic style, ${style}`,
                    imageUrl: fullModelUrl || "https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg",
                    motionStrength: 5,
                    aspectRatio: ratio === "9:16" ? "9:16" : "16:9",
                    duration: 10
                };

                const videoRes = await fetch(apiEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${videoApiKey}`
                    },
                    body: JSON.stringify(payload)
                });

                if (videoRes.ok) {
                    const videoData = await videoRes.json();
                    finalVideoUrl = videoData.video_url || videoData.url || "";
                }
            }

            renderedScenes.push({
                scene: scene.scene,
                lyrics_segment: scene.lyrics_segment,
                shot_type: scene.shot_type,
                visual_description: scene.visual_description,
                video_url: finalVideoUrl || "https://assets.mixkit.co/videos/preview/mixkit-cinematic-shot-of-the-rainy-city-at-night-34139-large.mp4" // Fallback jika kuota habis
            });
        }

        return res.status(200).json(renderedScenes);

    } catch (error) {
        console.error("Internal Server Error:", error);
        return res.status(500).json({ error: "Kesalahan internal pada pemrosesan server." });
    }
}