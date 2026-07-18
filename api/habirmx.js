const admin = require("firebase-admin");

// Inisialisasi Firebase Admin SDK secara aman
try {
    if (!admin.apps.length) {
        let rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_ACCOUNT || "{}";
        let serviceAccount;
        
        try {
            serviceAccount = JSON.parse(rawKey);
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }
        } catch (e) {
            const emailMatch = rawKey.match(/"client_email"\s*:\s*"([^"]+)"/);
            const projectMatch = rawKey.match(/"project_id"\s*:\s*"([^"]+)"/);
            const keyMatch = rawKey.match(/-----BEGIN PRIVATE KEY-----(.*?)-----END PRIVATE KEY-----/s);
            
            if (emailMatch && projectMatch && keyMatch) {
                const cleanKeyBody = keyMatch[1].replace(/\s+/g, '\n').trim();
                const formattedKey = `-----BEGIN PRIVATE KEY-----\n${cleanKeyBody}\n-----END PRIVATE KEY-----\n`;
                
                serviceAccount = {
                    client_email: emailMatch[1],
                    project_id: projectMatch[1],
                    private_key: formattedKey
                };
            } else {
                throw new Error("Gagal mengekstrak kredensial dari FIREBASE_SERVICE_ACCOUNT_KEY atau FIREBASE_ACCOUNT");
            }
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL
        });
    }
} catch (err) {
    console.error("Gagal Inisialisasi Firebase Admin:", err.message);
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function getValueByPath(obj, path) {
    if (!path) return null;
    return path.split('.').reduce((acc, part) => acc && acc[part] !== undefined ? acc[part] : null, obj);
}

function renderTemplate(templateStr, variables) {
    // Regex untuk mencari {{key}} atau {{key:angka}} (contoh: {{prompt:390}})
    return templateStr.replace(/\{\{([a-zA-Z0-9_]+)(?::(\d+))?\}\}/g, (match, key, limitStr) => {
        let safeValue = variables[key] || "";
        if (typeof safeValue === 'string') {
            // Fitur Smart Truncate (Potong aman tanpa merusak kata)
            if (limitStr) {
                const limit = parseInt(limitStr, 10);
                if (safeValue.length > limit) {
                    let cutStr = safeValue.substring(0, limit - 3);
                    let lastSpace = cutStr.lastIndexOf(' ');
                    // Pastikan spasi tidak terlalu jauh di belakang agar potongannya proporsional
                    if (lastSpace > limit * 0.7) {
                        cutStr = cutStr.substring(0, lastSpace);
                    }
                    safeValue = cutStr + "...";
                }
            }
            
            safeValue = safeValue
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t');
        }
        return safeValue;
    });
}

// Fallback pencarian URL Audio jika path di Admin salah
function findAudioUrlRecursively(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const targetKeys = ['audioUrl', 'audio_url', 'videoUrl', 'video_url', 'download_url', 'url', 'play_url', 'file_url', 'suno_audio_url'];
    for (const key of targetKeys) {
        if (obj[key] && typeof obj[key] === 'string' && obj[key].startsWith('http') && !obj[key].includes('callback')) {
            if (!obj[key].match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) && !obj[key].includes('image_') && !obj[key].includes('image/')) {
                return obj[key];
            }
        }
    }
    for (const key in obj) {
        if (typeof obj[key] === 'object') {
            const found = findAudioUrlRecursively(obj[key]);
            if (found) return found;
        }
    }
    return null;
}

