// ============================================================
// UI CONTROLLER: TOAST, MODALS, & SIDEBAR
// ============================================================

window.showIphoneToast = function(title, desc, iconClass = "fa-bell", duration = 4000) {
    const toast = document.getElementById('iphone-toast');
    if(!toast) return;
    document.getElementById('iphone-toast-icon').innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    document.getElementById('iphone-toast-title').innerText = title;
    document.getElementById('iphone-toast-desc').innerText = desc;
    
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, duration);
};

window.openSidebar = function() {
    document.getElementById('sidebarMenu').classList.add('show');
    document.getElementById('sidebarOverlay').classList.add('show');
    document.body.style.overflow = 'hidden'; 
};

window.closeSidebar = function() {
    document.getElementById('sidebarMenu').classList.remove('show');
    document.getElementById('sidebarOverlay').classList.remove('show');
    document.body.style.overflow = 'auto'; 
};

// ============================================================
// UI CONTROLLER: MODE SWITCHER (GENERATE, COVER, VOICE)
// ============================================================
window.switchMode = function(mode) {
    const btnGenerate = document.getElementById('modeGenerateBtn');
    const btnCover = document.getElementById('modeCoverBtn');
    const btnVoice = document.getElementById('modeVoiceBtn');
    const uploadSection = document.getElementById('uploadSectionWrapper');
    const voiceSection = document.getElementById('voiceModeWrapper');
    const modeDesc = document.getElementById('modeDescription');
    
    const customModeToggle = document.getElementById('customModeToggle')?.closest('.toggle-container');
    const customModeHelper = customModeToggle?.nextElementSibling;
    const styleWrapper = document.getElementById('styleInput')?.closest('.input-group');
    const instrumentalToggle = document.getElementById('instrumentalToggle')?.closest('.toggle-container');
    const instrumentalHelper = instrumentalToggle?.nextElementSibling;
    const optParamsWrapper = document.getElementById('optionalParametersWrapper');
    const generateBtn = document.getElementById('generateBtn');
    const benefitDesc = generateBtn?.nextElementSibling;
    
    const btnAudioToStyle = document.getElementById('btnAudioToStyle');
    const selectLangContainer = document.getElementById('langDropdownContainer');
    const btnSyncDetect = document.getElementById('btnSyncDetect');
    const btnFlixaPresets = document.getElementById('btnFlixaPresets');

    const btnStyleAI = document.querySelector("button[onclick*=\"triggerMagicWand('style')\"]");
    const btnLyricsAI = document.querySelector("button[onclick*=\"triggerMagicWand('lyrics')\"]");

    localStorage.setItem('kreaverse_last_mode', mode);

    if(btnGenerate) btnGenerate.classList.remove('active');
    if(btnCover) btnCover.classList.remove('active');
    if(btnVoice) btnVoice.classList.remove('active');

    if (mode === 'generate') {
        if(btnGenerate) btnGenerate.classList.add('active');
        if(uploadSection) uploadSection.classList.add('hidden');
        if(voiceSection) voiceSection.classList.add('hidden');
        
        if(btnAudioToStyle) btnAudioToStyle.style.display = 'none';
        if(selectLangContainer) selectLangContainer.style.display = 'none';
        if(btnSyncDetect) btnSyncDetect.style.display = 'none';
        if(btnFlixaPresets) btnFlixaPresets.style.display = 'none';
        
        if(btnStyleAI) btnStyleAI.style.display = 'flex';
        if(btnLyricsAI) btnLyricsAI.style.display = 'flex';
        
        window.selectedAudioUrl = ""; 
        if(modeDesc) modeDesc.innerText = "Buat lagu baru dari awal menggunakan lirik dan gaya musik Anda sendiri.";
        
        if(customModeToggle) customModeToggle.style.display = 'flex';
        if(customModeHelper) customModeHelper.style.display = 'block';
        if(styleWrapper) styleWrapper.style.display = 'flex';
        if(instrumentalToggle) instrumentalToggle.style.display = 'flex';
        if(instrumentalHelper) instrumentalHelper.style.display = 'block';
        if(optParamsWrapper) optParamsWrapper.style.display = 'block';
        if(generateBtn) generateBtn.style.display = 'flex';
        if(benefitDesc) benefitDesc.style.display = 'flex';
        window.toggleCustomFields(); 
        
    } else if (mode === 'cover') {
        if(btnCover) btnCover.classList.add('active');
        if(uploadSection) uploadSection.classList.remove('hidden');
        if(voiceSection) voiceSection.classList.add('hidden');
        
        if (document.getElementById('llmSelect') && document.getElementById('llmSelect').value !== 'auto_pool') {
            window.selectLlmOption('auto_pool', 'auto_pool', 'Flixa AI Chat (Auto)');
            window.showIphoneToast("Info AI", "Chat AI dialihkan ke mode Auto agar dapat mendengarkan audio referensi Anda.", "fa-brain");
        }
        
        if(btnAudioToStyle) btnAudioToStyle.style.display = 'flex';
        if(selectLangContainer) selectLangContainer.style.display = 'flex';
        if(btnSyncDetect) btnSyncDetect.style.display = 'flex';
        if(btnFlixaPresets) btnFlixaPresets.style.display = 'flex';
        
        if(btnStyleAI) btnStyleAI.style.display = 'none';
        if(btnLyricsAI) btnLyricsAI.style.display = 'none';
        
        if(modeDesc) modeDesc.innerText = "Unggah audio referensi (maks 8 menit). AI akan mengubah gaya musiknya sesuai prompt Anda.";
        
        if(customModeToggle) customModeToggle.style.display = 'flex';
        if(customModeHelper) customModeHelper.style.display = 'block';
        if(styleWrapper) styleWrapper.style.display = 'flex';
        if(instrumentalToggle) instrumentalToggle.style.display = 'flex';
        if(instrumentalHelper) instrumentalHelper.style.display = 'block';
        if(optParamsWrapper) optParamsWrapper.style.display = 'block';
        if(generateBtn) generateBtn.style.display = 'flex';
        if(benefitDesc) benefitDesc.style.display = 'flex';
        window.toggleCustomFields();
        
    } else if (mode === 'voice') {
        if(btnVoice) btnVoice.classList.add('active');
        if(uploadSection) uploadSection.classList.add('hidden');
        if(voiceSection) voiceSection.classList.remove('hidden');
        
        if(btnAudioToStyle) btnAudioToStyle.style.display = 'none';
        if(selectLangContainer) selectLangContainer.style.display = 'none';
        if(btnSyncDetect) btnSyncDetect.style.display = 'none';
        if(btnFlixaPresets) btnFlixaPresets.style.display = 'none';
        
        if(modeDesc) modeDesc.innerText = "Kloning suara Anda sendiri atau ekstrak karakter vokal dari lagu AI sebelumnya.";
        
        if(customModeToggle) customModeToggle.style.display = 'none';
        if(customModeHelper) customModeHelper.style.display = 'none';
        const titleWrapper = document.getElementById('titleFieldWrapper');
        if(titleWrapper) titleWrapper.classList.add('hidden');
        if(styleWrapper) styleWrapper.style.display = 'none';
        if(instrumentalToggle) instrumentalToggle.style.display = 'none';
        if(instrumentalHelper) instrumentalHelper.style.display = 'none';
        const lyricsWrapper = document.getElementById('lyricsFieldWrapper');
        if(lyricsWrapper) lyricsWrapper.classList.add('hidden');
        if(optParamsWrapper) optParamsWrapper.style.display = 'none';
        if(generateBtn) generateBtn.style.display = 'none';
        if(benefitDesc) benefitDesc.style.display = 'none';
    }
    
    if(typeof window.checkLyricsState === 'function') window.checkLyricsState();
};

