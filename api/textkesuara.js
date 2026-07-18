import fetch from 'node-fetch';

// FUNGSI PINTAR: Mengambil API Key langsung dari Database Firebase Anda!
async function getApiKeyFromFirebase(providerName) {
    const projectId = "kreaverse-ai0107";
    const apiKey = "AIzaSyAO8JV4jkJmbHChYvjUCS7wqfVbKr94tHM";
    // Menggunakan Firestore REST API agar tidak perlu install library tambahan
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
    
    const query = {
        structuredQuery: {
            from: [{ collectionId: "api_keys" }],
            where: {
                compositeFilter: {
                    op: "AND",
                    filters: [
                        { fieldFilter: { field: { fieldPath: "provider" }, op: "EQUAL", value: { stringValue: providerName } } },
                        { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "aktif" } } }
                    ]
                }
            },
            orderBy: [{ field: { fieldPath: "priority" }, direction: "ASCENDING" }],
            limit: 1
        }
    };

    try {
        const res = await fetch(url, { method: 'POST', body: JSON.stringify(query) });
        const data = await res.json();
        if (data && data[0] && data[0].document) {
            return data[0].document.fields.key.stringValue; // Mengembalikan API Key yang aktif
        }
    } catch (e) {
        console.error("Gagal mengambil API Key dari DB:", e);
    }
    return null;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { text, voiceId, provider, stability } = req.body;
    if (!text || !voiceId || !provider) return res.status(400).json({ error: 'Data tidak lengkap' });

    try {
        let audioBuffer;
        const provName = provider.toLowerCase();

        // ==========================================
        // 1. ROUTING LOGIC: ELEVENLABS
        // ==========================================
        if (provName.includes('eleven')) {
            // AMBIL API KEY DARI DASHBOARD ADMIN!
            const ELEVENLABS_API_KEY = await getApiKeyFromFirebase("ElevenLabs");
            if (!ELEVENLABS_API_KEY) throw new Error("API Key ElevenLabs tidak ditemukan di Database Admin atau statusnya mati.");

            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                method: 'POST',
                headers: { 'Accept': 'audio/mpeg', 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, model_id: "eleven_multilingual_v2", voice_settings: { stability: stability ? (stability / 100) : 0.5, similarity_boost: 0.75 } })
            });
            if (!response.ok) throw new Error(`ElevenLabs Error: ${response.statusText}`);
            audioBuffer = await response.buffer();
        } 
        
        // ==========================================
        // 2. ROUTING LOGIC: OPENAI TTS
        // ==========================================
        else if (provName.includes('openai')) {
            // AMBIL API KEY DARI DASHBOARD ADMIN!
            const OPENAI_API_KEY = await getApiKeyFromFirebase("OpenAI TTS");
            if (!OPENAI_API_KEY) throw new Error("API Key OpenAI tidak ditemukan di Database Admin.");

            const response = await fetch(`https://api.openai.com/v1/audio/speech`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: "tts-1", input: text, voice: voiceId })
            });
            if (!response.ok) throw new Error(`OpenAI Error: ${response.statusText}`);
            audioBuffer = await response.buffer();
        } 

        // ==========================================
        // 3. ROUTING LOGIC: GOOGLE TTS
        // ==========================================
        else if (provName.includes('google')) {
            // AMBIL API KEY DARI DASHBOARD ADMIN!
            const GOOGLE_API_KEY = await getApiKeyFromFirebase("Google TTS");
            if (!GOOGLE_API_KEY) throw new Error("API Key Google TTS tidak ditemukan di Database Admin.");

            const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize`, {
                method: 'POST',
                headers: { 'X-Goog-Api-Key': GOOGLE_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: { text: text }, voice: { languageCode: "id-ID", name: voiceId }, audioConfig: { audioEncoding: "MP3" } })
            });
            if (!response.ok) throw new Error(`Google TTS Error: ${response.statusText}`);
            const data = await response.json();
            audioBuffer = Buffer.from(data.audioContent, 'base64');
        }

        // ==========================================
        // 4. ROUTING LOGIC: HUGGING FACE (GRATIS, TANPA API KEY)
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
            audioBuffer = await audioRes.buffer();
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
}