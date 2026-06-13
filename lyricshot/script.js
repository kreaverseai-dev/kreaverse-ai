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
    durationDisplay.innerHTML = `📊 <strong>Informasi Video Musik:</strong> Terdeteksi ${lines.length} baris lirik. Total durasi video otomatis disesuaikan menjadi <strong>${totalDuration} detik</strong> (${lines.length} klip video x 10 detik).`;
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
    if (file.type && file.type.startsWith('image/')) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const maxW = 1024;
                    const maxH = 1024;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxW) {
                            height = Math.round((height * maxW) / width);
                            width = maxW;
                        }
                    } else {
                        if (height > maxH) {
                            width = Math.round((width * maxH) / height);
                            height = maxH;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                };
                img.onerror = () => {
                    const rawReader = new FileReader();
                    rawReader.readAsDataURL(file);
                    rawReader.onload = () => resolve(rawReader.result);
                    rawReader.onerror = () => resolve(null);
                };
            };
            reader.onerror = () => resolve(null);
        });
    }
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
        const providerNaskahSelect = document.getElementById('providerNaskahSelect');
        const providerSelect = document.getElementById('providerSelect');

        if (providerNaskahSelect.selectedIndex === -1) {
            alert("Harap pilih Provider AI (Naskah/Lirik) terlebih dahulu.");
            generateBtn.disabled = false;
            loading.classList.add('hidden');
            return;
        }
        if (providerSelect.selectedIndex === -1) {
            alert("Harap pilih Provider AI (Video) terlebih dahulu.");
            generateBtn.disabled = false;
            loading.classList.add('hidden');
            return;
        }

        const providerNaskahId = providerNaskahSelect.value;
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

        let data = {};
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            data = await response.json();
        } else {
            const rawText = await response.text();
            if (rawText.includes("504") || response.status === 504) {
                throw new Error("Timeout Server Vercel (Proses pembuatan storyboard/video memakan waktu terlalu lama).");
            } else if (rawText.includes("413") || response.status === 413) {
                throw new Error("Berkas terlalu besar, mohon gunakan gambar dengan resolusi yang lebih rendah.");
            } else {
                throw new Error(`Sistem Error (${response.status})`);
            }
        }

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

function startStatusPolling() {
    const loaders = document.querySelectorAll('.video-loader');
    loaders.forEach(loader => {
        const taskId = loader.getAttribute('data-task-id');
        const provider = loader.getAttribute('data-provider');
        const scene = loader.getAttribute('data-scene');
        if (!taskId) return;

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/check-status?taskId=${taskId}&provider=${provider}`);
                const data = await res.json();
                
                if (res.ok && data.status === "complete" && data.video_url) {
                    clearInterval(interval);
                    // Pasang pemutar video asli
                    const videoBox = document.getElementById(`video-box-${scene}`);
                    videoBox.innerHTML = `<video controls autoplay loop src="${data.video_url}"></video>`;
                    
                    // Aktifkan tombol unduh asli
                    const downloadBtn = document.getElementById(`download-btn-${scene}`);
                    downloadBtn.href = data.video_url;
                    downloadBtn.classList.remove('hidden');
                } else if (data.status === "failed") {
                    clearInterval(interval);
                    loader.innerHTML = "❌ Gagal merender adegan ini.";
                }
            } catch (err) {
                console.error("Polling error:", err);
            }
        }, 5000); // Tanyakan status ke server setiap 5 detik
    });
}