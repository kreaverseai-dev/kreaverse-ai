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
            return res.status(200).json({ success: true, message: "No Hugging Face Spaces found in settings/downloader_api" });
        }

        const results = [];
        const updatedHfSpaces = [...hfSpaces];

        for (let i = 0; i < hfSpaces.length; i++) {
            const space = hfSpaces[i];
            const { spaceId, token } = space;

            if (!spaceId || !token) {
                results.push({ spaceId: spaceId || "unknown", status: "FAILED", error: "Missing spaceId or token" });
                continue;
            }

            try {
                const hfUrl = `https://huggingface.co/api/spaces/${spaceId}/restart`;
                const restartRes = await fetch(hfUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ factory: true })
                });

                if (restartRes.ok) {
                    const now = Date.now();
                    updatedHfSpaces[i].lastRebuild = now;
                    results.push({ spaceId, status: "SUCCESS" });
                } else {
                    const errText = await restartRes.text();
                    results.push({ spaceId, status: "FAILED", error: errText });
                }
            } catch (err) {
                results.push({ spaceId, status: "FAILED", error: err.message });
            }
        }

        // Tulis kembali struktur data terbaru yang telah diperbarui timestamp-nya ke Firestore
        await docRef.update({ hfSpaces: updatedHfSpaces });

        return res.status(200).json({ success: true, results });
    } catch (error) {
        console.error("Cron rebuild error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}