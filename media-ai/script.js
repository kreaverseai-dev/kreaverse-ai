document.addEventListener('DOMContentLoaded', () => {
    const providerSelect = document.getElementById('provider-select');
    const modelSelect = document.getElementById('model-select');
    const promptInput = document.getElementById('prompt-input');
    const generateBtn = document.getElementById('generate-btn');
    
    const resultContainer = document.getElementById('result-container');
    const resultStatus = document.getElementById('result-status');
    const resultContent = document.getElementById('result-content');

    // Database Model sesuai spesifikasi dokumentasi
    const apiData = {
        apiframe: {
            name: "APIFrame",
            proxyRoute: "/api/apiframe",
            models: [
                { id: "midjourney", name: "Midjourney (Image)", endpoint: "/images/generate", type: "image" },
                { id: "nano-banana", name: "Nano Banana (Image)", endpoint: "/images/generate", type: "image" },
                { id: "sora", name: "Sora (Video)", endpoint: "/videos/generate", type: "video" },
                { id: "veo-3.1", name: "Veo 3.1 (Video)", endpoint: "/videos/generate", type: "video" },
                { id: "kling", name: "Kling (Video)", endpoint: "/videos/generate", type: "video" },
                { id: "hailuo-2.3", name: "Hailuo 2.3 (Video)", endpoint: "/videos/generate", type: "video" },
                { id: "suno", name: "Suno Horeg/DJ (Music)", endpoint: "/music/generate", type: "audio" }
            ]
        },
        crun: {
            name: "Crun AI",
            proxyRoute: "/api/crun",
            models: [
                { id: "suno-v5.5", name: "Suno AI v5.5 (Audio)", endpoint: "/audio/generations", type: "audio" },
                { id: "suno-v6", name: "Suno AI v6 (Audio)", endpoint: "/audio/generations", type: "audio" },
                { id: "text-to-image", name: "Image Generation", endpoint: "/images/generations", type: "image" }
            ]
        },
        musicapi: {
            name: "MusicAPI",
            proxyRoute: "/api/musicapi",
            models: [
                { id: "sonic", name: "Sonic (Vocal, Remix, Stems)", endpoint: "/api/v1/sonic/create", type: "audio" },
                { id: "producer", name: "Producer (Studio Quality)", endpoint: "/api/v1/producer/create", type: "audio" },
                { id: "nuro", name: "Nuro (High-Efficiency)", endpoint: "/api/v1/nuro/create", type: "audio" }
            ]
        }
    };

    // 1. Event Listener Saat Provider Dipilih
    providerSelect.addEventListener('change', (e) => {
        const providerKey = e.target.value;
        const selectedProvider = apiData[providerKey];

        // Reset dropdown model
        modelSelect.innerHTML = '<option value="" disabled selected>-- Pilih Model AI --</option>';
        
        if (selectedProvider) {
            selectedProvider.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.name;
                // Simpan data tambahan di dataset
                option.dataset.endpoint = model.endpoint;
                option.dataset.type = model.type;
                modelSelect.appendChild(option);
            });
            modelSelect.disabled = false;
        } else {
            modelSelect.disabled = true;
        }
        
        // Disable prompt & button until model is selected
        promptInput.disabled = true;
        generateBtn.disabled = true;
    });

    // 2. Event Listener Saat Model Dipilih
    modelSelect.addEventListener('change', () => {
        if (modelSelect.value) {
            promptInput.disabled = false;
            generateBtn.disabled = false;
            promptInput.focus();
        }
    });

    // 3. Eksekusi Tombol Generate
    generateBtn.addEventListener('click', async () => {
        const providerKey = providerSelect.value;
        const modelId = modelSelect.value;
        const promptText = promptInput.value.trim();
        
        const selectedOption = modelSelect.options[modelSelect.selectedIndex];
        const endpoint = selectedOption.dataset.endpoint;
        const mediaType = selectedOption.dataset.type;
        const proxyRoute = apiData[providerKey].proxyRoute;

        if (!promptText) {
            Swal.fire({
                title: 'Prompt Kosong',
                text: 'Silakan masukkan deskripsi/prompt terlebih dahulu.',
                icon: 'warning',
                confirmButtonColor: '#D97757',
                background: document.documentElement.getAttribute('data-theme') === 'dark' ? '#242424' : '#FFF',
                color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#E5E5E5' : '#1F1F1F'
            });
            return;
        }

        // Susun Payload (Disesuaikan secara umum, dokumentasi aslinya mungkin butuh format spesifik)
        let payload = {
            model: modelId,
            prompt: promptText
        };

        // Loading State
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
        
        resultContainer.classList.remove('hidden');
        resultContent.innerHTML = '<div style="color: var(--text-secondary);"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p style="margin-top:10px;">AI sedang bekerja, ini bisa memakan waktu beberapa menit...</p></div>';
        resultStatus.className = 'status-badge processing';
        resultStatus.textContent = 'Memproses...';

        try {
            const response = await fetch(proxyRoute, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint, payload })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Terjadi kesalahan dari server AI.');
            }

            // Parsing URL Media (Mencari URL hasil render di response JSON)
            // Karena tiap API punya struktur balasan berbeda, kita buat logic pencarian generik
            const mediaUrl = extractMediaUrl(data);

            if (mediaUrl) {
                renderMedia(mediaUrl, mediaType);
            } else {
                // Jika API menggunakan sistem Task/Queue asinkron (Butuh polling)
                throw new Error('Permintaan diterima, namun API membutuhkan waktu/polling untuk menyelesaikan (Task ID diterima). Fitur Polling sedang dalam pengembangan.');
            }

        } catch (error) {
            resultStatus.className = 'status-badge error';
            resultStatus.textContent = 'Gagal';
            resultContent.innerHTML = `<div style="color: #F44336; text-align: center;"><i class="fa-solid fa-triangle-exclamation fa-2x"></i><p style="margin-top:10px;">${error.message}</p></div>`;
            
            Swal.fire({
                title: 'Gagal Generate',
                text: error.message,
                icon: 'error',
                confirmButtonColor: '#D97757',
                background: document.documentElement.getAttribute('data-theme') === 'dark' ? '#242424' : '#FFF',
                color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#E5E5E5' : '#1F1F1F'
            });
        } finally {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Sekarang';
        }
    });

    // Fungsi ekstraksi URL hasil dari berbagai format JSON balasan API
    function extractMediaUrl(data) {
        if (typeof data === 'string' && data.startsWith('http')) return data;
        if (data.url) return data.url;
        if (data.audio_url) return data.audio_url;
        if (data.video_url) return data.video_url;
        if (data.image_url) return data.image_url;
        if (data.data && Array.isArray(data.data) && data.data[0].url) return data.data[0].url;
        if (data.result && data.result.url) return data.result.url;
        return null; // Jika null, berarti balasan berupa Task ID (Asynchronous queue)
    }

    // Fungsi Render Output ke Layar
    function renderMedia(url, type) {
        resultStatus.className = 'status-badge success';
        resultStatus.textContent = 'Selesai';

        if (type === 'image') {
            resultContent.innerHTML = `<img src="${url}" alt="AI Generated Image" style="max-width:100%; border-radius:8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">`;
        } else if (type === 'video') {
            resultContent.innerHTML = `<video src="${url}" controls autoplay loop style="max-width:100%; border-radius:8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);"></video>`;
        } else if (type === 'audio') {
            resultContent.innerHTML = `
                <div style="width:100%; max-width: 400px; text-align:center;">
                    <i class="fa-solid fa-music fa-3x" style="color:var(--accent-color); margin-bottom:15px;"></i>
                    <audio src="${url}" controls style="width:100%; outline:none;"></audio>
                </div>`;
        }
    }
});
