let activeProviders = [];

document.addEventListener('DOMContentLoaded', async () => {
    const providerNaskahSelect = document.getElementById('providerNaskahSelect');
    const providerSelect = document.getElementById('providerSelect');
    try {
        const res = await fetch('/api/providers');
        const data = await res.json();
        if (res.ok && data.length > 0) {
            activeProviders = data;
            providerNaskahSelect.innerHTML = '';
            providerSelect.innerHTML = '';
            data.forEach(p => {
                const nameLower = p.name.toLowerCase();
                if (nameLower.includes('gemini') || nameLower.includes('openrouter')) {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    providerNaskahSelect.appendChild(opt);
                } else if (nameLower.includes('magic') || nameLower.includes('leonardo')) {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    providerSelect.appendChild(opt);
                }
            });
            updateNaskahModels();
            updateVideoModels();
            toggleUploadFields();
        } else {
            providerSelect.innerHTML = '<option value="">Gagal memuat provider</option>';
        }
    } catch (err) {
        console.error(err);
        providerSelect.innerHTML = '<option value="">Koneksi API Error</option>';
    }
});

function updateNaskahModels() {
    const providerSelect = document.getElementById('providerNaskahSelect');
    const modelSelect = document.getElementById('modelNaskahSelect');
    const selectedId = providerSelect.value;
    modelSelect.innerHTML = '';
    const p = activeProviders.find(item => item.id === selectedId);
    if (p && p.models.length > 0) {
        p.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        });
    }
}

function updateVideoModels() {
    const providerSelect = document.getElementById('providerSelect');
    const modelSelect = document.getElementById('modelVideoSelect');
    const selectedId = providerSelect.value;
    modelSelect.innerHTML = '';
    const p = activeProviders.find(item => item.id === selectedId);
    if (p && p.models.length > 0) {
        p.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        });
    }
}

