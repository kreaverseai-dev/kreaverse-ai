// File: /api/musicapi.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    // Tambahan: clientEmail untuk data di Dasbor Admin
    const { endpoint, payload, clientEmail = "Klien Anonim" } = req.body;
    const FIREBASE_PROJECT_ID = "kreaverse-ai-2605f";

    try {
        // ==========================================
        // BAGIAN 1: COPY-PASTE UNTUK SEMUA PROVIDER (TIDAK PERLU DIUBAH)
        // ==========================================
        const queryRes = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                structuredQuery: {
                    from: [{ collectionId: "api_keys" }],
                    where: {
                        fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "aktif" } }
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

        let successData = null;
        let lastError = null;

        // ==========================================
        // BAGIAN 2: LOOPING AUTO-SWITCH
        // ==========================================
        for (let i = 0; i < activeKeys.length; i++) {
            const currentDocName = activeKeys[i].id;
            const currentApiKey = activeKeys[i].key;

            // ---> DI SINI TEMPAT ANDA MENGGANTI URL & HEADER UNTUK PROVIDER BARU <---
            const response = await fetch(`https://api.musicapi.ai${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentApiKey}` // Ganti ini jika provider baru minta format beda
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.ok) {
                successData = data;
                break; // Berhasil! Stop looping.
            } 
            else {
                // Jika error 401 (Unauthorized), 403 (Forbidden), 429 (Too Many Requests / Limit)
                if (response.status === 401 || response.status === 403 || response.status === 429) {
                    await fetch(`https://firestore.googleapis.com/v1/${currentDocName}?updateMask.fieldPaths=status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fields: { status: { stringValue: "mati" } } })
                    });
                }
                lastError = data.error?.message || data.message || 'Terjadi kesalahan pada Provider.';
            }
        }

        // ==========================================
        // BAGIAN 3: HASIL & PELAPOR GALERI
        // ==========================================
        if (successData) {
            
            // === [KODE PELAPOR GALERI KE FIREBASE] ===
            try {
                // Deteksi URL audio (menyesuaikan format MusicAPI)
                let audioUrl = successData.audio_url || successData.url || (successData.output && successData.output[0]) || null;
                
                if (audioUrl) {
                    await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/render_gallery`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fields: {
                                type: { stringValue: 'music' }, // Ikon musik
                                email: { stringValue: clientEmail },
                                url: { stringValue: audioUrl },
                                timestamp: { integerValue: Date.now().toString() }
                            }
                        })
                    });
                }
            } catch (e) {
                console.error("Gagal mengirim data galeri musik ke admin");
            }
            // ===============================================

            return res.status(200).json(successData);
        } else {
            return res.status(500).json({ error: `Semua API Key gagal. Error provider: ${lastError}` });
        }

    } catch (error) {
        return res.status(500).json({ error: 'Gagal menghubungi Database: ' + error.message });
    }
}