window.toggleCustomFields = function() {
    const isCustom = document.getElementById('customModeToggle')?.checked;
    const titleWrapper = document.getElementById('titleFieldWrapper');
    const lyricsWrapper = document.getElementById('lyricsFieldWrapper');
    
    if (isCustom) {
        if (titleWrapper) titleWrapper.classList.remove('hidden');
        if (lyricsWrapper) lyricsWrapper.classList.remove('hidden');
    } else {
        if (titleWrapper) titleWrapper.classList.add('hidden');
        if (lyricsWrapper) lyricsWrapper.classList.add('hidden');
    }
};

// ============================================================
// UI CONTROLLER: CUSTOM DROPDOWNS & SLIDERS
// ============================================================
window.toggleCustomSelect = function(dropdownId) {
    const dropdowns = ['providerDropdown', 'modelDropdown', 'sunoModelDropdown', 'vocalGenderDropdown', 'llmDropdown', 'voiceGenderDropdown', 'styleLangDropdownOptions', 'uploadFormatDropdown'];
    dropdowns.forEach(id => {
        if (id !== dropdownId) {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        }
    });
    const target = document.getElementById(dropdownId);
    if (target) target.classList.toggle('hidden');
};

document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select-container')) {
        const dropdowns = ['providerDropdown', 'modelDropdown', 'sunoModelDropdown', 'vocalGenderDropdown', 'llmDropdown', 'voiceGenderDropdown', 'styleLangDropdownOptions', 'uploadFormatDropdown'];
        dropdowns.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    }
});

