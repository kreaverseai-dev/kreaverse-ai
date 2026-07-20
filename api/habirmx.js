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
            if (!audioUrl) return res.status(400).json({ error: 'Audio URL wajib diisi untuk deteksi lirik.' });
            try {
                const whisperKeysQuery = await db.collection("api_keys").where("provider", "==", "Groq Whisper").where("status", "==", "aktif").get();
                if (whisperKeysQuery.empty) throw new Error("API Key untuk Groq Whisper tidak ditemukan atau mati.");
                const whisperKey = whisperKeysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1))[0].data().key;

                const audioFetch = await fetch(audioUrl);
                if (!audioFetch.ok) throw new Error("Gagal mengunduh audio referensi untuk ditranskripsi.");
                const audioBlob = await audioFetch.blob();

                const formData = new FormData();
                formData.append("file", audioBlob, "audio.mp3");
                formData.append("model", "whisper-large-v3-turbo");
                formData.append("temperature", "0.0");
                
                const pastedLyrics = lyrics || inputText || ""; 
                let promptHint = pastedLyrics.trim() !== "" ? pastedLyrics.substring(0, 500).replace(/\n/g, ', ') : (title ? `${title}, lirik lagu, musik.` : "Lirik lagu, musik.");

                formData.append("prompt", promptHint);
                formData.append("condition_on_previous_text", "false");

                const whisperRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                    method: "POST", headers: { "Authorization": `Bearer ${whisperKey}` }, body: formData
                });

                const whisperData = await whisperRes.json();
                if (!whisperRes.ok) throw new Error(whisperData.error?.message || "Gagal transkripsi audio via Whisper.");
                if (!whisperData.text) throw new Error("Suara tidak terdeteksi atau audio kosong.");

                let cleanText = whisperData.text;
                cleanText = cleanText.replace(/Terima kasih telah menonton!?/gi, "").replace(/Thanks for watching!?/gi, "").replace(/Terima kasih!?/gi, "").replace(/Subtitle by .+/gi, "").replace(/Subtitles by .+/gi, "");
                cleanText = cleanText.replace(/作词.*?(\n|$)/g, "").replace(/作曲.*?(\n|$)/g, "").replace(/编曲.*?(\n|$)/g, "");
                cleanText = cleanText.replace(/\n\s*\n/g, '\n').trim();

                if (!cleanText) cleanText = "[Musik Instrumental / Vokal tidak terdengar jelas oleh AI]";

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
                const whisperKeysQuery = await db.collection("api_keys").where("provider", "==", "Groq Whisper").where("status", "==", "aktif").get();
                if (whisperKeysQuery.empty) throw new Error("API Key untuk Groq Whisper tidak ditemukan atau mati.");
                const whisperKey = whisperKeysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1))[0].data().key;

                const audioFetch = await fetch(audioUrl);
                if (!audioFetch.ok) throw new Error("Gagal mengunduh audio referensi.");
                const audioBlob = await audioFetch.blob();

                const formData = new FormData();
                formData.append("file", audioBlob, "audio.mp3");
                formData.append("model", "whisper-large-v3-turbo");
                formData.append("temperature", "0.0");
                formData.append("response_format", "verbose_json");
                
                const promptHint = lyrics.substring(0, 400).replace(/\n/g, ', ');
                formData.append("prompt", "Ini adalah lagu panjang. Lanjutkan transkripsi sampai akhir musik. " + promptHint); 

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
        // ROUTE 1B: MAGIC WAND (AUTO-EDIT LIRIK & STYLE VIA LLM)
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
                    if (llmProvidersToTry.length === 0) return res.status(500).json({ error: 'Tidak ada provider LLM aktif.' });
                } else {
                    const specificProvider = allProviders.find(p => p.value === finalProviderId);
                    if (!specificProvider) return res.status(500).json({ error: 'Provider LLM tidak ditemukan.' });
                    llmProvidersToTry = [specificProvider];
                }

                let systemPrompt = "";
                if (llmType === 'style') {
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
1. ANALISIS INPUT: Jika user menempelkan LIRIK LAGU FULL (lagu terkenal), JANGAN salin liriknya (hindari Copyright). Tulis ulang lirik BARU dengan makna, cerita, pesan, dan emosi (vibe) yang SAMA PERSIS, tapi gunakan pilihan kata yang lebih indah, puitis, dan berpotensi viral. Jika user memberikan IDE/TEMA, buatkan lirik dari nol yang sangat menyentuh hati.
2. JANGAN PERNAH memasukkan nama genre (seperti "Lagu Dangdut") ke dalam teks lirik!
3. STRUKTUR WAJIB SUNO AI: Gunakan tag meta standar: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Guitar Solo] atau [Instrumental], [Outro].
4. Buat lirik layaknya manusia asli: puitis, rima bagus, dan emosional.
5. Jawab HANYA dengan lirik lagunya saja.`;
                    } else {
                        let whisperText = "";
                        if (audioUrl) {
                            try {
                                const wQuery = await db.collection("api_keys").where("provider", "==", "Groq Whisper").where("status", "==", "aktif").get();
                                if (!wQuery.empty) {
                                    const wKey = wQuery.docs[0].data().key;
                                    const aFetch = await fetch(audioUrl);
                                    const aBlob = await aFetch.blob();
                                    const fData = new FormData();
                                    fData.append("file", aBlob, "audio.mp3");
                                    fData.append("model", "whisper-large-v3-turbo");
                                    const wRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { "Authorization": `Bearer ${wKey}` }, body: fData });
                                    const wData = await wRes.json();
                                    if (wData.text) whisperText = wData.text;
                                }
                            } catch(e) { }
                        }
                        systemPrompt = `Kamu adalah Music Arranger Profesional. Tugasmu menyusun ulang lirik mentah dari user agar sesuai dengan lagu aslinya.
