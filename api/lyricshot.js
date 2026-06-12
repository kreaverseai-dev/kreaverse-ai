// api/lyricshot.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lyrics, style } = req.body;

  if (!lyrics) {
    return res.status(400).json({ error: 'Lirik tidak boleh kosong' });
  }

  // Definisikan sistem prompt agar AI membalas dalam format JSON murni
  const systemPrompt = `Anda adalah sutradara video klip profesional. Tugas Anda adalah menganalisis lirik lagu yang diberikan dan membaginya menjadi beberapa adegan storyboard yang berurutan.
Tentukan jenis shot, deskripsi visual yang detail dengan gaya visual "${style}", serta berikan prompt gambar dan prompt video untuk AI generator.

Respon Anda WAJIB dalam format JSON murni yang valid tanpa tambahan markdown ataupun penjelasan di luar JSON. Format JSON harus seperti ini:
[
  {
    "scene": 1,
    "lyrics_segment": "Potongan lirik adegan ini",
    "shot_type": "Close-up / Wide Shot / Extreme Close-up / etc.",
    "visual_description": "Deskripsi adegan visual secara detail",
    "image_prompt": "Prompt detail untuk generate gambar (Stable Diffusion/Midjourney)",
    "video_prompt": "Prompt detail untuk generate video (Runway/Sora/Luma)"
  }
]`;

  try {
    // Ambil API key dari database internal Anda atau gunakan API Betabotz dari sistem Anda
    // Di bawah ini adalah contoh memanggil endpoint LLM menggunakan format umum Fetch API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` // Sesuaikan dengan manajemen key Anda
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // atau model lain yang responsif terhadap instruksi JSON
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Lirik Lagu:\n${lyrics}` }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" } // Memaksa format JSON jika menggunakan API OpenAI terbaru
      })
    });

    const data = await response.json();
    const resultText = data.choices[0].message.content;

    // Kirim kembali hasil JSON ke frontend
    return res.status(200).json(JSON.parse(resultText));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Gagal memproses lirik ke AI.' });
  }
}