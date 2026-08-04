window.globalAudioProviders = [];
window.globalLlmProviders = [];
window.activeCloudinaryAccounts = [];
window.selectedAudioUrl = "";
window.rawAudioFile = null;

// FUNGSI INI YANG MEMPERBAIKI ERROR "Memuat Model..."
window.loadDynamicModels = function() {
    const providerSelectedLabel = document.getElementById('providerSelectedLabel');
    const llmSelectedLabel = document.getElementById('llmSelectedLabel');
    
    if (providerSelectedLabel) providerSelectedLabel.innerText = "Memuat provider...";
    if (llmSelectedLabel) llmSelectedLabel.innerText = "Memuat model chat...";

    try {
        window.onSnapshot(window.doc(window.db, "settings", "api_providers"), (docSnap) => {
            if (docSnap.exists() && docSnap.data().list) {
                const list = docSnap.data().list;
                
                // Filter Audio Providers
                window.globalAudioProviders = list.filter(m => {
                    if (!m.serviceType) return true;
                    const type = String(m.serviceType).toLowerCase();
                    const label = String(m.label || m.name || m.provider || "").toLowerCase();
                    if (label.includes('elevenlabs') || label.includes('google tts') || label.includes('whisper')) return false; 
                    return type === "audio" || type === "music" || type === "text-to-audio";
                });
                
                if (window.globalAudioProviders.length > 0) {
                    let allModels = [];
                    window.globalAudioProviders.forEach(p => {
                        if (p.models) {
                            const mList = p.models.split(',').map(m => m.trim()).filter(m => m);
                            mList.forEach(mod => {
                                if (mod.toLowerCase().includes('whisper')) return;
                                allModels.push({ rawVal: mod, name: `Flixa AI - ${mod.toUpperCase()}` });
                            });
                        }
                    });

                    let dropdownHtml = `<div style="font-size: 0.65rem; color: #94a3b8; font-weight: 800; padding: 8px 12px;">Semua Model</div>`;
                    allModels.forEach(m => {
                        dropdownHtml += `
                            <div class="custom-select-option" style="padding: 12px; cursor: pointer;" onclick="window.selectSunoModel('${m.rawVal}', '${m.name}')">
                                <div style="color: #0f172a; font-weight: 700; font-size: 0.95rem;">${m.name}</div>
                            </div>
                        `;
                    });

                    const dropdownContainer = document.getElementById('sunoModelDropdown');
                    if (dropdownContainer) dropdownContainer.innerHTML = dropdownHtml;

                    // Auto-select model pertama agar tombol bisa diklik
                    if (allModels.length > 0) {
                        window.selectSunoModel(allModels[0].rawVal, allModels[0].name);
                    }
                } else {
                    document.getElementById('activeSunoModelName').innerHTML = `<span style="color: #ef4444;">Tidak ada model aktif</span>`;
                }

                // Filter LLM Providers
                window.globalLlmProviders = list.filter(m => {
                    if (!m.serviceType) return false;
                    const type = String(m.serviceType).toLowerCase();
                    return type === "llm" || type === "text" || type === "chat";
                });
                
                if (window.globalLlmProviders.length > 0) {
                    document.getElementById('llmSettingsWrapper')?.classList.remove('hidden');
                    let llmOptionsHtml = `<div class="custom-select-option" onclick="window.selectLlmOption('auto_pool', 'auto_pool', 'Flixa AI Chat (Auto)')">Flixa AI Chat (Auto)</div>`;
                    document.getElementById('llmDropdown').innerHTML = llmOptionsHtml;
                    window.selectLlmOption('auto_pool', 'auto_pool', 'Flixa AI Chat (Auto)');
                }
            }
        });
    } catch (e) {
        console.error("Gagal memuat model:", e);
    }
};

window.selectSunoModel = function(modelVal, modelName) {
    document.getElementById('modelSelect').value = modelVal;
    document.getElementById('providerSelect').value = 'auto_pool'; 
    document.getElementById('activeSunoModelName').innerHTML = modelName;
    document.getElementById('sunoModelDropdown').classList.add('hidden');
};