window.syncSliderVal = function(sliderId, valId) {
    const slider = document.getElementById(sliderId);
    const valBox = document.getElementById(valId);
    if (slider && valBox) valBox.innerText = slider.value;
};

window.resetSlider = function(sliderId, valId, defaultVal) {
    const slider = document.getElementById(sliderId);
    const valBox = document.getElementById(valId);
    if (slider && valBox) {
        slider.value = defaultVal;
        valBox.innerText = defaultVal;
    }
};

window.toggleAccordion = function(bodyId) {
    const body = document.getElementById(bodyId);
    if (body) {
        body.classList.toggle('hidden');
        const icon = body.previousElementSibling.querySelector('.fa-chevron-down');
        if(icon) {
            icon.style.transform = body.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
            icon.style.transition = '0.3s';
        }
    }
};

window.updateCounter = function(inputId, counterId, maxLen) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(counterId);
    if (input && counter) {
        counter.innerText = `${input.value.length}/${maxLen}`;
    }
};

window.clearInput = function(inputId, counterId, maxLen) {
    const input = document.getElementById(inputId);
    if (input) {
        input.value = '';
        window.updateCounter(inputId, counterId, maxLen);
    }
};

// ============================================================
// UI CONTROLLER: AUDIO PLAYERS (MINI PLAYER & GLOBAL PLAYER)
// ============================================================
window.toggleCustomPlay = function(audioId, containerId) {
    const audio = document.getElementById(audioId);
    const container = document.getElementById(containerId);
    if(!audio || !container) return;
    const btn = container.querySelector('button i');
    
    if (audio.paused) {
        document.querySelectorAll('audio').forEach(a => {
            if(a.id !== audioId) {
                a.pause();
                const otherContainer = a.nextElementSibling;
                if(otherContainer && otherContainer.classList.contains('custom-player')) {
                    const icon = otherContainer.querySelector('.play-btn i');
                    if(icon) icon.className = 'fa-solid fa-play';
                }
            }
        });
        
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                if(btn) btn.className = 'fa-solid fa-pause';
            }).catch(error => {
                console.error("Playback failed:", error);
                window.showIphoneToast("Akses Audio", "Ketuk layar sekali lagi untuk mengizinkan suara.", "fa-play-circle");
            });
        }
    } else {
        audio.pause();
        if(btn) btn.className = 'fa-solid fa-play';
    }
};

window.seekCustomAudio = function(e, audioId) {
    const audio = document.getElementById(audioId);
    const container = e.currentTarget;
    if (!audio || !isFinite(audio.duration)) return;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = clickX / rect.width;
    audio.currentTime = percent * audio.duration;
};

window.playGlobalAudio = function(url, title, thumbUrl, docId = null) {
    if (!url) {
        window.showIphoneToast("Error", "Audio URL tidak valid.", "fa-triangle-exclamation");
        return;
    }
    window.currentPlayingDocId = docId;
    
    if (docId && window.globalLibraryDocs) {
        const docData = window.globalLibraryDocs.find(d => d.id === docId);
        if (docData && docData.isNew) {
            window.updateDoc(window.doc(window.db, "render_gallery", docId), { isNew: false }).catch(e=>e);
        }
    }

    const playerUI = document.getElementById('globalMiniPlayer');
    const audioEl = document.getElementById('globalAudioEl');
    const btnIcon = document.getElementById('gmpPlayBtn')?.querySelector('i');
    
    document.getElementById('gmpTitle').innerText = title;
    document.getElementById('gmpThumb').src = thumbUrl;
    document.getElementById('gmpAuthor').innerText = window.currentUserData?.nama || "Kreaverse AI User";
    
    if (audioEl.src && audioEl.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioEl.src);
    }

    audioEl.src = url;
    audioEl.play().then(() => {
        if(btnIcon) btnIcon.className = 'fa-solid fa-pause';
        if(playerUI) playerUI.classList.add('show');
        
        document.querySelectorAll('audio').forEach(a => {
            if(a.id !== 'globalAudioEl') {
                a.pause();
                const otherContainer = a.nextElementSibling;
                if(otherContainer && otherContainer.classList && otherContainer.classList.contains('custom-player')) {
                    const icon = otherContainer.querySelector('.play-btn i');
                    if(icon) icon.className = 'fa-solid fa-play';
                }
            }
        });
    }).catch(e => {
        console.error("Autoplay failed:", e);
        window.showIphoneToast("Akses Audio", "Ketuk tombol Play untuk memulai.", "fa-play");
        if(playerUI) playerUI.classList.add('show');
    });
};