// Fallback pencarian pesan Error
function extractErrorString(obj) {
    if (!obj) return null;
    if (typeof obj === 'string') return obj;
    if (typeof obj !== 'object') return String(obj);
    
    const keys = ['failReason', 'errorMessage', 'error_message', 'fail_reason', 'error', 'message', 'msg', 'detail', 'reason'];
    for (const key of keys) {
        if (obj[key] && typeof obj[key] === 'string' && obj[key].trim() !== '' && obj[key].toLowerCase() !== 'success' && obj[key].toLowerCase() !== 'ok') {
            return obj[key].trim();
        }
    }
    
    for (const key in obj) {
        if (typeof obj[key] === 'object') {
            const found = extractErrorString(obj[key]);
            if (found) return found;
        }
    }
    return null;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'POST') {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }
        if (!body) body = {};

        const { action, email, providerId, modelId, title, prompt, instrumental, lyrics, audioUrl, options, llmType, inputText, vocalGender, currentMode } = body;

        // ============================================================
        // ROUTE 1A: DETEKSI LIRIK (ASR WHISPER)
        // ============================================================
        if (action === 'detect_lyrics') {
            if (!audioUrl) {
                return res.status(400).json({ error: 'Audio URL wajib diisi untuk deteksi lirik.' });
            }
            try {
                const whisperKeysQuery = await db.collection("api_keys").where("provider", "==", "Groq Whisper").where("status", "==", "aktif").get();
                if (whisperKeysQuery.empty) {
                    throw new Error("API Key untuk Groq Whisper tidak ditemukan atau mati. Pastikan sudah didaftarkan di Dashboard Admin.");
                }
                const whisperKeysDocs = whisperKeysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1));
                const whisperKey = whisperKeysDocs[0].data().key;

                const audioFetch = await fetch(audioUrl);
                if (!audioFetch.ok) throw new Error("Gagal mengunduh audio referensi untuk ditranskripsi.");
                const audioBlob = await audioFetch.blob();

                const formData = new FormData();
                formData.append("file", audioBlob, "audio.mp3");
                formData.append("model", "whisper-large-v3-turbo");
                formData.append("temperature", "0.0");
                
                // FIX 1: Pancingan Multi-Bahasa agar AI tahu ini lirik lagu, bukan video YouTube
                const promptHint = title ? `Lyrics of the song ${title}. Lirik lagu. 歌詞. 가사. Letras.` : "Lyrics of the song. Lirik lagu. 歌詞. 가사. Letras.";
                formData.append("prompt", promptHint);

                const whisperRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${whisperKey}` },
                    body: formData
                });

                const whisperData = await whisperRes.json();
                if (!whisperRes.ok) throw new Error(whisperData.error?.message || "Gagal transkripsi audio via Whisper.");

                if (!whisperData.text) throw new Error("Suara tidak terdeteksi atau audio kosong.");

                // FIX 2: Filter Pembersih Halusinasi (Post-Processing)
                let cleanText = whisperData.text;
                
                // Hapus halusinasi subtitle YouTube (berbagai bahasa)
                cleanText = cleanText.replace(/Terima kasih telah menonton!?/gi, "");
                cleanText = cleanText.replace(/Thanks for watching!?/gi, "");
                cleanText = cleanText.replace(/Terima kasih!?/gi, "");
                cleanText = cleanText.replace(/Subtitle by .+/gi, "");
                cleanText = cleanText.replace(/Subtitles by .+/gi, "");
                
                // Hapus halusinasi credit title Mandarin (Penulis lirik, Komposer, dll) tanpa menghapus lirik Mandarin asli
                cleanText = cleanText.replace(/作词.*?(\n|$)/g, ""); // Lyricist
                cleanText = cleanText.replace(/作曲.*?(\n|$)/g, ""); // Composer
                cleanText = cleanText.replace(/编曲.*?(\n|$)/g, ""); // Arranger
                
                // Bersihkan spasi berlebih akibat penghapusan
                cleanText = cleanText.replace(/\n\s*\n/g, '\n').trim();

                // FIX 3: Jangan lempar error 500 jika kosong. Berikan teks fallback yang elegan.
                if (!cleanText) {
                    cleanText = "[Musik Instrumental / Vokal tidak terdengar jelas oleh AI]";
                }

                return res.status(200).json({ success: true, result: cleanText });
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        }

        // ============================================================
        // ROUTE 1B: MAGIC WAND (AUTO-EDIT LIRIK & STYLE VIA LLM)
        // ============================================================
        if (action === 'magic_wand') {
            if (!llmType) {
                return res.status(400).json({ error: 'Parameter llmType wajib diisi untuk Magic Wand.' });
            }

            // FIX: Jika providerId kosong dari frontend, otomatis gunakan auto_pool
            const finalProviderId = providerId || 'auto_pool';
            let finalInputText = inputText || "";

            try {
                if (!finalInputText) {
                    return res.status(400).json({ error: 'Teks input wajib diisi untuk menggunakan AI.' });
                }

                const providersDoc = await db.collection("settings").doc("api_providers").get();
                const allProviders = providersDoc.data().list || [];
                
                // 1. Kumpulkan provider LLM (Mendukung Auto Fallback)
                let llmProvidersToTry = [];
                if (finalProviderId === 'auto_pool') {
                    llmProvidersToTry = allProviders.filter(p => {
                        if (!p.serviceType) return false;
                        const type = String(p.serviceType).toLowerCase();
                        return type === "llm" || type === "text" || type === "chat";
                    });
                    if (llmProvidersToTry.length === 0) return res.status(500).json({ error: 'Tidak ada provider LLM aktif untuk Auto Fallback.' });
                } else {
                    const specificProvider = allProviders.find(p => p.value === finalProviderId);
                    if (!specificProvider) return res.status(500).json({ error: 'Provider LLM tidak ditemukan.' });
                    llmProvidersToTry = [specificProvider];
                }

                // 2. Siapkan System Prompt (Otak AI Habi RMX)
                let systemPrompt = "";
                if (llmType === 'style') {
                    // Logika Dinamis untuk Vokal (Hanya diisi jika user meminta)
                    let genderInstruction = "";
                    if (vocalGender === 'female' || finalInputText.toLowerCase().includes('cewek') || finalInputText.toLowerCase().includes('wanita') || finalInputText.toLowerCase().includes('perempuan') || finalInputText.toLowerCase().includes('female')) {
                        genderInstruction = "beautiful female vocal, clear female singer, perfectly mixed vocals, zero noise, ";
                    } else if (vocalGender === 'male' || finalInputText.toLowerCase().includes('cowok') || finalInputText.toLowerCase().includes('pria') || finalInputText.toLowerCase().includes('laki') || finalInputText.toLowerCase().includes('male')) {
                        genderInstruction = "deep male vocal, clear male singer, perfectly mixed vocals, zero noise, ";
                    }

                    systemPrompt = `You are a Master Audio Engineer & Prompt Engineer for Suno AI. Convert the user's idea into a highly detailed, professional list of comma-separated music tags.
ABSOLUTE RULES:
1. 100% ENGLISH. Only keep specific cultural genres ('Dangdut', 'Koplo', 'Sholawat', 'Campursari', 'Jedag Jedug') untranslated.
2. NO ARTIST NAMES. NO EXCEPTIONS. Focus ONLY on instruments and mixing quality.
3. INDONESIAN SLOW STYLE (DJ & DANGDUT): If the user asks for DJ, Remix, Jedag Jedug, or Dangdut, you MUST aim for the "Indonesian Slow Bass" vibe. It must be SLOW TEMPO but HIGH ENERGY (not boring/loyo). Add these exact tags: "Indonesian DJ breakbeat, slow bass, groovy rhythm, punchy kick drum, bouncy bassline, satisfying drop, 110 BPM to 120 BPM, energetic but slow tempo, FL Studio quality". DO NOT EVER use fast/chaotic tags like 'hardcore', 'breakcore', 'acid', or 'trance'.
4. MASTERING & CLEAN AUDIO: Focus heavily on pristine mixing. ALWAYS add: "pristine studio mixing, zero noise, crystal clear audio, perfectly balanced eq, rich harmonics, dynamic range, high fidelity, 8k resolution audio, clean background, professional vocal production, lossless audio".
5. FIX SUNO'S LAZINESS & COVER CONSISTENCY: Suno often loses energy or drifts away from the original melody in the middle of a song. You MUST ADD these exact keywords at the very end of your response to force consistency: "consistent melody progression, steady rhythm from start to finish, high energy maintained, cohesive arrangement, no fading, powerful chorus, strict adherence to original melody, consistent vocal timbre, unwavering pitch, identical instrumental motif throughout".
6. LENGTH: You MUST generate a very long, highly detailed prompt between 900 and 980 characters. Do not fall short. Fill it with specific instruments, mood, and mastering quality tags.
7. VOCALS: ${genderInstruction ? `Include this exact tag: "${genderInstruction}".` : `DO NOT add vocal gender tags.`}
Output ONLY the comma-separated prompt tags. No conversational text.`;
                
                } else if (llmType === 'lyrics') {
                    if (currentMode === 'generate') {
                        systemPrompt = `Kamu adalah Penulis Lagu (Songwriter) Profesional pemenang Grammy dan Ahli Lirik Viral. Tugasmu: Buat lirik lagu ORIGINAL yang lengkap, panjang, puitis, dan terasa sangat "manusiawi" berdasarkan input user.
