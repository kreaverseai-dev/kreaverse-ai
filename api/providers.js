export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const firebaseUrl = "https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/api_keys";
        const fbRes = await fetch(firebaseUrl);
        const fbData = await fbRes.json();
        
        const providers = [];
        if (fbData.documents) {
            // Saring hanya kunci API yang berstatus aktif dengan aman
            const activeDocs = fbData.documents.filter(doc => 
                doc.fields?.status?.stringValue?.toLowerCase() === "aktif"
            );
            
            // Urutkan berdasarkan prioritas terkecil (tertinggi)
            activeDocs.sort((a, b) => {
                const pA = a.fields?.priority ? parseInt(a.fields.priority.integerValue || a.fields.priority.stringValue || 99) : 99;
                const pB = b.fields?.priority ? parseInt(b.fields.priority.integerValue || b.fields.priority.stringValue || 99) : 99;
                return pA - pB;
            });

            const uniqueProviders = {};
            activeDocs.forEach(doc => {
                const name = doc.fields?.provider?.stringValue || "Unknown";
                let standardName = name;
                const nameLower = name.toLowerCase();
                
                if (nameLower.includes("gemini") || nameLower.includes("google")) {
                    standardName = "Google Gemini";
                } else if (nameLower.includes("openrouter")) {
                    standardName = "OpenRouter";
                } else if (nameLower.includes("magic")) {
                    standardName = "Magic Hour";
                } else if (nameLower.includes("leonardo")) {
                    standardName = "Leonardo AI";
                }

                const rawModels = doc.fields?.id_model?.stringValue || doc.fields?.model?.stringValue || "";
                let models = rawModels ? rawModels.split(',').map(m => m.trim()) : [];
                
                if (models.length === 0) {
                    if (standardName === "Google Gemini") models = ["gemini-2.5-flash"];
                    else if (standardName === "OpenRouter") models = ["google/gemini-2.5-flash"];
                    else models = ["default"];
                }

                const providerId = standardName.toLowerCase().replace(/\s+/g, "");
                if (!uniqueProviders[providerId]) {
                    uniqueProviders[providerId] = {
                        id: providerId,
                        name: standardName,
                        models: new Set()
                    };
                }
                models.forEach(m => uniqueProviders[providerId].models.add(m));
            });

            providers.push(...Object.values(uniqueProviders).map(p => ({
                id: p.id,
                name: p.name,
                models: Array.from(p.models)
            })));
        }

        return res.status(200).json(providers);

    } catch (error) {
        console.error("Fetch Providers Error:", error);
        return res.status(500).json({ error: "Gagal memuat konfigurasi API." });
    }
}