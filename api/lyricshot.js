const admin = require("firebase-admin");

// Inisialisasi Firebase Admin SDK secara aman (Bypass JSON Parse Crash)
try {
    if (!admin.apps.length) {
        let rawKey = process.env.FIREBASE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "{}";
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
                throw new Error("Gagal mengekstrak kredensial dari FIREBASE_ACCOUNT");
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
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

function renderTemplate(templateStr, variables) {
    let result = templateStr || "";
    for (const key in variables) {
        const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        let safeValue = variables[key] || "";
        if (typeof safeValue === 'string') {
            safeValue = safeValue
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t');
        }
        result = result.replace(placeholder, safeValue);
    }
    return result;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ============================================================
    // ROUTE 1: GENERATE STORYBOARD & VIDEO (POST)
    // ============================================================
    if (req.method === 'POST') {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }
        if (!body) body = {};

        const { email, lyrics, providerId, providerNaskahId, modelNaskah, modelVideo, ratio, duration, timeOfDay, characterImage } = body;

        if (!email || !lyrics || !providerId || !providerNaskahId) {
            return res.status(400).json({ error: 'Parameter email, lirik, dan ID Provider wajib diisi!' });
        }

        try {
            // 1. Validasi User
            const usersRef = db.collection("users");
            const userQuery = await usersRef.where("email", "==", email).get();
            if (userQuery.empty) return res.status(403).json({ error: 'Akses ditolak: Klien tidak terdaftar!' });
            
            const userDoc = userQuery.docs[0];
            const userData = userDoc.data();

            if (userData.expiry && userData.expiry < Date.now() && userData.tier !== 'max_lifetime') {
                return res.status(403).json({ error: 'Masa aktif paket premium Anda telah kedaluwarsa!' });
            }

            // 2. Ambil Data Provider dari Admin Dashboard
            const providersDoc = await db.collection("settings").doc("api_providers").get();
            const allProviders = providersDoc.data().list || [];
            
            const llmProvider = allProviders.find(p => p.value === providerNaskahId);
            const videoProvider = allProviders.find(p => p.value === providerId);

            if (!llmProvider || !videoProvider) {
                return res.status(500).json({ error: 'Konfigurasi Provider AI tidak ditemukan di Dashboard Admin.' });
            }

            // 3. Ambil API Key LLM & Video
            const llmKeys = await db.collection("api_keys").where("provider", "==", llmProvider.value).where("status", "==", "aktif").get();
            const videoKeys = await db.collection("api_keys").where("provider", "==", videoProvider.value).where("status", "==", "aktif").get();

            if (llmKeys.empty || videoKeys.empty) {
                return res.status(502).json({ error: 'API Key untuk Naskah atau Video habis / tidak aktif.' });
            }

            const llmApiKey = llmKeys.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1))[0].data().key;
            const videoApiKey = videoKeys.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1))[0].data().key;

            // ==========================================
            // TAHAP A: PANGGIL LLM UNTUK MEMBUAT NASKAH (DENGAN AUTO-FALLBACK)
            // ==========================================
            const optimalClipsCount = body.optimalClipsCount || 5;
            const systemPrompt = `Kamu adalah Sutradara Video Klip Sinematik. Tugasmu memecah lirik lagu ini menjadi tepat ${optimalClipsCount} adegan (scenes). Output WAJIB berupa JSON Array murni tanpa markdown, contoh: [{"scene":1, "lyrics_segment":"lirik bait ini", "visual_description":"deskripsi prompt gambar/video yang sangat detail dalam bahasa inggris", "shot_type":"Close Up"}]. Suasana waktu: ${timeOfDay || 'Otomatis'}.`;

            let availableModels = [];
            if (llmProvider.models) {
                availableModels = llmProvider.models.split(',').map(m => m.trim()).filter(m => m);
            }
            let modelQueue = [modelNaskah || "default"];
            availableModels.forEach(m => {
                if (m !== modelNaskah) modelQueue.push(m);
            });

            let storyboard = null;
            let lastLlmError = "";

            for (const currentModel of modelQueue) {
                try {
                    const llmVariables = {
                        model: currentModel,
                        systemPrompt: systemPrompt,
                        prompt: `Lirik Lagu:\n${lyrics}`
                    };

                    const rawLlmPayload = llmProvider.payloadTemplate || `{"model": "{{model}}", "messages": [{"role": "system", "content": "{{systemPrompt}}"}, {"role": "user", "content": "{{prompt}}"}]}`;
                    const llmPayloadStr = renderTemplate(rawLlmPayload, llmVariables);
                    
                    let parsedLlmPayload;
                    try {
                        parsedLlmPayload = JSON.parse(llmPayloadStr);
                    } catch (jsonErr) {
                        throw new Error(`Format Payload JSON Naskah di Admin tidak valid. Detail: ${jsonErr.message}`);
                    }

                    const llmHeaders = { "Content-Type": "application/json" };
                    llmHeaders[llmProvider.headerName || "Authorization"] = (llmProvider.headerValue || "Bearer {apiKey}").replace("{apiKey}", llmApiKey);

                    const llmResponse = await fetch(`${llmProvider.baseUrl}${llmProvider.endpoint}`, {
                        method: 'POST', headers: llmHeaders, body: JSON.stringify(parsedLlmPayload)
                    });

                    if (!llmResponse.ok) {
                        const errText = await llmResponse.text();
                        throw new Error(`Error ${llmResponse.status}: ${errText}`);
                    }

                    const llmData = await llmResponse.json();
                    
                    let resultText = "";
                    if (llmData.choices && llmData.choices[0].message) resultText = llmData.choices[0].message.content;
                    else if (llmData.candidates && llmData.candidates[0].content) resultText = llmData.candidates[0].content.parts[0].text;
                    
                    resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
                    storyboard = JSON.parse(resultText);
                    break; 

                } catch (loopErr) {
                    lastLlmError = `Model [${currentModel}] gagal: ${loopErr.message}`;
                }
            }

            if (!storyboard) {
                throw new Error(`Semua model AI Naskah gagal memproses. Error Terakhir: ${lastLlmError}`);
            }

            // ==========================================
            // TAHAP B: PANGGIL VIDEO AI UNTUK TIAP ADEGAN
            // ==========================================
            let finalScenes = [];
            let totalCost = storyboard.length;

            if (userData.dailyQuota > 0 && (userData.generateCount + totalCost) > userData.dailyQuota) {
                return res.status(403).json({ error: `Kredit tidak cukup. Butuh ${totalCost} kredit, sisa ${userData.dailyQuota - userData.generateCount}.` });
            }

            for (let i = 0; i < storyboard.length; i++) {
                const scene = storyboard[i];
                
                let isImageToVideo = characterImage && videoProvider.endpointCover;
                let endpointPath = isImageToVideo ? videoProvider.endpointCover : videoProvider.endpoint;
                let rawPayloadTemplate = isImageToVideo ? videoProvider.payloadCoverTemplate : videoProvider.payloadTemplate;
                rawPayloadTemplate = rawPayloadTemplate || "{}";

                const videoVariables = {
                    model: modelVideo || "default",
                    prompt: scene.visual_description,
                    ratio: ratio || "16:9",
                    duration: duration || 5,
                    imageUrl: characterImage || ""
                };

                const videoPayloadStr = renderTemplate(rawPayloadTemplate, videoVariables);
                
                let parsedVideoPayload;
                try {
                    parsedVideoPayload = JSON.parse(videoPayloadStr);
                } catch (jsonErr) {
                    finalScenes.push({ ...scene, status: "failed", error: `Payload Video JSON tidak valid: ${jsonErr.message}` });
                    continue;
                }

                const videoHeaders = { "Content-Type": "application/json" };
                videoHeaders[videoProvider.headerName || "Authorization"] = (videoProvider.headerValue || "Bearer {apiKey}").replace("{apiKey}", videoApiKey);

                try {
                    const vidResponse = await fetch(`${videoProvider.baseUrl}${endpointPath}`, {
                        method: 'POST', headers: videoHeaders, body: JSON.stringify(parsedVideoPayload)
                    });

                    if (!vidResponse.ok) {
                        const errText = await vidResponse.text();
                        finalScenes.push({ ...scene, status: "failed", error: `API Video Error (${vidResponse.status}): ${errText}` });
                        continue;
                    }

                    const vidData = await vidResponse.json();
                    
                    // AUTO-DETEKSI CERDAS TASK ID (Bypass kesalahan ketik di Admin Dashboard)
                    let taskId = getValueByPath(vidData, videoProvider.responsePath || "id");
                    if (!taskId) {
                        taskId = vidData.id || vidData.task_id || vidData.job_id || (vidData.data && vidData.data.id);
                    }
                    
                    finalScenes.push({
                        ...scene,
                        task_id: taskId,
                        provider: videoProvider.value,
                        status: taskId ? "pending" : "failed",
                        error: taskId ? null : `Task ID tidak ditemukan dalam respons API: ${JSON.stringify(vidData)}`
                    });
                    
                } catch (vidErr) {
                    finalScenes.push({ ...scene, status: "failed", error: vidErr.message });
                }
            }

            // Potong Saldo Klien
            await userDoc.ref.update({ generateCount: FieldValue.increment(totalCost) });

            await db.collection("system_logs").add({
                type: "success", host: videoProvider.value, request: "GENERATE_STORYBOARD",
                message: `Klien ${userData.nama} membuat ${totalCost} klip video.`,
                timestamp: Date.now()
            });

            return res.status(200).json(finalScenes);

        } catch (globalErr) {
            return res.status(500).json({ error: globalErr.message });
        }
    }

    // ============================================================
    // ROUTE 2: ASYNCHRONOUS STATUS CHECK (GET) - UNTUK POLLING
    // ============================================================
    if (req.method === 'GET') {
        const { taskId, provider } = req.query;
        if (!taskId || !provider) return res.status(400).json({ error: 'taskId dan provider wajib dilampirkan!' });

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

            const headers = { "Content-Type": "application/json" };
            headers[activeProvider.headerName || "Authorization"] = (activeProvider.headerValue || "Bearer {apiKey}").replace("{apiKey}", apiKey);

            const response = await fetch(statusUrl, { method: 'GET', headers });
            const resData = await response.json();

            if (!response.ok) return res.status(response.status).json({ error: 'Gagal mendapatkan status.', details: resData });

            // AUTO-DETEKSI CERDAS STATUS DAN VIDEO URL
            let statusVal = getValueByPath(resData, activeProvider.statusResponsePath || "status");
            if (!statusVal && resData.status) statusVal = resData.status;

            let videoUrlVal = getValueByPath(resData, activeProvider.statusVideoUrlPath || "download_url");
            if (!videoUrlVal) {
                videoUrlVal = resData.video_url || resData.videoUrl || resData.url || (resData.data && resData.data.video_url);
            }

            const isCompleted = String(statusVal).toLowerCase() === String(activeProvider.statusCompletedValue || "complete").toLowerCase();
            const isFailed = String(statusVal).toLowerCase() === String(activeProvider.statusFailedValue || "failed").toLowerCase();

            let finalStatus = "processing";
            if (isCompleted) finalStatus = "complete";
            else if (isFailed) finalStatus = "failed";

            return res.status(200).json({ status: finalStatus, video_url: videoUrlVal || null, raw: resData });

        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
};