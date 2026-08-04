// ============================================================
// PENGELOLA AKUN CLOUDINARY & UPLOAD
// ============================================================
window.activeCloudinaryAccounts = [];

window.fetchCloudinaryAccounts = async function() {
    try {
        const snap = await window.getDocs(window.collection(window.db, "cloudinary_accounts"));
        window.activeCloudinaryAccounts = [];
        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.status !== "limit") {
                window.activeCloudinaryAccounts.push({ id: docSnap.id, ...d });
            } else if (d.resetTime && Date.now() > d.resetTime) {
                window.activeCloudinaryAccounts.push({ id: docSnap.id, ...d });
                window.updateDoc(window.doc(window.db, "cloudinary_accounts", docSnap.id), { status: "aktif", resetTime: null }).catch(e=>e);
            }
        });
    } catch (err) {
        console.error("Gagal menarik akun Cloudinary:", err);
    }
};

window.uploadBlobToCloudinary = async function(blob, originalName, isBypassed = true, durationStr = "0:00") {
    await window.fetchCloudinaryAccounts();
    if (window.activeCloudinaryAccounts.length === 0) throw new Error("Storage limit");
    
    let uploadSuccess = false;
    
    for (let i = 0; i < window.activeCloudinaryAccounts.length; i++) {
        const targetAccount = window.activeCloudinaryAccounts[i];
        const formData = new FormData();
        const prefix = isBypassed ? "bypassed_" : "original_";
        formData.append("file", blob, prefix + originalName);
        formData.append("upload_preset", targetAccount.uploadPreset);
        
        try {
            const res = await fetch(`https://api.cloudinary.com/v1_1/${targetAccount.cloudName}/auto/upload`, {
                method: 'POST', body: formData
            });
            
            if(!res.ok) {
                const freezeTime = Date.now() + (30 * 24 * 60 * 60 * 1000);
                try { await window.updateDoc(window.doc(window.db, "cloudinary_accounts", targetAccount.id), { status: "limit", resetTime: freezeTime }); } catch(e) {}
                throw new Error("Limit");
            }
            
            const data = await res.json();
            window.selectedAudioUrl = data.secure_url;
            const type = isBypassed ? "dsp" : "original";
            if(window.saveToUploadHistory) window.saveToUploadHistory(originalName, data.secure_url, type, durationStr);
            uploadSuccess = true;
            break; 
        } catch (err) {
            continue; 
        }
    }
    if (!uploadSuccess) throw new Error("Semua Akun Cloudinary Penuh (Masa Tenggang 30 Hari).");
};

window.uploadVoiceFileToCloudinary = async function(file) {
    await window.fetchCloudinaryAccounts();
    if (!window.activeCloudinaryAccounts || window.activeCloudinaryAccounts.length === 0) throw new Error("Storage Cloudinary penuh/limit.");
    
    let uploadSuccess = false;
    let finalUrl = "";
    
    for (let i = 0; i < window.activeCloudinaryAccounts.length; i++) {
        const targetAccount = window.activeCloudinaryAccounts[i];
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", targetAccount.uploadPreset);
        try {
            const res = await fetch(`https://api.cloudinary.com/v1_1/${targetAccount.cloudName}/auto/upload`, { method: 'POST', body: formData });
            if(!res.ok) {
                const freezeTime = Date.now() + (30 * 24 * 60 * 60 * 1000);
                try { await window.updateDoc(window.doc(window.db, "cloudinary_accounts", targetAccount.id), { status: "limit", resetTime: freezeTime }); } catch(e) {}
                throw new Error("Limit");
            }
            const data = await res.json();
            finalUrl = data.secure_url;
            uploadSuccess = true;
            break;
        } catch(err) { continue; }
    }
    if (!uploadSuccess) throw new Error("Semua Server Storage Penuh (Masa Tenggang).");
    return finalUrl;
};

// ============================================================
// API: GENERATE SONG
// ============================================================
window.isGeneratingSong = false;

