import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { text, voiceId, provider, stability } = req.body;

    if (!text || !voiceId || !provider) {
        return res.status(400).json({ error: 'Text, Voice ID, dan Provider wajib diisi' });
    }

    try {
        const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY; 
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

        let audioBuffer;
        const provName = provider.toLowerCase();

        // ==========================================
        // 1. ROUTING LOGIC: ELEVENLABS
        // ==========================================
        if (provName.includes('eleven')) {
            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    model_id: "eleven_multilingual_v2",
                    voice_settings: {
                        stability: stability ? (stability / 100) : 0.5,
                        similarity_boost: 0.75
                    }
                })
            });

            if (!response.ok) throw new Error(`ElevenLabs Error: ${response.statusText}`);
            audioBuffer = await response.buffer();
        } 
        
        // ==========================================
        // 2. ROUTING LOGIC: OPENAI TTS
        // ==========================================
        else if (provName.includes('openai')) {
            const response = await fetch(`https://api.openai.com/v1/audio/speech`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "tts-1",
                    input: text,
                    voice: voiceId // contoh: "alloy", "echo", "fable"
                })
            });

            if (!response.ok) throw new Error(`OpenAI Error: ${response.statusText}`);
            audioBuffer = await response.buffer();
        } 

        // ==========================================
        // 3. ROUTING LOGIC: GOOGLE TTS (BASE64)
        // ==========================================
        else if (provName.includes('google')) {
            const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize`, {
                method: 'POST',
                headers: {
                    'X-Goog-Api-Key': GOOGLE_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    input: { text: text },
                    voice: { languageCode: "id-ID", name: voiceId },
                    audioConfig: { audioEncoding: "MP3" }
                })
            });

            if (!response.ok) throw new Error(`Google TTS Error: ${response.statusText}`);
            const data = await response.json();
            audioBuffer = Buffer.from(data.audioContent, 'base64');
        }

        // ==========================================
        // 4. ROUTING LOGIC: HUGGING FACE (XTTS-v2 PUBLIC)
        // ==========================================
        else if (provName.includes('huggingface') || provName.includes('hf') || provName.includes('lainnya') || voiceId.includes('hf.space')) {
            // Menembak langsung ke server publik
            const response = await fetch(voiceId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: [
                        text, // Teks dari klien
                        "id", // Bahasa Indonesia
                        null, // Mic audio
                        "https://www.w3schools.com/html/horse.mp3", // Audio Referensi (Sementara pakai dummy)
                        false // Agree TOS
                    ]
                })
            });

            if (!response.ok) throw new Error(`Hugging Face Error: ${response.statusText}`);
            const data = await response.json();
            
            // Mengambil URL file audio dari balasan server publik
            let audioFileUrl = data.data[0].name || data.data[0]; 
            
            // Memperbaiki format URL jika server membalas dengan path relatif
            if (!audioFileUrl.startsWith('http')) {
                const baseUrl = voiceId.replace('/api/predict', '');
                audioFileUrl = audioFileUrl.startsWith('/') ? baseUrl + audioFileUrl : baseUrl + '/file=' + audioFileUrl;
            }
            
            const audioRes = await fetch(audioFileUrl);
            audioBuffer = await audioRes.buffer();
        }
        
        else {
            return res.status(400).json({ error: 'Provider belum didukung oleh sistem backend.' });
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(audioBuffer);

    } catch (error) {
        console.error("TTS Error:", error);
        res.status(500).json({ error: error.message });
    }
}