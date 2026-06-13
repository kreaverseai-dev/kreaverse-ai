// api/check-status.js

export default async function handler(req, res) {
    // Izinkan koneksi langsung dari Dasbor Kreaverse
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // INTERSEPSI: Pengecekan status render video LyricShot AI (Magic Hour & Leonardo)
    const { taskId, provider } = req.query;
    if (taskId && provider) {
        try {
            const firebaseUrl = "https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/api_keys";
            const fbRes = await fetch(firebaseUrl);
            const fbData = await fbRes.json();
            
            let apiKey = null;
            if (fbData.documents) {
                const activeDocs = fbData.documents.filter(doc => doc.fields?.status?.stringValue?.toLowerCase() === "aktif");
                const matchedDoc = activeDocs.find(doc => doc.fields?.provider?.stringValue?.toLowerCase().includes(provider.toLowerCase()));
                if (matchedDoc) {
                    apiKey = matchedDoc.fields.key.stringValue.trim();
                }
            }

            if (!apiKey) {
                return res.status(500).json({ error: "API Key untuk pemantauan tidak ditemukan." });
            }

            let videoUrl = "";
            let status = "processing";

            if (provider.toLowerCase().includes("magic")) {
                const statusRes = await fetch(`https://api.magichour.ai/v1/video-generation/${taskId}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                if (statusRes.ok) {
                    const data = await statusRes.json();
                    if (data.status === "complete" && data.download_url) {
                        status = "complete";
                        videoUrl = data.download_url;
                    } else if (data.status === "failed") {
                        status = "failed";
                    }
                }
            } else if (provider.toLowerCase().includes("leonardo")) {
                const statusRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${taskId}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                if (statusRes.ok) {
                    const data = await statusRes.json();
                    const gen = data.generations_by_pk;
                    if (gen) {
                        if (gen.status === "COMPLETE" && gen.generated_images?.[0]?.url) {
                            status = "complete";
                            videoUrl = gen.generated_images[0].url;
                        } else if (gen.status === "FAILED") {
                            status = "failed";
                        }
                    }
                }
            }

            return res.status(200).json({ status, videoUrl });
        } catch (error) {
            console.error("Status Checker Error:", error);
            return res.status(500).json({ error: "Internal Server Error" });
        }
    }

    // MENGAMBIL KUNCI ASLI DARI DATABASE (Via POST Body)
    const keys = req.body || {};
    let providers = [];

    // 1. Pengecekan APIFrame (ASLI)
    try {
        if (keys.apiframe) {
            const apiFrameRes = await fetch('https://api.apiframe.ai/v2/me', { headers: { 'X-API-Key': keys.apiframe } });
            if (apiFrameRes.ok) {
                const data = await apiFrameRes.json();
                providers.push({ name: "APIFrame", status: "ONLINE", balance: `${data.balance} Credits` });
            } else {
                providers.push({ name: "APIFrame", status: "ERROR", balance: "Key Invalid / Limit Habis" });
            }
        } else {
            providers.push({ name: "APIFrame", status: "OFFLINE", balance: "API Key Belum Ditambahkan" });
        }
    } catch (e) { providers.push({ name: "APIFrame", status: "ERROR", balance: "Server Provider Down" }); }

    // 2. Pengecekan Hugging Face (ASLI)
    try {
        if (keys.hugging) {
            const hfRes = await fetch('https://huggingface.co/api/whoami-v2', { headers: { 'Authorization': `Bearer ${keys.hugging}` } });
            if(hfRes.ok) providers.push({ name: "Hugging Face", status: "ONLINE", balance: "Token Valid & Aktif" });
            else providers.push({ name: "Hugging Face", status: "ERROR", balance: "Token Invalid" });
        } else { providers.push({ name: "Hugging Face", status: "OFFLINE", balance: "Token Belum Ditambahkan" }); }
    } catch (e) { providers.push({ name: "Hugging Face", status: "ERROR", balance: "Server Provider Down" }); }

    // 3. Pengecekan Crun AI (ASLI)
    try {
        if (keys.crun) {
            const crunRes = await fetch('https://api.crun.ai/v1/users/me', { headers: { 'Authorization': `Bearer ${keys.crun}` } });
            if(crunRes.ok) providers.push({ name: "Crun AI", status: "ONLINE", balance: "Key Valid & Aktif" });
            else providers.push({ name: "Crun AI", status: "ERROR", balance: "Key Invalid" });
        } else { providers.push({ name: "Crun AI", status: "OFFLINE", balance: "API Key Belum Ditambahkan" }); }
    } catch (e) { providers.push({ name: "Crun AI", status: "ERROR", balance: "Server Provider Down" }); }

    // 4. Pengecekan MusicAPI (ASLI)
    try {
        if (keys.music) {
            const musicRes = await fetch('https://api.musicapi.ai/api/v1/me', { headers: { 'Authorization': `Bearer ${keys.music}` } });
            if(musicRes.ok) providers.push({ name: "MusicAPI", status: "ONLINE", balance: "Key Valid & Aktif" });
            else providers.push({ name: "MusicAPI", status: "ERROR", balance: "Key Invalid" });
        } else { providers.push({ name: "MusicAPI", status: "OFFLINE", balance: "API Key Belum Ditambahkan" }); }
    } catch (e) { providers.push({ name: "MusicAPI", status: "ERROR", balance: "Server Provider Down" }); }

    const onlineCount = providers.filter(p => p.status === "ONLINE").length;
    res.status(200).json({
        system_status: onlineCount > 0 ? "AKTIF" : "OFFLINE",
        online_providers: onlineCount, 
        offline_providers: providers.length - onlineCount,
        details: providers
    });
}