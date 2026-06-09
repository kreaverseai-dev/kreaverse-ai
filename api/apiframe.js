// File: /api/apiframe.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    // Tambahan: Tangkap clientEmail dari frontend untuk label di Galeri
    const { endpoint, payload, clientEmail = "Klien Anonim" } = req.body;
    
    // ID Database Firebase Anda
    const FIREBASE_PROJECT_ID = "kreaverse-ai-2605f";

    try {
        // 1. MENGAMBIL SEMUA API KEY AKTIF DARI FIREBASE (REST API)
        const queryRes = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                structuredQuery: {
                    from: [{ collectionId: "api_keys" }],
                    where: {
                        fieldFilter: { 
                            field: { fieldPath: "status" }, 
                            op: "EQUAL", 
                            value: { stringValue: "aktif" } 
                        }
                    }
                }
            })
        });

        const queryData = await queryRes.json();
        
        let activeKeys = [];
        if (Array.isArray(queryData) && queryData[0].document) {
            activeKeys = queryData.map(item => ({
                id: item.document.name,
                key: item.document.fields.key.stringValue
            }));
        }

        if (activeKeys.length === 0) {
            return res.status(500).json({ error: 'Sistem Kritis: Tidak ada API Key yang aktif di Database.' });
        }

        // 2. SISTEM AUTO-SWITCH (MENGUJI KUNCI SATU PER SATU)
        let successData = null;
        let lastError = null;

        for (let i = 0; i < activeKeys.length; i++) {
            const currentDocName = activeKeys[i].id;
            const currentApiKey = activeKeys[i].key;

            const response = await fetch(`https://api.apiframe.ai/v2${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': currentApiKey
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            // Jika API Key BERHASIL
            if (response.ok) {
                successData = data;
                break; 
            } 
            // Jika API Key MATI/LIMIT
            else {
                if (response.status === 401 || response.status === 403 || response.status === 429) {
                    await fetch(`https://firestore.googleapis.com/v1/${currentDocName}?updateMask.fieldPaths=status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fields: { status: { stringValue: "mati" } } })
                    });
                }
                lastError = data.error?.message || data.message || 'Terjadi kesalahan APIFrame.';
            }
        }

        // 3. PENGEMBALIAN HASIL AKHIR & LAPORAN KE GALERI
        if (successData) {
            
            // === [KODE PELAPOR GALERI KE FIREBASE] ===
            try {
                // Mendeteksi URL gambar dari respon APIFrame
                let imgUrl = successData.url || successData.image_url || (successData.output && successData.output[0]) || (successData.images && successData.images[0]) || null;
                
                if (imgUrl) {
                    await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/render_gallery`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fields: {
                                type: { stringValue: 'image' },
                                email: { stringValue: clientEmail },
                                url: { stringValue: imgUrl },
                                timestamp: { integerValue: Date.now().toString() }
                            }
                        })
                    });
                }
            } catch (e) {
                console.error("Gagal mengirim data galeri ke admin");
            }
            // ===============================================

            return res.status(200).json(successData);
        } else {
            return res.status(500).json({ error: `Semua API Key gagal atau kehabisan limit. Error provider: ${lastError}` });
        }

    } catch (error) {
        return res.status(500).json({ error: 'Gagal menghubungi sistem Database Server: ' + error.message });
    }
}