ATURAN MUTLAK:
1. ANALISIS INPUT: 
   - Jika user menempelkan LIRIK LAGU FULL (lagu terkenal), JANGAN salin liriknya (hindari Copyright). Tulis ulang lirik BARU dengan makna, cerita, pesan, dan emosi (vibe) yang SAMA PERSIS, tapi gunakan pilihan kata yang lebih indah, puitis, dan berpotensi viral.
   - Jika user memberikan IDE/TEMA (misal: "lagu sedih", "sholawat", "galau"), buatkan lirik dari nol yang sangat menyentuh hati, bermakna dalam, dan tidak kaku (seperti tulisan manusia asli yang sedang curhat atau berdoa).
2. JANGAN PERNAH memasukkan nama genre (seperti "Lagu Dangdut", "Ini Sholawat", "Lagu Pop") ke dalam teks lirik! Terapkan *nuansa* bahasanya saja.
3. STRUKTUR WAJIB SUNO AI: Gunakan tag meta standar di dalam kurung siku: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Chorus], [Bridge], [Guitar Solo] atau [Drop] atau [Instrumental], [Chorus], [Outro].
4. Buat lirik layaknya manusia asli: puitis, memiliki rima (AABB/ABAB), emosional, dan pas dengan ketukan nada. Pastikan liriknya cukup panjang untuk durasi 3-4 menit.
5. Jawab HANYA dengan lirik lagunya saja. Dilarang keras memberikan penjelasan, judul, atau basa-basi di awal maupun di akhir.`;
                    } else {
                        systemPrompt = `Kamu adalah Music Arranger & Vocal Director Profesional. Tugasmu: Merapikan teks lirik mentah hasil transkripsi AI agar siap dinyanyikan oleh AI (Suno) untuk fitur COVER LAGU.
