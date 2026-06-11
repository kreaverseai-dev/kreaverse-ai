import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();

export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const docRef = db.collection('settings').doc('downloader_api');
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return res.status(404).json({ success: false, error: "settings/downloader_api document not found" });
        }

        const data = docSnap.data();
        const hfSpaces = data.hfSpaces || [];

        if (hfSpaces.length === 0) {
            return res.status(200).json({ success: true, message: "No Hugging Face Spaces found" });
        }

        const results = [];
        for (const space of hfSpaces) {
            const url = space.url;
            if (url) {
                try {
                    const pingRes = await fetch(url, { method: 'GET' });
                    results.push({ spaceId: space.spaceId, url, status: pingRes.status });
                } catch (err) {
                    results.push({ spaceId: space.spaceId, url, status: "FAILED", error: err.message });
                }
            }
        }

        return res.status(200).json({ success: true, results });
    } catch (error) {
        console.error("Keep-alive error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}