export default async function handler(req, res) {
  // 1. Cek Method
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method not allowed' });
  }

  // 2. Ambil API Key
  const apiKey = process.env.CODEOTP_API_KEY;
  
  // Jika API Key kosong (karena belum redeploy), tampilkan error ini ke layar
  if (!apiKey) {
    return res.status(500).json({ status: false, message: 'API Key belum terbaca. Silakan Redeploy Vercel Anda!' });
  }

  const { endpoint, payload } = req.body;

  try {
    // 3. Siapkan data (Kita selipkan api_key di dalam body untuk jaga-jaga)
    const bodyData = payload || {};
    bodyData.api_key = apiKey; 

    // 4. Tembak API CodeOTP
    const response = await fetch(`https://www.codeotp.id/api${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}` // Kita kirim di Header juga
      },
      body: JSON.stringify(bodyData)
    });

    // 5. Ambil balasan dari CodeOTP dan kembalikan ke web Anda
    const data = await response.json();
    res.status(200).json(data);
    
  } catch (error) {
    // Jika website CodeOTP down atau URL salah
    res.status(500).json({ status: false, message: 'Gagal menghubungi CodeOTP: ' + error.message });
  }
}