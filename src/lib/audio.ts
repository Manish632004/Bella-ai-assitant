/**
 * Audio handling utility for Bella Live API Voice stream.
 * Handles:
 * - 16kHz layout sampling for microphone stream.
 * - Raw Little Endian Int16 PCM translation.
 * - 24kHz layout output sampling for model voice playback.
 * - Gapless double-buffer queue scheduler.
 * - Interrupt signal immediate stop.
 * - Input & Output AnalyserNodes for real-time waveform visuals.
 */

export type LiveState = "disconnected" | "connecting" | "listening" | "speaking";

// PCM Conversion Helper: converts Float32Array [-1.0, 1.0] to signed Int16 Raw PCM Little Endian
function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

// Float conversion helper: converts signed Int16 array buffer to Float32Array [-1.0, 1.0]
function pcm16ToFloats(uint8Array: Uint8Array): Float32Array {
  const int16 = new Int16Array(
    uint8Array.buffer,
    uint8Array.byteOffset,
    uint8Array.byteLength / 2
  );
  const floats = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    floats[i] = int16[i] / 32768.0;
  }
  return floats;
}

// Convert ArrayBuffer to Base64 String
function base64ArrayBuffer(arrayBuffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Convert Base64 string to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export class BellaAudioSession {
  private ws: WebSocket | null = null;
  
  // Audios contexts (separate to match exact required sample rates)
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  
  // Audio sources & processors
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micProcessorNode: ScriptProcessorNode | null = null;
  
  // Visualisers
  public inputAnalyser: AnalyserNode | null = null;
  public outputAnalyser: AnalyserNode | null = null;
  private outputGainNode: GainNode | null = null;
  
  // Buffering / Playback details
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  
  // State Callbacks
  private onStateChange: (state: LiveState) => void;
  private onTranscription: (role: "user" | "model", text: string) => void;
  private onToolCall: (name: string, args: any, callback: (result: any) => void) => void;
  private onError: (error: string) => void;
  private onMemorySync?: (memories: any[]) => void;
  private onDashboardSync?: () => void;
  private onStartScreenShare?: () => void;
  private onStopScreenShare?: () => void;
  private onMiniModeChange?: (enabled: boolean) => void;
  private onCameraModeChange?: (mode: string) => void;
  
  private currentState: LiveState = "disconnected";
  private isActivated = false;
  private sessionId: string;

  private onProactiveInit?: (settings: any, suggestions: any[]) => void;
  private onProactiveSuggestion?: (suggestion: any) => void;

  constructor(handlers: {
    onStateChange: (state: LiveState) => void;
    onTranscription: (role: "user" | "model", text: string) => void;
    onToolCall: (name: string, args: any, callback: (result: any) => void) => void;
    onError: (error: string) => void;
    onMemorySync?: (memories: any[]) => void;
    onDashboardSync?: () => void;
    onStartScreenShare?: () => void;
    onStopScreenShare?: () => void;
    onMiniModeChange?: (enabled: boolean) => void;
    onCameraModeChange?: (mode: string) => void;
    onProactiveInit?: (settings: any, suggestions: any[]) => void;
    onProactiveSuggestion?: (suggestion: any) => void;
  }, sessionId?: string) {
    this.sessionId = sessionId || `bella_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.onStateChange = handlers.onStateChange;
    this.onTranscription = handlers.onTranscription;
    this.onToolCall = handlers.onToolCall;
    this.onError = handlers.onError;
    this.onMemorySync = handlers.onMemorySync;
    this.onDashboardSync = handlers.onDashboardSync;
    this.onStartScreenShare = handlers.onStartScreenShare;
    this.onStopScreenShare = handlers.onStopScreenShare;
    this.onMiniModeChange = handlers.onMiniModeChange;
    this.onCameraModeChange = handlers.onCameraModeChange;
    this.onProactiveInit = handlers.onProactiveInit;
    this.onProactiveSuggestion = handlers.onProactiveSuggestion;
  }

  private setState(state: LiveState) {
    this.currentState = state;
    this.onStateChange(state);
  }

  public getState(): LiveState {
    return this.currentState;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Pushes a compressed JPEG base64 screenshot frame directly to the live WebSocket server.
   */
  public sendVideoFrame(base64Data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && (this.currentState === "listening" || this.currentState === "speaking")) {
      const clean = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
      if (clean && clean.length > 50) {
        this.ws.send(JSON.stringify({ type: "video", video: clean }));
      }
    }
  }

  /**
   * Send proactive suggestion feedback to the server.
   */
  public sendProactiveFeedback(suggestionId: string, action: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "proactive_feedback", suggestionId, action }));
    }
  }

  /**
   * Send proactive settings update to the server.
   */
  public sendProactiveUpdateSettings(patch: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "proactive_update_settings", patch }));
    }
  }

  // Requests microphone and creates connections
  public async connect() {
    if (this.isActivated) return;
    this.isActivated = true;
    this.setState("connecting");

    try {
      // 1. Establish custom WebSocket server bridge with persistent session ID
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      this.ws = new WebSocket(`${protocol}//${window.location.host}/live?sessionId=${encodeURIComponent(this.sessionId)}`);
      this.ws.binaryType = "blob";

      this.ws.onopen = async () => {
        console.log("[Bella] Connected to server side WS bridge (sessionId:", this.sessionId, ")");
        try {
          // Guard against early user disconnect during connection setup
          if (!this.isActivated) return;

          // Safe, cross-browser AudioContext initialization
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextClass) {
            throw new Error("Holographic audio link unsupported: Web Audio API missing in browser.");
          }

          this.inputAudioCtx = new AudioContextClass({ sampleRate: 16000 });
          // Native system output context eliminates Windows WASAPI driver downsampling jitter
          this.outputAudioCtx = new AudioContextClass();

          // Ensure Audio Contexts are active and resumed to bypass browser security blocks
          if (this.inputAudioCtx.state === "suspended") {
            await this.inputAudioCtx.resume().catch(() => {});
          }
          if (this.outputAudioCtx.state === "suspended") {
            await this.outputAudioCtx.resume().catch(() => {});
          }
          
          // Setup custom output Analyser & Volume Gains
          this.outputGainNode = this.outputAudioCtx.createGain();
          this.outputGainNode.gain.value = 1.0;
          this.outputAnalyser = this.outputAudioCtx.createAnalyser();
          this.outputAnalyser.fftSize = 256;
          this.outputAnalyser.smoothingTimeConstant = 0.8;
          
          this.outputGainNode.connect(this.outputAnalyser);
          this.outputAnalyser.connect(this.outputAudioCtx.destination);
          
          // Obtain User Microphone layout with enhanced hardware echo suppression
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          });

          // Safeguard: Check if we disconnected while waiting for user to grant mic permissions
          if (!this.isActivated || !this.inputAudioCtx || !this.outputAudioCtx) {
            stream.getTracks().forEach((track) => {
              try {
                track.stop();
              } catch (e) {}
            });
            return;
          }

          this.micStream = stream;

          // Setup custom input Analyser
          this.inputAnalyser = this.inputAudioCtx.createAnalyser();
          this.inputAnalyser.fftSize = 256;
          
          this.micSourceNode = this.inputAudioCtx.createMediaStreamSource(this.micStream);
          this.micSourceNode.connect(this.inputAnalyser);

          // Stream input PCM 16-bit to WS
          this.micProcessorNode = this.inputAudioCtx.createScriptProcessor(2048, 1, 1);
          this.micSourceNode.connect(this.micProcessorNode);
          this.micProcessorNode.connect(this.inputAudioCtx.destination);

          this.micProcessorNode.onaudioprocess = (e) => {
            if (this.currentState === "disconnected" || this.currentState === "connecting") return;
            
            const channelData = e.inputBuffer.getChannelData(0);
            
            // While Bella is actively speaking, calculate energy to prevent speaker bleed
            // from falsely triggering Gemini Live VAD self-interruptions
            const isSpeaking = this.currentState === "speaking" || this.activeSources.length > 0;
            if (isSpeaking) {
              let sumSquares = 0;
              for (let i = 0; i < channelData.length; i++) {
                sumSquares += channelData[i] * channelData[i];
              }
              const rms = Math.sqrt(sumSquares / channelData.length);
              // If energy is below the deliberate user speech threshold, suppress speaker echo
              if (rms < 0.040) {
                return;
              }
            }
            
            // Convert to base64 Int16 Little Endian PCM
            const pcmBuffer = floatTo16BitPCM(channelData);
            const base64 = base64ArrayBuffer(pcmBuffer);
            
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ audio: base64 }));
            }
          };

          // Sound setups are fully functional
          this.setState("listening");

        } catch (audioError: any) {
          console.error("Audio Context or Microphone Initialization Failed:", audioError);
          this.onError(`Permission error: ${audioError.message || "Microphone required for holographic Live link."}`);
          this.disconnect();
        }
      };

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Root Error Handler message
          if (data.type === "error") {
            this.onError(data.error);
            this.disconnect();
            return;
          }

          // Handle server-side states
          if (data.type === "status") {
            console.log("[Bella WS Status]:", data.status);
            if (data.status === "connecting_gemini") {
              // Wait for Gemini Live connection
            } else if (data.status === "connected") {
              this.setState("listening");
            } else if (data.status === "session_closed") {
              this.disconnect();
            }
            return;
          }

          if (data.type === "mini_mode" && this.onMiniModeChange) {
            this.onMiniModeChange(Boolean(data.enabled));
          }

          if (data.type === "camera_mode" && this.onCameraModeChange) {
            this.onCameraModeChange(data.mode);
          }

          // Handle audio payload (24kHzPCM model response)
          if (data.type === "audio" && data.audio) {
            this.playAudioPCMChunk(data.audio);
          }

          // Handle interruption signal (e.g. user talked over Bella)
          if (data.type === "interrupted") {
            this.handleInterruption();
          }

          // Turn complete
          if (data.type === "turnComplete") {
            // Once Bella completes speaking, change visual state back to listening
            setTimeout(() => {
              if (this.activeSources.length === 0 && this.currentState === "speaking") {
                this.setState("listening");
              }
            }, 100);
          }

          // Handle live captions transcription
          if (data.type === "transcription") {
            this.onTranscription(data.role, data.text);
          }

          // Handle memory synchronization
          if (data.type === "memory_sync" && data.memories) {
            if (this.onMemorySync) {
              this.onMemorySync(data.memories);
            }
          }

          // Handle dashboard synchronization (live updates from voice tools)
          if (data.type === "dashboard_sync" && this.onDashboardSync) {
            this.onDashboardSync();
          }

          // Handle screen sharing voice activation
          if (data.type === "start_screen_share" && this.onStartScreenShare) {
            this.onStartScreenShare();
          }

          if (data.type === "stop_screen_share" && this.onStopScreenShare) {
            this.onStopScreenShare();
          }

          // Handle proactive intelligence init
          if (data.type === "proactive_init" && this.onProactiveInit) {
            this.onProactiveInit(data.settings, data.suggestions || []);
          }

          // Handle real-time proactive suggestion
          if (data.type === "proactive_suggestion" && data.suggestion && this.onProactiveSuggestion) {
            this.onProactiveSuggestion(data.suggestion);
          }

          // Handle Tool Calling
          if (data.type === "toolCall") {
            const { callId, name, args } = data;
            this.onToolCall(name, args, (result) => {
              // Send back execution result to server bridge
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                  type: "toolResponse",
                  id: callId,
                  name: name,
                  output: result
                }));
              }
            });
          }

        } catch (parseError) {
          console.error("Error reading server packet:", parseError);
        }
      };

      this.ws.onerror = (wsError) => {
        if (!this.isActivated) return;
        console.warn("WebSocket transport error:", wsError);
        this.onError("Holographic network link lost. Please check connection.");
        this.disconnect();
      };

      this.ws.onclose = (event) => {
        console.log("WebSocket connection closed", event.code, event.reason);
        if (this.isActivated && event.code !== 1000 && event.code !== 1005) {
          this.onError("Holographic link disconnected. Re-awake Bella to continue.");
        }
        this.disconnect();
      };

    } catch (e: any) {
      console.error("Connection establish sequence failed:", e);
      if (this.isActivated) {
        this.onError(e.message || "Failed to initialize active channel.");
      }
      this.disconnect();
    }
  }

  // Interruption triggers: stops all active audio players immediately
  private handleInterruption() {
    console.log("[Audio] Interruption signal received; flushing play logs.");
    
    // Stop all playing nodes
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch (err) {
        // Already finished or stopped
      }
    });
    this.activeSources = [];
    this.nextStartTime = 0;
    
    // Set state back to user listening
    this.setState("listening");
  }

  // Direct raw PCM chunk scheduled playback at 24kHz
  private playAudioPCMChunk(base64Audio: string) {
    if (!this.outputAudioCtx || !this.outputGainNode) return;

    try {
      this.setState("speaking");
      const uint8Array = base64ToUint8Array(base64Audio);
      const floats = pcm16ToFloats(uint8Array);

      // Create AudioBuffer of 24000Hz (the exact playback sample rate of Gemini outputs)
      const buffer = this.outputAudioCtx.createBuffer(1, floats.length, 24000);
      buffer.getChannelData(0).set(floats);

      // Create Buffer source
      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = buffer;

      // Connect source to gain which is routed to analyser & speakers
      source.connect(this.outputGainNode);

      const currentTime = this.outputAudioCtx.currentTime;
      
      // Gapless jitter-free scheduler sync
      if (this.nextStartTime < currentTime) {
        // Start fresh with a 65ms buffer lead to bridge network packet jitter and prevent audio stutter
        this.nextStartTime = currentTime + 0.065;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;

      // Keep reference to handle real-time interruptions
      source.onended = () => {
        const index = this.activeSources.indexOf(source);
        if (index > -1) {
          this.activeSources.splice(index, 1);
        }
        
        // Revert back to listening only when all queued chunks finish playing
        if (this.activeSources.length === 0 && this.currentState === "speaking") {
          const now = this.outputAudioCtx ? this.outputAudioCtx.currentTime : currentTime;
          if (now >= this.nextStartTime - 0.03) {
            this.setState("listening");
          } else {
            const remainingMs = Math.max(10, (this.nextStartTime - now) * 1000);
            setTimeout(() => {
              if (this.activeSources.length === 0 && this.currentState === "speaking") {
                this.setState("listening");
              }
            }, remainingMs + 10);
          }
        }
      };

      this.activeSources.push(source);

    } catch (playbackError) {
      console.error("PCM Chunk buffering/playback failed:", playbackError);
    }
  }

  // Fully cleanup and release microphones & connection sockets
  public disconnect() {
    this.isActivated = false;
    this.setState("disconnected");

    // Close WS socket cleanly without triggering error handler
    if (this.ws) {
      try {
        const socket = this.ws;
        this.ws = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, "Normal sleep/disconnect");
        }
      } catch (e) {}
    }

    // Stop and release user microphone streams
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      this.micStream = null;
    }

    // Disconnect routing nodes
    if (this.micProcessorNode) {
      try {
        this.micProcessorNode.disconnect();
      } catch (e) {}
      this.micProcessorNode = null;
    }

    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect();
      } catch (e) {}
      this.micSourceNode = null;
    }

    // Close Audio contexts
    if (this.inputAudioCtx) {
      try {
        this.inputAudioCtx.close();
      } catch (e) {}
      this.inputAudioCtx = null;
    }

    if (this.outputAudioCtx) {
      try {
        this.outputAudioCtx.close();
      } catch (e) {}
      this.outputAudioCtx = null;
    }

    this.activeSources = [];
    this.nextStartTime = 0;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.outputGainNode = null;
  }
}