ATURAN MUTLAK:
1. BERSIHKAN LIRIK: Hapus SEMUA teks metadata, terjemahan, atau label bahasa yang salah tangkap (seperti "[Bahasa Mandarin:]", "[Bahasa Indonesia:]", "Terjemahan:", dll). Sisakan HANYA lirik lagunya saja.
2. JANGAN mengubah makna atau kata-kata asli dari lirik lagunya.
3. TUGAS UTAMA: Analisis pola kalimat, rima, dan bait untuk menyisipkan tag struktur lagu secara akurat dan logis.
4. MENCEGAH NYANYI TERLALU CEPAT: Suno sering langsung bernyanyi. Kamu WAJIB menambahkan tag [Long Instrumental Intro] atau [Intro] di baris paling atas sebelum lirik dimulai.
5. JEDA MUSIK: Sisipkan tag jeda musik seperti [Melodic Interlude], [Instrumental Break], atau [Guitar Solo] di antara bait (misal antara Chorus dan Verse 2) agar lagu memiliki nafas dan sesuai dengan struktur lagu asli pada umumnya.
6. STRUKTUR LENGKAP: Gunakan tag [Verse], [Pre-Chorus], [Chorus], [Bridge], dan akhiri dengan [Outro] lalu [End]. Sesuaikan penempatannya dengan logika lagu aslinya.
7. Jawab HANYA dengan lirik yang sudah disisipkan tag struktur. Dilarang keras memberikan basa-basi, penjelasan, atau komentar.`;
                    }
                }

                let resultText = "";
                let success = false;
                let lastError = "";

                // 3. Looping Eksekusi (Provider -> API Key -> Model)
                for (const llmProvider of llmProvidersToTry) {
                    const keysQuery = await db.collection("api_keys").where("provider", "==", llmProvider.value).where("status", "==", "aktif").get();
                    const sortedKeysDocs = keysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1));
                    
                    if (sortedKeysDocs.length === 0) {
                        lastError = `API Key untuk ${llmProvider.label || llmProvider.value} habis atau tidak aktif.`;
                        continue; 
                    }

                    let modelList = [];
                    if (llmProvider.models) {
                        modelList = llmProvider.models.split(',').map(m => m.trim()).filter(m => m);
                        modelList.sort((a, b) => {
                            const numA = parseFloat(a.match(/\d+(\.\d+)?/)?.[0] || 0);
                            const numB = parseFloat(b.match(/\d+(\.\d+)?/)?.[0] || 0);
                            return numB - numA; 
                        });
                    }
                    if (modelList.length === 0) modelList = ["default"];

                    let targetModels = modelList;
                    if (finalProviderId !== 'auto_pool' && modelId && modelList.includes(modelId)) {
                        targetModels = [modelId]; 
                    }

                    for (const keyDoc of sortedKeysDocs) {
                        const activeApiKey = keyDoc.data().key;
                        
                        for (const currentModel of targetModels) {
                            try {
                                const variables = { model: currentModel, systemPrompt: systemPrompt, prompt: finalInputText };
                                let rawBody = llmProvider.payloadTemplate || `{"model": "{{model}}", "messages": [{"role": "system", "content": "{{systemPrompt}}"}, {"role": "user", "content": "{{prompt}}"}]}`;
                                let parsedBodyString = renderTemplate(rawBody, variables);
                                const finalPayload = JSON.parse(parsedBodyString);

                                const headers = { "Content-Type": "application/json" };
                                const headerName = llmProvider.headerName || "Authorization";
                                const headerValueTemplate = llmProvider.headerValue || "Bearer {apiKey}";
                                headers[headerName] = headerValueTemplate.replace("{apiKey}", activeApiKey);

                                const response = await fetch(`${llmProvider.baseUrl}${llmProvider.endpoint}`, {
                                    method: 'POST', headers: headers, body: JSON.stringify(finalPayload)
                                });

                                const resData = await response.json();
                                
                                if (!response.ok || (resData.code && resData.code !== 200)) {
                                    const errMsg = getValueByPath(resData, llmProvider.errorPath) || extractErrorString(resData) || "API Error";
                                    throw new Error(errMsg);
                                }

                                if (resData.choices && resData.choices[0].message) {
                                    resultText = resData.choices[0].message.content;
                                } else if (resData.candidates && resData.candidates[0].content) {
                                    resultText = resData.candidates[0].content.parts[0].text;
                                } else {
                                    resultText = JSON.stringify(resData);
                                }

                                success = true;
                                break; 

                            } catch (e) {
                                lastError = e.message;
                                const lowerErr = lastError.toLowerCase();
                                // Fitur Auto-Kill API Key jika saldo habis
                                if (lowerErr.includes('insufficient') || lowerErr.includes('balance') || lowerErr.includes('quota') || lowerErr.includes('credit')) {
                                    try { await db.collection("api_keys").doc(keyDoc.id).update({ status: "mati" }); } catch(err){}
                                    break; // Lanjut ke API Key berikutnya karena saldo key ini habis
                                }
                                console.warn(`Model ${currentModel} di ${llmProvider.value} gagal: ${lastError}`);
                            }
                        }
                        if (success) break; // Berhenti mencari API key jika sudah sukses
                    }
                    if (success) break; // Berhenti mencari Provider jika sudah sukses
                }

                if (!success) {
                    throw new Error(`Semua model LLM gagal merespons. Error terakhir: ${lastError}`);
                }

                return res.status(200).json({ success: true, result: resultText.trim() });

            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        }

        // ============================================================
        // ROUTE KREAVERSE VOICE & PERSONA (KIE.AI INTEGRATION)
        // ============================================================
        if (action === 'generate_phrase' || action === 'create_voice' || action === 'create_persona') {
            try {
                const providersDoc = await db.collection("settings").doc("api_providers").get();
                const allProviders = providersDoc.data().list || [];
                const kieProvider = allProviders.find(p => p.baseUrl && p.baseUrl.includes('kie.ai'));
                if (!kieProvider) throw new Error("Provider KIE.ai tidak ditemukan di sistem.");

                const keysQuery = await db.collection("api_keys").where("provider", "==", kieProvider.value).where("status", "==", "aktif").get();
                const sortedKeysDocs = keysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1));
                if (sortedKeysDocs.length === 0) throw new Error("API Key KIE.ai habis atau tidak aktif.");
                const activeApiKey = sortedKeysDocs[0].data().key;

                const headers = {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${activeApiKey}`
                };

                if (action === 'generate_phrase') {
                    const { voiceUrl, vocalStartS, vocalEndS } = body;
                    if (!voiceUrl) throw new Error("voiceUrl wajib diisi.");
                    
                    const payload = {
                        voiceUrl: voiceUrl,
                        vocalStartS: vocalStartS || 0,
                        vocalEndS: vocalEndS || 30,
                        language: "id"
                    };

                    const response = await fetch(`${kieProvider.baseUrl}/api/v1/voice/validate`, {
                        method: 'POST', headers, body: JSON.stringify(payload)
                    });
                    const resData = await response.json();
                    if (!response.ok || resData.code !== 200) throw new Error(resData.msg || "Gagal generate phrase");
                    
                    return res.status(200).json({ success: true, taskId: resData.data.taskId });
                }

                if (action === 'create_voice') {
                    const { taskId, verifyUrl, voiceName, description, style } = body;
                    if (!taskId || !verifyUrl) throw new Error("taskId dan verifyUrl wajib diisi.");

                    const payload = {
                        taskId: taskId,
                        verifyUrl: verifyUrl,
                        voiceName: voiceName || "My Custom Voice",
                        description: description || "Kreaverse Voice Clone",
                        style: style || "",
                        singerSkillLevel: "beginner"
                    };

                    const response = await fetch(`${kieProvider.baseUrl}/api/v1/voice/generate`, {
                        method: 'POST', headers, body: JSON.stringify(payload)
                    });
                    const resData = await response.json();
                    if (!response.ok || resData.code !== 200) throw new Error(resData.msg || "Gagal create voice");
                    
                    return res.status(200).json({ success: true, taskId: resData.data.taskId });
                }

                if (action === 'create_persona') {
                    const { taskId, audioId, name, description, vocalStart, vocalEnd } = body;
                    if (!taskId || !audioId || !name || !description) throw new Error("Parameter persona tidak lengkap.");

                    const payload = {
                        taskId: taskId,
                        audioId: audioId,
                        name: name,
                        description: description,
                        vocalStart: vocalStart || 0,
                        vocalEnd: vocalEnd || 30
                    };

                    const response = await fetch(`${kieProvider.baseUrl}/api/v1/generate/generate-persona`, {
                        method: 'POST', headers, body: JSON.stringify(payload)
                    });
                    const resData = await response.json();
                    if (!response.ok || resData.code !== 200) throw new Error(resData.msg || "Gagal create persona");
                    
                    return res.status(200).json({ success: true, personaId: resData.data.personaId });
                }

            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        }

        // ============================================================
        // ROUTE 2: GENERATE MUSIC (DYNAMIC PROVIDER SUPPORT)
        // ============================================================
        if (!email || !prompt) {
            return res.status(400).json({ error: 'Parameter email dan prompt wajib diisi!' });
        }

        try {
            const usersRef = db.collection("users");
            const userQuery = await usersRef.where("email", "==", email).get();
            if (userQuery.empty) return res.status(403).json({ error: 'Akses ditolak: Klien tidak terdaftar!' });
            
            const userDoc = userQuery.docs[0];
            const userData = userDoc.data();

            if (userData.expiry && userData.expiry < Date.now() && userData.tier !== 'max_lifetime') {
                return res.status(403).json({ error: 'Masa aktif paket premium Anda telah kedaluwarsa!' });
            }
            if (userData.dailyQuota > 0 && userData.generateCount >= userData.dailyQuota) {
                return res.status(403).json({ error: 'Batas kuota harian pembuatan lagu Anda telah habis!' });
            }

            const providersDoc = await db.collection("settings").doc("api_providers").get();
            const allProviders = providersDoc.data().list || [];
            
            const audioProviders = allProviders.filter(p => {
                if (!p.serviceType) return true;
                const type = String(p.serviceType).toLowerCase();
                return type === "audio" || type === "music" || type === "text-to-audio";
            });

            if (audioProviders.length === 0) return res.status(500).json({ error: 'Belum ada provider Audio terdaftar.' });

            const targetProviderId = providerId || modelId;
            const isAutoPool = (targetProviderId === 'auto_pool');
            
            let providersToTry = [];
            if (isAutoPool) {
                providersToTry = audioProviders; // Coba semua provider jika mode Auto
            } else {
                const strictProvider = audioProviders.find(p => p.value === targetProviderId);
                if (!strictProvider) return res.status(500).json({ error: 'Provider spesifik tidak ditemukan di database.' });
                providersToTry = [strictProvider]; // Mode Strict: Hanya coba 1 provider ini
            }

            let taskResponse = null;
            let successfulProvider = null;
            let lastErrorMessage = "Tidak ada respons dari server.";
            let keyFoundAndUsed = false;

            for (let i = 0; i < providersToTry.length; i++) {
                let currentProvider = providersToTry[i];
                
                const keysQuery = await db.collection("api_keys").where("provider", "==", currentProvider.value).where("status", "==", "aktif").get();
                const sortedKeysDocs = keysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1));

                let activeModel = "V5_5";
                if (currentProvider.models) {
                    const modelList = currentProvider.models.split(',').map(m => m.trim()).filter(m => m);
                    if (modelList.length > 0) activeModel = (modelId && modelList.includes(modelId)) ? modelId : modelList[0];
                }

                for (const keyDoc of sortedKeysDocs) {
                    const activeApiKey = keyDoc.data().key;

                    try {
                        let endpointPath = currentProvider.endpoint;
                        if (audioUrl && currentProvider.endpointCover) endpointPath = currentProvider.endpointCover;
                        let providerUrl = `${currentProvider.baseUrl}${endpointPath}`;

                        // INJEKSI GENDER OTOMATIS
                        let finalStylePrompt = prompt || "";
                        let finalLyrics = lyrics || "";
                        const selectedGender = vocalGender || (options && options.vocalGender) || "not_specified";

                        let vocalGenderShort = "";
                        if (selectedGender.toLowerCase() === 'female') {
                            vocalGenderShort = "f";
                            if (!finalStylePrompt.toLowerCase().includes('female')) {
                                finalStylePrompt = "female vocal, female singer, " + finalStylePrompt;
                            }
                            if (!finalLyrics.toLowerCase().includes('[female')) {
                                finalLyrics = "[Female Vocal]\n" + finalLyrics;
                            }
                        } else if (selectedGender.toLowerCase() === 'male') {
                            vocalGenderShort = "m";
                            if (!finalStylePrompt.toLowerCase().includes('male')) {
                                finalStylePrompt = "male vocal, male singer, " + finalStylePrompt;
                            }
                            if (!finalLyrics.toLowerCase().includes('[male')) {
                                finalLyrics = "[Male Vocal]\n" + finalLyrics;
                            }
                        }

                        let rawBody = currentProvider.payloadTemplate || "{}";
                        
                        // Aktifkan Payload Custom jika user mengisi lirik (Custom Mode ON)
                        if (finalLyrics && finalLyrics.trim() !== "" && currentProvider.payloadCustomTemplate) {
                            rawBody = currentProvider.payloadCustomTemplate;
                        }
                        
                        // Aktifkan Payload Cover jika user upload audio
                        if (audioUrl && currentProvider.payloadCoverTemplate) {
                            rawBody = currentProvider.payloadCoverTemplate;
                        }

                        const variables = {
                            title: title || "Untitled Song", 
                            prompt: finalStylePrompt, 
                            lyrics: finalLyrics, 
                            audioUrl: audioUrl || "",
                            videoUrl: audioUrl || "", 
                            uploadUrl: audioUrl || "", 
                            customMode: finalLyrics ? "true" : "false", 
                            instrumental: instrumental ? "true" : "false", 
                            negativeTags: options?.negativeTags || "",
                            vocalGender: selectedGender, 
                            vocalGenderShort: vocalGenderShort, 
                            styleWeight: options?.styleWeight || "0.5",
                            weirdness: options?.weirdness || "0.5", 
                            audioWeight: options?.audioWeight || "0.5",
                            personaId: options?.personaId || "", 
                            model: activeModel
                        };
                        
                        let parsedBodyString = renderTemplate(rawBody, variables);
                        const finalPayload = JSON.parse(parsedBodyString);

                        const headers = { "Content-Type": "application/json" };
                        const headerName = currentProvider.headerName || "Authorization";
                        const headerValueTemplate = currentProvider.headerValue || "Bearer {apiKey}";
                        headers[headerName] = headerValueTemplate.replace("{apiKey}", activeApiKey);

                        let fetchBody = JSON.stringify(finalPayload);
                        
                        // FIX FASTAPI: Auto-Convert JSON ke URL-Encoded Form (Khusus untuk endpoint yang menolak JSON murni)
                        if (finalPayload._send_as_form) {
                            delete finalPayload._send_as_form;
                            headers["Content-Type"] = "application/x-www-form-urlencoded";
                            const formParams = new URLSearchParams();
                            for (const key in finalPayload) {
                                formParams.append(key, finalPayload[key]);
                            }
                            fetchBody = formParams.toString();
                        }

                        const response = await fetch(providerUrl, { method: 'POST', headers: headers, body: fetchBody });

                        let resData = {};
                        const contentType = response.headers.get("content-type");
                        if (contentType && contentType.includes("application/json")) {
                            resData = await response.json();
                        } else {
                            throw new Error(`Provider mengembalikan respons non-JSON`);
                        }

                        if (!response.ok || (resData.code && resData.code !== 200)) {
                            const errMsg = getValueByPath(resData, currentProvider.errorPath) || extractErrorString(resData) || "API Error";
                            throw new Error(errMsg);
                        }

                        const execMode = currentProvider.execMode || 'async';

                        // LOGIKA MODE SYNCHRONOUS (Langsung dapat URL)
                        if (execMode === 'sync') {
                            let audioUrlVal = getValueByPath(resData, currentProvider.statusVideoUrlPath || "audioUrl");
                            if (!audioUrlVal) audioUrlVal = findAudioUrlRecursively(resData);
                            
                            if (!audioUrlVal) {
                                throw new Error("URL Audio tidak ditemukan pada respons Synchronous API.");
                            }

                            let tracks = [];
                            let extractedArray = getValueByPath(resData, currentProvider.statusVideoUrlPath?.split('.').slice(0, -1).join('.'));
                            
                            if (Array.isArray(extractedArray)) {
                                tracks = extractedArray.map(item => ({
                                    audioUrl: item.audio_url || item.audioUrl || item.url || audioUrlVal,
                                    imageUrl: item.image_url || item.imageUrl || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg"
                                })).filter(t => t.audioUrl);
                            } else {
                                tracks.push({ audioUrl: audioUrlVal, imageUrl: "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" });
                            }

                            taskResponse = { 
                                status: "completed",
                                provider: currentProvider.value,
                                tracks: tracks,
                                raw: resData
                            };
                            successfulProvider = currentProvider;
                            keyFoundAndUsed = true;
                            break;

                        } else {
                            // LOGIKA MODE ASYNCHRONOUS (Task ID & Polling)
                            const responsePath = currentProvider.responsePath || "id";
                            let taskId = getValueByPath(resData, responsePath);
                            
                            // Fallback pencarian ID
                            if (!taskId) taskId = resData.data?.taskId || resData.taskId || resData.data?.task_id || resData.task_id || resData.data?.id || resData.id;
                            
                            if (taskId) {
                                taskResponse = { taskId, provider: currentProvider.value };
                                successfulProvider = currentProvider;
                                keyFoundAndUsed = true;
                                break;
                            } else {
                                throw new Error("Task ID tidak ditemukan dalam respons API. Periksa Payload Template di Dashboard Admin.");
                            }
                        }

                    } catch (apiErr) {
                        lastErrorMessage = apiErr.message;
                        const lowerErr = lastErrorMessage.toLowerCase();
                        
                        // FITUR AUTO-KILL API KEY JIKA SALDO HABIS
                        if (lowerErr.includes('insufficient') || lowerErr.includes('balance') || lowerErr.includes('credit') || lowerErr.includes('quota') || lowerErr.includes('fund') || lowerErr.includes('limit')) {
                            try {
                                await db.collection("api_keys").doc(keyDoc.id).update({ status: "mati" });
                                await db.collection("system_logs").add({
                                    type: "warning", host: currentProvider.value, request: "AUTO_KILL_KEY",
                                    message: `API Key otomatis dimatikan karena saldo habis. Pesan: ${lastErrorMessage}`, timestamp: Date.now()
                                });
                            } catch(e) {}
                        } else {
                            await db.collection("system_logs").add({
                                type: "error", host: currentProvider.value, request: isAutoPool ? "GENERATE_MUSIC_FAILOVER" : "GENERATE_MUSIC_STRICT",
                                message: `Koneksi atau pemrosesan gagal: ${apiErr.message}`, timestamp: Date.now()
                            });
                        }
                    }
                }

                if (keyFoundAndUsed) break; // Berhenti mencari provider lain jika sudah sukses
            }

            if (!taskResponse) {
                if (isAutoPool) {
                    return res.status(502).json({ error: 'Seluruh server AI sedang sibuk atau kehabisan kunci akses. Silakan coba lagi.' });
                } else {
                    return res.status(502).json({ error: `Server yang Anda pilih gagal merespons: ${lastErrorMessage}` });
                }
            }

            await userDoc.ref.update({ generateCount: FieldValue.increment(1) });

            await db.collection("system_logs").add({
                type: "success", host: successfulProvider.value, request: "GENERATE_MUSIC",
                message: `Klien ${userData.nama} sukses memicu aransemen lagu. Mode: ${successfulProvider.execMode || 'async'}`,
                timestamp: Date.now()
            });

            return res.status(200).json(taskResponse);

        } catch (globalErr) {
            return res.status(500).json({ error: globalErr.message });
        }
    }

    // ============================================================
    // METODE GET: ASYNCHRONOUS STATUS CHECK (POLLING STATUS)
    // ============================================================
    if (req.method === 'GET') {
        const { taskId, provider, email, action } = req.query; // FITUR REFUND: Email ditangkap di sini
        if (!taskId) return res.status(400).json({ error: 'taskId wajib dilampirkan!' });

        // ROUTE GET KHUSUS VOICE & PERSONA
        if (action === 'check_phrase' || action === 'check_voice') {
            try {
                const providersDoc = await db.collection("settings").doc("api_providers").get();
                const allProviders = providersDoc.data().list || [];
                const kieProvider = allProviders.find(p => p.baseUrl && p.baseUrl.includes('kie.ai'));
                if (!kieProvider) throw new Error("Provider KIE.ai tidak ditemukan.");

                const keysQuery = await db.collection("api_keys").where("provider", "==", kieProvider.value).where("status", "==", "aktif").get();
                const sortedKeysDocs = keysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1));
                if (sortedKeysDocs.length === 0) throw new Error("API Key KIE.ai habis.");
                const activeApiKey = sortedKeysDocs[0].data().key;

                const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${activeApiKey}` };
                
                if (action === 'check_phrase') {
                    const response = await fetch(`${kieProvider.baseUrl}/api/v1/voice/validate-info?taskId=${taskId}`, { method: 'GET', headers });
                    const resData = await response.json();
                    if (!response.ok || resData.code !== 200) throw new Error(resData.msg || "Gagal cek phrase");
                    return res.status(200).json(resData.data);
                }
                
                if (action === 'check_voice') {
                    const response = await fetch(`${kieProvider.baseUrl}/api/v1/voice/record-info?taskId=${taskId}`, { method: 'GET', headers });
                    const resData = await response.json();
                    if (!response.ok || resData.code !== 200) throw new Error(resData.msg || "Gagal cek voice");
                    return res.status(200).json(resData.data);
                }
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        }

        if (!provider) return res.status(400).json({ error: 'provider wajib dilampirkan!' });

        try {
            const providersDoc = await db.collection("settings").doc("api_providers").get();
            const allProviders = providersDoc.data().list || [];
            const activeProvider = allProviders.find(p => p.value === provider);

            if (!activeProvider) return res.status(500).json({ error: 'Provider tidak dikenali.' });

            const keysQuery = await db.collection("api_keys").where("provider", "==", provider).where("status", "==", "aktif").limit(1).get();
            if (keysQuery.empty) return res.status(502).json({ error: 'Tidak ada API Key aktif.' });

            const apiKey = keysQuery.docs[0].data().key;

            let statusUrl = activeProvider.statusUrlTemplate || "{baseUrl}/v1/tasks/{taskId}";
            statusUrl = statusUrl.replace("{baseUrl}", activeProvider.baseUrl).replace("{taskId}", taskId);

            const cacheBuster = statusUrl.includes('?') ? `&_t=${Date.now()}` : `?_t=${Date.now()}`;
            const finalStatusUrl = statusUrl + cacheBuster;

            const headers = { 
                "Content-Type": "application/json",
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            };
            const headerName = activeProvider.headerName || "Authorization";
            const headerValueTemplate = activeProvider.headerValue || "Bearer {apiKey}";
            headers[headerName] = headerValueTemplate.replace("{apiKey}", apiKey);

            const response = await fetch(finalStatusUrl, { 
                method: 'GET', 
                headers: headers,
                cache: 'no-store' 
            });
            
            let resData = {};
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                resData = await response.json();
            } else {
                // TANGKAP ERROR 413 KIE.AI YANG BUKAN JSON (HTML/TEXT)
                const textData = await response.text();
                if (response.status === 413 || textData.includes('413') || textData.toLowerCase().includes('payload too large')) {
                     return res.status(200).json({ status: "failed", audioUrl: null, reason: "Hak Cipta Terdeteksi: Lirik atau audio melanggar hak cipta. Silakan ubah lirik atau gunakan DSP Bypass.", raw: textData });
                }
                throw new Error(`Provider status mengembalikan respons non-JSON`);
            }

            let actualErrorMessage = getValueByPath(resData, activeProvider.errorPath) || extractErrorString(resData);

            // TANGKAP JEBAKAN KIE.AI (HTTP 200 TAPI SUCCESSFLAG 2 / GAGAL)
            let isKieFailed = false;
            if (resData.data && (resData.data.successFlag === 2 || resData.data.status === "failed" || resData.data.errorCode)) {
                isKieFailed = true;
                actualErrorMessage = resData.data.errorMessage || actualErrorMessage || "Generation failed (KIE Flag)";
            }

            if (!response.ok || (resData.code && resData.code !== 200) || isKieFailed) {
                const errMsg = actualErrorMessage || resData.msg || resData.message || resData.error || "API Error";
                const lowerErr = String(errMsg).toLowerCase();
                
                // --- SISTEM ANTI-PANIK UNIVERSAL (UNTUK SEMUA PROVIDER) ---
                // Mengatasi "Race Condition" / Delay Sinkronisasi Database di server pusat.
                if (lowerErr.includes('not found') || response.status === 404 || resData.code === 404) {
                     return res.status(200).json({ status: "processing", audioUrl: null, reason: "Sinkronisasi antrean server AI...", raw: resData });
                }
                // -----------------------------------------------------------
                
                let translatedError = errMsg;
                if (lowerErr.includes('copyright') || lowerErr.includes('lyrics contain') || lowerErr.includes('artist name') || lowerErr.includes('catalog') || lowerErr.includes('matches an existing')) {
                    translatedError = "Hak Cipta Terdeteksi: Lirik atau audio melanggar hak cipta. Silakan ubah lirik atau gunakan fitur DSP Bypass.";
                } else if (lowerErr.includes('insufficient') || lowerErr.includes('balance') || lowerErr.includes('credit')) {
                    translatedError = "Saldo API server habis. Harap hubungi Admin.";
                } else if (lowerErr.includes('too long') || lowerErr.includes('exceed')) {
                    translatedError = "Durasi terlalu panjang atau prompt melebihi batas karakter.";
                }
                
                // Jika error bersifat permanen, return 200 dengan status failed agar frontend stop polling
                if (resData.code === 413 || resData.code === 400 || resData.code === 403 || lowerErr.includes('artist name') || lowerErr.includes('copyright') || lowerErr.includes('fail') || lowerErr.includes('error') || lowerErr.includes('reject') || lowerErr.includes('tags') || lowerErr.includes('matches an existing') || lowerErr.includes('catalog') || lowerErr.includes('insufficient') || lowerErr.includes('balance') || isKieFailed) {
                    
                    // --- SISTEM REFUND OTOMATIS: JIKA GAGAL DI AWAL (HTTP STATUS) ---
                    if (email) {
                        try {
                            const refundQuery = await db.collection("users").where("email", "==", email).get();
                            if (!refundQuery.empty) {
                                await refundQuery.docs[0].ref.update({ 
                                    generateCount: FieldValue.increment(-1),
                                    kredit: FieldValue.increment(50)
                                });
                                console.log(`[REFUND SUKSES] Saldo dikembalikan 50 Kredit (HTTP Error) untuk email: ${email}`);
                            }
                        } catch (refundErr) { console.error("Gagal melakukan refund:", refundErr); }
                    }
                    // -----------------------------------------------------------------

                    return res.status(200).json({ status: "failed", audioUrl: null, reason: translatedError, raw: resData });
                }
                
                return res.status(500).json({ error: translatedError, details: resData });
            }

            // MENCARI STATUS MENGGUNAKAN JALUR DINAMIS DARI ADMIN PANEL
            let statusVal = getValueByPath(resData, activeProvider.statusResponsePath || "status");
            let extractedStatus = String(statusVal).toLowerCase().trim();

            if (!statusVal || extractedStatus === "null" || extractedStatus === "undefined" || extractedStatus === "") {
                const rawStr = JSON.stringify(resData).toLowerCase();
                const statusRegex = /"(?:status|state|task_status|taskstatus)"\s*:\s*"?([a-zA-Z0-9_-]+)"?/g;
                let match;
                while ((match = statusRegex.exec(rawStr)) !== null) {
                    extractedStatus = match[1].trim();
                }
            }

            let completedValues = ["success", "finished", "completed", "done", "successful", "complete"];
            if (activeProvider.statusCompletedValue) {
                completedValues.push(...activeProvider.statusCompletedValue.toLowerCase().split(',').map(s => s.trim()));
            }

            let failedValues = ["failed", "error", "fail", "failure", "timeout", "canceled", "rejected", "generate_audio_failed", "unsuccessful", "banned", "moderation", "revoked"];
            if (activeProvider.statusFailedValue) {
                failedValues.push(...activeProvider.statusFailedValue.toLowerCase().split(',').map(s => s.trim()));
            }

            let processingValues = ["processing", "in_progress", "queued", "pending", "starting", "running", "submitted", "wait", "waiting", "active", "generating", "progress", "streaming", "text_success", "first_success"];

            let isCompleted = false;
            let isFailed = false;
            let isProcessing = false;

            if (processingValues.includes(extractedStatus) || extractedStatus.includes("process") || extractedStatus.includes("queue") || extractedStatus.includes("pend") || extractedStatus.includes("run") || extractedStatus.includes("wait") || extractedStatus.includes("start") || extractedStatus.includes("submit") || extractedStatus.includes("generat") || extractedStatus.includes("stream")) {
                isProcessing = true;
            } else if (failedValues.includes(extractedStatus) || extractedStatus.includes("fail") || extractedStatus.includes("error") || extractedStatus.includes("reject") || extractedStatus.includes("cancel") || extractedStatus.includes("timeout") || extractedStatus.includes("ban")) {
                isFailed = true;
            } else if (completedValues.includes(extractedStatus) || extractedStatus.includes("success") || extractedStatus.includes("complete") || extractedStatus.includes("done")) {
                isCompleted = true;
            }

            if (actualErrorMessage) {
                const lowerMsg = actualErrorMessage.toLowerCase();
                if (lowerMsg.includes('fail') || lowerMsg.includes('error') || lowerMsg.includes('reject') || lowerMsg.includes('artist name') || lowerMsg.includes('copyright') || lowerMsg.includes('try again') || lowerMsg.includes('unauthorized') || lowerMsg.includes('insufficient') || lowerMsg.includes('tags') || lowerMsg.includes('matches an existing') || lowerMsg.includes('catalog')) {
                    isFailed = true;
                    isCompleted = false;
                    isProcessing = false;
                }
            } else if (!isCompleted && !isFailed && !isProcessing) {
                isProcessing = true; 
            }

            let audioUrlVal = null;
            let tracks = [];

            if (isCompleted) {
                // DINAMIS: Mengekstrak URL Audio berdasarkan pengaturan Admin
                const targetPath = activeProvider.statusVideoUrlPath || "download_url";
                let extractedMedia = getValueByPath(resData, targetPath);

                // Cek apakah targetPath mengandung indeks array (contoh: data.sunoData.0.audioUrl)
                const arrayMatch = targetPath.match(/(.*?)\.\d+\.(.*)/);

                if (arrayMatch) {
                    // Ekstrak semua data dari dalam array sekaligus (Bisa 2 lagu atau lebih)
                    const arrayPath = arrayMatch[1]; 
                    const propName = arrayMatch[2];  

                    let extractedArray = getValueByPath(resData, arrayPath);
                    if (Array.isArray(extractedArray) && extractedArray.length > 0) {
                        tracks = extractedArray.map(item => ({
                            audioId: item.id || item.audio_id || item.audioId || "",
                            audioUrl: item[propName] || item.audio_url || item.audioUrl || item.url || item.download_url || "",
                            imageUrl: item.image_url || item.imageUrl || item.cover_url || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg"
                        })).filter(t => t.audioUrl && typeof t.audioUrl === 'string' && t.audioUrl.startsWith('http'));

                        if (tracks.length > 0) audioUrlVal = tracks[0].audioUrl;
                    }
                } else if (typeof extractedMedia === 'string' && extractedMedia.startsWith('http')) {
                    audioUrlVal = extractedMedia;
                    tracks.push({ 
                        audioId: resData.id || resData.audio_id || resData.audioId || taskId,
                        audioUrl: audioUrlVal, 
                        imageUrl: "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" 
                    });
                }

                // Fallback jika jalur dinamis admin salah/gagal
                if (!audioUrlVal) {
                    audioUrlVal = findAudioUrlRecursively(resData);
                    if (audioUrlVal) {
                        tracks.push({ 
                            audioId: resData.id || resData.audio_id || resData.audioId || taskId,
                            audioUrl: audioUrlVal, 
                            imageUrl: "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" 
                        });
                    }
                }

                if (!audioUrlVal) {
                    isCompleted = false;
                    isProcessing = true;
                }
            }

            let finalStatus = "processing";
            if (isCompleted) finalStatus = "completed";
            else if (isFailed) finalStatus = "failed";

            if (finalStatus !== "completed") {
                audioUrlVal = null;
            }

            let failReason = "Gagal diproses oleh provider.";
            if (isFailed) {
                failReason = actualErrorMessage || "Dibatalkan oleh server AI. Status tidak dikenali: " + extractedStatus;
                
                if (typeof failReason === 'string') {
                    const lowerReason = failReason.toLowerCase();
                    if (lowerReason.includes('copyright') || lowerReason.includes('lyrics contain') || lowerReason.includes('matches an existing') || lowerReason.includes('artist name') || lowerReason.includes('catalog')) {
                        failReason = "Hak Cipta Terdeteksi: Lirik atau lagu ini melanggar hak cipta. Silakan ubah lirik atau gunakan tombol merah 'Upload Audio Kreaverse AI' (DSP Bypass).";
                    } else if (lowerReason.includes('too long') || (lowerReason.includes('duration') && lowerReason.includes('exceed'))) {
                        failReason = "Durasi audio terlalu panjang. Maksimal 8 Menit.";
                    } else if (lowerReason.includes('unsupported')) {
                        failReason = "Format audio tidak didukung atau parameter tidak valid.";
                    } else if (lowerReason.includes('insufficient') || lowerReason.includes('balance') || lowerReason.includes('credit') || lowerReason.includes('fund')) {
                        failReason = "Kredit API server habis. Harap hubungi Admin.";
                    }
                }
                
                // PENCATATAN LOG ERROR DINAMIS (RAW ERROR JSON)
                await db.collection("system_logs").add({
                    type: "error", 
                    host: activeProvider.value, 
                    request: "POLLING_FAILED",
                    message: `Tugas ${taskId} dibatalkan oleh mesin AI.`,
                    details: typeof failReason === 'string' ? failReason : JSON.stringify(failReason),
                    rawError: JSON.stringify(resData, null, 2),
                    timestamp: Date.now()
                });
                
                // --- SISTEM REFUND OTOMATIS: JIKA GAGAL DI TENGAH JALAN (POLLING FAILED) ---
                if (email) {
                    try {
                        const refundQuery = await db.collection("users").where("email", "==", email).get();
                        if (!refundQuery.empty) {
                            await refundQuery.docs[0].ref.update({ 
                                generateCount: FieldValue.increment(-1),
                                kredit: FieldValue.increment(50)
                            });
                            console.log(`[REFUND SUKSES] Saldo dikembalikan 50 Kredit (Polling Failed) untuk email: ${email} pada task: ${taskId}`);
                        }
                    } catch (refundErr) {
                        console.error("Gagal melakukan refund:", refundErr);
                    }
                }
                // -----------------------------------------------------------------------------
            }

            return res.status(200).json({ 
                status: finalStatus, 
                audioUrl: audioUrlVal || null, 
                tracks: tracks, 
                reason: failReason, 
                raw: resData 
            });

        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
};