window.generateAudioSong = async function() {
    if (window.isGeneratingSong) {
        if(window.showIphoneToast) window.showIphoneToast("Sabar", "Sistem sedang memproses antrean Anda sebelumnya.", "fa-hand-paper");
        return;
    }

    if (window.isMaintenanceModeActive) {
        if(window.showMaintenanceScreen) window.showMaintenanceScreen();
        return; 
    }

    if (!window.isLoggedIn || !window.currentUser) {
        if(window.showIphoneToast) window.showIphoneToast("Akses Ditolak", "Silakan login terlebih dahulu untuk membuat lagu.", "fa-lock");
        setTimeout(() => { window.location.href = "/login/index.html"; }, 2000);
        return;
    }

    const generateBtn = document.getElementById('generateBtn');
    let providerId = document.getElementById('providerSelect').value;
    let modelId = document.getElementById('modelSelect').value;

    if (!modelId) {
        providerId = 'auto_pool';
        modelId = 'v5.5';
        document.getElementById('providerSelect').value = providerId;
        document.getElementById('modelSelect').value = modelId;
    }

    if (!providerId || !modelId) {
        const engineWrapper = document.getElementById('engineSettingsWrapper');
        const engineBody = document.getElementById('engineSettingsBody');
        if (engineBody && engineBody.classList.contains('hidden')) {
            if(window.toggleAccordion) window.toggleAccordion('engineSettingsBody');
        }
        engineWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
        engineWrapper.style.transition = "box-shadow 0.3s";
        engineWrapper.style.boxShadow = "0 0 0 4px rgba(0, 122, 255, 0.3)";
        setTimeout(() => { engineWrapper.style.boxShadow = "0 8px 24px rgba(0,0,0,0.04)"; }, 2000);
        return;
    }

    const currentMode = document.getElementById('modeGenerateBtn').classList.contains('active') ? 'generate' : 'cover';
    
    if (currentMode === 'cover') {
        if (!window.selectedAudioUrl && !window.rawAudioFile) {
            if(window.showIphoneToast) window.showIphoneToast("Error", "Mode Cover memerlukan file audio referensi. Silakan unggah audio terlebih dahulu!", "fa-triangle-exclamation");
            return;
        }
    }

    if (!window.isAdmin && window.currentUserData && window.currentUserData.tier !== 'max_lifetime' && window.currentUserData.tier !== 'max_monthly' && window.currentUserData.tier !== 'max') {
        const currentKredit = window.currentUserData.kredit !== undefined ? window.currentUserData.kredit : (window.currentUserData.dailyQuota || 0);
        if (currentKredit < 50) {
            if(window.showIphoneToast) window.showIphoneToast("Kredit Tidak Cukup", "Anda membutuhkan minimal 50 kredit. Silakan upgrade paket Anda.", "fa-coins");
            return;
        }
    }

    const style = document.getElementById('styleInput').value.trim();
    if (!style) {
        if(window.showIphoneToast) window.showIphoneToast("Error", "Gaya musik (Style of Music) wajib diisi!", "fa-triangle-exclamation");
        return;
    }

    window.isGeneratingSong = true;
    const originalBtnHtml = generateBtn.innerHTML;
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyiapkan Antrean...';

    try {
        if (currentMode === 'cover' && !window.selectedAudioUrl && window.rawAudioFile) {
            generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengunggah Audio...';
            let finalDurStr = "0:00";
            const origPlayer = document.getElementById('originalAudioPlayer');
            if (origPlayer && isFinite(origPlayer.duration) && origPlayer.duration > 0) {
                finalDurStr = window.formatTime ? window.formatTime(origPlayer.duration) : "0:00";
            }
            await window.uploadBlobToCloudinary(window.rawAudioFile, window.rawAudioFile.name, false, finalDurStr);
        }

        let title = document.getElementById('titleInput').value.trim();
        if (!title && (window.selectedAudioUrl || window.rawAudioFile)) {
            let rawName = document.getElementById('uploadedMiniFileName').innerText;
            if (rawName && rawName !== '-' && !rawName.startsWith('http')) {
                let cleanName = rawName.replace(/\.(mp3|wav|ogg|m4a|flac|aac)$/i, '');
                cleanName = cleanName.replace(/[\[\]\(\)\|\-_]/g, ' ').replace(/\s+/g, ' ').trim();
                let finalTitle = `Flixa AI - ${cleanName}`;
                if (finalTitle.length > 99) finalTitle = finalTitle.substring(0, 99);
                title = finalTitle;
                document.getElementById('titleInput').value = title; 
            }
        }

        const lyrics = document.getElementById('lyricsInput').value.trim();
        const instrumental = document.getElementById('instrumentalToggle').checked;

        const options = {
            negativeTags: document.getElementById('negativeTagsInput').value.trim(),
            vocalGender: document.getElementById('vocalGenderSelect').value,
            styleWeight: document.getElementById('styleWeightSlider').value,
            weirdness: document.getElementById('weirdnessSlider').value,
            audioWeight: document.getElementById('audioWeightSlider').value,
            personaId: document.getElementById('personaIdInput').value.trim()
        };

        generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menghubungi AI...';

        const response = await fetch('/api/habirmx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: window.currentUser.email, providerId, modelId, title, prompt: style, instrumental, lyrics, audioUrl: window.selectedAudioUrl, options })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal menghubungi API gateway");

        if (!window.isAdmin && window.currentUserData && window.currentUserData.tier !== 'max_lifetime' && window.currentUserData.tier !== 'max_monthly' && window.currentUserData.tier !== 'max') {
            if(window.showIphoneToast) window.showIphoneToast("Memproses", "Permintaan dikirim ke server...", "fa-cloud-arrow-up");
        }

        let modelLabelText = modelId;
        const activeSunoModelNameEl = document.getElementById('activeSunoModelName');
        if (activeSunoModelNameEl) {
            modelLabelText = activeSunoModelNameEl.innerText.replace(/Pro/g, '').trim();
        }
        const modelLabel = modelLabelText;
        
        const safeTaskId = data.taskId || `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const sessionGroupId = `sg_${Date.now()}`;
        
        if (data.status === "completed" && data.tracks && data.tracks.length > 0) {
            // Synchronous API
        } else {
            let createdDocIds = []; 
            
            for (let i = 0; i < 2; i++) {
                const docRef = await window.addDoc(window.collection(window.db, "render_gallery"), {
                    email: window.currentUser.email,
                    url: "",
                    prompt: style,
                    lyrics: lyrics,
                    title: `${title || "Untitled Song"} - Versi ${i + 1}`,
                    tool: "Habi RMX",
                    type: "audio",
                    status: "processing",
                    taskId: safeTaskId,
                    audioId: "-", 
                    sessionGroup: sessionGroupId, 
                    provider: data.provider || providerId,
                    model: modelLabel,
                    timestamp: Date.now() - i,
                    mode: currentMode,
                    personaId: options.personaId || "",
                    vocalGender: options.vocalGender || "",
                    styleWeight: options.styleWeight || "",
                    weirdness: options.weirdness || "",
                    audioWeight: options.audioWeight || "",
                    originalAudioUrl: currentMode === 'cover' ? window.selectedAudioUrl : ""
                });
                createdDocIds.push(docRef.id);
            }

            let pollCount = 0;
            const maxPolls = 180; 
            
            const pollInterval = setInterval(async () => {
                pollCount++;
                try {
                    const pollRes = await fetch(`/api/habirmx?taskId=${safeTaskId}&provider=${providerId}`);
                    const pollData = await pollRes.json();

                    if (pollData.status === 'completed' || pollData.status === 'success') {
                        clearInterval(pollInterval);
                        if (pollData.tracks && pollData.tracks.length > 0) {
                            for (let i = 0; i < createdDocIds.length; i++) {
                                const trackData = pollData.tracks[i] || pollData.tracks[pollData.tracks.length - 1];
                                if (trackData) {
                                    let finalDur = trackData.duration || "--:--";
                                    if (typeof finalDur === 'number') {
                                        const m = Math.floor(finalDur / 60).toString().padStart(2, '0');
                                        const s = Math.floor(finalDur % 60).toString().padStart(2, '0');
                                        finalDur = `${m}:${s}`;
                                    }
                                    await window.updateDoc(window.doc(window.db, "render_gallery", createdDocIds[i]), {
                                        status: "complete",
                                        url: trackData.audioUrl || trackData.url || "",
                                        imageUrl: trackData.imageUrl || trackData.cover || "",
                                        duration: finalDur,
                                        audioId: trackData.audioId || trackData.id || safeTaskId
                                    });
                                }
                            }
                            if (typeof window.showIphoneToast === 'function') {
                                window.showIphoneToast("Selesai", "Lagu berhasil dibuat!", "fa-check-circle");
                            }
                        }
                    } 
                    else if (pollData.status === 'failed' || pollData.status === 'error') {
                        clearInterval(pollInterval);
                        let finalErrorMsg = pollData.reason || pollData.error || pollData.message || "Gagal diproses oleh server AI.";
                        if (finalErrorMsg.toLowerCase() === 'success' || finalErrorMsg.toLowerCase() === 'ok') {
                            finalErrorMsg = "Dibatalkan oleh AI (Durasi audio referensi melebihi batas 60 detik atau melanggar hak cipta).";
                        }
                        for (let i = 0; i < createdDocIds.length; i++) {
                            await window.updateDoc(window.doc(window.db, "render_gallery", createdDocIds[i]), {
                                status: "failed",
                                error: finalErrorMsg
                            });
                        }
                    }
                    
                    if (pollCount >= maxPolls) {
                        clearInterval(pollInterval);
                        for (let i = 0; i < createdDocIds.length; i++) {
                            await window.updateDoc(window.doc(window.db, "render_gallery", createdDocIds[i]), {
                                status: "failed",
                                error: "Timeout: Server AI terlalu lama merespons (Lebih dari 15 Menit)."
                            });
                        }
                    }
                } catch (e) { console.error("Polling error:", e); }
            }, 5000); 
        }
        
        document.getElementById('miniLibraryContainer').scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
        let displayError = err.message;
        if (!window.isAdmin && (displayError.toLowerCase().includes('habis') || displayError.toLowerCase().includes('insufficient') || displayError.toLowerCase().includes('api'))) {
            displayError = "Trafik server sedang penuh atau dalam perbaikan. Silakan coba beberapa saat lagi.";
        }
        if (displayError.toLowerCase().includes('karakter suara') || displayError.toLowerCase().includes('kadaluarsa')) {
            if(window.showIphoneToast) window.showIphoneToast("Suara Kadaluarsa", displayError, "fa-user-astronaut", 6000);
            document.getElementById('personaIdInput').value = '';
        } else {
            if(window.showIphoneToast) window.showIphoneToast("Gagal", displayError, "fa-triangle-exclamation");
        }
    } finally {
        window.isGeneratingSong = false;
        generateBtn.disabled = false;
        generateBtn.innerHTML = originalBtnHtml;
    }
};

// ============================================================
// API: MAGIC WAND, DETECT LYRICS, EXTRACT STYLE, REVISI AI
// ============================================================
window.triggerMagicWand = async function(type) {
    if (!window.isLoggedIn || !window.currentUser) {
        if(window.showIphoneToast) window.showIphoneToast("Akses Ditolak", "Silakan login terlebih dahulu untuk menggunakan AI.", "fa-lock");
        return;
    }

    const llmProviderId = document.getElementById('llmSelect').value;
    const llmModelId = document.getElementById('llmModelSelect').value;
    if (!llmProviderId) return;

    const currentMode = document.getElementById('modeGenerateBtn').classList.contains('active') ? 'generate' : 'cover';
    const inputId = type === 'style' ? 'styleInput' : 'lyricsInput';
    const inputEl = document.getElementById(inputId);
    const originalText = inputEl.value.trim();

    const btn = event.currentTarget;
    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI...';
    inputEl.disabled = true;

    const lyricsPromptInstruction = "TUGAS: Susun ulang format lirik mentah ini menjadi format lirik lagu profesional untuk Suno AI/Udio TANPA MENGUBAH KATA-KATA ASLINYA.\n\nATURAN MUTLAK:\n1. Gunakan struktur baku HANYA dengan kurung siku: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Interlude], [Bridge], [Outro].\n2. Masukkan arahan instrumen ATAU suara latar ke dalam kurung siku agar tidak dienkripsi sistem, contoh: [Instrumental Intro], [Guitar Solo], [Backing Vocals: ...], [Fade Out].\n3. WAJIB tambahkan meta-tag anti-halusinasi ini di baris paling atas lirik: [Exact Original Melody], [Consistent Rhythm], [No Improvisation].\n4. HAPUS semua teks yang tidak relevan (seperti 'Upload By', uploader, 'Terima Kasih', dll) serta HAPUS teks halusinasi lirik bahasa Inggris (seperti 'I\\'m sorry', 'Sculptures...', dll) jika lagu aslinya bukan bahasa Inggris.\n5. WAJIB sisipkan watermark suara latar (Habi RMX) tepat di bawah tag [Intro] dan [Interlude].\n6. PERTAHANKAN atau tambahkan tanda titik tiga (...) di akhir kalimat untuk efek cengkok/nada panjang.\n7. JANGAN MENGUBAH, MENERJEMAHKAN, ATAU MENAMBAH KATA pada lirik utama.\n8. Langsung berikan hasil liriknya tanpa kata pengantar.\n\nLIRIK MENTAH:\n";

    if (type === 'lyrics' && !originalText) {
        if (!window.rawAudioFile && !window.selectedAudioUrl) {
            inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
            if(window.showIphoneToast) window.showIphoneToast("Error", "Silakan unggah audio referensi terlebih dahulu untuk transkripsi otomatis!", "fa-triangle-exclamation");
            return;
        }

        if(window.showIphoneToast) window.showIphoneToast("ASR Whisper Aktif", "AI sedang mendengarkan & menyalin suara lagu...", "fa-microphone-lines");

        try {
            let audioBlob = window.rawAudioFile;
            if (!audioBlob && window.selectedAudioUrl) {
                const fetchRes = await fetch(window.selectedAudioUrl);
                audioBlob = await fetchRes.blob();
            }

            let groqKey = "";
            try {
                const collections = ["api_keys", "keys", "database_keys", "api_providers"];
                for (let col of collections) {
                    const snap = await window.getDocs(window.collection(window.db, col));
                    snap.forEach(docSnap => {
                        const d = docSnap.data();
                        const name = (d.provider || d.name || d.id || "").toLowerCase();
                        if (name.includes("groq") || name.includes("whisper")) {
                            if (d.apiKey) groqKey = d.apiKey;
                            else if (d.key) groqKey = d.key;
                        }
                    });
                    if (groqKey) break;
                }
            } catch(e) {}

            if (!groqKey) throw new Error("Kunci API Groq Whisper tidak ditemukan di database.");

            const formData = new FormData();
            formData.append("file", audioBlob, "audio.mp3");
            formData.append("model", "whisper-large-v3");
            formData.append("temperature", "0.0"); 
            formData.append("prompt", "This is a song with music and vocals. Transcribe the lyrics accurately in its original language. Ignore instrumental breaks, drums, and melodies. Do not hallucinate words.");

            const whisperResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                method: "POST", headers: { "Authorization": `Bearer ${groqKey}` }, body: formData
            });
            
            const whisperData = await whisperResponse.json();
            if (!whisperResponse.ok) throw new Error(whisperData.error?.message || "Gagal transkripsi audio.");

            const rawText = whisperData.text;

            if(window.showIphoneToast) window.showIphoneToast("Merapikan lirik", "Menyusun struktur lagu (Intro, Verse, Chorus)...", "fa-wand-magic-sparkles");
            
            const vocalGenderVal = document.getElementById('vocalGenderSelect') ? document.getElementById('vocalGenderSelect').value : 'not_specified';
            
            const response = await fetch('/api/habirmx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'magic_wand', providerId: llmProviderId, modelId: llmModelId, llmType: 'lyrics',
                    inputText: lyricsPromptInstruction + rawText, vocalGender: vocalGenderVal, currentMode: currentMode
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Gagal merapikan lirik.");

            let finalResult = data.result.trim();
            inputEl.value = "";
            let i = 0;
            const chunkSize = 15; 
            
            function typeWriter() {
                if (i < finalResult.length) {
                    inputEl.value += finalResult.substring(i, i + chunkSize);
                    i += chunkSize;
                    setTimeout(typeWriter, 1); 
                } else {
                    inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
                    if(window.updateCounter) window.updateCounter(inputId, 'lyricsCounter', 5000);
                    if(window.showIphoneToast) window.showIphoneToast("Selesai", "Lirik otomatis berhasil disusun oleh AI!", "fa-circle-check");
                }
            }
            typeWriter();

        } catch (err) {
            inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
            if(window.showIphoneToast) window.showIphoneToast("ASR Gagal", err.message, "fa-circle-xmark");
        }
        return;
    }

    if (!originalText) {
        inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
        if(window.showIphoneToast) window.showIphoneToast("Error", `Silakan isi ${type === 'style' ? 'Style of Music' : 'Lyrics'} terlebih dahulu sebelum menggunakan AI.`, "fa-triangle-exclamation");
        return;
    }

    if(window.showIphoneToast) window.showIphoneToast("Magic Wand Hack", "AI sedang merombak teks Anda...", "fa-wand-magic-sparkles");

    try {
        let finalAudioUrl = window.selectedAudioUrl;
        if (currentMode === 'cover' && type === 'lyrics' && !finalAudioUrl && window.rawAudioFile) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Upload Audio...';
            let finalDurStr = "0:00";
            const origPlayer = document.getElementById('originalAudioPlayer');
            if (origPlayer && isFinite(origPlayer.duration) && origPlayer.duration > 0) {
                finalDurStr = window.formatTime ? window.formatTime(origPlayer.duration) : "0:00";
            }
            await window.uploadBlobToCloudinary(window.rawAudioFile, window.rawAudioFile.name, false, finalDurStr);
            finalAudioUrl = window.selectedAudioUrl;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI...';
        }

        const vocalGenderVal = document.getElementById('vocalGenderSelect') ? document.getElementById('vocalGenderSelect').value : 'not_specified';

        let textToSend = originalText;
        if (type === 'style') {
            if (currentMode === 'cover') {
                textToSend = "TUGAS: Kembangkan deskripsi genre musik ini menjadi prompt AI Music (Suno/Udio). \n\nATURAN MUTLAK:\n1. Wajib gunakan meta-tags ini di awal teks: [Exact Cover, Identical Melody Progression, 1:1 Vocal Cadence, Mirror Source Audio, No Improvisation, Strict BPM, Consistent Rhythm].\n2. Tekankan dengan keras bahwa struktur melodi dari awal hingga akhir (intro, verse, chorus, outro) TIDAK BOLEH BERUBAH, dilarang berhalusinasi, dan dilarang membuat nada/solo baru di tengah lagu.\n3. Panjang teks hasil akhir WAJIB di antara 950 hingga 980 karakter.\n4. Jangan gunakan kata pengantar, langsung berikan prompt-nya.\n\nGENRE DASAR:\n" + originalText;
            } else {
                textToSend = "TUGAS: Kembangkan deskripsi genre musik ini menjadi prompt AI Music (Suno/Udio) yang detail dan profesional.\n\nATURAN MUTLAK:\n1. Gunakan meta-tags instrumen dan nuansa yang kuat.\n2. Panjang teks hasil akhir WAJIB di antara 950 hingga 980 karakter.\n3. Jangan gunakan kata pengantar, langsung berikan prompt-nya.\n\nGENRE DASAR:\n" + originalText;
            }
        } else if (type === 'lyrics') {
            textToSend = lyricsPromptInstruction + originalText;
        }

        const response = await fetch('/api/habirmx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'magic_wand', providerId: llmProviderId, modelId: llmModelId, llmType: type,
                inputText: textToSend, vocalGender: vocalGenderVal, currentMode: currentMode, audioUrl: finalAudioUrl 
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal menghubungi AI");

        let finalResult = data.result.trim();
        const maxLimit = type === 'style' ? 950 : 4900;
        if (finalResult.length > maxLimit) {
            let cutIndex = finalResult.lastIndexOf(',', maxLimit);
            if (cutIndex === -1 || cutIndex < maxLimit - 50) cutIndex = finalResult.lastIndexOf(' ', maxLimit);
            if (cutIndex === -1) cutIndex = maxLimit;
            finalResult = finalResult.substring(0, cutIndex);
        }

        inputEl.value = "";
        let i = 0;
        const chunkSize = 15; 
        
        function typeWriter() {
            if (i < finalResult.length) {
                inputEl.value += finalResult.substring(i, i + chunkSize);
                i += chunkSize;
                setTimeout(typeWriter, 1); 
            } else {
                inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
                if(window.updateCounter) window.updateCounter(inputId, type === 'style' ? 'styleCounter' : 'lyricsCounter', type === 'style' ? 1000 : 5000);
                if(window.showIphoneToast) window.showIphoneToast("Selesai", "Teks berhasil disempurnakan oleh AI!", "fa-circle-check");
            }
        }
        typeWriter();

    } catch (err) {
        inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
        if(window.showIphoneToast) window.showIphoneToast("Gagal", err.message, "fa-circle-xmark");
    }
};

window.detectLyrics = async function() {
    if (!window.isLoggedIn || !window.currentUser) return;
    const llmProviderId = document.getElementById('llmSelect') ? document.getElementById('llmSelect').value : 'auto_pool';
    const llmModelId = document.getElementById('llmModelSelect') ? document.getElementById('llmModelSelect').value : 'auto_pool';

    const inputEl = document.getElementById('lyricsInput');
    const progressBox = document.getElementById('detectLyricsProgress');
    const statusText = document.getElementById('detectLyricsStatus');
    const btn = event.currentTarget;
    const originalBtnHtml = btn.innerHTML;

    btn.disabled = true; inputEl.disabled = true; progressBox.classList.remove('hidden');

    try {
        let finalAudioUrl = window.selectedAudioUrl;
        const isDspActive = document.getElementById('uploadedMiniBadge') && document.getElementById('uploadedMiniBadge').innerText === "DSP Bypassed";
        
        if (window.originalCleanAudioUrl) {
            finalAudioUrl = window.originalCleanAudioUrl;
            statusText.innerText = "Menganalisis audio original...";
        } 
        else if ((!finalAudioUrl || isDspActive) && window.rawAudioFile) {
            statusText.innerText = "Menyiapkan audio original untuk AI...";
            await window.fetchCloudinaryAccounts();
            if (window.activeCloudinaryAccounts.length > 0) {
                const targetAccount = window.activeCloudinaryAccounts[0];
                const formDataCloudinary = new FormData();
                formDataCloudinary.append("file", window.rawAudioFile, "original_detect.mp3");
                formDataCloudinary.append("upload_preset", targetAccount.uploadPreset);
                
                finalAudioUrl = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', `https://api.cloudinary.com/v1_1/${targetAccount.cloudName}/auto/upload`);
                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).secure_url);
                        else reject(new Error("Upload gagal"));
                    };
                    xhr.onerror = () => reject(new Error("Error jaringan"));
                    xhr.send(formDataCloudinary);
                });
                window.originalCleanAudioUrl = finalAudioUrl;
            }
        }

        statusText.innerHTML = "AI sedang mendengarkan lagu dan menulis lirik...";

        const response = await fetch('/api/habirmx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'magic_wand', providerId: llmProviderId, modelId: llmModelId, llmType: 'detect_lyrics',
                inputText: "Tolong dengarkan lagu ini dan tuliskan liriknya dengan akurat dari awal sampai akhir.", 
                audioUrl: finalAudioUrl, currentMode: 'cover'
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal menghubungi AI");

        let finalResult = data.result.trim();
        inputEl.value = "";
        let i = 0;
        function typeWriter() {
            if (i < finalResult.length) {
                inputEl.value += finalResult.charAt(i);
                i++;
                setTimeout(typeWriter, 5);
            } else {
                inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
                if(window.updateCounter) window.updateCounter('lyricsInput', 'lyricsCounter', 5000);
                if(window.showIphoneToast) window.showIphoneToast("Deteksi Selesai", "Lirik berhasil diekstrak dari audio!", "fa-check-double");
                if(window.checkLyricsState) window.checkLyricsState();
            }
        }
        typeWriter();

    } catch (err) {
        inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
        if(window.showIphoneToast) window.showIphoneToast("Gagal Deteksi", err.message, "fa-triangle-exclamation");
    } finally {
        progressBox.classList.add('hidden');
    }
};

