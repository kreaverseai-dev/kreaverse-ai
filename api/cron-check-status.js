const admin = require("firebase-admin");

try {
    if (!admin.apps.length) {
        let rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_ACCOUNT || "{}";
        let serviceAccount;
        try {
            serviceAccount = JSON.parse(rawKey);
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }
        } catch (e) {
            const emailMatch = rawKey.match(/"client_email"\s*:\s*"([^"]+)"/);
            const projectMatch = rawKey.match(/"project_id"\s*:\s*"([^"]+)"/);
            const keyMatch = rawKey.match(/-----BEGIN PRIVATE KEY-----(.*?)-----END PRIVATE KEY-----/s);
            if (emailMatch && projectMatch && keyMatch) {
                const cleanKeyBody = keyMatch[1].replace(/\s+/g, '\n').trim();
                serviceAccount = { client_email: emailMatch[1], project_id: projectMatch[1], private_key: `-----BEGIN PRIVATE KEY-----\n${cleanKeyBody}\n-----END PRIVATE KEY-----\n` };
            }
        }
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
} catch (err) {
    console.error("Gagal Inisialisasi Firebase:", err.message);
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
    try {
        const cronSecret = req.query.secret || req.headers.authorization;
        const validSecret = process.env.CRON_SECRET || "h4b1StUdlO_CrOn_SeCrEt_Key_2026";

        if (cronSecret !== validSecret) return res.status(401).json({ error: "Akses ditolak." });

        const processingSnapshot = await db.collection("render_gallery").where("status", "in", ["processing", "pending"]).limit(8).get();

        if (processingSnapshot.empty) return res.status(200).json({ message: "Tidak ada antrean." });

        const host = req.headers.host || process.env.VERCEL_URL || "kreaverse-ai.biz.id";
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const baseUrl = `${protocol}://${host}`;

        let processedCount = 0;
        let logs = [];

        const promises = processingSnapshot.docs.map(async (docSnap) => {
            const docId = docSnap.id;
            const item = docSnap.data();
            
            try {
                let apiUrl = "";
                if (item.tool === "LyricShot AI" && item.task_id) {
                    apiUrl = `${baseUrl}/api/lyricshot?taskId=${encodeURIComponent(item.task_id)}&provider=${encodeURIComponent(item.provider)}`;
                } else if (item.tool === "Habi RMX" && item.taskId) {
                    apiUrl = `${baseUrl}/api/habirmx?taskId=${encodeURIComponent(item.taskId)}&provider=${encodeURIComponent(item.provider)}`;
                } else {
                    await db.collection("render_gallery").doc(docId).update({ status: "failed", error: "Data tugas tidak valid." });
                    return { id: docId, status: "failed" };
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 7000);
                
                let checkRes;
                try {
                    checkRes = await fetch(apiUrl, { signal: controller.signal });
                } catch (fetchErr) {
                    if (fetchErr.name === 'AbortError') return { id: docId, status: "timeout_skip" };
                    throw fetchErr;
                } finally {
                    clearTimeout(timeoutId);
                }

                const text = await checkRes.text();
                let data = {};
                try { data = JSON.parse(text); } catch(e) { data = { error: "Respons API rusak." }; }

                if (checkRes.ok && (data.status === "completed" || data.status === "complete")) {
                    // FITUR MENGAMBIL 2 LAGU SEKALIGUS & TITIK MERAH (isNew)
                    const tracks = data.tracks || [];
                    if (tracks.length > 0) {
                        const updatePayload = { 
                            status: "complete", 
                            url: tracks[0].audioUrl,
                            isNew: true // Titik merah
                        };
                        if (tracks[0].imageUrl) updatePayload.imageUrl = tracks[0].imageUrl;
                        if (tracks.length > 1) updatePayload.title = `${item.title} (Part 1)`;
                        
                        await db.collection("render_gallery").doc(docId).update(updatePayload);

                        // Buat lagu kedua jika ada
                        for (let i = 1; i < tracks.length; i++) {
                            const newDoc = {
                                ...item,
                                status: "complete",
                                url: tracks[i].audioUrl,
                                title: `${item.title} (Part ${i+1})`,
                                isNew: true, // Titik merah
                                timestamp: Date.now() + i
                            };
                            if (tracks[i].imageUrl) newDoc.imageUrl = tracks[i].imageUrl;
                            delete newDoc.id; 
                            await db.collection("render_gallery").add(newDoc);
                        }
                        processedCount++;
                    } else if (data.audioUrl || data.video_url) {
                        await db.collection("render_gallery").doc(docId).update({ status: "complete", url: data.audioUrl || data.video_url, isNew: true });
                        processedCount++;
                    }
                }
                else if (data.status === "failed" || !checkRes.ok) {
                    const errorMsg = data.reason || data.error || data.message || "Dibatalkan oleh server AI";
                    await db.collection("render_gallery").doc(docId).update({ status: "failed", error: errorMsg });
                    processedCount++;
                }
                else {
                    const itemTime = item.timestamp || Date.now();
                    if ((Date.now() - itemTime) > 3600000) {
                        await db.collection("render_gallery").doc(docId).update({ status: "failed", error: "Timeout: KIE AI tidak merespons selama 1 jam." });
                        processedCount++;
                    }
                }
                return { id: docId, status: "checked" };

            } catch (err) {
                logs.push({ id: docId, error: err.message });
                return { id: docId, status: "error" };
            }
        });

        await Promise.all(promises);
        return res.status(200).json({ message: "Selesai", diupdate: processedCount, errors: logs });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}