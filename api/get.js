const admin = require('firebase-admin');

module.exports = async (req, res) => {
  // Hanya menerima metode GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Metode tidak diizinkan' });
  }

  try {
    const query = req.query.query ? req.query.query.toLowerCase() : '';

    // Inisialisasi Firebase Admin SDK
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
      
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    const db = admin.firestore();
    
    // Ambil maksimal 100 lirik dari Firestore untuk dicocokkan
    const snapshot = await db.collection('karaoke_lyrics').limit(100).get();
    const songs = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      const titleMatch = data.title && data.title.toLowerCase().includes(query);
      const artistMatch = data.artist && data.artist.toLowerCase().includes(query);
      
      if (titleMatch || artistMatch) {
        songs.push({
          id: doc.id,
          title: data.title,
          artist: data.artist,
          lyrics: data.lyrics
        });
      }
    });

    return res.status(200).json({ songs });
  } catch (error) {
    console.error('Error saat mencari lirik:', error);
    return res.status(500).json({ error: error.message });
  }
};