window.extractStyleFromAudio = async function() {
    if (!window.isLoggedIn || !window.currentUser) return;
    const llmProviderId = document.getElementById('llmSelect') ? document.getElementById('llmSelect').value : 'auto_pool';
    const llmModelId = document.getElementById('llmModelSelect') ? document.getElementById('llmModelSelect').value : 'auto_pool';
    const chosenLang = document.getElementById('autoStyleLang') ? document.getElementById('autoStyleLang').value : 'english';

    const btn = document.getElementById('btnAudioToStyle');
    const inputEl = document.getElementById('styleInput');
    const originalBtnHtml = btn.innerHTML;

    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...'; inputEl.disabled = true;

    if(window.showIphoneToast) window.showIphoneToast("Analisis Audio", "AI sedang menganalisis emosi, melodi, ritme, dan gaya musik. Mohon tunggu...", "fa-ear-listen");

    try {
        let finalAudioUrl = window.selectedAudioUrl;
        const isDspActive = document.getElementById('uploadedMiniBadge') && document.getElementById('uploadedMiniBadge').innerText === "DSP Bypassed";
        
        if (window.originalCleanAudioUrl) {
            finalAudioUrl = window.originalCleanAudioUrl;
        } 
        else if ((!finalAudioUrl || isDspActive) && window.rawAudioFile) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Upload Original...';
            await window.fetchCloudinaryAccounts();
            if (window.activeCloudinaryAccounts.length > 0) {
                const targetAccount = window.activeCloudinaryAccounts[0];
                const formDataCloudinary = new FormData();
                formDataCloudinary.append("file", window.rawAudioFile, "original_style.mp3");
                formDataCloudinary.append("upload_preset", targetAccount.uploadPreset);
                
                finalAudioUrl = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', `https://api.cloudinary.com/v1_1/${targetAccount.cloudName}/auto/upload`);
                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).secure_url);
                        else reject(new Error("Upload gagal"));
                    };
                    xhr.onerror = () => reject(new Error("Error jaringan"));
                    xhr.send(formDataCloudinary);
                });
                window.originalCleanAudioUrl = finalAudioUrl;
            }
        }

        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ekstrak...';

        let promptInstruction = "TUGAS KHUSUS MUSICAL ANALYSIS: Bertindaklah sebagai ahli musik. Dengarkan audio pada link yang diberikan, lalu deskripsikan genre, instrumen, mood, tempo, dan getaran (vibe) musiknya secara akurat menjadi sebuah prompt untuk Suno AI/Udio. \n\nATURAN MUTLAK:\n1. JANGAN tuliskan liriknya, fokus hanya pada gaya instrumen dan musiknya (Style of Music).\n2. Format jawaban HARUS berupa kata kunci/frasa pendek yang dipisahkan oleh koma (contoh: acoustic folk, calm, acoustic guitar, slow tempo, rural vibe).\n3. Dilarang keras menggunakan kalimat sapaan. Langsung berikan hasilnya.";
        
        if (chosenLang === 'indonesian') promptInstruction += "\n4. JAWAB DALAM BAHASA INDONESIA (contoh: pop akustik, santai, gitar akustik, tempo lambat).";
        else promptInstruction += "\n4. JAWAB DALAM BAHASA INGGRIS (contoh: acoustic pop, chill, acoustic guitar, slow tempo).";

        const response = await fetch('/api/habirmx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'magic_wand', providerId: llmProviderId, modelId: llmModelId, llmType: 'style',
                inputText: promptInstruction, audioUrl: finalAudioUrl, currentMode: 'cover'
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal menghubungi AI");

        let finalResult = data.result.trim();
        inputEl.value = "";
        let i = 0;
        function typeWriter() {
            if (i < finalResult.length) {
                inputEl.value += finalResult.charAt(i);
                i++;
                setTimeout(typeWriter, 10);
            } else {
                inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
                if(window.updateCounter) window.updateCounter('styleInput', 'styleCounter', 1000);
                if(window.showIphoneToast) window.showIphoneToast("Ekstrak Selesai", "Genre berhasil diidentifikasi dari audio!", "fa-check-double");
            }
        }
        typeWriter();

    } catch (err) {
        inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
        if(window.showIphoneToast) window.showIphoneToast("Gagal Ekstrak", err.message, "fa-triangle-exclamation");
    }
};

