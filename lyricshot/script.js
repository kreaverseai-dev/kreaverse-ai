// lyricshot/script.js
async function generateStoryboard() {
    const lyrics = document.getElementById('lyricsInput').value;
    const style = document.getElementById('visualStyle').value;
    const generateBtn = document.getElementById('generateBtn');
    const loading = document.getElementById('loading');
    const resultContainer = document.getElementById('resultContainer');
    const storyboardGrid = document.getElementById('storyboardGrid');

    if (!lyrics.trim()) {
        alert("Harap masukkan lirik lagu terlebih dahulu.");
        return;
    }

    // Tampilkan Loading
    generateBtn.disabled = true;
    loading.classList.remove('hidden');
    resultContainer.classList.add('hidden');
    storyboardGrid.innerHTML = '';

    try {
        const response = await fetch('/api/lyricshot', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ lyrics, style })
        });

        const data = await response.json();

        if (response.ok) {
            // Render storyboard adegan ke UI
            // Jika AI mengembalikan objek berbungkus, sesuaikan pembacaan array-nya
            const scenes = Array.isArray(data) ? data : (data.storyboard || data.scenes || []);
            
            scenes.forEach(item => {
                const card = document.createElement('div');
                card.className = 'storyboard-card';
                card.innerHTML = `
                    <div class="card-header">
                        <span class="scene-badge">Scene ${item.scene}</span>
                        <span class="shot-type">${item.shot_type}</span>
                    </div>
                    <div class="card-body">
                        <p class="lyrics-quote">"<em>${item.lyrics_segment}</em>"</p>
                        <p class="description"><strong>Visual:</strong> ${item.visual_description}</p>
                        <hr>
                        <div class="prompt-box">
                            <strong>Image Prompt:</strong>
                            <p class="prompt-text">${item.image_prompt}</p>
                        </div>
                        <div class="prompt-box">
                            <strong>Video Prompt:</strong>
                            <p class="prompt-text">${item.video_prompt}</p>
                        </div>
                    </div>
                `;
                storyboardGrid.appendChild(card);
            });

            resultContainer.classList.remove('hidden');
        } else {
            alert("Terjadi kesalahan: " + (data.error || "Gagal memproses data"));
        }
    } catch (err) {
        console.error(err);
        alert("Terjadi kendala koneksi.");
    } finally {
        generateBtn.disabled = false;
        loading.classList.add('hidden');
    }
}