function calculateDuration() {
    const lyrics = document.getElementById('lyricsInput').value.trim();
    const durationDisplay = document.getElementById('durationDisplay');
    if (!lyrics) {
        durationDisplay.classList.add('hidden');
        return;
    }
    const lines = lyrics.split(/(?:\r?\n|(?<=[a-z\.\s])(?=[A-Z])|(?=\([A-Za-z]))/g)
                        .map(line => line.trim())
                        .filter(line => line.length > 0);
    const totalDuration = lines.length * 10;
    durationDisplay.classList.remove('hidden');
    durationDisplay.innerHTML = `ÃÂ°ÃÂÃÂÃÂ <strong>Informasi Video Musik:</strong> Terdeteksi ${lines.length} baris lirik. Total durasi video otomatis disesuaikan menjadi <strong>${totalDuration} detik</strong> (${lines.length} klip video x 10 detik).`;
}

function toggleUploadFields() {
    const providerSelect = document.getElementById('providerSelect');
    const magicHourUploads = document.getElementById('magicHourUploads');
    const leonardoUploads = document.getElementById('leonardoUploads');
    
    if (providerSelect.selectedIndex === -1) return;
    const providerName = providerSelect.options[providerSelect.selectedIndex].text.toLowerCase();

    if (providerName.includes('magic')) {
        magicHourUploads.classList.remove('hidden');
        leonardoUploads.classList.add('hidden');
    } else if (providerName.includes('leonardo')) {
        leonardoUploads.classList.remove('hidden');
        magicHourUploads.classList.add('hidden');
    } else {
        magicHourUploads.classList.add('hidden');
        leonardoUploads.classList.add('hidden');
    }
}

async function getBase64(file) {
    if (!file) return null;
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

async function generateStoryboard() {
    const lyrics = document.getElementById('lyricsInput').value;
    const providerId = document.getElementById('providerSelect').value;
    const ratio = document.getElementById('ratioSelect').value;
    const generateBtn = document.getElementById('generateBtn');
    const loading = document.getElementById('loading');
    const resultContainer = document.getElementById('resultContainer');
    const storyboardGrid = document.getElementById('storyboardGrid');

    if (!lyrics.trim()) {
        alert("Harap masukkan lirik lagu terlebih dahulu.");
        return;
    }

    generateBtn.disabled = true;
    loading.classList.remove('hidden');
    resultContainer.classList.add('hidden');
    storyboardGrid.innerHTML = '';

    try {
        const providerNaskahId = document.getElementById('providerNaskahSelect').value;
        const modelNaskah = document.getElementById('modelNaskahSelect').value;
        const modelVideo = document.getElementById('modelVideoSelect').value;
        const payload = {
            lyrics,
            providerId,
            providerNaskahId,
            modelNaskah,
            modelVideo,
            ratio,
            style: "Cinematic Moody",
            faceImage: null,
            hijabImage: null,
            bajuImage: null,
            sepatuImage: null,
            aksesorisImage: null,
            fullModelImage: null
        };

        const providerSelect = document.getElementById('providerSelect');
        const providerName = providerSelect.options[providerSelect.selectedIndex].text.toLowerCase();

        if (providerName.includes('magic')) {
            payload.faceImage = await getBase64(document.getElementById('faceInput').files[0]);
            payload.hijabImage = await getBase64(document.getElementById('hijabInput').files[0]);
            payload.bajuImage = await getBase64(document.getElementById('bajuInput').files[0]);
            payload.sepatuImage = await getBase64(document.getElementById('sepatuInput').files[0]);
            payload.aksesorisImage = await getBase64(document.getElementById('aksesorisInput').files[0]);
        } else if (providerName.includes('leonardo')) {
            payload.fullModelImage = await getBase64(document.getElementById('fullModelInput').files[0]);
        }

        const response = await fetch('/api/lyricshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            const scenes = Array.isArray(data) ? data : [];
            scenes.forEach(item => {
                const card = document.createElement('div');
                card.className = 'storyboard-card';
                
                let mediaElement = "";
                let downloadClass = "download-btn";
                
                if (item.status === "pending" && item.task_id) {
                    mediaElement = `<div class="video-loader" id="loader-${item.scene}" data-scene="${item.scene}" data-task-id="${item.task_id}" data-provider="${item.provider}" style="padding: 40px; text-align: center; color: var(--accent-purple); font-size: 0.9rem; font-weight: 500;">⏳ Sedang merender adegan... (30-60 detik)</div>`;
                    downloadClass += " hidden";
                } else {
                    mediaElement = `<video controls preload="metadata" src="${item.video_url || 'https://res.cloudinary.com/demo/video/upload/dog.mp4'}"></video>`;
                }

                card.innerHTML = `
                    <div class="card-header">
                        <span class="scene-badge">Klip ${item.scene}</span>
                        <span class="shot-type">${item.shot_type || 'Cinematic'}</span>
                    </div>
                    <div class="card-body">
                        <p class="lyrics-quote">"<em>${item.lyrics_segment}</em>"</p>
                        <p class="description"><strong>Visual:</strong> ${item.visual_description}</p>
                        <hr>
                        <div class="video-box" id="video-box-${item.scene}">
                            ${mediaElement}
                        </div>
                        <a href="${item.video_url || '#'}" target="_blank" download="Klip-${item.scene}.mp4" id="download-btn-${item.scene}" class="${downloadClass}">Unduh Klip ${item.scene}</a>
                    </div>
                `;
                storyboardGrid.appendChild(card);
            });
            resultContainer.classList.remove('hidden');
            
            // Mulai sistem pemantauan latar belakang (Polling)
            startStatusPolling();
        } else {
            alert("Gagal memproses: " + (data.error || "Terjadi kesalahan sistem. Silakan coba kembali."));
        }
    } catch (err) {
        console.error(err);
        alert("Koneksi gagal terhubung dengan server.");
    } finally {
        generateBtn.disabled = false;
        loading.classList.add('hidden');
    }
}