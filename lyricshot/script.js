let activeProviders = [];

document.addEventListener('DOMContentLoaded', async () => {
    const providerSelect = document.getElementById('providerSelect');
    try {
        const res = await fetch('/api/providers');
        const data = await res.json();
        if (res.ok && data.length > 0) {
            activeProviders = data;
            providerSelect.innerHTML = '';
            data.forEach(p => {
                if (p.name.toLowerCase().includes('magic') || p.name.toLowerCase().includes('leonardo')) {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    providerSelect.appendChild(opt);
                }
            });
            toggleUploadFields();
        } else {
            providerSelect.innerHTML = '<option value="">Gagal memuat provider video</option>';
        }
    } catch (err) {
        console.error(err);
        providerSelect.innerHTML = '<option value="">Koneksi API Error</option>';
    }
});

function calculateDuration() {
    const lyrics = document.getElementById('lyricsInput').value.trim();
    const durationDisplay = document.getElementById('durationDisplay');
    if (!lyrics) {
        durationDisplay.classList.add('hidden');
        return;
    }
    const lines = lyrics.split('\n').filter(line => line.trim().length > 0);
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
        const payload = {
            lyrics,
            providerId,
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
                card.innerHTML = `
                    <div class="card-header">
                        <span class="scene-badge">Klip ${item.scene}</span>
                        <span class="shot-type">${item.shot_type || 'Cinematic'}</span>
                    </div>
                    <div class="card-body">
                        <p class="lyrics-quote">"<em>${item.lyrics_segment}</em>"</p>
                        <p class="description"><strong>Visual:</strong> ${item.visual_description}</p>
                        <hr>
                        <div class="video-box">
                            <video controls preload="metadata" src="${item.video_url || ''}"></video>
                        </div>
                        <a href="${item.video_url || '#'}" target="_blank" download="Klip-${item.scene}.mp4" class="download-btn">Unduh Klip ${item.scene}</a>
                    </div>
                `;
                storyboardGrid.appendChild(card);
            });
            resultContainer.classList.remove('hidden');
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