window.toggleGlobalPlay = function() {
    const audioEl = document.getElementById('globalAudioEl');
    const btnIcon = document.getElementById('gmpPlayBtn')?.querySelector('i');
    if(!audioEl || !btnIcon) return;

    if (audioEl.paused) {
        audioEl.play();
        btnIcon.className = 'fa-solid fa-pause';
    } else {
        audioEl.pause();
        btnIcon.className = 'fa-solid fa-play';
    }
};

window.closeGlobalPlayer = function() {
    const playerUI = document.getElementById('globalMiniPlayer');
    const audioEl = document.getElementById('globalAudioEl');
    if(audioEl) audioEl.pause();
    if(playerUI) playerUI.classList.remove('show');
};

window.seekGlobalPlayer = function(e) {
    const audioEl = document.getElementById('globalAudioEl');
    const wrapper = document.getElementById('gmpProgressWrapper');
    if (!audioEl || !wrapper || !isFinite(audioEl.duration)) return;
    
    const rect = wrapper.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = clickX / rect.width;
    audioEl.currentTime = percent * audioEl.duration;
};

// ============================================================
// UI CONTROLLER: TOP PROGRESS BAR
// ============================================================
let dotInterval;
window.startDotsAnimation = function() {
    const dotsEl = document.getElementById('topProgressDots');
    if(!dotsEl) return;
    let dotCount = 0;
    clearInterval(dotInterval);
    dotInterval = setInterval(() => {
        dotCount = (dotCount + 1) % 4;
        dotsEl.innerText = '.'.repeat(dotCount);
    }, 400);
};

window.stopDotsAnimation = function() {
    clearInterval(dotInterval);
    const dotsEl = document.getElementById('topProgressDots');
    if(dotsEl) dotsEl.innerText = '';
};

window.showTopProgress = function(badgeText, badgeColor) {
    const overlay = document.getElementById('topProgressOverlay');
    const badge = document.getElementById('topProgressBadge');
    if(!overlay || !badge) return;

    badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> ${badgeText}`;
    badge.style.color = badgeColor;
    document.getElementById('topProgressFill').style.background = `linear-gradient(90deg, ${badgeColor}, #fff)`;
    
    overlay.style.transform = 'translateY(0)';
    window.startDotsAnimation();
};

window.hideTopProgress = function() {
    const overlay = document.getElementById('topProgressOverlay');
    if(overlay) overlay.style.transform = 'translateY(-100%)';
    window.stopDotsAnimation();
};

window.updateTopProgress = function(percent, text) {
    const pctEl = document.getElementById('topProgressPercent');
    const fillEl = document.getElementById('topProgressFill');
    const txtEl = document.getElementById('topProgressText');
    
    if(pctEl) pctEl.innerText = `${percent}/100`;
    if(fillEl) fillEl.style.width = `${percent}%`;
    if(txtEl) txtEl.innerHTML = `${text}<span id="topProgressDots">...</span>`;
};

// ============================================================
// UI CONTROLLER: CONFIRMATION & ERROR MODALS
// ============================================================
window.kreaConfirm = function(title, message, onConfirm) {
    document.getElementById('confirmModalTitle').innerText = title;
    document.getElementById('confirmModalDesc').innerText = message;
    document.getElementById('customConfirmOverlay').classList.add('show');
    
    const btnOk = document.getElementById('btnConfirmOk');
    const newBtnOk = btnOk.cloneNode(true);
    btnOk.parentNode.replaceChild(newBtnOk, btnOk);
    
    newBtnOk.onclick = () => {
        document.getElementById('customConfirmOverlay').classList.remove('show');
        onConfirm();
    };
};

window.closeKreaConfirm = function() {
    document.getElementById('customConfirmOverlay').classList.remove('show');
};

window.closeErrorDetail = function() {
    document.getElementById('errorDetailModalOverlay').classList.remove('show');
};

window.closeDspStudio = function() {
    document.getElementById('dspStudioWrapper').classList.add('hidden');
    if (window.animationFrameId) {
        cancelAnimationFrame(window.animationFrameId);
        window.animationFrameId = null;
    }
    if (window.audioContextForVis && window.audioContextForVis.state === 'running') {
        window.audioContextForVis.suspend();
    }
    const origPlayer = document.getElementById('originalAudioPlayer');
    const bypassPlayer = document.getElementById('bypassedAudioPlayer');
    if (origPlayer && !origPlayer.paused) window.toggleCustomPlay('originalAudioPlayer', 'cp-original');
    if (bypassPlayer && !bypassPlayer.paused) window.toggleCustomPlay('bypassedAudioPlayer', 'cp-bypassed');
};

// Inisialisasi UI saat halaman dimuat
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { 
        window.toggleCustomFields(); 
    }, 100);
});