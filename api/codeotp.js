// File: api/codeotp.js

export default async function handler(req, res) {
  // Pastikan hanya menerima method POST dari frontend Anda
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method not allowed' });
  }

  // Ambil API Key dari Environment Variables Vercel
  const apiKey = process.env.CODEOTP_API_KEY;
  
  // Ambil endpoint tujuan dan data dari frontend
  const { endpoint, payload } = req.body;

  try {
    // Asumsi Base URL API CodeOTP adalah https://www.codeotp.id/api
    // (Jika salah, Anda bisa menyesuaikan URL ini)
    const response = await fetch(`https://www.codeotp.id/api${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Biasanya API Key dikirim via Header Authorization atau x-api-key
        'Authorization': `Bearer ${apiKey}`, 
        'Accept': 'application/json'
      },
      // Jika ada payload (seperti server_id, price_id), kirimkan. Jika tidak, kirim kosong.
      body: payload ? JSON.stringify(payload) : undefined 
    });

    const data = await response.json();
    
    // Kembalikan respon dari CodeOTP ke frontend Anda
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ status: false, message: 'Gagal terhubung ke server OTP' });
  }
}