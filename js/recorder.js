/**
 * recorder.js — Guided video recording with prompt overlay
 * Uses MediaRecorder API + cycling prompts per phase
 */

import { encryptData } from './crypto.js';
import { saveCapsule, getState, showToast, addHistoryEntry, getNextCapsuleNumber } from './app.js';

// ── Prompt phases ──────────────────────────────────────────────────────────

const PHASES = [
    {
        id: 'identification',
        label: '🪪 Identification',
        prompts: [
            'Bonjour, je me présente…',
            'Mon nom est {name}, nous sommes le {date}.',
            'J\'enregistre mes directives anticipées en psychiatrie.',
        ],
        duration: 30  // seconds
    },
    {
        id: 'pathologie',
        label: '🧠 Pathologie & Signes d\'alerte',
        prompts: [
            'Ma pathologie principale est…',
            'Quand je vais moins bien, les signes sont…',
            'Ce qui m\'aide à reconnaître une crise est…',
        ],
        duration: 60
    },
    {
        id: 'directives',
        label: '📋 Mes Directives de Soins',
        prompts: [
            'En cas de crise, je souhaite que l\'on…',
            'Je refuse expressément…',
            'Mon traitement habituel est…',
            'Ma personne de confiance est…',
        ],
        duration: 90
    },
    {
        id: 'espoir',
        label: '💚 Mon Message d\'Espoir',
        prompts: [
            'À toi, moi du futur, je veux te dire…',
            'Tu as traversé des moments difficiles avant, et tu t\'en es sorti(e).',
            'Voici ce qui m\'a aidé à tenir : …',
            'Je crois en toi. Tu es plus fort(e) que tu ne le crois.',
        ],
        duration: 45
    }
];

// ── Recorder class ─────────────────────────────────────────────────────────

export class GuidedRecorder {
    constructor(opts = {}) {
        this.videoEl = opts.videoEl;        // <video> preview element
        this.overlayPhase = opts.overlayPhase;   // .prompt-phase span
        this.overlayText = opts.overlayText;    // .prompt-text span
        this.phaseDots = opts.phaseDots;      // NodeList of .phase-dot
        this.promptList = opts.promptList;     // NodeList of .prompt-list li
        this.timerEl = opts.timerEl;        // timer display element
        this.recDot = opts.recDot;         // blinking dot element
        this.onSaved = opts.onSaved || (() => { });

        this.stream = null;
        this.mediaRecorder = null;
        this.chunks = [];
        this.isRecording = false;

        this.phaseIndex = 0;
        this.promptIndex = 0;
        this.elapsedSec = 0;
        this._timerInterval = null;
        this._promptInterval = null;
    }