window.syncLyrics = async function() {
    if (!window.isLoggedIn || !window.currentUser) return;
    const inputEl = document.getElementById('lyricsInput');
    const progressBox = document.getElementById('detectLyricsProgress');
    const statusText = document.getElementById('detectLyricsStatus');
    const btn = document.getElementById('btnSyncDetect');
    const originalBtnHtml = btn.innerHTML;
    const originalLyrics = inputEl.value.trim();

    btn.disabled = true; inputEl.disabled = true; progressBox.classList.remove('hidden');
    statusText.innerText = "Menyiapkan Audio...";

    try {
        let finalAudioUrl = window.selectedAudioUrl;
        const isDspActive = document.getElementById('uploadedMiniBadge') && document.getElementById('uploadedMiniBadge').innerText === "DSP Bypassed";
        
        if (window.originalCleanAudioUrl) {
            finalAudioUrl = window.originalCleanAudioUrl;
        } 
        else if ((!finalAudioUrl || isDspActive) && window.rawAudioFile) {
            await window.fetchCloudinaryAccounts();
            if (window.activeCloudinaryAccounts.length > 0) {
                const targetAccount = window.activeCloudinaryAccounts[0];
                const formDataCloudinary = new FormData();
                formDataCloudinary.append("file", window.rawAudioFile, "original_sync.mp3");
                formDataCloudinary.append("upload_preset", targetAccount.uploadPreset);
                
                finalAudioUrl = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', `https://api.cloudinary.com/v1_1/${targetAccount.cloudName}/auto/upload`);
                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).secure_url);
                        else reject(new Error("Upload audio gagal"));
                    };
                    xhr.onerror = () => reject(new Error("Terjadi kesalahan jaringan saat upload"));
                    xhr.send(formDataCloudinary);
                });
                window.originalCleanAudioUrl = finalAudioUrl;
                if (!window.selectedAudioUrl) window.selectedAudioUrl = finalAudioUrl;
            }
        }

        statusText.innerHTML = "Flixa AI sedang menganalisis vokal & menyinkronkan ketukan...";
        
        let audioDurSec = 240; 
        const origPlayer = document.getElementById('originalAudioPlayer');
        if (origPlayer && isFinite(origPlayer.duration) && origPlayer.duration > 0) audioDurSec = origPlayer.duration;
        
        const response = await fetch('/api/habirmx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'sync_lyrics', audioUrl: finalAudioUrl, lyrics: originalLyrics, audioDuration: audioDurSec
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal sinkronisasi lirik.");

        let lrcText = "";
        if (data.isLrcString) {
            lrcText = data.result;
        } else {
            data.result.forEach(line => {
                let m = Math.floor(line.start / 60).toString().padStart(2, '0');
                let s = (line.start % 60).toFixed(2).padStart(5, '0'); 
                lrcText += `[${m}:${s}] ${line.text}\n`;
            });
        }

        inputEl.value = lrcText.trim();
        if(window.updateCounter) window.updateCounter('lyricsInput', 'lyricsCounter', 5000);
        if(window.showIphoneToast) window.showIphoneToast("Selesai", "Lirik berhasil disinkronkan dengan lagu!", "fa-stopwatch");

    } catch (err) {
        if(window.showIphoneToast) window.showIphoneToast("Sync Gagal", err.message, "fa-circle-xmark");
    } finally {
        inputEl.disabled = false; btn.disabled = false; btn.innerHTML = originalBtnHtml;
        progressBox.classList.add('hidden');
        if(window.checkLyricsState) window.checkLyricsState(); 
    }
};

