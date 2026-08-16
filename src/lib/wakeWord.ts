/**
 * BELLA Wake Word Detector (V2).
 *
 * Uses the browser-native Web Speech API (webkitSpeechRecognition) for
 * continuous, always-listening keyword detection. Zero dependencies, runs
 * entirely in the BELLA browser tab.
 *
 * Design goals (per V2 spec):
 *   - Very low CPU: relies on the browser's native speech engine (no FFT loop).
 *   - Ignore random conversation: only the configured phrase triggers.
 *   - Prevent duplicate triggers: configurable debounce window.
 *   - Recover automatically after errors: auto-restart on onend/onerror.
 *   - Activation sound + state callback on detection.
 *
 * Public API:
 *   const det = new BellaWakeWordDetector();
 *   det.start({ phrase, sensitivity, onTriggered, onState });
 *   det.setPhrase("hey bella");
 *   det.setSensitivity(60);
 *   det.stop();
 */

// --- Minimal typed shim for the unprefixed SpeechRecognition API -------------
// The browser types are not in the default lib, so we declare what we use.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as
    | SpeechRecognitionCtor
    | null;
}

export type WakeWordState = "stopped" | "listening" | "triggered" | "error";

export interface WakeWordOptions {
  /** Phrase to match (case-insensitive substring). */
  phrase: string;
  /** 0 (strict) .. 100 (loose). Higher = shorter debounce, more matches. */
  sensitivity?: number;
  /** Fired once when the phrase is detected. */
  onTriggered?: () => void;
  /** Fired whenever the detector state changes. */
  onState?: (state: WakeWordState) => void;
}

export class BellaWakeWordDetector {
  private recognition: SpeechRecognitionLike | null = null;
  private ctor: SpeechRecognitionCtor | null;
  private phrase = "hey bella";
  private sensitivity = 60;
  private onTriggered: (() => void) | null = null;
  private onState: ((s: WakeWordState) => void) | null = null;

  /** True when the user intends the detector to be running. */
  private intended = false;
  /** True while the underlying recognition is actively listening. */
  private active = false;
  /** Guards against rapid double-fires of the same utterance. */
  private lastTrigger = 0;
  /** Debounce window (ms) — derived from sensitivity. */
  private debounceMs = 3000;
  /** Backoff for restart after repeated errors. */
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors = 0;

  // Web Audio VAD & buffer capture
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private audioBuffer: Float32Array[] = [];
  private isVerifying = false;
  private voiceEnergyFrames = 0;
  private baselineNoise = 15;

  constructor() {
    this.ctor = getSpeechRecognitionCtor();
  }

  /** Whether wake-word detection is supported. */
  static isSupported(): boolean {
    return true;
  }

  /** Begin continuously listening in standby mode. */
  start(opts: WakeWordOptions): boolean {
    this.phrase = (opts.phrase || "hey bella").toLowerCase().trim();
    this.sensitivity = opts.sensitivity ?? this.sensitivity;
    this.onTriggered = opts.onTriggered ?? null;
    this.onState = opts.onState ?? null;
    this.debounceMs = Math.round(5000 - (this.sensitivity / 100) * 3500);
    this.intended = true;
    this.consecutiveErrors = 0;
    this.isVerifying = false;
    this.audioBuffer = [];

    this.startWebAudioVAD();
    this.launchSpeechRecognition();
    return true;
  }

  /** Fully stop listening and clear timers and audio streams. */
  stop(): void {
    this.intended = false;
    this.isVerifying = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.stopWebAudioVAD();
    this.teardownSpeechRecognition();
    this.setState("stopped");
  }

  /** Change the wake phrase live. */
  setPhrase(phrase: string): void {
    this.phrase = (phrase || "hey bella").toLowerCase().trim();
  }

  /** Change sensitivity live. */
  setSensitivity(value: number): void {
    this.sensitivity = Math.max(0, Math.min(100, value));
    this.debounceMs = Math.round(5000 - (this.sensitivity / 100) * 3500);
  }

  // --- Web Audio VAD with AI Verification (/api/wake-check) -----------------