ATURAN MUTLAK:
1. User memberikan "Lirik Mentah" (ejaan benar tapi susunan salah).
2. Sistem memberikan "Transkripsi Audio" (susunan benar tapi ejaan mungkin halusinasi/salah).
3. TUGASMU: Susun ulang Lirik Mentah agar pengulangannya (A-B-A-B) persis mengikuti Transkripsi Audio!
4. Jika penyanyi mengulang bait 3x di Transkripsi, tulis bait itu 3x menggunakan ejaan Lirik Mentah.
5. Sisipkan tag [Intro], [Verse], [Chorus], [Instrumental] di tempat yang tepat.
6. Jawab HANYA dengan lirik yang sudah tersusun rapi.`;
                        finalInputText = `LIRIK MENTAH USER:\n${inputText}\n\nTRANSKRIPSI AUDIO (Acuan Pengulangan):\n${whisperText || "Gunakan instingmu untuk menata lirik ini"}`;
                    }
                }

                let resultText = "";
                let success = false;
                let lastError = "";

                for (const llmProvider of llmProvidersToTry) {
                    const keysQuery = await db.collection("api_keys").where("provider", "==", llmProvider.value).where("status", "==", "aktif").get();
                    const sortedKeysDocs = keysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1));
                    if (sortedKeysDocs.length === 0) { lastError = `API Key untuk ${llmProvider.label || llmProvider.value} habis.`; continue; }

                    let modelList = llmProvider.models ? llmProvider.models.split(',').map(m => m.trim()).filter(m => m).sort((a, b) => parseFloat(b.match(/\d+(\.\d+)?/)?.[0] || 0) - parseFloat(a.match(/\d+(\.\d+)?/)?.[0] || 0)) : ["default"];
                    let targetModels = (finalProviderId !== 'auto_pool' && modelId && modelList.includes(modelId)) ? [modelId] : modelList;

                    for (const keyDoc of sortedKeysDocs) {
                        const activeApiKey = keyDoc.data().key;
                        for (const currentModel of targetModels) {
                            try {
                                const variables = { model: currentModel, systemPrompt: systemPrompt, prompt: finalInputText };
                                let parsedBodyString = renderTemplate(llmProvider.payloadTemplate || `{"model": "{{model}}", "messages": [{"role": "system", "content": "{{systemPrompt}}"}, {"role": "user", "content": "{{prompt}}"}]}`, variables);
                                const finalPayload = JSON.parse(parsedBodyString);

                                const headers = { "Content-Type": "application/json" };
                                headers[llmProvider.headerName || "Authorization"] = (llmProvider.headerValue || "Bearer {apiKey}").replace("{apiKey}", activeApiKey);

                                const response = await fetch(`${llmProvider.baseUrl}${llmProvider.endpoint}`, { method: 'POST', headers: headers, body: JSON.stringify(finalPayload) });
                                const resData = await response.json();
                                
                                if (!response.ok || (resData.code && resData.code !== 200)) throw new Error(getValueByPath(resData, llmProvider.errorPath) || extractErrorString(resData) || "API Error");

                                if (resData.choices && resData.choices[0].message) resultText = resData.choices[0].message.content;
                                else if (resData.candidates && resData.candidates[0].content) resultText = resData.candidates[0].content.parts[0].text;
                                else resultText = JSON.stringify(resData);

                                success = true; break; 
                            } catch (e) {
                                lastError = e.message;
                                if (lastError.toLowerCase().includes('insufficient') || lastError.toLowerCase().includes('balance') || lastError.toLowerCase().includes('quota') || lastError.toLowerCase().includes('credit')) {
                                    try { await db.collection("api_keys").doc(keyDoc.id).update({ status: "mati" }); } catch(err){}
                                    break; 
                                }
                            }
                        }
                        if (success) break;
                    }
                    if (success) break;
                }
                if (!success) throw new Error(`Semua model LLM gagal merespons. Error terakhir: ${lastError}`);
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
            const audioProviders = allProviders.filter(p => !p.serviceType || String(p.serviceType).toLowerCase() === "audio" || String(p.serviceType).toLowerCase() === "music" || String(p.serviceType).toLowerCase() === "text-to-audio");

            if (audioProviders.length === 0) return res.status(500).json({ error: 'Belum ada provider Audio terdaftar.' });

            const targetProviderId = providerId || modelId;
            const isAutoPool = (targetProviderId === 'auto_pool');
            let providersToTry = isAutoPool ? audioProviders : [audioProviders.find(p => p.value === targetProviderId)].filter(Boolean);

            if (providersToTry.length === 0) return res.status(500).json({ error: 'Provider spesifik tidak ditemukan di database.' });

            let taskResponse = null;
            let successfulProvider = null;
            let lastErrorMessage = "Tidak ada respons dari server.";
            let keyFoundAndUsed = false;

            // CEK KEPEMILIKAN SUARA DI DATABASE (Berlaku hanya jika opsi Voice dipakai)
            let requiredKeyDocId = null;
            if (options && options.personaId) {
                try {
                    const personaDoc = await db.collection("persona_keys").doc(options.personaId).get();
                    if (personaDoc.exists) {
                        requiredKeyDocId = personaDoc.data().keyDocId;
                    }
                } catch(e) { console.error("Gagal cek persona:", e); }
            }

            for (let i = 0; i < providersToTry.length; i++) {
                let currentProvider = providersToTry[i];
                
                const keysQuery = await db.collection("api_keys").where("provider", "==", currentProvider.value).where("status", "==", "aktif").get();
                let sortedKeysDocs = keysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1));

                // FILTER KHUSUS VOICE: Paksa sistem hanya melirik API Key si pembuat suara
                if (requiredKeyDocId) {
                    const specificKeyDoc = sortedKeysDocs.find(k => k.id === requiredKeyDocId);
                    if (specificKeyDoc) {
                        sortedKeysDocs = [specificKeyDoc]; // Kunci sistem ke API Key ini saja
                    } else {
                        sortedKeysDocs = []; // Kosongkan agar loop key tidak berjalan
                        lastErrorMessage = "Server penyimpanan untuk Suara ini sedang penuh. Silakan kembali ke menu 'Kloning Voice' untuk me-refresh suara Anda ke server baru.";
                        if (isAutoPool) break; // Hentikan pencarian Auto-Fallback
                    }
                }

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
                        if (response.headers.get("content-type")?.includes("application/json")) resData = await response.json();
                        else throw new Error(`Provider mengembalikan respons non-JSON`);

                        if (!response.ok || (resData.code && resData.code !== 200)) {
                            throw new Error(getValueByPath(resData, currentProvider.errorPath) || extractErrorString(resData) || "API Error");
                        }

                        if (currentProvider.execMode === 'sync') {
                            let audioUrlVal = getValueByPath(resData, currentProvider.statusVideoUrlPath || "audioUrl") || findAudioUrlRecursively(resData);
                            if (!audioUrlVal) throw new Error("URL Audio tidak ditemukan pada respons Synchronous API.");

                            let tracks = [];
                            let extractedArray = getValueByPath(resData, currentProvider.statusVideoUrlPath?.split('.').slice(0, -1).join('.'));
                            if (Array.isArray(extractedArray)) {
                                tracks = extractedArray.map(item => ({ audioUrl: item.audio_url || item.audioUrl || item.url || audioUrlVal, imageUrl: item.image_url || item.imageUrl || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" })).filter(t => t.audioUrl);
                            } else {
                                tracks.push({ audioUrl: audioUrlVal, imageUrl: "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" });
                            }

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
                        if (lowerErr.includes('insufficient') || lowerErr.includes('balance') || lowerErr.includes('credit') || lowerErr.includes('quota') || lowerErr.includes('fund') || lowerErr.includes('limit')) {
                            try {
                                await db.collection("api_keys").doc(keyDoc.id).update({ status: "mati" });
                                await db.collection("system_logs").add({
                                    type: "warning", host: currentProvider.value, request: "AUTO_KILL_KEY",
                                    message: `API Key otomatis dimatikan karena saldo habis. Pesan: ${lastErrorMessage}`, timestamp: Date.now()
                                });
                            } catch(e) {}
                            
                            // CUSTOM ERROR JIKA KEY MATI (Tutup info dari user publik)
                            if (requiredKeyDocId) {
                                lastErrorMessage = "Server penyimpanan untuk Suara ini baru saja penuh (Auto-Kill). Silakan buat / kloning ulang suara Anda di menu 'Kloning Voice' agar dipindah ke server baru.";
                            } else {
                                lastErrorMessage = "Antrean server sedang penuh. Mengalihkan ke jalur AI lain..."; // Rahasiakan alasan saldo habis
                            }
                        } else {
                            await db.collection("system_logs").add({
                                type: "error", host: currentProvider.value, request: isAutoPool ? "GENERATE_MUSIC_FAILOVER" : "GENERATE_MUSIC_STRICT",
                                message: `Koneksi atau pemrosesan gagal: ${apiErr.message}`, timestamp: Date.now()
                            });
                        }
                    }
                }
                if (keyFoundAndUsed) break; 
            }

            if (!taskResponse) {
                if (isAutoPool) {
                    return res.status(502).json({ error: 'Seluruh server AI sedang sibuk memproses antrean. Silakan coba lagi beberapa saat.' });
                } else {
                    let finalOutputError = lastErrorMessage;
                    // Jaga-jaga agar error "Saldo Habis" tidak bocor ke user saat mode strict provider
                    if (finalOutputError.toLowerCase().includes('insufficient') || finalOutputError.toLowerCase().includes('balance') || finalOutputError.toLowerCase().includes('quota')) {
                        finalOutputError = "Server sedang penuh atau antrean terlalu panjang. Silakan coba beberapa saat lagi.";
                    }
                    return res.status(502).json({ error: `Server yang Anda pilih gagal merespons: ${finalOutputError}` });
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
                throw new Error(`Provider status mengembalikan respons non-JSON`);
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

            let isCompleted = completedValues.includes(extractedStatus) || extractedStatus.includes("success") || extractedStatus.includes("complete") || extractedStatus.includes("done");
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
                        tracks = extractedArray.map(item => ({ audioId: item.id || item.audio_id || item.audioId || "", audioUrl: item[arrayMatch[2]] || item.audio_url || item.audioUrl || item.url || item.download_url || "", imageUrl: item.image_url || item.imageUrl || item.cover_url || "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" })).filter(t => t.audioUrl && typeof t.audioUrl === 'string' && t.audioUrl.startsWith('http'));
                        if (tracks.length > 0) audioUrlVal = tracks[0].audioUrl;
                    }
                } else if (typeof extractedMedia === 'string' && extractedMedia.startsWith('http')) {
                    audioUrlVal = extractedMedia;
                    tracks.push({ audioId: resData.id || resData.audio_id || resData.audioId || taskId, audioUrl: audioUrlVal, imageUrl: "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" });
                }

                if (!audioUrlVal) {
                    audioUrlVal = findAudioUrlRecursively(resData);
                    if (audioUrlVal) tracks.push({ audioId: resData.id || resData.audio_id || resData.audioId || taskId, audioUrl: audioUrlVal, imageUrl: "https://i.postimg.cc/Jh211FTG/46cc61ec-de7f-4c62-8245-946e22312d2b.jpg" });
                }
                if (!audioUrlVal) { isCompleted = false; isProcessing = true; }
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