    // Initialize camera stream
    async initCamera() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: true
            });
            this.videoEl.srcObject = this.stream;
            this.videoEl.muted = true;
            await this.videoEl.play();
            return true;
        } catch (err) {
            console.error('Camera error:', err);
            showToast('Impossible d\'accéder à la caméra. Vérifiez les permissions.');
            return false;
        }
    }

    // Start recording
    async start() {
        if (!this.stream) {
            const ok = await this.initCamera();
            if (!ok) return;
        }

        this.chunks = [];
        this.phaseIndex = 0;
        this.promptIndex = 0;
        this.elapsedSec = 0;

        const mimeType = getSupportedMimeType();
        this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
        this.mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) this.chunks.push(e.data);
        };
        this.mediaRecorder.start(1000); // collect data every second
        this.isRecording = true;

        // Update UI
        if (this.recDot) this.recDot.classList.add('recording');

        this._startTimer();
        this._startPrompts();
        this._updatePhaseUI();
    }

    // Stop recording and save
    async stop(skipSave = false) {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;

        this._stopTimer();
        this._stopPrompts();
        this.isRecording = false;
        if (this.recDot) this.recDot.classList.remove('recording');

        return new Promise(resolve => {
            this.mediaRecorder.onstop = async () => {
                const mimeType = getSupportedMimeType();
                const blob = new Blob(this.chunks, { type: mimeType });
                
                // Trigger auto download of the unencrypted file locally
                const state = getState();
                const userName = state.name || 'Capsule';
                const now = new Date();
                const dateStr = `${now.getDate().toString().padStart(2, '0')}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getFullYear()}`;
                const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
                const filename = `DAP_${userName}_${dateStr}.${ext}`;
                
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);

                if (!skipSave) {
                    await this._saveEncrypted(blob);
                }
                resolve(blob);
            };
            this.mediaRecorder.stop();
        });
    }

    pause() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.pause();
            this._stopTimer();
            this._stopPrompts();
            if (this.recDot) this.recDot.classList.remove('recording');
        }
    }

    resume() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
            this.mediaRecorder.resume();
            this._startTimer();
            this._startPrompts();
            if (this.recDot) this.recDot.classList.add('recording');
        }
    }

    // Destroy camera stream
    destroy() {
        this._stopTimer();
        this._stopPrompts();
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
    }

    // ── Private ────────────────────────────────────────────────────────────

    _startTimer() {
        this._timerInterval = setInterval(() => {
            this.elapsedSec++;
            if (this.timerEl) this.timerEl.textContent = formatTime(this.elapsedSec);

            // Auto-advance phase based on duration
            const phase = PHASES[this.phaseIndex];
            if (phase && this.elapsedSec >= this._phaseStartSec() + phase.duration) {
                if (this.phaseIndex < PHASES.length - 1) {
                    this.phaseIndex++;
                    this.promptIndex = 0;
                    this._updatePhaseUI();
                }
            }
        }, 1000);
    }

    _stopTimer() {
        clearInterval(this._timerInterval);
    }

    _startPrompts() {
        this._showCurrentPrompt();
        this._promptInterval = setInterval(() => {
            const phase = PHASES[this.phaseIndex];
            if (!phase) return;
            if (this.promptIndex < phase.prompts.length - 1) {
                this.promptIndex++;
            } else {
                this.promptIndex = 0;
            }
            this._showCurrentPrompt();
        }, 8000); // cycle every 8 seconds
    }

    _stopPrompts() {
        clearInterval(this._promptInterval);
    }

    _phaseStartSec() {
        let sec = 0;
        for (let i = 0; i < this.phaseIndex; i++) sec += PHASES[i].duration;
        return sec;
    }

    _showCurrentPrompt() {
        const phase = PHASES[this.phaseIndex];
        if (!phase) return;
        const state = getState();
        const now = new Date().toLocaleDateString('fr-FR');
        let text = phase.prompts[this.promptIndex]
            .replace('{name}', state.name || '…')
            .replace('{date}', now);

        if (this.overlayPhase) this.overlayPhase.textContent = phase.label;
        if (this.overlayText) this.overlayText.textContent = text;

        // Update prompt list
        if (this.promptList) {
            this.promptList.forEach((li, i) => {
                li.className = i < this.phaseIndex ? 'done'
                    : i === this.phaseIndex ? 'active'
                        : '';
            });
        }
    }

    _updatePhaseUI() {
        if (this.phaseDots) {
            this.phaseDots.forEach((dot, i) => {
                dot.className = 'phase-dot' + (i < this.phaseIndex ? ' done' : i === this.phaseIndex ? ' active' : '');
            });
        }
        this._showCurrentPrompt();
    }

    async _saveEncrypted(blob) {
        try {
            const state = getState();
            const pin = state.pin;
            const userId = state.name;

            const buffer = await blob.arrayBuffer();
            const encrypted = await encryptData(buffer, pin);

            await saveCapsule({
                id: userId,
                encryptedVideo: encrypted,
                mimeType: blob.type,
                duration: this.elapsedSec,
                recordedAt: new Date().toISOString()
            });

            showToast('✅ Capsule sauvegardée en toute sécurité !');

            // Log dans l'historique
            try {
                const capsuleNum = await getNextCapsuleNumber();
                await addHistoryEntry({
                    type: 'record',
                    details: {
                        capsuleNumber: capsuleNum,
                        duration: this.elapsedSec
                    }
                });
            } catch (e) { console.warn('History log error:', e); }

            this.onSaved();
        } catch (err) {
            console.error('Save error:', err);
            showToast('❌ Erreur lors de la sauvegarde.');
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
}

function getSupportedMimeType() {
    const types = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
    ];
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
}

export { PHASES };