window.submitRevisiAI = async function() {
    const instruction = document.getElementById('revisiInstructionInput').value.trim();
    if (!instruction) return;

    const type = document.getElementById('revisiTargetType').value;
    const inputEl = type === 'style' ? document.getElementById('styleInput') : document.getElementById('lyricsInput');
    const currentText = inputEl.value.trim();
    
    const llmProviderId = 'auto_pool';
    const llmModelId = 'auto_pool';

    const btn = document.getElementById('btnSubmitRevisi');
    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    const combinedPrompt = `TEKS ASLI:\n${currentText}\n\nINSTRUKSI REVISI DARI USER:\n${instruction}`;

    try {
        const response = await fetch('/api/habirmx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'magic_wand', providerId: llmProviderId, modelId: llmModelId,
                llmType: type === 'style' ? 'revise_style' : 'revise_lyrics', inputText: combinedPrompt
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal menghubungi AI");

        let finalResult = data.result.trim();
        
        inputEl.value = "";
        let i = 0;
        const chunkSize = 15; 
        function typeWriter() {
            if (i < finalResult.length) {
                inputEl.value += finalResult.substring(i, i + chunkSize);
                i += chunkSize;
                setTimeout(typeWriter, 1); 
            } else {
                btn.disabled = false; btn.innerHTML = originalBtnHtml;
                if(window.closeRevisiModal) window.closeRevisiModal();
                if(window.updateCounter) window.updateCounter(type === 'style' ? 'styleInput' : 'lyricsInput', type === 'style' ? 'styleCounter' : 'lyricsCounter', type === 'style' ? 1000 : 5000);
                if(window.showIphoneToast) window.showIphoneToast("Revisi Selesai", "Teks berhasil diperbarui sesuai instruksi Anda!", "fa-check-double");
            }
        }
        typeWriter();

    } catch (err) {
        btn.disabled = false; btn.innerHTML = originalBtnHtml;
        if(window.showIphoneToast) window.showIphoneToast("Gagal Revisi", err.message, "fa-triangle-exclamation");
    }
};

// ============================================================
// API: VOICE CLONING & PERSONA
// ============================================================
window.getValidationPhrase = async function() {
    const fileInput = document.getElementById('voiceSourceInput');
    const btn = document.getElementById('btnGetPhrase');
    
    if (!fileInput.files || fileInput.files.length === 0) {
        return window.showIphoneToast ? window.showIphoneToast("Error", "Silakan pilih Audio Sumber terlebih dahulu!", "fa-triangle-exclamation") : null;
    }

    const currentFile = fileInput.files[0];
    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;

    try {
        let voiceUrl = "";
        if (window.cachedSourceFile && window.cachedSourceFile.name === currentFile.name && window.cachedSourceFile.size === currentFile.size && window.cachedSourceUrl) {
            voiceUrl = window.cachedSourceUrl;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyiapkan Teks...';
        } else {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengunggah Audio...';
            voiceUrl = await window.uploadVoiceFileToCloudinary(currentFile);
            window.cachedSourceFile = currentFile;
            window.cachedSourceUrl = voiceUrl;
        }
        
        const response = await fetch('/api/habirmx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'generate_phrase', voiceUrl: voiceUrl, vocalStartS: 0, vocalEndS: 30 })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal menghubungi server API.");
        
        window.currentVoiceTaskId = data.taskId;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menunggu AI...';
        
        const pollInterval = setInterval(async () => {
            try {
                const pollRes = await fetch(`/api/habirmx?action=check_phrase&taskId=${window.currentVoiceTaskId}`);
                const pollData = await pollRes.json();
                
                if (pollData.status === 'wait_validating' || pollData.status === 'success') {
                    clearInterval(pollInterval);
                    document.getElementById('validationPhraseText').innerText = pollData.validateInfo;
                    document.getElementById('phraseContainer').classList.remove('hidden');
                    
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> Teks Berhasil Didapat';
                    btn.style.background = '#10b981'; btn.style.color = '#fff';
                    
                    if(window.showIphoneToast) window.showIphoneToast("Sukses", "Teks verifikasi berhasil didapatkan. Silakan rekam suara Anda membaca teks tersebut.", "fa-microphone");
                } else if (pollData.status === 'processing_validate_fail' || pollData.status === 'fail') {
                    clearInterval(pollInterval);
                    throw new Error(pollData.errorMessage || "Gagal memproses audio sumber.");
                }
            } catch (pollErr) {
                clearInterval(pollInterval);
                btn.disabled = false; btn.innerHTML = originalBtnHtml;
                if(window.showIphoneToast) window.showIphoneToast("Error", pollErr.message, "fa-triangle-exclamation");
            }
        }, 3000);

    } catch (err) {
        btn.disabled = false; btn.innerHTML = originalBtnHtml;
        if(window.showIphoneToast) window.showIphoneToast("Error", err.message, "fa-triangle-exclamation");
    }
};

window.submitVoiceCloning = async function() {
    const fileInput = document.getElementById('voiceValidationInput');
    const voiceName = document.getElementById('voiceNameInput').value.trim();
    const voiceDesc = document.getElementById('voiceDescInput').value.trim();
    const voiceStyle = document.getElementById('voiceStyleInput').value.trim();
    const btn = document.getElementById('btnSubmitVoice');

    if (!window.currentVoiceTaskId) return window.showIphoneToast ? window.showIphoneToast("Sesi Berakhir", "Silakan klik 'Dapatkan Teks Verifikasi' sekali lagi untuk menyegarkan sesi.", "fa-rotate-right") : null;
    if (!voiceName) return window.showIphoneToast ? window.showIphoneToast("Error", "Nama Karakter Suara wajib diisi!", "fa-triangle-exclamation") : null;

    const isUploadMode = !document.getElementById('cloneUploadArea').classList.contains('hidden');
    let finalValidationFile = null;

    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;

    try {
        let verifyUrl = "";

        if (isUploadMode) {
            if (!fileInput.files || fileInput.files.length === 0) {
                btn.disabled = false;
                return window.showIphoneToast ? window.showIphoneToast("Error", "Silakan unggah file Audio Verifikasi!", "fa-triangle-exclamation") : null;
            }
            const currentFile = fileInput.files[0];
            
            if (window.cachedVerifyBlob && window.cachedVerifyBlob.name === currentFile.name && window.cachedVerifyBlob.size === currentFile.size && window.cachedVerifyUrl) {
                verifyUrl = window.cachedVerifyUrl;
            } else {
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengunggah Verifikasi...';
                verifyUrl = await window.uploadVoiceFileToCloudinary(currentFile);
                window.cachedVerifyBlob = currentFile;
                window.cachedVerifyUrl = verifyUrl;
            }
        } else {
            if (!window.cloneRecordedBlob) {
                btn.disabled = false;
                return window.showIphoneToast ? window.showIphoneToast("Error", "Silakan rekam suara Anda membaca teks verifikasi!", "fa-triangle-exclamation") : null;
            }
            
            if (window.cachedVerifyBlob === window.cloneRecordedBlob && window.cachedVerifyUrl) {
                verifyUrl = window.cachedVerifyUrl;
            } else {
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengkonversi ke MP3...';
                const arrayBuffer = await window.cloneRecordedBlob.arrayBuffer();
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                const mp3Blob = await window.encodeAudioBufferToMp3(audioBuffer, () => {});
                
                finalValidationFile = new File([mp3Blob], `Verification_${Date.now()}.mp3`, { type: "audio/mp3" });
                
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengunggah Verifikasi...';
                verifyUrl = await window.uploadVoiceFileToCloudinary(finalValidationFile);
                
                window.cachedVerifyBlob = window.cloneRecordedBlob;
                window.cachedVerifyUrl = verifyUrl;
            }
        }

        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses Kloning...';
        
        const response = await fetch('/api/habirmx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'create_voice', taskId: window.currentVoiceTaskId, verifyUrl: verifyUrl,
                voiceName: voiceName, description: voiceDesc, style: voiceStyle
            })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal menghubungi server API.");
        
        const newTaskId = data.taskId;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI Sedang Bekerja...';
        
        const pollInterval = setInterval(async () => {
            try {
                const pollRes = await fetch(`/api/habirmx?action=check_voice&taskId=${newTaskId}`);
                const pollData = await pollRes.json();
                
                if (pollData.status === 'success') {
                    clearInterval(pollInterval);
                    const finalVoiceId = pollData.voiceId;
                    
                    document.getElementById('personaIdInput').value = finalVoiceId;
                    if(typeof window.saveVoiceToLibrary === 'function') window.saveVoiceToLibrary(voiceName, finalVoiceId, 'Kloning Voice');
                    
                    btn.disabled = false; btn.innerHTML = originalBtnHtml;
                    if(window.switchMode) window.switchMode('generate');
                    
                    const optParamsBody = document.getElementById('optionalParamsBody');
                    if (optParamsBody && optParamsBody.classList.contains('hidden')) {
                        if(window.toggleAccordion) window.toggleAccordion('optionalParamsBody');
                    }
                    
                    if(window.showIphoneToast) window.showIphoneToast("Kloning Sukses!", "Voice ID berhasil dibuat dan otomatis terisi di Optional Parameters.", "fa-wand-magic-sparkles");
                    
                } else if (pollData.status === 'processing_validate_fail' || pollData.status === 'fail') {
                    clearInterval(pollInterval);
                    throw new Error(pollData.errorMessage || "Gagal memverifikasi suara. Silakan rekam ulang dengan lebih jelas.");
                }
            } catch (pollErr) {
                clearInterval(pollInterval);
                btn.disabled = false; btn.innerHTML = originalBtnHtml;
                if(window.showIphoneToast) window.showIphoneToast("Gagal", pollErr.message, "fa-triangle-exclamation", 5000);
            }
        }, 3000);

    } catch (err) {
        btn.disabled = false; btn.innerHTML = originalBtnHtml;
        if(window.showIphoneToast) window.showIphoneToast("Error", err.message, "fa-triangle-exclamation", 5000);
    }
};

window.submitPersonaExtraction = async function() {
    const name = document.getElementById('personaNameInput').value.trim();
    const taskId = document.getElementById('personaTaskIdInput').value.trim();
    const audioId = document.getElementById('personaAudioIdInput').value.trim();
    const startS = document.getElementById('personaStartInput').value;
    const endS = document.getElementById('personaEndInput').value;
    const desc = document.getElementById('personaDescInput').value.trim();
    const btn = document.getElementById('btnSubmitPersona');

    if (!name || !taskId || !audioId) {
        return window.showIphoneToast ? window.showIphoneToast("Error", "Nama, Task ID, dan Audio ID wajib diisi!", "fa-triangle-exclamation") : null;
    }

    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengekstrak Persona...';

    try {
        const response = await fetch('/api/habirmx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'create_persona', taskId: taskId, audioId: audioId, name: name,
                description: desc || "Extracted Persona", vocalStart: parseFloat(startS) || 0, vocalEnd: parseFloat(endS) || 30
            })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal menghubungi server API.");
        
        document.getElementById('personaIdInput').value = data.personaId;
        if(typeof window.saveVoiceToLibrary === 'function') window.saveVoiceToLibrary(name, data.personaId, 'Persona');
        
        btn.disabled = false; btn.innerHTML = originalBtnHtml;
        if(window.switchMode) window.switchMode('generate');
        
        const optParamsBody = document.getElementById('optionalParamsBody');
        if (optParamsBody && optParamsBody.classList.contains('hidden')) {
            if(window.toggleAccordion) window.toggleAccordion('optionalParamsBody');
        }
        
        if(window.showIphoneToast) window.showIphoneToast("Ekstrak Sukses!", "Persona ID berhasil dibuat dan otomatis terisi di Optional Parameters.", "fa-user-astronaut");

    } catch (err) {
        btn.disabled = false; btn.innerHTML = originalBtnHtml;
        if(window.showIphoneToast) window.showIphoneToast("Error", err.message, "fa-triangle-exclamation");
    }
};