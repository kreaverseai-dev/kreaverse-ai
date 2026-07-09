const admin = require('firebase-admin');

module.exports = async (req, res) => {
  // Hanya menerima metode POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metode tidak diizinkan' });
  }

  try {
    const { title, artist, lyrics } = req.body;
    if (!title || !artist || !lyrics) {
      return res.status(400).json({ error: 'Data lirik tidak lengkap' });
    }

    // Inisialisasi Firebase Admin SDK secara aman
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
      
      // Mengatasi bug umum Vercel di mana karakter newline '\n' sering terbaca salah
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    const db = admin.firestore();
    
    // Simpan ke koleksi bernama 'karaoke_lyrics' di Firestore
    const docRef = await db.collection('karaoke_lyrics').add({
      title,
      artist,
      lyrics,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Error saat menyimpan lirik:', error);
    return res.status(500).json({ error: error.message });
  }
};