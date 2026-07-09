export default function handler(req, res) {
  // Ini adalah cara standar Vercel untuk mengirim respon
  res.status(200).json({ 
    message: "Koneksi Berhasil! API Anda Aktif." 
  });
}