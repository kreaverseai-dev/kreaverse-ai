// ============================================================
// MP3 ENCODER (WEB WORKER) - Mencegah HP Lag/Crash
// ============================================================
const mp3WorkerCode = `
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js');

    self.onmessage = function(e) {
        const { left, right, channels, sampleRate } = e.data;
        const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
        const mp3Data = [];
        const sampleBlockSize = 1152;

        for (let i = 0; i < left.length; i += sampleBlockSize) {
            const end = Math.min(i + sampleBlockSize, left.length);
            const leftChunk = new Int16Array(end - i);
            const rightChunk = new Int16Array(end - i);

            for (let j = 0; j < end - i; j++) {
                let sampleL = left[i + j];
                let sampleR = right ? right[i + j] : sampleL;

                if (sampleL > 1.0) sampleL = 1.0;
                if (sampleL < -1.0) sampleL = -1.0;
                if (sampleR > 1.0) sampleR = 1.0;
                if (sampleR < -1.0) sampleR = -1.0;

                leftChunk[j] = sampleL < 0 ? sampleL * 32768 : sampleL * 32767;
                rightChunk[j] = sampleR < 0 ? sampleR * 32768 : sampleR * 32767;
            }

            const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
            if (mp3buf.length > 0) mp3Data.push(mp3buf);

            if (i % (sampleBlockSize * 50) === 0) {
                const percent = (i / left.length) * 100;
                self.postMessage({ type: 'progress', percent: percent });
            }
        }

        const mp3buf = mp3encoder.flush();
        if (mp3buf.length > 0) mp3Data.push(mp3buf);

        const totalLength = mp3Data.reduce((acc, curr) => acc + curr.length, 0);
        const combinedBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (let i = 0; i < mp3Data.length; i++) {
            combinedBuffer.set(mp3Data[i], offset);
            offset += mp3Data[i].length;
        }

        self.postMessage({ type: 'done', buffer: combinedBuffer.buffer }, [combinedBuffer.buffer]);
    };
`;

window.encodeAudioBufferToMp3 = async function(audioBuffer, progressCallback) {
    return new Promise((resolve, reject) => {
        const channels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        
        const left = new Float32Array(audioBuffer.getChannelData(0));
        const right = channels > 1 ? new Float32Array(audioBuffer.getChannelData(1)) : null;

        const blob = new Blob([mp3WorkerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);

        worker.onmessage = function(e) {
            if (e.data.type === 'progress') {
                if (progressCallback) progressCallback(e.data.percent);
            } else if (e.data.type === 'done') {
                const finalBlob = new Blob([e.data.buffer], { type: 'audio/mp3' });
                worker.terminate(); 
                URL.revokeObjectURL(workerUrl); 
                resolve(finalBlob);
            }
        };

        worker.onerror = function(err) {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            reject(new Error("Web Worker Crash (Kemungkinan Memori Penuh)"));
        };

        if (right) {
            worker.postMessage({ left, right, channels, sampleRate }, [left.buffer, right.buffer]);
        } else {
            worker.postMessage({ left, right, channels, sampleRate }, [left.buffer]);
        }
    });
};

// ============================================================
// HELPER MATH FUNCTIONS
// ============================================================
window.makeMirageCurve = function() {
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    for (let i = 0; i < n_samples; ++i) {
        let x = (i * 2) / n_samples - 1;
        curve[i] = x + (Math.sin(x * Math.PI) * 0.005); 
    }
    return curve;
};

window.parseTimeToSeconds = function(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length !== 2) return 0;
    const m = parseInt(parts[0], 10);
    const s = parseInt(parts[1], 10);
    if (isNaN(m) || isNaN(s)) return 0;
    return (m * 60) + s;
};

window.formatSecondsToTime = function(sec) {
    if (isNaN(sec) || !isFinite(sec)) return "00:00";
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
};

