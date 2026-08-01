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
    return templateStr.replace(/\{\{([a-zA-Z0-9_]+)(?::(\d+))?\}\}/g, (match, key, limitStr) => {
        let safeValue = variables[key] || "";
        if (typeof safeValue === 'string') {
            if (limitStr) {
                const limit = parseInt(limitStr, 10);
                if (safeValue.length > limit) {
                    let cutStr = safeValue.substring(0, limit - 3);
                    let lastSpace = cutStr.lastIndexOf(' ');
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

// FITUR BARU: Pencari Cover Image Multi-Provider
function findImageUrlRecursively(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const targetKeys = ['image_url', 'imageUrl', 'cover_url', 'coverUrl', 'thumbnail', 'pic_url', 'picture', 'image', 'avatar'];
    for (const key of targetKeys) {
        if (obj[key] && typeof obj[key] === 'string' && obj[key].startsWith('http')) {
            if (obj[key].match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) || obj[key].includes('image') || obj[key].includes('cover')) {
                return obj[key];
            }
        }
    }
    for (const key in obj) {
        if (typeof obj[key] === 'object') {
            const found = findImageUrlRecursively(obj[key]);
            if (found) return found;
        }
    }
    return null;
}

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
        // ROUTE 1A: DETEKSI LIRIK (ASR WHISPER + AUTO-CLEANUP LLM)
        // ============================================================
        if (action === 'detect_lyrics') {
            if (!audioUrl) return res.status(400).json({ error: 'Audio URL wajib diisi untuk deteksi lirik.' });
            try {
                // 1. PROSES WHISPER (ASR MENTAH) - AUTO DETECT PROVIDER
                const providersDoc = await db.collection("settings").doc("api_providers").get();
                const allProviders = providersDoc.data()?.list || [];
                const whisperProvider = allProviders.find(p => String(p.label || p.value || "").toLowerCase().includes("whisper"));
                if (!whisperProvider) throw new Error("Provider Whisper tidak ditemukan di database API.");

                const whisperKeysQuery = await db.collection("api_keys").where("provider", "==", whisperProvider.value).where("status", "==", "aktif").get();
                if (whisperKeysQuery.empty) throw new Error("API Key untuk Whisper tidak ditemukan atau mati.");
                const whisperKey = whisperKeysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1))[0].data().key;

                const audioFetch = await fetch(audioUrl);
                if (!audioFetch.ok) throw new Error("Gagal mengunduh audio referensi untuk ditranskripsi.");
                const audioBlob = await audioFetch.blob();

                const formData = new FormData();
                formData.append("file", audioBlob, "audio.mp3");
                formData.append("model", "whisper-large-v3"); // Ganti ke V3 Murni agar sangat akurat untuk semua bahasa
                formData.append("temperature", "0.0"); // 0.0 agar tidak berhalusinasi
                
                const pastedLyrics = lyrics || inputText || ""; 
                let promptHint = pastedLyrics.trim() !== "" ? pastedLyrics.substring(0, 500).replace(/\n/g, ', ') : (title ? `${title}, lirik lagu, musik.` : "Lirik lagu, musik.");

                // Prompt ketat anti terjemahan dan pertahankan pengulangan
                formData.append("prompt", "This is a song with music and vocals. Transcribe the lyrics accurately in its original language. Do not translate. Keep all repetitions. " + promptHint);

                const whisperRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                    method: "POST", headers: { "Authorization": `Bearer ${whisperKey}` }, body: formData
                });

                const whisperData = await whisperRes.json();
                if (!whisperRes.ok) throw new Error(whisperData.error?.message || "Gagal transkripsi audio via Whisper.");
                if (!whisperData.text) throw new Error("Suara tidak terdeteksi atau audio kosong.");

                let rawText = whisperData.text;
                rawText = rawText.replace(/Terima kasih telah menonton!?/gi, "").replace(/Thanks for watching!?/gi, "").replace(/Terima kasih!?/gi, "").replace(/Subtitle by .+/gi, "").replace(/Subtitles by .+/gi, "");
                rawText = rawText.replace(/作词.*?(\n|$)/g, "").replace(/作曲.*?(\n|$)/g, "").replace(/编曲.*?(\n|$)/g, "");

                // 2. PROSES AUTO-CLEANUP MENGGUNAKAN CLAUDE / GOOGLE PRO
                let cleanText = rawText.trim();
                
                try {
                    const providersDoc = await db.collection("settings").doc("api_providers").get();
                    const allProviders = providersDoc.data().list || [];
                    const llmProviders = allProviders.filter(p => p.serviceType && (String(p.serviceType).toLowerCase() === "llm" || String(p.serviceType).toLowerCase() === "text" || String(p.serviceType).toLowerCase() === "chat"));
                    
                    if (llmProviders.length > 0) {
                        const llmProv = llmProviders[0]; 
                        const llmKeysQuery = await db.collection("api_keys").where("provider", "==", llmProv.value).where("status", "==", "aktif").get();
                        
                        if (!llmKeysQuery.empty) {
                            const llmKey = llmKeysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1))[0].data().key;
                            let activeModel = llmProv.models ? llmProv.models.split(',')[0].trim() : "default";

                            const systemPrompt = `Anda adalah Audio Engineer & Ahli Lirik. Teks di bawah ini adalah hasil transkripsi AI (Speech-to-Text) dari sebuah lagu full instrumen. Karena suara musiknya keras, AI transkripsi sering berhalusinasi (menulis kata-kata aneh/asalan yang tidak masuk akal).
TUGAS ANDA:
1. Bersihkan teks tersebut dari kata-kata halusinasi atau asalan.
2. Tebak dan perbaiki kata-kata yang salah dengar menjadi lirik yang masuk akal sesuai konteks.
3. Susun menjadi bait-bait lirik lagu yang rapi.
4. JANGAN tambahkan komentar apapun. HANYA berikan lirik yang sudah bersih.`;

                            const variables = { model: activeModel, systemPrompt: systemPrompt, prompt: `TEKS MENTAH BERANTAKAN:\n${rawText}` };
                            let parsedBodyString = renderTemplate(llmProv.payloadTemplate || `{"model": "{{model}}", "messages": [{"role": "system", "content": "{{systemPrompt}}"}, {"role": "user", "content": "{{prompt}}"}]}`, variables);
                            const finalPayload = JSON.parse(parsedBodyString);

                            const headers = { "Content-Type": "application/json" };
                            headers[llmProv.headerName || "Authorization"] = (llmProv.headerValue || "Bearer {apiKey}").replace("{apiKey}", llmKey);

                            const llmRes = await fetch(`${llmProv.baseUrl}${llmProv.endpoint}`, { method: 'POST', headers: headers, body: JSON.stringify(finalPayload) });
                            const llmData = await llmRes.json();

                            if (llmRes.ok) {
                                if (llmData.choices && llmData.choices[0].message) cleanText = llmData.choices[0].message.content;
                                else if (llmData.candidates && llmData.candidates[0].content) cleanText = llmData.candidates[0].content.parts[0].text;
                            }
                        }
                    }
                } catch (llmErr) {
                    console.warn("Auto-cleanup LLM gagal, menggunakan teks mentah Whisper:", llmErr);
                }

                if (!cleanText || cleanText.trim() === "") cleanText = "[Musik Instrumental / Vokal tidak terdengar jelas oleh AI]";

                return res.status(200).json({ success: true, result: cleanText });
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        }

        // ============================================================
        // ROUTE 1A-2: SINKRONISASI LIRIK
        // ============================================================
        if (action === 'sync_lyrics') {
            if (!audioUrl || !lyrics) return res.status(400).json({ error: 'Audio URL dan Teks Lirik wajib diisi untuk sinkronisasi.' });
            const audioDurationSec = body.audioDuration || 240; 
            try {
                // AUTO DETECT WHISPER PROVIDER
                const providersDoc = await db.collection("settings").doc("api_providers").get();
                const allProviders = providersDoc.data()?.list || [];
                const whisperProvider = allProviders.find(p => String(p.label || p.value || "").toLowerCase().includes("whisper"));
                if (!whisperProvider) throw new Error("Provider Whisper tidak ditemukan di database API.");

                const whisperKeysQuery = await db.collection("api_keys").where("provider", "==", whisperProvider.value).where("status", "==", "aktif").get();
                if (whisperKeysQuery.empty) throw new Error("API Key untuk Whisper tidak ditemukan atau mati.");
                const whisperKey = whisperKeysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1))[0].data().key;

                const audioFetch = await fetch(audioUrl);
                if (!audioFetch.ok) throw new Error("Gagal mengunduh audio referensi.");
                const audioBlob = await audioFetch.blob();

                const formData = new FormData();
                formData.append("file", audioBlob, "audio.mp3");
                formData.append("model", "whisper-large-v3"); // Gunakan V3 murni agar sinkronisasi sangat akurat
                formData.append("temperature", "0.0");
                formData.append("response_format", "verbose_json");
                
                const promptHint = lyrics.substring(0, 400).replace(/\n/g, ', ');
                // Prompt ketat mempertahankan bahasa asli
                formData.append("prompt", "This is a song with music and vocals. Transcribe the lyrics accurately in its original language. Do not translate. Keep all repetitions. " + promptHint); 

                const whisperRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                    method: "POST", headers: { "Authorization": `Bearer ${whisperKey}` }, body: formData
                });

                const whisperData = await whisperRes.json();
                if (!whisperRes.ok) throw new Error(whisperData.error?.message || "Gagal sinkronisasi via Groq.");

                const segments = whisperData.segments;
                if (!segments || segments.length === 0) throw new Error("AI tidak mendeteksi suara vokal pada lagu ini.");
                
                const rawUserLines = lyrics.split('\n').map(l => l.trim()).filter(l => l !== "");
                let validSegments = segments.filter(seg => {
                    let t = seg.text.toLowerCase();
                    if (t.includes("terima kasih") || t.includes("thanks for") || t.includes("subtitle")) return false;
                    if (seg.end - seg.start < 0.5 && t.replace(/[^a-z]/gi, '').length < 3) return false; 
                    return true;
                });

                let wordTimeSlots = [];
                for (let seg of validSegments) {
                    let words = seg.text.trim().split(/\s+/);
                    if (words.length === 0) continue;
                    let timePerWord = (seg.end - seg.start) / words.length;
                    for (let w = 0; w < words.length; w++) {
                        wordTimeSlots.push({ start: seg.start + (w * timePerWord), end: seg.start + ((w + 1) * timePerWord) });
                    }
                }

                let formattedLyrics = [];
                let slotIndex = 0;
                let lastEnd = 0;

                for (let i = 0; i < rawUserLines.length; i++) {
                    let line = rawUserLines[i];
                    let isTag = line.match(/^\[.*\]$/);

                    if (isTag) {
                        formattedLyrics.push({ id: i + 1, start: parseFloat(lastEnd.toFixed(2)), end: parseFloat(lastEnd.toFixed(2)), text: line });
                        continue;
                    }
                    let lineWordCount = line.split(/\s+/).length;
                    if (slotIndex < wordTimeSlots.length) {
                        let startSlot = wordTimeSlots[slotIndex];
                        if (startSlot.start - lastEnd > 5.0 && lastEnd > 0) {
                            formattedLyrics.push({ id: 'inst_' + i, start: parseFloat(lastEnd.toFixed(2)), end: parseFloat(startSlot.start.toFixed(2)), text: "[Instrumental]" });
                        }
                        let endSlotIndex = Math.min(slotIndex + lineWordCount - 1, wordTimeSlots.length - 1);
                        let endSlot = wordTimeSlots[endSlotIndex];

                        formattedLyrics.push({ id: i + 1, start: parseFloat(startSlot.start.toFixed(2)), end: parseFloat(endSlot.end.toFixed(2)), text: line });
                        lastEnd = endSlot.end;
                        slotIndex += lineWordCount;
                    } else {
                        let remainingTime = audioDurationSec - lastEnd;
                        let remainingLines = rawUserLines.length - i;
                        let timePerLine = Math.min(4.0, Math.max(2.0, remainingTime / remainingLines));
                        let subEnd = lastEnd + timePerLine;
                        
                        formattedLyrics.push({ id: i + 1, start: parseFloat(lastEnd.toFixed(2)), end: parseFloat(subEnd.toFixed(2)), text: line });
                        lastEnd = subEnd;
                    }
                }

                if (audioDurationSec - lastEnd > 5.0) {
                    formattedLyrics.push({ id: 'outro', start: parseFloat(lastEnd.toFixed(2)), end: parseFloat(audioDurationSec.toFixed(2)), text: "[Instrumental]" });
                }

                let lrcText = "";
                formattedLyrics.forEach(item => {
                    let m = Math.floor(item.start / 60).toString().padStart(2, '0');
                    let s = (item.start % 60).toFixed(2).padStart(5, '0');
                    lrcText += `[${m}:${s}] ${item.text}\n`;
                });

                return res.status(200).json({ success: true, isLrcString: true, result: lrcText.trim() });
            } catch (err) {
                return res.status(500).json({ error: "Gagal sinkronisasi lirik: " + err.message });
            }
        }

        // ============================================================
        // ROUTE 1B: MAGIC WAND (AUTO-EDIT LIRIK & STYLE VIA LLM MULTIMODAL)
        // ============================================================
        if (action === 'magic_wand') {
            if (!llmType) return res.status(400).json({ error: 'Parameter llmType wajib diisi untuk Magic Wand.' });

            const finalProviderId = providerId || 'auto_pool';
            let finalInputText = inputText || "";

            try {
                if (!finalInputText) return res.status(400).json({ error: 'Teks input wajib diisi untuk menggunakan AI.' });

                const providersDoc = await db.collection("settings").doc("api_providers").get();
                const allProviders = providersDoc.data().list || [];
                
                let llmProvidersToTry = [];
                if (finalProviderId === 'auto_pool') {
                    llmProvidersToTry = allProviders.filter(p => p.serviceType && (String(p.serviceType).toLowerCase() === "llm" || String(p.serviceType).toLowerCase() === "text" || String(p.serviceType).toLowerCase() === "chat"));
                    
                    // LOGIKA PINTAR: Jika ada Audio, filter HANYA provider yang mendukung Multimodal (Gemini/Claude)
                    if (audioUrl) {
                        const multimodalProviders = llmProvidersToTry.filter(p => 
                            (p.models && p.models.toLowerCase().includes('gemini')) || 
                            (p.label && p.label.toLowerCase().includes('multimodal'))
                        );
                        if (multimodalProviders.length > 0) {
                            llmProvidersToTry = multimodalProviders;
                        }
                    }
                    
                    if (llmProvidersToTry.length === 0) return res.status(500).json({ error: 'Tidak ada provider LLM aktif yang mendukung permintaan ini.' });
                } else {
                    const specificProvider = allProviders.find(p => p.value === finalProviderId);
                    if (!specificProvider) return res.status(500).json({ error: 'Provider LLM tidak ditemukan.' });
                    llmProvidersToTry = [specificProvider];
                }

                let systemPrompt = "";
                
                // 1. PROMPT UNTUK AUTO-STYLE (DITAMBAH KONTROL DURASI 3-4 MENIT)
                if (llmType === 'style') {
                    systemPrompt = `You are a Master Audio Engineer & Prompt Engineer for Suno AI. Listen to the provided audio and convert the vibe into a highly detailed, professional list of comma-separated music tags.
ABSOLUTE RULES:
1. 100% ENGLISH. Only keep specific cultural genres ('Dangdut', 'Koplo', 'Sholawat') untranslated.
2. NO ARTIST NAMES. Focus ONLY on instruments, mood, and tempo.
3. Output ONLY the comma-separated prompt tags. No conversational text.
4. CRITICAL: You MUST append these exact tags at the end of your response to force the AI to perfectly clone the audio and keep it strictly between 3 to 4 minutes: "[Is_MAX_MODE: MAX], [QUALITY: MAX], [REAL_INSTRUMENTS: MAX], pristine studio mixing, 1:1 exact melody copy, strict adherence to original chord progression, identical bassline, zero deviation from source audio, consistent rhythm from start to finish, no improvisation, identical vocal timbre, standard 3 to 4 minute song length, concise arrangement, no extended solos, clear ending, 8k resolution audio, lossless mastering".
5. STRICT LENGTH LIMIT: Your ENTIRE response, INCLUDING the mandatory tags above, MUST NOT EXCEED 900 characters. Be concise with your instrument tags to ensure it stays under the limit.`;
                } 
                // 2. PROMPT UNTUK DETEKSI LIRIK (HAPUS INSTRUMEN & DITAMBAH TAG [End])
                else if (llmType === 'detect_lyrics') {
                    systemPrompt = `Kamu adalah Ahli Transkripsi Audio Profesional. Tugasmu adalah MENDENGARKAN file audio yang dilampirkan dari detik pertama hingga detik terakhir, lalu menuliskan liriknya secara VERBATIM (kata per kata persis seperti yang diucapkan penyanyi).

ATURAN MUTLAK (HUKUMAN JIKA DILANGGAR):
1. DILARANG MENEBAK ATAU MENGARANG LIRIK! Tulis HANYA apa yang benar-benar kamu dengar dari audio ini.
2. JIKA AUDIO KOSONG, RUSAK, ATAU TIDAK TERDENGAR SUARA VOKAL SAMA SEKALI, WAJIB TULIS: "[Instrumental Music - No Vocals]". JANGAN PERNAH mengarang lirik seperti "Kulihat senja" atau lirik klise lainnya!
3. TULIS SAMPAI HABIS! Jangan berhenti di tengah jalan.
4. Tuliskan sesuai bahasa aslinya (Jangan diterjemahkan).
5. STRUKTUR STANDAR (TANPA INSTRUMEN): Berikan tag struktur lagu menggunakan kurung siku standar (contoh: [Intro], [Verse 1], [Chorus], [Outro]). DILARANG KERAS menuliskan deskripsi instrumen atau alat musik di dalam kurung siku maupun di luar kurung siku.
6. LYRIC ENGINEERING (ANTI-AMNESIA): Untuk mengunci nada penyanyi asli, sisipkan tag [EXACT SAME MELODY AND VOCALS] tepat di bawah tag [Intro] dan [Chorus].
7. WATERMARK WAJIB: Kamu WAJIB menyisipkan lirik "(Spoken: Ha bi R M X)" tepat di bawah tag [Instrumental Interlude] atau [Guitar Solo] di pertengahan lagu, DAN satu kali lagi tepat di bawah tag [Outro] di akhir lagu.
8. KONTROL DURASI (3 - 4 MENIT): Agar lagu tidak melar lebih dari 4 menit, kamu WAJIB menaruh tag [End] di baris paling bawah setelah [Outro].
9. Langsung berikan hasil liriknya, dilarang memberikan kata pengantar.`;
                }
                // 3. PROMPT UNTUK MERAPIKAN LIRIK (TEKS SAJA)
                else if (llmType === 'lyrics') {
                    systemPrompt = `Kamu adalah Penulis Lagu Profesional. Rapikan lirik dari user ini. Tambahkan tag struktur seperti [Verse] dan [Chorus]. Jangan mengubah kata-kata aslinya. WAJIB tambahkan tag [End] di baris paling bawah agar lagu berhenti tepat waktu.`;
                }
                // 4. FITUR BARU: REVISI STYLE (AI AGENT)
                else if (llmType === 'revise_style') {
                    systemPrompt = `Kamu adalah Asisten AI Audio Engineer. Tugasmu adalah MEREVISI prompt gaya musik (Style) yang sudah ada berdasarkan instruksi dari user.
ATURAN MUTLAK:
1. BACA prompt asli yang diberikan user.
2. LAKUKAN perubahan HANYA sesuai instruksi user (misal: tambah bass, ubah jadi dangdut, dll). JANGAN merubah bagian lain yang tidak diminta.
3. JIKA user menempelkan prompt mereka sendiri, rapikan menjadi format koma (comma-separated) dalam bahasa Inggris.
4. PANJANG MAKSIMAL: Hasil akhir TIDAK BOLEH LEBIH DARI 950 KARAKTER. Jika terlalu panjang, hapus kata kunci yang kurang penting.
5. Langsung berikan hasil akhirnya saja tanpa kata pengantar atau basa-basi.`;
                }
                // 5. FITUR BARU: REVISI LIRIK (AI AGENT)
                else if (llmType === 'revise_lyrics') {
                    systemPrompt = `Kamu adalah Asisten AI Penulis Lagu. Tugasmu adalah MEREVISI lirik lagu yang sudah ada berdasarkan instruksi dari user.
ATURAN MUTLAK:
1. BACA lirik asli yang diberikan user.
2. LAKUKAN perubahan HANYA sesuai instruksi user (misal: ubah kata, hapus baris, tambah watermark). JANGAN merubah lirik lain yang tidak diminta.
3. PERTAHANKAN format struktur [Bagian Lagu] jika ada. DILARANG menambahkan deskripsi instrumen.
4. JIKA user meminta menambahkan watermark "HABI RMX", pastikan format penulisannya persis seperti ini: (Spoken: Ha bi R M X).
5. Langsung berikan hasil akhirnya saja tanpa kata pengantar atau basa-basi.`;
                }

                // FIX: UBAH AUDIO URL MENJADI BASE64 DATA URI DENGAN PROTEKSI
                let finalAudioPayload = audioUrl;
                if (audioUrl) {
                    try {
                        const aFetch = await fetch(audioUrl);
                        if (!aFetch.ok) throw new Error(`HTTP error! status: ${aFetch.status}`);
                        const contentType = aFetch.headers.get('content-type');
                        
                        // Pastikan yang didownload benar-benar audio/video, bukan HTML (link error/diblokir)
                        if (contentType && !contentType.includes('text/html')) {
                            const aBuffer = await aFetch.arrayBuffer();
                            const base64Data = Buffer.from(aBuffer).toString('base64');
                            const mimeType = contentType || 'audio/mp3';
                            finalAudioPayload = `data:${mimeType};base64,${base64Data}`;
                        } else {
                            console.warn("URL tidak mengembalikan file audio langsung, mengirim URL mentah ke LLM.");
                        }
                    } catch(e) {
                        console.error("Gagal fetch audio base64, fallback ke URL mentah:", e);
                        // Fallback: biarkan finalAudioPayload berisi URL mentah agar API provider yang mencoba mendownloadnya
                    }
                }

                let resultText = "";
                let success = false;
                let lastError = "";

                for (const llmProvider of llmProvidersToTry) {
                    const keysQuery = await db.collection("api_keys").where("provider", "==", llmProvider.value).where("status", "==", "aktif").get();
                    const sortedKeysDocs = keysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1));
                    if (sortedKeysDocs.length === 0) { lastError = `API Key habis.`; continue; }

                    let modelList = llmProvider.models ? llmProvider.models.split(',').map(m => m.trim()).filter(m => m) : ["default"];
                    let targetModels = (finalProviderId !== 'auto_pool' && modelId && modelList.includes(modelId)) ? [modelId] : modelList;

                    for (const keyDoc of sortedKeysDocs) {
                        const activeApiKey = keyDoc.data().key;
                        for (const currentModel of targetModels) {
                            try {
                                let finalPayload;
                                
                                if (audioUrl) {
                                    finalPayload = {
                                        model: currentModel,
                                        max_tokens: 8192,
                                        temperature: 0.0, // 0.0 agar sangat kaku dan tidak berhalusinasi
                                        messages: [
                                            { role: "system", content: systemPrompt },
                                            { role: "user", content: [
                                                { type: "text", text: finalInputText },
                                                { type: "image_url", image_url: { url: finalAudioPayload } }
                                            ]}
                                        ]
                                    };
                                } else {
                                    const variables = { model: currentModel, systemPrompt: systemPrompt, prompt: finalInputText };
                                    let parsedBodyString = renderTemplate(llmProvider.payloadTemplate || `{"model": "{{model}}", "messages": [{"role": "system", "content": "{{systemPrompt}}"}, {"role": "user", "content": "{{prompt}}"}]}`, variables);
                                    finalPayload = JSON.parse(parsedBodyString);
                                    if (!finalPayload.max_tokens) finalPayload.max_tokens = 8192;
                                }

                                const headers = { "Content-Type": "application/json" };
                                headers[llmProvider.headerName || "Authorization"] = (llmProvider.headerValue || "Bearer {apiKey}").replace("{apiKey}", activeApiKey);

                                const response = await fetch(`${llmProvider.baseUrl}${llmProvider.endpoint}`, { method: 'POST', headers: headers, body: JSON.stringify(finalPayload) });
                                const resData = await response.json();
                                
                                if (!response.ok || (resData.code && resData.code !== 200)) throw new Error(extractErrorString(resData) || "API Error");

                                if (resData.choices && resData.choices[0].message) resultText = resData.choices[0].message.content;
                                else if (resData.candidates && resData.candidates[0].content) resultText = resData.candidates[0].content.parts[0].text;
                                else resultText = JSON.stringify(resData);

                                success = true; break; 
                            } catch (e) {
                                lastError = e.message;
                                const lowerErr = lastError.toLowerCase();
                                
                                // LOGIKA PINTAR: Jika saldo habis, matikan key ini dan langsung lompat ke key berikutnya
                                if (lowerErr.includes('insufficient') || lowerErr.includes('balance') || lowerErr.includes('quota') || lowerErr.includes('credit') || lowerErr.includes('available') || lowerErr.includes('need at least') || lowerErr.includes('not enough')) {
                                    try { await db.collection("api_keys").doc(keyDoc.id).update({ status: "mati" }); } catch(err){}
                                    break; // Berhenti mencoba di key yang sama, lanjut ke key berikutnya!
                                }
                            }
                        }
                        if (success) break;
                    }
                    if (success) break;
                }
                if (!success) throw new Error(`LLM gagal merespons. Pastikan model mendukung Audio (Gemini). Error: ${lastError}`);
                
                let finalCleanText = resultText.trim().replace(/Berikut adalah[\s\S]*?:/gi, '');
                return res.status(200).json({ success: true, result: finalCleanText });
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

                const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${activeApiKey}` };

                if (action === 'generate_phrase') {
                    const { voiceUrl, vocalStartS, vocalEndS } = body;
                    if (!voiceUrl) throw new Error("voiceUrl wajib diisi.");
                    
                    const response = await fetch(`${kieProvider.baseUrl}/api/v1/voice/validate`, {
                        method: 'POST', headers, body: JSON.stringify({ voiceUrl: voiceUrl, vocalStartS: vocalStartS || 0, vocalEndS: vocalEndS || 30, language: "id" })
                    });
                    const resData = await response.json();
                    if (!response.ok || resData.code !== 200) throw new Error(resData.msg || "Gagal generate phrase");
                    return res.status(200).json({ success: true, taskId: resData.data.taskId });
                }

                if (action === 'create_voice') {
                    const { taskId, verifyUrl, voiceName, description, style } = body;
                    if (!taskId || !verifyUrl) throw new Error("taskId dan verifyUrl wajib diisi.");

                    const response = await fetch(`${kieProvider.baseUrl}/api/v1/voice/generate`, {
                        method: 'POST', headers, body: JSON.stringify({ taskId: taskId, verifyUrl: verifyUrl, voiceName: voiceName || "My Custom Voice", description: description || "Kreaverse Voice Clone", style: style || "", singerSkillLevel: "beginner" })
                    });
                    const resData = await response.json();
                    if (!response.ok || resData.code !== 200) throw new Error(resData.msg || "Gagal create voice");
                    return res.status(200).json({ success: true, taskId: resData.data.taskId });
                }

                if (action === 'create_persona') {
                    const { taskId, audioId, name, description, vocalStart, vocalEnd } = body;
                    if (!taskId || !audioId || !name || !description) throw new Error("Parameter persona tidak lengkap.");

                    const response = await fetch(`${kieProvider.baseUrl}/api/v1/generate/generate-persona`, {
                        method: 'POST', headers, body: JSON.stringify({ taskId: taskId, audioId: audioId, name: name, description: description, vocalStart: vocalStart || 0, vocalEnd: vocalEnd || 30 })
                    });
                    const resData = await response.json();
                    if (!response.ok || resData.code !== 200) throw new Error(resData.msg || "Gagal create persona");
                    
                    const newPersonaId = resData.data.personaId;
                    const activeKeyDocId = sortedKeysDocs[0].id;
                    
                    // SIMPAN KEPEMILIKAN: Catat API Key mana yang membuat suara ini (Tanpa ganggu frontend)
                    try {
                        await db.collection("persona_keys").doc(newPersonaId).set({
                            keyDocId: activeKeyDocId,
                            createdAt: Date.now()
                        });
                    } catch(e) { console.error("Gagal simpan mapping persona:", e); }

                    return res.status(200).json({ success: true, personaId: newPersonaId });
                }
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        }

        // ============================================================
        // ROUTE 1D: FETCH AUDIO (BYPASS CORS UNTUK MASTERING LOKAL)
        // ============================================================
        if (action === 'fetch_audio') {
            const { audioUrl } = body;
            if (!audioUrl) return res.status(400).json({ error: 'Audio URL wajib diisi.' });

            try {
                // Backend Vercel mendownload langsung dari server sumber (Kebal CORS)
                const audioFetch = await fetch(audioUrl);
                if (!audioFetch.ok) throw new Error("Gagal mengunduh audio dari server sumber.");
                
                const arrayBuffer = await audioFetch.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                
                // Kirim balik ke Frontend sebagai file utuh
                res.setHeader('Content-Type', audioFetch.headers.get('content-type') || 'audio/mpeg');
                res.setHeader('Content-Length', buffer.length);
                return res.send(buffer);
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        }

        // ============================================================
        // ROUTE 2: GENERATE MUSIC (DYNAMIC PROVIDER SUPPORT)
        // ============================================================
        if (!email || !prompt) return res.status(400).json({ error: 'Parameter email dan prompt wajib diisi!' });

        try {
            const usersRef = db.collection("users");
            const userQuery = await usersRef.where("email", "==", email).get();
            if (userQuery.empty) return res.status(403).json({ error: 'Akses ditolak: Klien tidak terdaftar!' });
            const userDoc = userQuery.docs[0];
            const userData = userDoc.data();

            if (userData.expiry && userData.expiry < Date.now() && userData.tier !== 'max_lifetime') return res.status(403).json({ error: 'Masa aktif paket premium Anda telah kedaluwarsa!' });
            if (userData.dailyQuota > 0 && userData.generateCount >= userData.dailyQuota) return res.status(403).json({ error: 'Batas kuota harian pembuatan lagu Anda telah habis!' });

            const providersDoc = await db.collection("settings").doc("api_providers").get();
            const allProviders = providersDoc.data().list || [];
            
            // FIX KETAT: Pisahkan mesin pembuat lagu dari mesin suara (TTS) dan transkripsi (ASR)
            const audioProviders = allProviders.filter(p => {
                const sType = String(p.serviceType || "").toLowerCase();
                const label = String(p.label || p.name || p.provider || p.value || "").toLowerCase();
                
                if (sType && !sType.includes("audio") && !sType.includes("music")) return false;
                
                // BLOKIR KERAS: Jangan masukkan ElevenLabs, Google TTS, atau Whisper ke daftar mesin musik!
                if (label.includes('elevenlabs') || label.includes('tts') || label.includes('speech') || label.includes('whisper') || label.includes('asr')) {
                    return false;
                }
                return true;
            });

            if (audioProviders.length === 0) return res.status(500).json({ error: 'Belum ada provider Mesin Musik terdaftar.' });

            const targetProviderId = providerId || modelId;
            const isAutoPool = (targetProviderId === 'auto_pool');
            
            // CEK KEPEMILIKAN SUARA DI DATABASE (Berlaku hanya jika opsi Voice dipakai)
            let requiredKeyDocId = null;
            let requiredProviderName = null;

            if (options && options.personaId) {
                try {
                    const personaDoc = await db.collection("persona_keys").doc(options.personaId).get();
                    if (personaDoc.exists) {
                        requiredKeyDocId = personaDoc.data().keyDocId;
                        
                        // PELACAKAN PINTAR: Cari tahu provider mana yang memiliki API Key ini
                        const keyDoc = await db.collection("api_keys").doc(requiredKeyDocId).get();
                        if (keyDoc.exists) {
                            requiredProviderName = keyDoc.data().provider;
                        }
                    }
                } catch(e) { console.error("Gagal cek persona:", e); }
            }

            let providersToTry = [];
            
            // LOGIKA PINTAR: Jika pakai Voice, PAKSA gunakan provider pemilik Voice tersebut!
            if (requiredProviderName) {
                const voiceProvider = audioProviders.find(p => p.value === requiredProviderName);
                if (voiceProvider) {
                    providersToTry = [voiceProvider];
                } else {
                    return res.status(500).json({ error: `Provider '${requiredProviderName}' untuk Suara ini tidak ditemukan di sistem.` });
                }
            } else {
                // Logika normal jika tidak pakai Voice (Auto Pool / Spesifik)
                providersToTry = isAutoPool ? audioProviders : [audioProviders.find(p => p.value === targetProviderId)].filter(Boolean);
            }

            if (providersToTry.length === 0) return res.status(500).json({ error: 'Provider spesifik tidak ditemukan di database.' });

            let taskResponse = null;
            let successfulProvider = null;
            let lastErrorMessage = "Tidak ada respons dari server.";
            let keyFoundAndUsed = false;

            for (let i = 0; i < providersToTry.length; i++) {
                let currentProvider = providersToTry[i];
                
                const keysQuery = await db.collection("api_keys").where("provider", "==", currentProvider.value).where("status", "==", "aktif").get();
                let sortedKeysDocs = keysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1));

                // JIKA PROVIDER INI TIDAK PUNYA KEY AKTIF -> LANGSUNG LEWATI (SKIP), JANGAN BUAT ERROR!
                if (sortedKeysDocs.length === 0) {
                    if (lastErrorMessage === "Tidak ada respons dari server.") {
                        lastErrorMessage = `API Key untuk provider '${currentProvider.value}' tidak ditemukan atau mati.`;
                    }
                    continue; 
                }

                // FILTER KHUSUS VOICE: Paksa sistem hanya melirik API Key si pembuat suara
                if (requiredKeyDocId) {
                    const specificKeyDoc = sortedKeysDocs.find(k => k.id === requiredKeyDocId);
                    if (specificKeyDoc) {
                        sortedKeysDocs = [specificKeyDoc]; // Kunci sistem ke API Key ini saja
                    } else {
                        // LOGIKA PINTAR: Jika API Key pembuat suara ini sudah mati/dihapus, langsung hentikan proses!
                        // Jangan continue ke provider lain karena Voice ID ini tidak akan dikenali di akun lain.
                        return res.status(400).json({ 
                            error: "Karakter Suara (Voice ID) ini sudah kadaluarsa karena limit server. Silakan buat ulang / kloning ulang suara Anda di menu 'Pakai SuaraMu'." 
                        });
                    }
                }

                let activeModel = "V5_5";
                let isModelSupported = false;
                let requestedModels = modelId ? modelId.split(',').map(m => m.trim()).filter(m => m) : [];

                if (currentProvider.models) {
                    const modelList = currentProvider.models.split(',').map(m => m.trim()).filter(m => m);
                    if (modelList.length > 0) {
                        for (let rm of requestedModels) {
                            if (modelList.includes(rm)) {
                                activeModel = rm;
                                isModelSupported = true;
                                break;
                            }
                        }
                        // Jika mode Auto Pool dan provider ini tidak punya model yang diminta, lewati provider ini
                        if (!isModelSupported && isAutoPool) continue;
                        
                        // Fallback aman jika strict mode tapi model tidak cocok
                        if (!isModelSupported) activeModel = modelList[0];
                    }
                }

                for (const keyDoc of sortedKeysDocs) {
                    const activeApiKey = keyDoc.data().key;

                    try {
                        let endpointPath = currentProvider.endpoint;
                        if (audioUrl && currentProvider.endpointCover) endpointPath = currentProvider.endpointCover;
                        let providerUrl = `${currentProvider.baseUrl}${endpointPath}`;

                        let finalStylePrompt = prompt || "";
                        let finalLyrics = lyrics || "";
                        const selectedGender = vocalGender || (options && options.vocalGender) || "not_specified";

                        let vocalGenderShort = "";
                        if (selectedGender.toLowerCase() === 'female') {
                            vocalGenderShort = "f";
                            if (!finalStylePrompt.toLowerCase().includes('female')) finalStylePrompt = "female vocal, female singer, " + finalStylePrompt;
                            if (!finalLyrics.toLowerCase().includes('[female')) finalLyrics = "[Female Vocal]\n" + finalLyrics;
                        } else if (selectedGender.toLowerCase() === 'male') {
                            vocalGenderShort = "m";
                            if (!finalStylePrompt.toLowerCase().includes('male')) finalStylePrompt = "male vocal, male singer, " + finalStylePrompt;
                            if (!finalLyrics.toLowerCase().includes('[male')) finalLyrics = "[Male Vocal]\n" + finalLyrics;
                        }

                        let rawBody = currentProvider.payloadTemplate || "{}";
                        if (finalLyrics && finalLyrics.trim() !== "" && currentProvider.payloadCustomTemplate) rawBody = currentProvider.payloadCustomTemplate;
                        if (audioUrl && currentProvider.payloadCoverTemplate) rawBody = currentProvider.payloadCoverTemplate;

                        const variables = {
                            title: title || "Untitled Song", prompt: finalStylePrompt, lyrics: finalLyrics, 
                            audioUrl: audioUrl || "", videoUrl: audioUrl || "", uploadUrl: audioUrl || "", 
                            customMode: finalLyrics ? "true" : "false", instrumental: instrumental ? "true" : "false", 
                            negativeTags: options?.negativeTags || "", vocalGender: selectedGender, vocalGenderShort: vocalGenderShort, 
                            styleWeight: options?.styleWeight || "0.5", weirdness: options?.weirdness || "0.5", audioWeight: options?.audioWeight || "0.5",
                            personaId: options?.personaId || "", model: activeModel
                        };
                        
                        let parsedBodyString = renderTemplate(rawBody, variables);
                        const finalPayload = JSON.parse(parsedBodyString);

                        const headers = { "Content-Type": "application/json" };
                        headers[currentProvider.headerName || "Authorization"] = (currentProvider.headerValue || "Bearer {apiKey}").replace("{apiKey}", activeApiKey);

                        let fetchBody = JSON.stringify(finalPayload);
                        if (finalPayload._send_as_form) {
                            delete finalPayload._send_as_form;
                            headers["Content-Type"] = "application/x-www-form-urlencoded";
                            const formParams = new URLSearchParams();
                            for (const key in finalPayload) formParams.append(key, finalPayload[key]);
                            fetchBody = formParams.toString();
                        }

                        const response = await fetch(providerUrl, { method: 'POST', headers: headers, body: fetchBody });
                        let resData = {};
                        if (response.headers.get("content-type")?.includes("application/json")) {
                            resData = await response.json();
                        } else {
                            const errorText = await response.text();
                            throw new Error(`Provider HTTP ${response.status}: ${errorText.substring(0, 100)}`);
                        }

                        if (!response.ok || (resData.code && resData.code !== 200)) {
                            throw new Error(getValueByPath(resData, currentProvider.errorPath) || extractErrorString(resData) || "API Error");
                        }

                        if (currentProvider.execMode === 'sync') {
                            let tracks = [];
                            let audioUrlVal = getValueByPath(resData, currentProvider.statusVideoUrlPath || "audioUrl") || findAudioUrlRecursively(resData);

                            let searchTargets = [];
                            if (Array.isArray(resData.data)) searchTargets = resData.data;
                            else if (Array.isArray(resData.result)) searchTargets = resData.result;
                            else if (Array.isArray(resData.tracks)) searchTargets = resData.tracks;
                            else if (Array.isArray(resData)) searchTargets = resData;

                            if (searchTargets.length > 0) {
                                searchTargets.forEach(item => {
                                    let url = findAudioUrlRecursively(item);
                                    if (url) {
                                        let img = findImageUrlRecursively(item) || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg";
                                        tracks.push({ audioUrl: url, imageUrl: img });
                                    }
                                });
                            }

                            if (tracks.length === 0 && audioUrlVal) {
                                tracks.push({ audioUrl: audioUrlVal, imageUrl: findImageUrlRecursively(resData) || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" });
                            }

                            if (tracks.length === 0) throw new Error("URL Audio tidak ditemukan pada respons Synchronous API.");

                            taskResponse = { status: "completed", provider: currentProvider.value, tracks: tracks, raw: resData };
                            successfulProvider = currentProvider; keyFoundAndUsed = true; break;

                        } else {
                            let taskId = getValueByPath(resData, currentProvider.responsePath || "id") || resData.data?.taskId || resData.taskId || resData.data?.task_id || resData.task_id || resData.data?.id || resData.id;
                            if (taskId) {
                                taskResponse = { taskId, provider: currentProvider.value };
                                successfulProvider = currentProvider; keyFoundAndUsed = true; break;
                            } else {
                                throw new Error("Task ID tidak ditemukan dalam respons API.");
                            }
                        }

                    } catch (apiErr) {
                        lastErrorMessage = apiErr.message;
                        const lowerErr = lastErrorMessage.toLowerCase();
                        
                        // FITUR AUTO-KILL API KEY JIKA SALDO HABIS
                        if (lowerErr.includes('insufficient') || lowerErr.includes('balance') || lowerErr.includes('credit') || lowerErr.includes('quota') || lowerErr.includes('fund') || lowerErr.includes('limit') || lowerErr.includes('available') || lowerErr.includes('need at least') || lowerErr.includes('not enough')) {
                            try {
                                await db.collection("api_keys").doc(keyDoc.id).update({ status: "mati" });
                                await db.collection("system_logs").add({
                                    type: "warning", host: currentProvider.value, request: "AUTO_KILL_KEY",
                                    message: `API Key otomatis dimatikan karena saldo habis. Pesan: ${lastErrorMessage}`, timestamp: Date.now()
                                });
                            } catch(e) {}
                            
                            continue; // <--- LANJUT COBA KEY / PROVIDER LAIN
                        } else {
                            await db.collection("system_logs").add({
                                type: "error", host: currentProvider.value, request: isAutoPool ? "GENERATE_MUSIC_FAILOVER" : "GENERATE_MUSIC_STRICT",
                                message: `Koneksi atau pemrosesan gagal: ${apiErr.message}`, timestamp: Date.now()
                            });
                            
                            continue; // <--- LANJUT COBA KEY / PROVIDER LAIN
                        }
                    }
                }
                if (keyFoundAndUsed) break; 
            }

            if (!taskResponse) {
                const isAdmin = userData && userData.role === 'admin';
                let finalOutputError = lastErrorMessage || "Tidak ada respons dari server.";

                if (isAdmin) {
                    return res.status(502).json({ error: `[ADMIN DEBUG] Gagal: ${finalOutputError}` });
                } else {
                    // LOGIKA PINTAR: Sembunyikan urusan "API Key / Saldo" dari pengguna biasa
                    const lowerErr = finalOutputError.toLowerCase();
                    if (lowerErr.includes('insufficient') || lowerErr.includes('balance') || lowerErr.includes('quota') || lowerErr.includes('api key') || lowerErr.includes('mati')) {
                        finalOutputError = "Semua server AI saat ini sedang penuh atau dalam masa pemeliharaan. Sistem sedang mengalihkan rute, silakan coba lagi dalam beberapa menit.";
                    } else if (lowerErr.includes('not found') || lowerErr.includes('voice')) {
                        finalOutputError = "Karakter suara tidak ditemukan di server. Silakan buat ulang suara Anda.";
                    } else {
                        finalOutputError = "Server AI sedang sibuk memproses antrean. Silakan coba lagi beberapa saat.";
                    }
                    return res.status(502).json({ error: finalOutputError });
                }
            }

            await userDoc.ref.update({ generateCount: FieldValue.increment(1) });
            await db.collection("system_logs").add({ type: "success", host: successfulProvider.value, request: "GENERATE_MUSIC", message: `Klien ${userData.nama} sukses memicu aransemen lagu.`, timestamp: Date.now() });

            return res.status(200).json(taskResponse);
        } catch (globalErr) {
            return res.status(500).json({ error: globalErr.message });
        }
    }

    // ============================================================
    // METODE GET: ASYNCHRONOUS STATUS CHECK (POLLING STATUS)
    // ============================================================
    if (req.method === 'GET') {
        const { taskId, provider, email, action } = req.query; 
        if (!taskId) return res.status(400).json({ error: 'taskId wajib dilampirkan!' });

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

            const statusUrl = activeProvider.statusUrlTemplate?.replace("{baseUrl}", activeProvider.baseUrl).replace("{taskId}", taskId) || `${activeProvider.baseUrl}/v1/tasks/${taskId}`;
            const finalStatusUrl = statusUrl + (statusUrl.includes('?') ? `&_t=${Date.now()}` : `?_t=${Date.now()}`);

            const headers = { "Content-Type": "application/json", "Cache-Control": "no-store, no-cache", "Pragma": "no-cache" };
            headers[activeProvider.headerName || "Authorization"] = (activeProvider.headerValue || "Bearer {apiKey}").replace("{apiKey}", apiKey);

            const response = await fetch(finalStatusUrl, { method: 'GET', headers: headers, cache: 'no-store' });
            
            let resData = {};
            if (response.headers.get("content-type")?.includes("application/json")) {
                resData = await response.json();
            } else {
                const textData = await response.text();
                if (response.status === 413 || textData.includes('413') || textData.toLowerCase().includes('payload too large')) {
                     return res.status(200).json({ status: "failed", audioUrl: null, reason: "Hak Cipta / Payload Terlalu Besar: Lirik atau audio melebihi batas yang diizinkan server AI.", raw: textData });
                }
                throw new Error(`Provider status mengembalikan respons non-JSON (HTTP ${response.status})`);
            }

            let actualErrorMessage = getValueByPath(resData, activeProvider.errorPath) || extractErrorString(resData);
            let isKieFailed = false;
            if (resData.data && (resData.data.successFlag === 2 || resData.data.status === "failed" || resData.data.errorCode)) {
                isKieFailed = true;
                actualErrorMessage = resData.data.errorMessage || actualErrorMessage || "Generation failed (KIE Flag)";
            }

            if (!response.ok || (resData.code && resData.code !== 200) || isKieFailed) {
                const errMsg = actualErrorMessage || resData.msg || resData.message || resData.error || "API Error";
                const lowerErr = String(errMsg).toLowerCase();
                
                if (lowerErr.includes('not found') || response.status === 404 || resData.code === 404) {
                     return res.status(200).json({ status: "processing", audioUrl: null, reason: "Sinkronisasi antrean server AI...", raw: resData });
                }
                
                let translatedError = errMsg;
                if (lowerErr.includes('copyright') || lowerErr.includes('lyrics contain') || lowerErr.includes('artist name') || lowerErr.includes('catalog') || lowerErr.includes('matches an existing')) {
                    // MENGGUNAKAN PESAN ERROR ASLI PROVIDER UNTUK COPY/LIRIK
                    translatedError = `Moderasi AI / Hak Cipta Terdeteksi: ${errMsg}`;
                } else if (lowerErr.includes('insufficient') || lowerErr.includes('balance') || lowerErr.includes('credit') || lowerErr.includes('quota') || lowerErr.includes('fund')) {
                    // MENYEMBUNYIKAN ERROR SALDO HABIS DARI USER (Hanya ditunjukkan sebagai error sistem/sibuk)
                    translatedError = "Server AI internal sedang penuh/maintenance. Silakan coba provider lain atau hubungi Admin.";
                } else if (lowerErr.includes('too long') || lowerErr.includes('exceed')) {
                    translatedError = `Durasi/Batas Karakter Terlampaui: ${errMsg}`;
                }
                
                if (resData.code === 413 || resData.code === 400 || resData.code === 403 || lowerErr.includes('artist name') || lowerErr.includes('copyright') || lowerErr.includes('fail') || lowerErr.includes('error') || lowerErr.includes('reject') || lowerErr.includes('tags') || lowerErr.includes('matches an existing') || lowerErr.includes('catalog') || lowerErr.includes('insufficient') || lowerErr.includes('balance') || isKieFailed) {
                    if (email) {
                        try {
                            const refundQuery = await db.collection("users").where("email", "==", email).get();
                            if (!refundQuery.empty) await refundQuery.docs[0].ref.update({ generateCount: FieldValue.increment(-1), kredit: FieldValue.increment(50) });
                        } catch (refundErr) {}
                    }
                    return res.status(200).json({ status: "failed", audioUrl: null, reason: translatedError, raw: resData });
                }
                return res.status(500).json({ error: translatedError, details: resData });
            }

            let statusVal = getValueByPath(resData, activeProvider.statusResponsePath || "status");
            let extractedStatus = String(statusVal).toLowerCase().trim();
            if (!statusVal || extractedStatus === "null" || extractedStatus === "undefined" || extractedStatus === "") {
                const match = /"(?:status|state|task_status|taskstatus)"\s*:\s*"?([a-zA-Z0-9_-]+)"?/g.exec(JSON.stringify(resData).toLowerCase());
                if (match) extractedStatus = match[1].trim();
            }

            let completedValues = ["success", "finished", "completed", "done", "successful", "complete", ...(activeProvider.statusCompletedValue?.toLowerCase().split(',').map(s => s.trim()) || [])];
            let failedValues = ["failed", "error", "fail", "failure", "timeout", "canceled", "rejected", "generate_audio_failed", "unsuccessful", "banned", "moderation", "revoked", ...(activeProvider.statusFailedValue?.toLowerCase().split(',').map(s => s.trim()) || [])];
            let processingValues = ["processing", "in_progress", "queued", "pending", "starting", "running", "submitted", "wait", "waiting", "active", "generating", "progress", "streaming", "text_success", "first_success"];

            // FIX BUG 1 TRACK & 4 TRACK: Jangan anggap selesai jika statusnya ada di dalam daftar 'processingValues' (seperti first_success)
            let isCompleted = completedValues.includes(extractedStatus) || 
                ((extractedStatus.includes("success") || extractedStatus.includes("complete") || extractedStatus.includes("done")) && 
                !processingValues.includes(extractedStatus));
                
            let isFailed = failedValues.includes(extractedStatus) || extractedStatus.includes("fail") || extractedStatus.includes("error") || extractedStatus.includes("reject") || extractedStatus.includes("cancel") || extractedStatus.includes("timeout") || extractedStatus.includes("ban");
            let isProcessing = (!isCompleted && !isFailed) || processingValues.includes(extractedStatus) || extractedStatus.includes("process") || extractedStatus.includes("queue") || extractedStatus.includes("run") || extractedStatus.includes("wait");

            if (actualErrorMessage && (actualErrorMessage.toLowerCase().includes('fail') || actualErrorMessage.toLowerCase().includes('error') || actualErrorMessage.toLowerCase().includes('reject') || actualErrorMessage.toLowerCase().includes('artist name') || actualErrorMessage.toLowerCase().includes('copyright'))) {
                isFailed = true; isCompleted = false; isProcessing = false;
            }

            let audioUrlVal = null;
            let tracks = [];

            if (isCompleted) {
                const targetPath = activeProvider.statusVideoUrlPath || "download_url";
                let extractedMedia = getValueByPath(resData, targetPath);
                const arrayMatch = targetPath.match(/(.*?)\.\d+\.(.*)/);

                if (arrayMatch) {
                    let extractedArray = getValueByPath(resData, arrayMatch[1]);
                    if (Array.isArray(extractedArray) && extractedArray.length > 0) {
                        tracks = extractedArray.map(item => ({ audioId: item.id || item.audio_id || item.audioId || "", audioUrl: item[arrayMatch[2]] || item.audio_url || item.audioUrl || item.url || item.download_url || "", imageUrl: findImageUrlRecursively(item) || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" })).filter(t => t.audioUrl && typeof t.audioUrl === 'string' && t.audioUrl.startsWith('http'));
                        if (tracks.length > 0) audioUrlVal = tracks[0].audioUrl;
                    }
                } else if (typeof extractedMedia === 'string' && extractedMedia.startsWith('http')) {
                    audioUrlVal = extractedMedia;
                    tracks.push({ audioId: resData.id || resData.audio_id || resData.audioId || taskId, audioUrl: audioUrlVal, imageUrl: findImageUrlRecursively(resData) || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" });
                }

                // REVISI BACKEND: Gunakan pelacak pintar untuk menemukan array lagu sedalam apapun
                let searchTargets = findTracksArrayRecursively(resData) || [];

                if (searchTargets.length > 0) {
                    searchTargets.forEach(item => {
                        let url = findAudioUrlRecursively(item);
                        if (url) {
                            let img = findImageUrlRecursively(item) || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg";
                            // Ambil durasi asli dari API jika ada
                            let dur = item.duration || item.play_time || null;
                            tracks.push({ 
                                audioId: item.id || item.audio_id || item.audioId || taskId, 
                                audioUrl: url, 
                                imageUrl: img,
                                duration: dur // Simpan durasi asli
                            });
                        }
                    });
                }

                // Jika gagal ekstrak array dan tracks masih kosong, cari 1 URL secara rekursif global
                if (tracks.length === 0) {
                    audioUrlVal = findAudioUrlRecursively(resData) || audioUrlVal;
                    if (audioUrlVal) tracks.push({ audioId: resData.id || resData.audio_id || resData.audioId || taskId, audioUrl: audioUrlVal, imageUrl: findImageUrlRecursively(resData) || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" });
                }
                
                if (tracks.length > 0) audioUrlVal = tracks[0].audioUrl;
                if (!audioUrlVal) { isCompleted = false; isProcessing = true; }

                // Mencegah duplikasi track dari respons API
                const uniqueTracks = [];
                const seenUrls = new Set();
                for (const t of tracks) {
                    if (t.audioUrl && !seenUrls.has(t.audioUrl)) {
                        seenUrls.add(t.audioUrl);
                        uniqueTracks.push(t);
                    }
                }
                tracks = uniqueTracks;

                // === AUTO-SPLIT TRACKS KE DATABASE SAAT POLLING SELESAI ===
                if (isCompleted && tracks.length > 0) {
                    try {
                        const taskQuery = await db.collection("render_gallery").where("taskId", "==", taskId).get();
                        if (!taskQuery.empty) {
                            // Urutkan berdasarkan timestamp descending (karena di frontend Track 1 dibuat dengan timestamp lebih besar)
                            const existingDocs = taskQuery.docs.sort((a, b) => b.data().timestamp - a.data().timestamp);
                            
                            for (let j = 0; j < tracks.length; j++) {
                                if (j < existingDocs.length) {
                                    const docToUpdate = existingDocs[j];
                                    let baseTitle = docToUpdate.data().title || "Lagu Flixa AI";
                                    baseTitle = baseTitle.replace(/\s*-\s*(?:Track|Versi)\s*\d+/gi, '').trim();
                                    
                                    // Update dokumen processing yang sudah ada di frontend
                            if (docToUpdate.data().status !== "complete" || !docToUpdate.data().url) {
                                await docToUpdate.ref.update({
                                    status: "complete",
                                    url: tracks[j].audioUrl,
                                    imageUrl: tracks[j].imageUrl || docToUpdate.data().imageUrl || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg",
                                    title: `${baseTitle} - Versi ${j + 1}`,
                                    audioId: tracks[j].audioId || taskId // FIX: Simpan Audio ID asli agar tidak kosong (-)
                                });
                            }
                                }
                            }
                            // FIX RACE CONDITION: Hapus logika addDoc dan deleteDoc di sini.
                            // Kita hanya mengupdate dokumen yang sudah disiapkan oleh frontend.
                        }
                    } catch (dbErr) {
                        console.error("Gagal auto-split tracks ke database:", dbErr);
                    }
                }
                // ==========================================================
            }

            let finalStatus = isCompleted ? "completed" : (isFailed ? "failed" : "processing");
            let failReason = "Gagal diproses oleh provider.";

            if (isFailed) {
                failReason = actualErrorMessage || "Dibatalkan oleh server AI. Status tidak dikenali: " + extractedStatus;
                if (typeof failReason === 'string') {
                    const lowerReason = failReason.toLowerCase();
                    if (lowerReason.includes('copyright') || lowerReason.includes('lyrics contain') || lowerReason.includes('matches an existing') || lowerReason.includes('artist name') || lowerReason.includes('catalog')) {
                        // TAMPILKAN ALASAN HAK CIPTA ASLI DARI PROVIDER
                        failReason = `Sistem Moderasi / Filter AI: ${actualErrorMessage || failReason}`;
                    } else if (lowerReason.includes('too long') || (lowerReason.includes('duration') && lowerReason.includes('exceed'))) {
                        failReason = `Batas Waktu/Karakter Berlebih: ${actualErrorMessage || failReason}`;
                    } else if (lowerReason.includes('unsupported')) {
                        failReason = `Tipe/Format Tidak Sesuai: ${actualErrorMessage || failReason}`;
                    } else if (lowerReason.includes('insufficient') || lowerReason.includes('balance') || lowerReason.includes('credit') || lowerReason.includes('fund') || lowerReason.includes('quota')) {
                        // SEMBUNYIKAN SALDO HABIS (CUKUP DI LOG ADMIN, USER LIHAT INI:)
                        failReason = "Server AI sedang sibuk memproses antrean panjang atau sedang maintenance. Silakan gunakan provider lain.";
                    }
                }
                
                await db.collection("system_logs").add({ type: "error", host: activeProvider.value, request: "POLLING_FAILED", message: `Tugas ${taskId} dibatalkan oleh mesin AI.`, details: typeof failReason === 'string' ? failReason : JSON.stringify(failReason), rawError: JSON.stringify(resData, null, 2), timestamp: Date.now() });
                
                if (email) {
                    try {
                        const refundQuery = await db.collection("users").where("email", "==", email).get();
                        if (!refundQuery.empty) await refundQuery.docs[0].ref.update({ generateCount: FieldValue.increment(-1), kredit: FieldValue.increment(50) });
                    } catch (refundErr) { }
                }
            }

            return res.status(200).json({ status: finalStatus, audioUrl: finalStatus === "completed" ? audioUrlVal : null, tracks: tracks, reason: failReason, raw: resData });

        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }
    return res.status(405).json({ error: 'Method Not Allowed' });
};