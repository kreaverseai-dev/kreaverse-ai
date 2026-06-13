export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const firebaseUrl = "https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/api_keys";
        const fbRes = await fetch(firebaseUrl);
        const fbData = await fbRes.json();
        
        const providers = [];
        if (fbData.documents) {
            // Saring hanya kunci API yang berstatus aktif
            const activeDocs = fbData.documents.filter(doc => 
                doc.fields && doc.fields.status && doc.fields.status.stringValue.toLowerCase() === "aktif"
            );
            
            // Urutkan berdasarkan prioritas terkecil (tertinggi)
            activeDocs.sort((a, b) => {
                const pA = a.fields.priority ? parseInt(a.fields.priority.integerValue || a.fields.priority.stringValue) : 99;
                const pB = b.fields.priority ? parseInt(b.fields.priority.integerValue || b.fields.priority.stringValue) : 99;
                return pA - pB;
            });

            activeDocs.forEach(doc => {
                const name = doc.fields.provider.stringValue;
                const rawModels = doc.fields.id_model?.stringValue || doc.fields.model?.stringValue || "";
                
                // Pisahkan model berdasarkan tanda koma
                let models = rawModels ? rawModels.split(',').map(m => m.trim()) : [];
                
                // Tambahkan model default jika di database kosong
                const nameLower = name.toLowerCase();
                if (models.length === 0) {
                    if (nameLower.includes("openai")) models = ["gpt-4o-mini"];
                    else if (nameLower.includes("gemini") || nameLower.includes("google")) models = ["gemini-2.5-flash"];
                    else if (nameLower.includes("betabotz")) models = ["openai-custom"];
                    else if (nameLower.includes("openrouter")) models = ["google/gemini-2.5-flash"];
                    else models = ["default"];
                }

                providers.push({
                    id: doc.name.split('/').pop(), // ID dokumen Firebase
                    name: name,
                    models: models
                });
            });
        }

        return res.status(200).json(providers);

    } catch (error) {
        console.error("Fetch Providers Error:", error);
        return res.status(500).json({ error: "Gagal memuat konfigurasi API." });
    }
}