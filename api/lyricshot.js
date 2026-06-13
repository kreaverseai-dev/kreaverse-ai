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

async function saveToFirestore(fields) {
    try {
        const payload = {
            fields: {
                email: { stringValue: fields.email || "anon@kreaverse.ai" },
                tool: { stringValue: "LyricShot AI" },
                status: { stringValue: fields.status || "pending" },
                task_id: { stringValue: fields.task_id || "" },
                provider: { stringValue: fields.provider || "" },
                model: { stringValue: fields.model || "default" },
                lyrics_segment: { stringValue: fields.lyrics_segment || "" },
                prompt: { stringValue: fields.prompt || "" },
                url: { stringValue: fields.url || "" },
                timestamp: { integerValue: String(fields.timestamp || Date.now()) }
            }
        };
        const res = await fetch("https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/render_gallery?key=AIzaSyAO8JV4jkJmbHChYvjUCS7wqfVbKr94tHM", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            const data = await res.json();
            if (data.name) return data.name.split('/').pop();
        } else {
            const errText = await res.text();
            console.error("Firestore write failed:", errText);
        }
    } catch (err) {
        console.error("Firestore write network error:", err);
    }
    return "";
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { email, lyrics, ratio, style, providerId, providerNaskahId, modelNaskah, modelVideo, faceImage, hijabImage, bajuImage, sepatuImage, aksesorisImage, fullModelImage } = req.body;

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

        let activeKeys = [];
        if (fbData.documents) {
            activeKeys = fbData.documents.filter(doc => doc.fields?.status?.stringValue?.toLowerCase() === "aktif");
            activeKeys.sort((a, b) => {
                const pA = a.fields?.priority ? parseInt(a.fields.priority.integerValue || a.fields.priority.stringValue || 99) : 99;
                const pB = b.fields?.priority ? parseInt(b.fields.priority.integerValue || b.fields.priority.stringValue || 99) : 99;
                return pA - pB;
            });
        }

        // Ambil daftar kunci aktif berdasarkan provider terstandarisasi yang dipilih
        let naskahDocs = [];
        if (providerNaskahId === "googlegemini") {
            naskahDocs = activeKeys.filter(doc => doc.fields?.provider?.stringValue?.toLowerCase().includes("gemini") || doc.fields?.provider?.stringValue?.toLowerCase().includes("google"));
        } else if (providerNaskahId === "openrouter") {
            naskahDocs = activeKeys.filter(doc => doc.fields?.provider?.stringValue?.toLowerCase().includes("openrouter"));
        } else {
            naskahDocs = activeKeys.filter(doc => doc.fields?.provider?.stringValue?.toLowerCase().includes("gemini") || doc.fields?.provider?.stringValue?.toLowerCase().includes("openrouter"));
        }

        let videoDocs = [];
        if (providerId === "magichour") {
            videoDocs = activeKeys.filter(doc => doc.fields?.provider?.stringValue?.toLowerCase().includes("magic"));
        } else if (providerId === "leonardoai") {
            videoDocs = activeKeys.filter(doc => doc.fields?.provider?.stringValue?.toLowerCase().includes("leonardo"));
        } else {
            videoDocs = activeKeys.filter(doc => doc.fields?.provider?.stringValue?.toLowerCase().includes("magic") || doc.fields?.provider?.stringValue?.toLowerCase().includes("leonardo"));
        }

        if (naskahDocs.length === 0) return res.status(500).json({ error: "Kunci API Naskah aktif tidak ditemukan." });
        if (videoDocs.length === 0) return res.status(500).json({ error: "Kunci API Video aktif tidak ditemukan." });

        const selectedProviderName = videoDocs[0]?.fields?.provider?.stringValue?.toLowerCase() || "";

        // Deteksi apakah pengguna mengunggah setidaknya satu foto acuan
        const hasUploads = faceImage || hijabImage || bajuImage || sepatuImage || aksesorisImage || fullModelImage;
        
        let faceUrl = null;
        let hijabUrl = null;
        let bajuUrl = null;
        let sepatuUrl = null;
        let aksesorisUrl = null;
        let fullModelUrl = null;

        if (hasUploads) {
            // Hanya memproses database Cloudinary jika pengguna mengunggah foto
            let activeCloudinaries = [];
            const cloudinaryCollections = ["cloudinary", "cloudinary_db", "cloudinary_accounts"];
            
            for (const col of cloudinaryCollections) {
                try {
                    const clRes = await fetch(`https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/${col}`);
                    if (clRes.ok) {
                        const clData = await clRes.json();
                        if (clData.documents && clData.documents.length > 0) {
                            const activeClDocs = clData.documents.filter(doc => doc.fields?.status?.stringValue?.toLowerCase() === "aktif");
                            if (activeClDocs.length > 0) {
                                activeClDocs.forEach(doc => {
                                    activeCloudinaries.push({
                                        cloudName: doc.fields?.cloud_name?.stringValue || doc.fields?.cloudName?.stringValue || doc.fields?.cloud_name_unsigned?.stringValue || "",
                                        uploadPreset: doc.fields?.upload_preset?.stringValue || doc.fields?.uploadPreset?.stringValue || doc.fields?.upload_preset_unsigned?.stringValue || ""
                                    });
                                });
                                break;
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Gagal memuat alternatif koleksi Cloudinary ${col}:`, err);
                }
            }

            if (activeCloudinaries.length === 0) {
                return res.status(500).json({ error: "Penyimpanan media (Cloudinary) tidak aktif. Periksa nama koleksi Cloudinary Anda di Firestore." });
            }

            // 2. Unggah gambar aset menggunakan rotasi Cloudinary otomatis
            [faceUrl, hijabUrl, bajuUrl, sepatuUrl, aksesorisUrl, fullModelUrl] = await Promise.all([
                uploadToCloudinary(faceImage, activeCloudinaries),
                uploadToCloudinary(hijabImage, activeCloudinaries),
                uploadToCloudinary(bajuImage, activeCloudinaries),
                uploadToCloudinary(sepatuImage, activeCloudinaries),
                uploadToCloudinary(aksesorisImage, activeCloudinaries),
                uploadToCloudinary(fullModelImage, activeCloudinaries)
            ]);
        }

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
                            'accept': 'application/json',
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
                } else {
                    const errorText = await geminiRes.text();
                    console.error(`${provName.toUpperCase()} API Error [Status ${geminiRes.status}]:`, errorText);
                }
            } catch (err) {
                console.error("LLM Key Fail, trying next...", err);
            }
        }

        if (!naskahSuccess) return res.status(500).json({ error: "Gagal membuat naskah. Semua API Key naskah habis saldo." });

        // 4. Proses render video per adegan menggunakan Rotasi Kunci Video otomatis secara parallel
        const renderPromises = aiText.map(async (scene) => {
            let finalVideoUrl = "";
            
            for (const doc of videoDocs) {
                const key = doc.fields?.key?.stringValue?.trim();
                const provName = doc.fields?.provider?.stringValue?.toLowerCase() || "";
                
                let apiEndpoint = "";
                let payload = {};

                if (provName.includes("magic")) {
                    const isCustomGen = faceUrl || bajuUrl || hijabUrl;
                    apiEndpoint = "https://api.magichour.ai/v1/text-to-video";
                    
                    let defaultCharacter = "";
                    if (!isCustomGen) {
                        defaultCharacter = "The main character is an elegant 20-year-old Indonesian woman resembling a warm, friendly Indonesian student with a soft neat face, wearing a neat pastel Indonesian-style hijab and a flowing long elegant gamis/dress (no pants, khas Indonesia)";
                    } else {
                        defaultCharacter = "Wearing modern hijab and a flowing elegant gamis abaya dress, with no pants, elegantly draped";
                    }
                    if (aksesorisUrl) defaultCharacter += " and styled with accessories";

                    payload = {
                        end_seconds: 5.0,
                        orientation: ratio === "9:16" ? "portrait" : "landscape",
                        style: {
                            prompt: `${scene.video_prompt}, ${defaultCharacter}, ${style}`
                        },
                        name: `Lyrics Shot - Scene ${scene.scene}`,
                        resolution: "480p"
                    };

                    try {
                        const videoRes = await fetch(apiEndpoint, {
                            method: 'POST',
                            headers: {
                                'accept': 'application/json',
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${key}`
                            },
                            body: JSON.stringify(payload)
                        });

                        if (videoRes.ok) {
                            const videoData = await videoRes.json();
                            finalVideoUrl = videoData.id || ""; // Mengambil Task ID Magic Hour
                            break; 
                        } else {
                            const errorText = await videoRes.text();
                            console.error(`Magic Hour API Error [Status ${videoRes.status}]:`, errorText);
                        }
                    } catch (e) {
                        console.error("Magic Hour Key failed:", e);
                    }

                } else if (provName.includes("leonardo")) {
                    apiEndpoint = "https://cloud.leonardo.ai/api/rest/v1/generations-text-to-video";
                    
                    const width = ratio === "9:16" ? 480 : 832;
                    const height = ratio === "9:16" ? 832 : 480;

                    let defaultCharacter = "";
                    if (fullModelUrl) {
                        defaultCharacter = `An Indonesian model resembling the model in this reference: ${fullModelUrl}, elegant cinematic, `;
                    } else {
                        defaultCharacter = "The main character is an elegant 20-year-old Indonesian woman resembling a warm, friendly Indonesian student with a soft neat face, wearing a neat pastel Indonesian-style hijab and a flowing long elegant gamis/dress (no pants, khas Indonesia), ";
                    }

                    payload = {
                        prompt: `${scene.video_prompt}, ${defaultCharacter}high quality cinematic style, ${style}`,
                        model: "MOTION2FAST",
                        width: width,
                        height: height,
                        resolution: "RESOLUTION_480",
                        frameInterpolation: true
                    };

                    try {
                        const videoRes = await fetch(apiEndpoint, {
                            method: 'POST',
                            headers: {
                                'accept': 'application/json',
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${key}`
                            },
                            body: JSON.stringify(payload)
                        });

                        if (videoRes.ok) {
                            const videoData = await videoRes.json();
                            finalVideoUrl = videoData.sdGenerationJob?.generationId || videoData.generationId || ""; // Mengambil Generation ID Leonardo
                            if (finalVideoUrl) {
                                break; 
                            }
                        } else {
                            const errorText = await videoRes.text();
                            console.error(`Leonardo AI API Error [Status ${videoRes.status}]:`, errorText);
                        }
                    } catch (e) {
                        console.error("Leonardo Key failed:", e);
                    }
                }
            }

            const sceneResult = {
                scene: scene.scene,
                lyrics_segment: scene.lyrics_segment,
                shot_type: scene.shot_type,
                visual_description: scene.visual_description,
                status: finalVideoUrl ? "pending" : "failed",
                task_id: finalVideoUrl || "",
                provider: selectedProviderName,
                video_url: ""
            };

            // Simpan langsung ke Firestore render_gallery di sisi server (Offline Background support!)
            const firestoreId = await saveToFirestore({
                email: email || "anon@kreaverse.ai",
                status: sceneResult.status,
                task_id: sceneResult.task_id,
                provider: selectedProviderName,
                model: modelVideo || "default",
                lyrics_segment: sceneResult.lyrics_segment,
                prompt: sceneResult.visual_description,
                url: "",
                timestamp: Date.now()
            });

            sceneResult.firestore_id = firestoreId;
            return sceneResult;
        });

        const renderedScenes = await Promise.all(renderPromises);
        return res.status(200).json(renderedScenes);

    } catch (error) {
        console.error("Internal Server Error:", error);
        return res.status(500).json({ error: "Kesalahan internal pada pemrosesan server." });
    }
}