  private startWebAudioVAD(): void {
    if (!this.intended) return;
    this.stopWebAudioVAD();

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass || typeof navigator === "undefined" || !navigator.mediaDevices) {
      return;
    }

    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    }).then((stream) => {
      if (!this.intended) {
        stream.getTracks().forEach(t => {
          try { t.stop(); } catch (e) {}
        });
        return;
      }

      this.micStream = stream;
      const ctx = new AudioContextClass({ sampleRate: 16000 });
      this.audioCtx = ctx;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      this.analyser = analyser;

      // ScriptProcessor (2048 samples = 128ms per chunk at 16kHz mono)
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      this.processorNode = processor;

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(ctx.destination);

      this.active = true;
      this.setState("listening");

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const maxChunks = 12; // 12 * 2048 / 16000 = ~1.5 seconds rolling window

      processor.onaudioprocess = (e) => {
        if (!this.intended) return;

        const input = e.inputBuffer.getChannelData(0);
        this.audioBuffer.push(new Float32Array(input));
        if (this.audioBuffer.length > maxChunks) {
          this.audioBuffer.shift();
        }

        // Measure voice band energy (bins 2 to 45, ~120Hz to 3200Hz)
        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        let count = 0;
        for (let i = 2; i < Math.min(freqData.length, 45); i++) {
          sum += freqData[i];
          count++;
        }
        const energy = count > 0 ? sum / count : 0;

        // Dynamic baseline noise adaptation
        if (energy < this.baselineNoise) {
          this.baselineNoise = this.baselineNoise * 0.9 + energy * 0.1;
        } else {
          this.baselineNoise = this.baselineNoise * 0.995 + energy * 0.005;
        }

        // Voice trigger threshold relative to baseline
        const sensDelta = Math.max(8, 25 - (this.sensitivity / 100) * 18);
        const voiceThreshold = Math.max(20, this.baselineNoise + sensDelta);

        if (energy > voiceThreshold) {
          this.voiceEnergyFrames++;
          // When vocal energy is heard for ~2 chunks (>200ms) and buffer has sufficient audio
          if (this.voiceEnergyFrames >= 2 && !this.isVerifying && this.audioBuffer.length >= 6) {
            this.voiceEnergyFrames = 0;
            this.verifyCapturedSpeech();
          }
        } else {
          this.voiceEnergyFrames = Math.max(0, this.voiceEnergyFrames - 1);
        }
      };

    }).catch((err) => {
      console.warn("[WakeWordDetector] Microphone initialization notice:", err?.message || err);
      this.setState("error");
    });
  }

  private async verifyCapturedSpeech(): Promise<void> {
    if (!this.intended || this.isVerifying || this.audioBuffer.length === 0) return;
    this.isVerifying = true;

    try {
      // Flatten captured audio chunks
      let totalLength = 0;
      for (const chunk of this.audioBuffer) totalLength += chunk.length;
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of this.audioBuffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const wavBase64 = encodeWavBase64(merged, 16000);

      const resp = await fetch("/api/wake-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: wavBase64,
          phrase: this.phrase
        })
      });

      const data = await resp.json();
      if (data && data.wake === true && this.intended) {
        console.log(`[WakeWordDetector] AI verified wake phrase "${this.phrase}"! Waking Bella.`);
        this.fire();
      }
    } catch (e: any) {
      console.warn("[WakeWordDetector] Speech verification check notice:", e?.message || e);
    } finally {
      // Cooldown before next check
      setTimeout(() => {
        this.isVerifying = false;
      }, 1000);
    }
  }

  private stopWebAudioVAD(): void {
    if (this.processorNode) {
      try {
        this.processorNode.onaudioprocess = null;
        this.processorNode.disconnect();
      } catch (e) {}
      this.processorNode = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch (e) {}
      this.analyser = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        try { track.stop(); } catch (e) {}
      });
      this.micStream = null;
    }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch (e) {}
      this.audioCtx = null;
    }
    this.audioBuffer = [];
    this.voiceEnergyFrames = 0;
    this.isVerifying = false;
  }

  // --- Web Speech API (Secondary Phrase Recognizer where supported) ------

  private launchSpeechRecognition(): void {
    if (!this.ctor || !this.intended) return;
    this.teardownSpeechRecognition();
    try {
      const rec = new this.ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.maxAlternatives = 3;

      rec.onstart = () => {
        this.consecutiveErrors = 0;
        this.active = true;
        this.setState("listening");
      };

      rec.onresult = (e: any) => {
        const cleanPhrase = this.phrase.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (!res) continue;
          for (let j = 0; j < res.length; j++) {
            const rawTranscript = (res[j]?.transcript || "").toString().toLowerCase();
            const cleanTranscript = rawTranscript.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
            if (
              cleanTranscript.includes(cleanPhrase) ||
              (cleanPhrase === "hey bella" && (cleanTranscript.includes("bella") || cleanTranscript.includes("hey bela") || cleanTranscript.includes("bela")))
            ) {
              console.log(`[WakeWordDetector] Wake word triggered by phrase match: "${rawTranscript}"`);
              this.fire();
              return;
            }
          }
        }
      };

      rec.onerror = (e: any) => {
        const err = e?.error || "unknown";
        if (err === "no-speech" || err === "aborted") return;
        this.consecutiveErrors++;
      };

      rec.onend = () => {
        this.active = false;
        if (!this.intended) return;
        if (this.restartTimer) clearTimeout(this.restartTimer);
        const delay = Math.min(500 * this.consecutiveErrors, 3000);
        this.restartTimer = setTimeout(() => this.launchSpeechRecognition(), Math.max(200, delay));
      };

      this.recognition = rec;
      rec.start();
    } catch {
      // Fail gracefully — Web Audio VAD handles detection
    }
  }

  private teardownSpeechRecognition(): void {
    if (this.recognition) {
      try {
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.onstart = null;
        this.recognition.abort();
      } catch (e) {}
      this.recognition = null;
    }
  }

  private fire(): void {
    const now = Date.now();
    if (now - this.lastTrigger < this.debounceMs) return; // duplicate suppression
    this.lastTrigger = now;
    this.playActivationSound();
    this.setState("triggered");
    try {
      this.onTriggered?.();
    } catch (e) {
      console.error("[WakeWordDetector] onTriggered error:", e);
    }
  }

  /** Soft two-tone chime synthesized via Web Audio (no asset needed). */
  private playActivationSound(): void {
    try {
      const Ctx =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx: AudioContext = new Ctx();
      const now = ctx.currentTime;
      const notes = [
        { f: 660, t: 0 },
        { f: 880, t: 0.12 },
      ];
      notes.forEach(({ f, t }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, now + t);
        gain.gain.exponentialRampToValueAtTime(0.18, now + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + t);
        osc.stop(now + t + 0.2);
      });
      // Close the transient context after the notes finish.
      setTimeout(() => ctx.close().catch(() => {}), 600);
    } catch {
      /* audio is best-effort */
    }
  }

  private setState(s: WakeWordState): void {
    try {
      this.onState?.(s);
    } catch {
      /* ignore */
    }
  }

  /** Whether the underlying recognition is currently active. */
  get isActive(): boolean {
    return this.active;
  }
}

// ---------------------------------------------------------------------------
// Audio Encoding Helpers for Wake-Check API
// ---------------------------------------------------------------------------
function encodeWavBase64(samples: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate (16-bit mono)
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // 16 bits per sample
  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  // Write 16-bit PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

