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
        // CATATAN: Di versi produksi, Anda harus mengambil API Key dari Firebase.
        // Untuk contoh ini, kita asumsikan Anda menyimpannya di Environment Variables Vercel.
        const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY; 
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

        let audioBuffer;

        // ==========================================
        // ROUTING LOGIC: JIKA PROVIDER ELEVENLABS
        // ==========================================
        if (provider.toLowerCase().includes('eleven')) {
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
                        stability: stability / 100, // Konversi 0-100 ke 0.0-1.0
                        similarity_boost: 0.75
                    }
                })
            });

            if (!response.ok) throw new Error(`ElevenLabs Error: ${response.statusText}`);
            audioBuffer = await response.buffer();
        } 
        
        // ==========================================
        // ROUTING LOGIC: JIKA PROVIDER OPENAI
        // ==========================================
        else if (provider.toLowerCase().includes('openai')) {
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
        
        else {
            return res.status(400).json({ error: 'Provider tidak didukung' });
        }

        // Mengembalikan file audio langsung ke Frontend
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(audioBuffer);

    } catch (error) {
        console.error("TTS Error:", error);
        res.status(500).json({ error: error.message });
    }
}