window.selectLlmOption = function(providerVal, modelVal, label) {
    document.getElementById('llmSelect').value = providerVal;
    document.getElementById('llmModelSelect').value = modelVal;
    document.getElementById('llmSelectedLabel').innerHTML = `<i class="fa-solid fa-brain" style="color: #8b5cf6;"></i> ` + label;
    document.getElementById('llmDropdown').classList.add('hidden');
};

// FUNGSI UPLOAD CLOUDINARY
window.fetchCloudinaryAccounts = async function() {
    try {
        const snap = await window.getDocs(window.collection(window.db, "cloudinary_accounts"));
        window.activeCloudinaryAccounts = [];
        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.status !== "limit") window.activeCloudinaryAccounts.push({ id: docSnap.id, ...d });
        });
    } catch (err) { console.error(err); }
};

window.uploadBlobToCloudinary = async function(blob, originalName, isBypassed = true, durationStr = "0:00") {
    await window.fetchCloudinaryAccounts();
    if (window.activeCloudinaryAccounts.length === 0) throw new Error("Storage limit");
    
    for (let i = 0; i < window.activeCloudinaryAccounts.length; i++) {
        const targetAccount = window.activeCloudinaryAccounts[i];
        const formData = new FormData();
        formData.append("file", blob, (isBypassed ? "bypassed_" : "original_") + originalName);
        formData.append("upload_preset", targetAccount.uploadPreset);
        
        try {
            const res = await fetch(`https://api.cloudinary.com/v1_1/${targetAccount.cloudName}/auto/upload`, { method: 'POST', body: formData });
            if(!res.ok) throw new Error("Limit");
            const data = await res.json();
            window.selectedAudioUrl = data.secure_url;
            return; 
        } catch (err) { continue; }
    }
    throw new Error("Semua Akun Cloudinary Penuh.");
};

// FUNGSI BUAT LAGU
window.isGeneratingSong = false;
window.generateAudioSong = async function() {
    if (window.isGeneratingSong) return window.showIphoneToast("Sabar", "Sistem sedang memproses antrean.", "fa-hand-paper");
    if (!window.isLoggedIn) return window.showIphoneToast("Akses Ditolak", "Silakan login terlebih dahulu.", "fa-lock");

    const generateBtn = document.getElementById('generateBtn');
    let providerId = document.getElementById('providerSelect').value;
    let modelId = document.getElementById('modelSelect').value;

    const style = document.getElementById('styleInput').value.trim();
    if (!style) return window.showIphoneToast("Error", "Gaya musik wajib diisi!", "fa-triangle-exclamation");

    window.isGeneratingSong = true;
    const originalBtnHtml = generateBtn.innerHTML;
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';

    try {
        const currentMode = document.getElementById('modeGenerateBtn').classList.contains('active') ? 'generate' : 'cover';
        if (currentMode === 'cover' && !window.selectedAudioUrl && window.rawAudioFile) {
            generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengunggah Audio...';
            await window.uploadBlobToCloudinary(window.rawAudioFile, window.rawAudioFile.name, false, "0:00");
        }

        let title = document.getElementById('titleInput').value.trim() || "Lagu Baru";
        const lyrics = document.getElementById('lyricsInput').value.trim();
        const instrumental = document.getElementById('instrumentalToggle').checked;

        generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menghubungi AI...';

        const response = await fetch('/api/habirmx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                email: window.currentUser.email, providerId, modelId, title, prompt: style, 
                instrumental, lyrics, audioUrl: window.selectedAudioUrl, options: {} 
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal menghubungi API");

        window.showIphoneToast("Sukses", "Permintaan berhasil dikirim ke server AI!", "fa-check-circle");
        
    } catch (err) {
        window.showIphoneToast("Gagal", err.message, "fa-triangle-exclamation");
    } finally {
        window.isGeneratingSong = false;
        generateBtn.disabled = false;
        generateBtn.innerHTML = originalBtnHtml;
    }
};