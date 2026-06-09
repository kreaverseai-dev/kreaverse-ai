export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // 1. Ambil API Key Crun.ai dari Firebase
        const firebaseUrl = "https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/api_keys";
        const fbRes = await fetch(firebaseUrl);
        const fbData = await fbRes.json();
        
        let apiKey = null;
        if (fbData.documents) {
            const crunDocs = fbData.documents.filter(doc => 
                doc.fields && doc.fields.provider && 
                doc.fields.provider.stringValue.toLowerCase() === "crun ai" &&
                doc.fields.status && doc.fields.status.stringValue === "aktif"
            );
            
            crunDocs.sort((a, b) => {
                const pA = a.fields.priority ? parseInt(a.fields.priority.integerValue || a.fields.priority.stringValue) : 99;
                const pB = b.fields.priority ? parseInt(b.fields.priority.integerValue || b.fields.priority.stringValue) : 99;
                return pA - pB;
            });

            if (crunDocs.length > 0) {
                apiKey = crunDocs[0].fields.key.stringValue.trim();
            }
        }

        if (!apiKey) {
            return res.status(500).json({ error: "API Key Crun AI tidak ditemukan di Database Firebase." });
        }

        // 2. GET = CEK STATUS (GetTaskInfo)
        if (req.method === 'GET') {
            const { task_id } = req.query;
            const crunRes = await fetch(`https://api.crun.ai/api/v1/client/job/GetTaskInfo?task_id=${task_id}`, {
                method: 'GET',
                headers: { 'x-api-key': apiKey } // Sesuai dokumentasi: x-api-key
            });
            
            const responseText = await crunRes.text();
            try { 
                return res.status(crunRes.status).json(JSON.parse(responseText)); 
            } catch (e) { 
                return res.status(crunRes.status).json({ error: "Crun AI mengembalikan respon tidak valid (Bukan JSON).", details: responseText }); 
            }
        }

        // 3. POST = BUAT TUGAS BARU (CreateTask)
        if (req.method === 'POST') {
            const payload = req.body; // Struktur { model: "...", input: {...} }
            
            const crunRes = await fetch("https://api.crun.ai/api/v1/client/job/CreateTask", {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey, // Sesuai dokumentasi
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            // SAFE PARSING (Mencegah Vercel Crash 'Unexpected token <')
            const responseText = await crunRes.text();
            try { 
                return res.status(crunRes.status).json(JSON.parse(responseText)); 
            } catch (e) { 
                return res.status(crunRes.status).json({ error: `Gagal mengirim ke Crun AI (Error HTTP ${crunRes.status})`, details: responseText }); 
            }
        }

        return res.status(405).json({ error: "Method not allowed" });

    } catch (error) {
        console.error("Vercel Crun API Error:", error);
        return res.status(500).json({ error: "Vercel Internal Error: " + error.message });
    }
}