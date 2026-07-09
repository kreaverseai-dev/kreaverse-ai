export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // Load active keys to see which providers are active
        const firebaseUrl = "https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/api_keys?pageSize=300";
        const fbRes = await fetch(firebaseUrl, {
            headers: { 'Cache-Control': 'no-cache' }
        });
        
        const activeProviderIds = new Set();
        if (fbRes.ok) {
            const fbData = await fbRes.json();
            if (fbData.documents) {
                fbData.documents.forEach(doc => {
                    const statusVal = (doc.fields?.status?.stringValue || "").trim().toLowerCase();
                    if (statusVal === "aktif" || statusVal === "active") {
                        const name = (doc.fields?.provider?.stringValue || "").trim().toLowerCase().replace(/[\s\-_]+/g, "");
                        activeProviderIds.add(name);
                    }
                });
            }
        }

        // Load configured providers from settings/api_providers
        const provSettingsUrl = "https://firestore.googleapis.com/v1/projects/kreaverse-ai0107/databases/(default)/documents/settings/api_providers";
        const provRes = await fetch(provSettingsUrl);
        let configuredProviders = [];
        
        if (provRes.ok) {
            const provData = await provRes.json();
            if (provData.fields?.list?.arrayValue?.values) {
                configuredProviders = provData.fields.list.arrayValue.values.map(val => {
                    const mapVal = val.mapValue?.fields || {};
                    return {
                        id: (mapVal.value?.stringValue || "").toLowerCase().replace(/[\s\-_]+/g, ""),
                        name: mapVal.label?.stringValue || mapVal.name?.stringValue || "",
                        serviceType: mapVal.serviceType?.stringValue || "LLM",
                        models: mapVal.models?.stringValue ? mapVal.models.stringValue.split(',').map(m => m.trim()) : []
                    };
                });
            }
        }

        // Saring provider yang terdaftar dan memiliki API Key aktif
        let providers = configuredProviders.filter(p => activeProviderIds.has(p.id));

        // Jika tidak ada penyaringan aktif, tampilkan seluruh yang terkonfigurasi secara manual di dashboard admin Anda
        if (providers.length === 0) {
            providers = configuredProviders;
        }

        // BEBAS HARDCODE FALLBACK: Mengembalikan murni sesuai daftar di database admin Anda!
        return res.status(200).json(providers);

    } catch (error) {
        console.error("Fetch Providers Error:", error);
        return res.status(200).json([]);
    }
}