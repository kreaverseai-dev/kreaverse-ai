document.addEventListener('DOMContentLoaded', () => {
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('file-input');
    const previewContainer = document.getElementById('preview-container');
    const fileNameDisplay = document.getElementById('file-name-display');
    const uploadBtn = document.getElementById('upload-btn');
    const resultContainer = document.getElementById('result-container');

    let selectedFile = null;
    let base64File = null;

    // 1. Membuka dialog file saat drop-area diklik
    dropArea.addEventListener('click', () => {
        fileInput.click();
    });

    // 2. Drag & Drop Event Listeners
    dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.classList.add('dragover');
    });

    dropArea.addEventListener('dragleave', () => {
        dropArea.classList.remove('dragover');
    });

    dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropArea.classList.remove('dragover');
        
        if (e.dataTransfer.files.length > 0) {
            prosesFile(e.dataTransfer.files[0]);
        }
    });

    // 3. File Input Change Listener
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            prosesFile(e.target.files[0]);
        }
    });

    // 4. Validasi & Konversi File ke Base64
    function prosesFile(file) {
        // Validasi Ukuran (Maks 10MB)
        const maxSize = 10 * 1024 * 1024; // 10MB dalam bytes
        if (file.size > maxSize) {
            Swal.fire({
                title: 'File Terlalu Besar',
                text: 'Maksimal ukuran file adalah 10MB. Silakan pilih file yang lebih kecil.',
                icon: 'warning',
                confirmButtonColor: '#D97757',
                background: document.documentElement.getAttribute('data-theme') === 'dark' ? '#242424' : '#FFF',
                color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#E5E5E5' : '#1F1F1F'
            });
            return;
        }

        selectedFile = file;
        fileNameDisplay.textContent = file.name;
        
        // Tampilkan tombol upload dan sembunyikan hasil sebelumnya
        previewContainer.classList.remove('hidden');
        resultContainer.classList.add('hidden');

        // Mengonversi file ke Base64 agar bisa dikirim melalui JSON (Sesuai dokumentasi Cloudinary)
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = () => {
            base64File = reader.result;
        };
    }

    // 5. Proses Unggah (Fetch ke Vercel Serverless Function)
    uploadBtn.addEventListener('click', async () => {
        if (!base64File) return;

        // Ubah state tombol menjadi loading
        const originalBtnText = uploadBtn.innerHTML;
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengunggah ke Cloud...';

        try {
            const response = await fetch('/api/cloudinary', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fileBase64: base64File })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Gagal mengunggah file. Coba lagi nanti.');
            }

            // Tampilkan hasil sukses
            tampilkanHasil(data.url);

        } catch (error) {
            Swal.fire({
                title: 'Upload Gagal',
                text: error.message,
                icon: 'error',
                confirmButtonColor: '#D97757',
                background: document.documentElement.getAttribute('data-theme') === 'dark' ? '#242424' : '#FFF',
                color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#E5E5E5' : '#1F1F1F'
            });
        } finally {
            // Kembalikan state tombol
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = originalBtnText;
            
            // Reset input file agar bisa memilih file yang sama lagi jika dibutuhkan
            fileInput.value = ''; 
        }
    });

    // 6. Menampilkan Hasil & Fitur Copy URL
    function tampilkanHasil(url) {
        resultContainer.innerHTML = `
            <div style="font-size: 2.5rem; color: #4CAF50; margin-bottom: 12px;">
                <i class="fa-solid fa-circle-check"></i>
            </div>
            <div style="font-weight: 600; font-size: 1.2rem; margin-bottom: 8px;">Berhasil Diunggah!</div>
            <div style="font-size: 0.9rem; color: var(--text-secondary);">File Anda telah tersimpan dengan aman.</div>
            
            <div class="result-input-group">
                <input type="text" id="result-url" value="${url}" readonly>
                <button id="copy-url-btn" class="copy-btn" aria-label="Copy URL">
                    <i class="fa-regular fa-copy"></i>
                </button>
            </div>
        `;
        
        resultContainer.classList.remove('hidden');
        previewContainer.classList.add('hidden'); // Sembunyikan tombol upload setelah berhasil

        // Event Listener untuk tombol Copy
        document.getElementById('copy-url-btn').addEventListener('click', () => {
            const urlInput = document.getElementById('result-url');
            navigator.clipboard.writeText(urlInput.value).then(() => {
                const btn = document.getElementById('copy-url-btn');
                btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                
                Swal.fire({
                    title: 'Tersalin!',
                    text: 'Tautan file telah disalin ke clipboard.',
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false,
                    background: document.documentElement.getAttribute('data-theme') === 'dark' ? '#242424' : '#FFF',
                    color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#E5E5E5' : '#1F1F1F'
                });

                setTimeout(() => {
                    btn.innerHTML = '<i class="fa-regular fa-copy"></i>';
                }, 2000);
            });
        });
    }
});