// ============================================================
// DSP ENGINE (ANTI-COPYRIGHT BYPASS V1 & V2)
// ============================================================
window.processKreaverseAudio = async function(file, isPreview = false, progressCallback) {
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const originalBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    const safeGetVal = (id, def) => { const el = document.getElementById(id); return el ? el.value : def; };
    let startSec = window.parseTimeToSeconds(safeGetVal('trimStartInput', '00:00'));
    let endSec = window.parseTimeToSeconds(safeGetVal('trimEndInput', '00:00'));
    
    if (endSec === 0 || endSec > originalBuffer.duration) endSec = originalBuffer.duration;
    if (startSec >= endSec) startSec = 0; 
    
    let trimDuration = endSec - startSec;

    if (isPreview && trimDuration > 60) {
        trimDuration = 60;
        endSec = startSec + 60;
        if (typeof window.showIphoneToast === 'function') {
            window.showIphoneToast("Mode Preview", "Memutar 1 menit pertama untuk hemat RAM/Baterai.", "fa-stopwatch");
        }
    }

    const startOffset = Math.floor(startSec * originalBuffer.sampleRate);
    const endOffset = Math.floor((startSec + trimDuration) * originalBuffer.sampleRate);
    const frameCount = endOffset - startOffset;

    const audioBuffer = audioCtx.createBuffer(originalBuffer.numberOfChannels, frameCount, originalBuffer.sampleRate);
    const chkMicro = document.getElementById('chkMicroReverse');
    const isMicroReverseChecked = chkMicro ? chkMicro.checked : false;

    for (let c = 0; c < originalBuffer.numberOfChannels; c++) {
        const channelData = originalBuffer.getChannelData(c).slice(startOffset, endOffset);
        
        if (isMicroReverseChecked && !isPreview) {
            const sampleRate = originalBuffer.sampleRate;
            const chunkLen = Math.floor(sampleRate * 0.025); 
            const step = Math.floor(sampleRate * 0.085); 
            
            for (let i = 0; i < channelData.length - chunkLen; i += step) {
                let left = i;
                let right = i + chunkLen - 1;
                while (left < right) {
                    let temp = channelData[left];
                    channelData[left] = channelData[right];
                    channelData[right] = temp;
                    left++; right--;
                }
            }
        }
        audioBuffer.copyToChannel(channelData, c);
    }

    const activeTab = localStorage.getItem('krea_dsp_tab') || 'v1';
    let speedVal = 1.0;
    let pitchVal = 0;
    
    if (activeTab === 'v1') {
        speedVal = parseFloat(safeGetVal('sliderTempoV1', '1.0'));
        pitchVal = parseFloat(safeGetVal('sliderPitchV1', '0')); 
    } else {
        speedVal = parseFloat(safeGetVal('kreaverseSpeed', '1.0'));
        pitchVal = parseFloat(safeGetVal('pitchSlider', '0')) * 100; 
    }

    const pitchMultiplier = Math.pow(2, pitchVal / 1200);
    const totalPlaybackRate = speedVal * pitchMultiplier;

    let finalDuration = trimDuration / totalPlaybackRate;
    if (finalDuration <= 0) finalDuration = 1; 
    const finalFrameCount = Math.floor(finalDuration * originalBuffer.sampleRate);

    const offlineCtx = new OfflineAudioContext(originalBuffer.numberOfChannels, finalFrameCount, originalBuffer.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    let lastNode = source;

    source.preservesPitch = false; 
    source.detune.value = pitchVal;
    source.playbackRate.value = speedVal;

    const masterToggleEl = document.getElementById('globalMasterToggle') || document.getElementById('masterToggle');
    let isMasterOn = masterToggleEl ? masterToggleEl.checked : false;

    // =========================================================
    // DSP V1 (BETA)
    // =========================================================
    if (isMasterOn && activeTab === 'v1') {
        const v1Timbre = parseInt(safeGetVal('sliderTimbreV1', '0')) || 0;
        const v1Stego = parseInt(safeGetVal('sliderStegoV1', '0')) || 0;
        const v1Void = parseInt(safeGetVal('sliderVoidV1', '0')) || 0;
        const v1Reverb = parseInt(safeGetVal('sliderReverbV1', '0')) || 0; 
        
        const tgTemporal = document.getElementById('tgTemporalV1') ? document.getElementById('tgTemporalV1').checked : false;
        const tgMirage = document.getElementById('tgMirageV1') ? document.getElementById('tgMirageV1').checked : false;
        const tgAntiMono = document.getElementById('tgAntiMonoV1') ? document.getElementById('tgAntiMonoV1').checked : false;
        const tgSpectral = document.getElementById('tgSpectralV1') ? document.getElementById('tgSpectralV1').checked : false;
        const tgQuantum = document.getElementById('tgQuantumV1') ? document.getElementById('tgQuantumV1').checked : false;
        const tgPhonetic = document.getElementById('tgPhoneticV1') ? document.getElementById('tgPhoneticV1').checked : false;

        if (tgTemporal) {
            const fluxLfo1 = offlineCtx.createOscillator(); fluxLfo1.frequency.value = 0.3; 
            const fluxLfo2 = offlineCtx.createOscillator(); fluxLfo2.frequency.value = 0.77; 
            const fluxGain = offlineCtx.createGain(); fluxGain.gain.value = 0.002; 
            fluxLfo1.connect(fluxGain); fluxLfo2.connect(fluxGain); fluxGain.connect(source.playbackRate);
            fluxLfo1.start(0); fluxLfo2.start(0);
        }

        if (v1Timbre > 0) {
            const lpFilter = offlineCtx.createBiquadFilter(); lpFilter.type = 'lowpass';
            lpFilter.frequency.value = 24000 - (v1Timbre * 200);
            lastNode.connect(lpFilter); lastNode = lpFilter;
        }

        if (v1Void > 0) {
            const delay = offlineCtx.createDelay(); delay.delayTime.value = 0.15; 
            const delayGain = offlineCtx.createGain(); delayGain.gain.value = (v1Void / 100) * 0.02; 
            const voidMix = offlineCtx.createGain();
            lastNode.connect(voidMix);
            lastNode.connect(delay); delay.connect(delayGain); delayGain.connect(voidMix);
            lastNode = voidMix;
        }

        if (v1Stego > 0) {
            const noiseLen = offlineCtx.sampleRate * 2; 
            const noiseBuf = offlineCtx.createBuffer(1, noiseLen, offlineCtx.sampleRate);
            const output = noiseBuf.getChannelData(0); 
            for (let i = 0; i < noiseLen; i++) output[i] = Math.random() * 2 - 1;
            const noiseSrc = offlineCtx.createBufferSource(); noiseSrc.buffer = noiseBuf; noiseSrc.loop = true;
            const noiseFilter = offlineCtx.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 1000; noiseFilter.Q.value = 0.5;
            const noiseGain = offlineCtx.createGain(); noiseGain.gain.value = (v1Stego / 100) * 0.15; 
            noiseSrc.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(offlineCtx.destination);
            noiseSrc.start(0);
        }

        if (tgMirage) {
            const allpass = offlineCtx.createBiquadFilter(); allpass.type = 'allpass'; allpass.frequency.value = 1000;
            lastNode.connect(allpass); lastNode = allpass;
        }

        if (tgSpectral) {
            const notch = offlineCtx.createBiquadFilter(); notch.type = 'notch'; notch.frequency.value = 3000; notch.Q.value = 2;
            lastNode.connect(notch); lastNode = notch;
        }

        if (tgQuantum) {
            const driftLfo1 = offlineCtx.createOscillator(); driftLfo1.frequency.value = 0.15;
            const driftLfo2 = offlineCtx.createOscillator(); driftLfo2.frequency.value = 1.2;
            const driftGain = offlineCtx.createGain(); driftGain.gain.value = 4; 
            driftLfo1.connect(driftGain); driftLfo2.connect(driftGain); driftGain.connect(source.detune);
            driftLfo1.start(0); driftLfo2.start(0);
        }

        if (tgPhonetic) {
            const vocalMask = offlineCtx.createBiquadFilter(); vocalMask.type = 'peaking'; vocalMask.frequency.value = 2500; vocalMask.Q.value = 2.5; vocalMask.gain.value = -3.5; 
            lastNode.connect(vocalMask); lastNode = vocalMask;
        }

        if (tgAntiMono && audioBuffer.numberOfChannels >= 2) {
            const splitter = offlineCtx.createChannelSplitter(2); const merger = offlineCtx.createChannelMerger(2);
            const gainL = offlineCtx.createGain(); const gainR = offlineCtx.createGain();
            gainL.gain.value = 1; gainR.gain.value = -1; 
            lastNode.connect(splitter); splitter.connect(gainL, 0); splitter.connect(gainR, 1);
            gainL.connect(merger, 0, 0); gainR.connect(merger, 0, 1);
            lastNode = merger;
        }
        
        if (v1Reverb > 0) {
            const length = offlineCtx.sampleRate * 2.0; 
            const impulse = offlineCtx.createBuffer(2, length, offlineCtx.sampleRate);
            for (let i = 0; i < 2; i++) {
                const channelData = impulse.getChannelData(i);
                for (let j = 0; j < length; j++) channelData[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 3); 
            }
            const convolver = offlineCtx.createConvolver(); convolver.buffer = impulse;
            const wetGain = offlineCtx.createGain(); wetGain.gain.value = (v1Reverb / 100) * 0.03; 
            const dryGain = offlineCtx.createGain(); dryGain.gain.value = 1.0;
            const mixNode = offlineCtx.createGain();
            lastNode.connect(dryGain); lastNode.connect(convolver); convolver.connect(wetGain);
            dryGain.connect(mixNode); wetGain.connect(mixNode);
            lastNode = mixNode;
        }

        const splitterV1 = offlineCtx.createChannelSplitter(2);
        const mergerV1 = offlineCtx.createChannelMerger(2);
        const delayLV1 = offlineCtx.createDelay(); delayLV1.delayTime.value = 0.012;
        const delayRV1 = offlineCtx.createDelay(); delayRV1.delayTime.value = 0.017;
        lastNode.connect(splitterV1);
        splitterV1.connect(delayLV1, 0); delayLV1.connect(mergerV1, 0, 0);
        splitterV1.connect(delayRV1, 1); delayRV1.connect(mergerV1, 0, 1);
        const dryGainV1 = offlineCtx.createGain(); dryGainV1.gain.value = 0.75;
        const wetGainV1 = offlineCtx.createGain(); wetGainV1.gain.value = 0.25;
        const finalMixV1 = offlineCtx.createGain();
        lastNode.connect(dryGainV1); mergerV1.connect(wetGainV1);
        dryGainV1.connect(finalMixV1); wetGainV1.connect(finalMixV1);
        lastNode = finalMixV1;

        isMasterOn = false;
    }
    
    // =========================================================
    // DSP V2 (STABIL)
    // =========================================================
    if (isMasterOn) {
        const v2Timbre = parseInt(safeGetVal('sliderTimbreV2', '0')) || 0;
        const v2Stego = parseInt(safeGetVal('sliderStegoV2', '0')) || 0;
        const v2Void = parseInt(safeGetVal('sliderVoidV2', '0')) || 0;

        if (v2Timbre > 0) {
            const lpFilter = offlineCtx.createBiquadFilter(); lpFilter.type = 'lowpass';
            lpFilter.frequency.value = 24000 - (v2Timbre * 200);
            lastNode.connect(lpFilter); lastNode = lpFilter;
        }

        if (v2Void > 0) {
            const delay = offlineCtx.createDelay(); delay.delayTime.value = 0.15; 
            const delayGain = offlineCtx.createGain(); delayGain.gain.value = (v2Void / 100) * 0.02; 
            const voidMix = offlineCtx.createGain();
            lastNode.connect(voidMix); lastNode.connect(delay); delay.connect(delayGain); delayGain.connect(voidMix);
            lastNode = voidMix;
        }

        if (v2Stego > 0) {
            const noiseLen = offlineCtx.sampleRate * 2; 
            const noiseBuf = offlineCtx.createBuffer(1, noiseLen, offlineCtx.sampleRate);
            const output = noiseBuf.getChannelData(0); 
            for (let i = 0; i < noiseLen; i++) output[i] = Math.random() * 2 - 1;
            const noiseSrc = offlineCtx.createBufferSource(); noiseSrc.buffer = noiseBuf; noiseSrc.loop = true;
            const noiseFilter = offlineCtx.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 1000; noiseFilter.Q.value = 0.5;
            const noiseGain = offlineCtx.createGain(); noiseGain.gain.value = (v2Stego / 100) * 0.15; 
            noiseSrc.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(offlineCtx.destination);
            noiseSrc.start(0);
        }

        const isWarpChecked = document.getElementById('chkWarp') && document.getElementById('chkWarp').checked;
        const isFluxChecked = document.getElementById('chkFlux') && document.getElementById('chkFlux').checked;
        if (isWarpChecked || isFluxChecked) {
            for (let time = 0; time < finalDuration; time += 0.1) {
                let dynamicSpeed = speedVal;
                if (isWarpChecked) {
                    const jitter = (Math.random() * 0.002) - 0.001; 
                    dynamicSpeed += (Math.sin(time * 0.5) * 0.0015) + jitter;
                }
                if (isFluxChecked) dynamicSpeed += (Math.sin(time * 0.7) * 0.002) + (Math.cos(time * 0.25) * 0.001);
                source.playbackRate.setValueAtTime(dynamicSpeed, time);
            }
        }

        const isPhaseChecked = document.getElementById('chkPhase') && document.getElementById('chkPhase').checked;
        if (isPhaseChecked) {
            const freqs = [250, 850, 2200, 4500, 7000];
            freqs.forEach(freq => {
                const allpass = offlineCtx.createBiquadFilter(); allpass.type = 'allpass'; allpass.frequency.value = freq + (Math.random() * 100); allpass.Q.value = 2.5 + Math.random(); 
                lastNode.connect(allpass); lastNode = allpass;
            });
        }

        const isFormantChecked = document.getElementById('chkFormant') && document.getElementById('chkFormant').checked;
        if (isFormantChecked) {
            const formantFilter = offlineCtx.createBiquadFilter(); formantFilter.type = 'peaking'; formantFilter.Q.value = 2.5; formantFilter.gain.value = 8.0; 
            for (let t = 0; t < finalDuration; t += 0.2) {
                const sweepFreq = 1600 + (Math.sin(t * 2.0) * 800); 
                formantFilter.frequency.linearRampToValueAtTime(sweepFreq, t + 0.2);
            }
            lastNode.connect(formantFilter); lastNode = formantFilter;
        }

        const isHarmonicsChecked = document.getElementById('chkHarmonics') && document.getElementById('chkHarmonics').checked;
        if (isHarmonicsChecked) {
            function makeAsymmetricSaturationCurve() {
                const n_samples = 44100; const curve = new Float32Array(n_samples);
                for (let i = 0; i < n_samples; ++i) {
                    let x = (i * 2) / n_samples - 1;
                    curve[i] = Math.tanh(x * 3.5) + (0.15 * Math.sin(x * Math.PI * 1.5));
                }
                return curve;
            }
            const saturator = offlineCtx.createWaveShaper(); saturator.curve = makeAsymmetricSaturationCurve(); saturator.oversample = '4x';
            lastNode.connect(saturator); lastNode = saturator;
        }

        const isSpatialChecked = document.getElementById('chkSpatial') && document.getElementById('chkSpatial').checked;
        if (isSpatialChecked) {
            const delayNode = offlineCtx.createDelay(); delayNode.delayTime.value = 0.035 + (Math.random() * 0.01); 
            const delayGain = offlineCtx.createGain(); delayGain.gain.value = 0.03; 
            const merger = offlineCtx.createGain();
            lastNode.connect(merger); lastNode.connect(delayNode); delayNode.connect(delayGain); delayGain.connect(merger); 
            lastNode = merger;
        }

        const isMaskingChecked = document.getElementById('chkMasking') && document.getElementById('chkMasking').checked;
        if (isMaskingChecked) {
            const noiseBufferSize = offlineCtx.sampleRate * finalDuration;
            const noiseBuffer = offlineCtx.createBuffer(1, noiseBufferSize, offlineCtx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
            for (let i = 0; i < noiseBufferSize; i++) {
                let white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856; b4 = 0.55000 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.0168980;
                output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362; output[i] *= 0.11; b6 = white * 0.115926;
            }
            const noiseSource = offlineCtx.createBufferSource(); noiseSource.buffer = noiseBuffer;
            const noiseFilter = offlineCtx.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.Q.value = 1.0; 
            const noiseGain = offlineCtx.createGain();
            for (let t = 0; t < finalDuration; t += 0.5) {
                const sweepFreq = 1500 + (Math.sin(t * 0.2) * 1000);
                noiseFilter.frequency.linearRampToValueAtTime(sweepFreq, t + 0.5);
                const dGain = 0.02 + (Math.sin(t * 0.5) * 0.015);
                noiseGain.gain.linearRampToValueAtTime(dGain, t + 0.5);
            }
            noiseSource.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(offlineCtx.destination); 
            noiseSource.start(0);
        }

        const isObfuscatorChecked = document.getElementById('chkObfuscator') && document.getElementById('chkObfuscator').checked;
        if (isObfuscatorChecked) {
            const chorusDelay = offlineCtx.createDelay(); chorusDelay.delayTime.value = 0.020; 
            const lfo = offlineCtx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.8; 
            const lfoGain = offlineCtx.createGain(); lfoGain.gain.value = 0.0006; 
            lfo.connect(lfoGain); lfoGain.connect(chorusDelay.delayTime); lfo.start(0);
            const chorusWetGain = offlineCtx.createGain(); chorusWetGain.gain.value = 0.04; 
            const chorusMix = offlineCtx.createGain();
            lastNode.connect(chorusMix); lastNode.connect(chorusDelay); chorusDelay.connect(chorusWetGain); chorusWetGain.connect(chorusMix); 
            lastNode = chorusMix;
        }

        const isMirageChecked = document.getElementById('chkMirage') && document.getElementById('chkMirage').checked;
        if (isMirageChecked) {
            const mirageShaper = offlineCtx.createWaveShaper(); mirageShaper.curve = window.makeMirageCurve(); mirageShaper.oversample = '4x';
            const mirageFilter = offlineCtx.createBiquadFilter(); mirageFilter.type = 'lowshelf'; mirageFilter.frequency.value = 400; mirageFilter.gain.value = -1.5;
            lastNode.connect(mirageShaper); mirageShaper.connect(mirageFilter); lastNode = mirageFilter;
        }

        const isNullifierChecked = document.getElementById('chkNullifier') && document.getElementById('chkNullifier').checked;
        if (isNullifierChecked) {
            const splitter = offlineCtx.createChannelSplitter(2); const merger = offlineCtx.createChannelMerger(2);
            const allpassL = offlineCtx.createBiquadFilter(); allpassL.type = 'allpass'; allpassL.frequency.value = 800; allpassL.Q.value = 1.5;
            const allpassR = offlineCtx.createBiquadFilter(); allpassR.type = 'allpass'; allpassR.frequency.value = 1200; allpassR.Q.value = 1.5;
            lastNode.connect(splitter);
            splitter.connect(allpassL, 0); allpassL.connect(merger, 0, 0); 
            splitter.connect(allpassR, 1); allpassR.connect(merger, 0, 1);
            lastNode = merger;
        }

        const isLayeringChecked = document.getElementById('chkLayering') && document.getElementById('chkLayering').checked;
        if (isLayeringChecked) {
            const stegoOsc = offlineCtx.createOscillator(); stegoOsc.type = 'sine';
            for (let t = 0; t < finalDuration; t += 0.2) {
                const freq = 18000 + Math.sin(t * 3) * 1000; 
                stegoOsc.frequency.setValueAtTime(freq, t);
            }
            const stegoGain = offlineCtx.createGain(); stegoGain.gain.value = 0.025; 
            stegoOsc.connect(stegoGain); stegoGain.connect(offlineCtx.destination); stegoOsc.start(0);

            const voidDelay = offlineCtx.createDelay(); voidDelay.delayTime.value = 0.007; 
            const voidGain = offlineCtx.createGain(); voidGain.gain.value = 0.02; 
            const voidMix = offlineCtx.createGain();
            lastNode.connect(voidMix); lastNode.connect(voidDelay); voidDelay.connect(voidGain); voidGain.connect(voidMix);
            lastNode = voidMix;
        }

        const isTransientChecked = document.getElementById('chkTransient') && document.getElementById('chkTransient').checked;
        if (isTransientChecked) {
            const introDelay = offlineCtx.createDelay(); introDelay.delayTime.value = (Math.random() * 0.047) + 0.013; 
            const fadeGain = offlineCtx.createGain(); fadeGain.gain.setValueAtTime(0.001, 0); fadeGain.gain.exponentialRampToValueAtTime(1.0, 0.15);
            lastNode.connect(introDelay); introDelay.connect(fadeGain); lastNode = fadeGain;
        }

        const isChromaChecked = document.getElementById('chkChroma') && document.getElementById('chkChroma').checked;
        if (isChromaChecked) {
            const splitter = offlineCtx.createChannelSplitter(2); const merger = offlineCtx.createChannelMerger(2);
            const delayL = offlineCtx.createDelay(); const delayR = offlineCtx.createDelay();
            delayL.delayTime.value = 0.015; delayR.delayTime.value = 0.022;
            const lfo = offlineCtx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.05; 
            const lfoGain = offlineCtx.createGain(); lfoGain.gain.value = 0.001; 
            lfo.connect(lfoGain); lfoGain.connect(delayL.delayTime);
            const invertGain = offlineCtx.createGain(); invertGain.gain.value = -1; lfoGain.connect(invertGain); invertGain.connect(delayR.delayTime);
            lfo.start(0);
            lastNode.connect(splitter);
            splitter.connect(delayL, 0); delayL.connect(merger, 0, 0);
            splitter.connect(delayR, 1); delayR.connect(merger, 0, 1);
            const dryGain = offlineCtx.createGain(); dryGain.gain.value = 0.7;
            const wetGain = offlineCtx.createGain(); wetGain.gain.value = 0.3; 
            const finalMix = offlineCtx.createGain();
            lastNode.connect(dryGain); merger.connect(wetGain);
            dryGain.connect(finalMix); wetGain.connect(finalMix);
            lastNode = finalMix;
        }

        const isRingModChecked = document.getElementById('chkRingMod') && document.getElementById('chkRingMod').checked;
        if (isRingModChecked) {
            const phaser = offlineCtx.createBiquadFilter(); phaser.type = 'allpass'; phaser.Q.value = 3.0; 
            const lfo = offlineCtx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.2; 
            const lfoDepth = offlineCtx.createGain(); lfoDepth.gain.value = 800; 
            phaser.frequency.value = 1200; 
            lfo.connect(lfoDepth); lfoDepth.connect(phaser.frequency); lfo.start(0);
            lastNode.connect(phaser); lastNode = phaser;
        }

        const isNukeChecked = document.getElementById('chkNuke') && document.getElementById('chkNuke').checked;
        if (isNukeChecked) {
            const noiseLen = offlineCtx.sampleRate * finalDuration;
            const noiseBuf = offlineCtx.createBuffer(1, noiseLen, offlineCtx.sampleRate);
            const output = noiseBuf.getChannelData(0);
            for (let i = 0; i < noiseLen; i++) output[i] = Math.random() * 2 - 1; 
            const noiseSrc = offlineCtx.createBufferSource(); noiseSrc.buffer = noiseBuf;
            const bpFilter = offlineCtx.createBiquadFilter(); bpFilter.type = 'bandpass'; bpFilter.Q.value = 6.0; 
            for(let t=0; t<finalDuration; t+=0.5) {
                const sweepFreq = 3000 + (Math.sin(t) * 1500); 
                bpFilter.frequency.linearRampToValueAtTime(sweepFreq, t + 0.5);
            }
            const noiseGain = offlineCtx.createGain(); noiseGain.gain.value = 0.015; 
            noiseSrc.connect(bpFilter); bpFilter.connect(noiseGain);
            const nukeMix = offlineCtx.createGain();
            lastNode.connect(nukeMix); noiseGain.connect(nukeMix); noiseSrc.start(0);
            lastNode = nukeMix;
        }
    }

    const masterGain = offlineCtx.createGain();
    masterGain.gain.setValueAtTime(1.5, 0);
    masterGain.gain.setValueAtTime(1.5, Math.max(0, finalDuration - 0.2));
    masterGain.gain.linearRampToValueAtTime(0.001, finalDuration); 
    lastNode.connect(masterGain);

    const brickwallLimiter = offlineCtx.createDynamicsCompressor();
    brickwallLimiter.threshold.value = -1.0; 
    brickwallLimiter.knee.value = 0.0;       
    brickwallLimiter.ratio.value = 20.0;     
    brickwallLimiter.attack.value = 0.001;   
    brickwallLimiter.release.value = 0.1;

    masterGain.connect(brickwallLimiter);
    brickwallLimiter.connect(offlineCtx.destination);
    
    source.start(0);
    const renderedBuffer = await offlineCtx.startRendering();

    const audioBufferToWavAsync = (buffer) => {
        return new Promise(resolve => {
            setTimeout(() => {
                const numOfChan = buffer.numberOfChannels;
                const length = buffer.length * numOfChan * 2 + 44;
                const bufferArray = new ArrayBuffer(length);
                const view = new DataView(bufferArray);
                const channels = [];
                let i, sample, offset = 0, pos = 0;

                const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
                const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };

                setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
                setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
                setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
                setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);

                for (i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

                while (pos < length) {
                    for (i = 0; i < numOfChan; i++) {
                        sample = Math.max(-1, Math.min(1, channels[i][offset]));
                        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
                        view.setInt16(pos, sample, true); pos += 2;
                    }
                    offset++;
                }
                resolve(new Blob([bufferArray], { type: 'audio/wav' }));
            }, 10);
        });
    };
    
    if (isPreview) {
        return await audioBufferToWavAsync(renderedBuffer);
    } else {
        const targetFormat = document.getElementById('uploadFormatSelect') ? document.getElementById('uploadFormatSelect').value : 'mp3';
        if (targetFormat === 'mp3' || targetFormat === 'ogg' || targetFormat === 'm4a') {
            return await window.encodeAudioBufferToMp3(renderedBuffer, progressCallback);
        } else {
            return await audioBufferToWavAsync(renderedBuffer);
        }
    }
};

// ============================================================
// VOICE RECORDER EFFECTS (STUDIO VOCAL)
// ============================================================
window.applyStudioEffectsToBlob = async function(blob, genderFilter, progressCallback) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    const offlineCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, audioBuffer.length, audioBuffer.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    
    if (genderFilter === 'raw') {
        source.connect(offlineCtx.destination);
        source.start(0);
        const renderedBuffer = await offlineCtx.startRendering();
        return await window.encodeAudioBufferToMp3(renderedBuffer, progressCallback);
    }

    source.preservesPitch = false;

    if (genderFilter === 'male') source.playbackRate.value = 0.85; 
    else if (genderFilter === 'female') source.playbackRate.value = 1.35; 
    else source.playbackRate.value = 1.0;  

    function makeSoftGateCurve(threshold) {
        const n_samples = 44100; const curve = new Float32Array(n_samples);
        for (let i = 0; i < n_samples; ++i) {
            const x = i * 2 / n_samples - 1;
            if (Math.abs(x) < threshold) curve[i] = x * Math.pow(Math.abs(x) / threshold, 2); 
            else curve[i] = x;
        }
        return curve;
    }
    const noiseGate = offlineCtx.createWaveShaper();
    noiseGate.curve = makeSoftGateCurve(0.008); 
    noiseGate.oversample = '4x';

    function makeDistortionCurve(amount) {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 44100; const curve = new Float32Array(n_samples); const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
    const saturation = offlineCtx.createWaveShaper();
    saturation.curve = makeDistortionCurve(2); 
    saturation.oversample = '4x';

    const hpf = offlineCtx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 40;
    const chestEQ = offlineCtx.createBiquadFilter(); chestEQ.type = 'peaking'; chestEQ.frequency.value = 180; chestEQ.Q.value = 0.8; chestEQ.gain.value = 5.5;
    const antiNasalEQ = offlineCtx.createBiquadFilter(); antiNasalEQ.type = 'peaking'; antiNasalEQ.frequency.value = 1200; antiNasalEQ.Q.value = 1.5; antiNasalEQ.gain.value = -7.5;
    const airEQ = offlineCtx.createBiquadFilter(); airEQ.type = 'highshelf'; airEQ.frequency.value = 8000; airEQ.gain.value = 5.0;

    const compressor = offlineCtx.createDynamicsCompressor();
    compressor.threshold.value = -18; compressor.knee.value = 10; compressor.ratio.value = 4; compressor.attack.value = 0.005; compressor.release.value = 0.1;

    const length = offlineCtx.sampleRate * 2.2; 
    const impulse = offlineCtx.createBuffer(2, length, offlineCtx.sampleRate);
    for (let i = 0; i < 2; i++) {
        const channelData = impulse.getChannelData(i);
        for (let j = 0; j < length; j++) channelData[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 5);
    }
    const convolver = offlineCtx.createConvolver(); convolver.buffer = impulse;

    const preDelay = offlineCtx.createDelay(); preDelay.delayTime.value = 0.04;
    const reverbHPF = offlineCtx.createBiquadFilter(); reverbHPF.type = 'highpass'; reverbHPF.frequency.value = 600;

    const dryGain = offlineCtx.createGain(); dryGain.gain.value = 1.0;
    const wetGain = offlineCtx.createGain(); wetGain.gain.value = 0.45; 
    
    const limiter = offlineCtx.createDynamicsCompressor();
    limiter.threshold.value = -0.5; limiter.knee.value = 0.0; limiter.ratio.value = 20.0; limiter.attack.value = 0.001; limiter.release.value = 0.05;

    const makeUpGain = offlineCtx.createGain(); makeUpGain.gain.value = 1.5; 

    source.connect(noiseGate); noiseGate.connect(saturation); saturation.connect(hpf); hpf.connect(chestEQ); chestEQ.connect(antiNasalEQ); antiNasalEQ.connect(airEQ); airEQ.connect(compressor);
    compressor.connect(dryGain);
    compressor.connect(preDelay); preDelay.connect(reverbHPF); reverbHPF.connect(convolver); convolver.connect(wetGain);
    dryGain.connect(makeUpGain); wetGain.connect(makeUpGain);
    makeUpGain.connect(limiter); limiter.connect(offlineCtx.destination);
    
    source.start(0);
    const renderedBuffer = await offlineCtx.startRendering();
    return await window.encodeAudioBufferToMp3(renderedBuffer, progressCallback);
};

// ============================================================
// VISUALIZER (OSCILLOSCOPE)
// ============================================================
window.audioContextForVis = null;
window.analyserNode = null;
window.animationFrameId = null;

window.initVisualizer = function() {
    if (!window.audioContextForVis) {
        window.audioContextForVis = new (window.AudioContext || window.webkitAudioContext)();
        window.analyserNode = window.audioContextForVis.createAnalyser();
        window.analyserNode.fftSize = 2048;
        
        const origAudio = document.getElementById('originalAudioPlayer');
        const bypAudio = document.getElementById('bypassedAudioPlayer');
        
        const source1 = window.audioContextForVis.createMediaElementSource(origAudio);
        const source2 = window.audioContextForVis.createMediaElementSource(bypAudio);
        
        source1.connect(window.analyserNode);
        source2.connect(window.analyserNode);
        window.analyserNode.connect(window.audioContextForVis.destination);
    }
    
    if(window.audioContextForVis.state === 'suspended') {
        window.audioContextForVis.resume();
    }

    const canvas = document.getElementById('audioVisualizer');
    if(!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    const bufferLength = window.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        window.animationFrameId = requestAnimationFrame(draw);
        window.analyserNode.getByteTimeDomainData(dataArray);

        canvasCtx.fillStyle = 'rgba(15, 23, 42, 1)';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = '#38bdf8';
        canvasCtx.beginPath();

        const sliceWidth = canvas.width * 1.0 / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * canvas.height / 2;

            if (i === 0) canvasCtx.moveTo(x, y);
            else canvasCtx.lineTo(x, y);

            x += sliceWidth;
        }

        canvasCtx.lineTo(canvas.width, canvas.height / 2);
        canvasCtx.stroke();
    }
    
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    
    if(window.animationFrameId) cancelAnimationFrame(window.animationFrameId);
    draw();
};

// ============================================================
// SMART TEMPO ANALYZER
// ============================================================
window.analyzeBPM = async function(audioBuffer) {
    const offlineCtx = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 150;

    source.connect(filter);
    filter.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const data = renderedBuffer.getChannelData(0);
    
    let peaks = [];
    let threshold = 0.8; 
    
    for (let i = 0; i < data.length; i++) {
        if (data[i] > threshold) {
            peaks.push(i);
            i += offlineCtx.sampleRate / 4; 
        }
    }

    if (peaks.length < 2) return 120; 

    let intervals = [];
    for (let i = 1; i < peaks.length; i++) {
        intervals.push(peaks[i] - peaks[i - 1]);
    }

    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];
    
    let bpm = (60 * offlineCtx.sampleRate) / medianInterval;
    
    while (bpm < 60) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    
    return Math.round(bpm);
};