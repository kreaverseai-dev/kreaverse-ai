const admin = require("firebase-admin");

// ============================================================
// INISIALISASI FIREBASE ADMIN (Sama persis dengan Habi RMX)
// ============================================================
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

// Fungsi untuk mengambil API Key dari Database Admin
async function getActiveApiKey(providerName) {
    const keysQuery = await db.collection("api_keys")
        .where("provider", "==", providerName)
        .where("status", "==", "aktif")
        .get();

    if (keysQuery.empty) return null;

    // Urutkan berdasarkan prioritas (1 paling tinggi)
    const sortedKeysDocs = keysQuery.docs.sort((a, b) => (a.data().priority || 1) - (b.data().priority || 1));
    return { id: sortedKeysDocs[0].id, key: sortedKeysDocs[0].data().key };
}

module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }

    const { text, voiceId, provider, stability } = body;

    if (!text || !voiceId || !provider) {
        return res.status(400).json({ error: 'Text, Voice ID, dan Provider wajib diisi' });
    }

    try {
        let audioBuffer;
        const provName = provider.toLowerCase();
        let usedApiKeyDocId = null;

        // ==========================================
        // 1. ROUTING LOGIC: ELEVENLABS
        // ==========================================
        if (provName.includes('eleven')) {
            const apiKeyData = await getActiveApiKey("ElevenLabs");
            if (!apiKeyData) throw new Error("API Key ElevenLabs tidak ditemukan di Database Admin atau statusnya mati.");
            usedApiKeyDocId = apiKeyData.id;

            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                method: 'POST',
                headers: { 'Accept': 'audio/mpeg', 'xi-api-key': apiKeyData.key, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, model_id: "eleven_multilingual_v2", voice_settings: { stability: stability ? (stability / 100) : 0.5, similarity_boost: 0.75 } })
            });

            if (!response.ok) {
                const errText = await response.text();
                // Auto-Kill Key jika saldo habis
                if (errText.toLowerCase().includes('quota') || errText.toLowerCase().includes('insufficient')) {
                    await db.collection("api_keys").doc(usedApiKeyDocId).update({ status: "mati" });
                }
                throw new Error(`ElevenLabs Error: ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuffer);
        } 
        
        // ==========================================
        // 2. ROUTING LOGIC: OPENAI TTS
        // ==========================================
        else if (provName.includes('openai')) {
            const apiKeyData = await getActiveApiKey("OpenAI TTS");
            if (!apiKeyData) throw new Error("API Key OpenAI TTS tidak ditemukan di Database Admin.");
            usedApiKeyDocId = apiKeyData.id;

            const response = await fetch(`https://api.openai.com/v1/audio/speech`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKeyData.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: "tts-1", input: text, voice: voiceId })
            });

            if (!response.ok) {
                const errText = await response.text();
                if (errText.toLowerCase().includes('quota') || errText.toLowerCase().includes('insufficient')) {
                    await db.collection("api_keys").doc(usedApiKeyDocId).update({ status: "mati" });
                }
                throw new Error(`OpenAI Error: ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuffer);
        } 

        // ==========================================
        // 3. ROUTING LOGIC: GOOGLE TTS
        // ==========================================
        else if (provName.includes('google')) {
            const apiKeyData = await getActiveApiKey("Google TTS");
            if (!apiKeyData) throw new Error("API Key Google TTS tidak ditemukan di Database Admin.");

            const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize`, {
                method: 'POST',
                headers: { 'X-Goog-Api-Key': apiKeyData.key, 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: { text: text }, voice: { languageCode: "id-ID", name: voiceId }, audioConfig: { audioEncoding: "MP3" } })
            });

            if (!response.ok) throw new Error(`Google TTS Error: ${response.statusText}`);
            const data = await response.json();
            audioBuffer = Buffer.from(data.audioContent, 'base64');
        }

        // ==========================================
        // 4. ROUTING LOGIC: HUGGING FACE (GRATIS)
        // ==========================================
        else if (provName.includes('huggingface') || provName.includes('hf') || provName.includes('lainnya') || voiceId.includes('hf.space')) {
            const response = await fetch(voiceId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: [ text, "id", null, "https://www.w3schools.com/html/horse.mp3", false ]
                })
            });

            if (!response.ok) throw new Error(`Hugging Face Error: ${response.statusText}`);
            const data = await response.json();
            let audioFileUrl = data.data[0].name || data.data[0]; 
            if (!audioFileUrl.startsWith('http')) {
                const baseUrl = voiceId.replace('/api/predict', '');
                audioFileUrl = audioFileUrl.startsWith('/') ? baseUrl + audioFileUrl : baseUrl + '/file=' + audioFileUrl;
            }
            
            const audioRes = await fetch(audioFileUrl);
            const arrayBuffer = await audioRes.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuffer);
        }
        
        else {
            return res.status(400).json({ error: 'Provider belum didukung.' });
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(audioBuffer);

    } catch (error) {
        console.error("TTS Error:", error);
        res.status(500).json({ error: error.message });
    }
};