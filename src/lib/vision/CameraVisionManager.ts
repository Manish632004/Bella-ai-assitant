/**
 * Camera Vision Manager
 * Handles privacy-first camera hardware access, device switching,
 * resolution scaling, and adaptive frame sampling.
 */

import { CameraDeviceInfo, VisionMode, VisionSamplingConfig } from "./types";

const DEFAULT_CONFIG: VisionSamplingConfig = {
  snapshotMaxDim: 960,
  jpegQuality: 0.65,
  conversationFps: 0.5,
  realtimeFps: 1.0
};

export class CameraVisionManager {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private currentMode: VisionMode = "OFF";
  private selectedDeviceId: string = "";
  private samplingTimer: any = null;
  private config: VisionSamplingConfig = DEFAULT_CONFIG;
  private onFrameCaptured?: (base64Jpeg: string) => void;
  private onModeChange?: (mode: VisionMode) => void;
  private onStatusChange?: (status: string) => void;

  constructor(callbacks?: {
    onFrameCaptured?: (base64Jpeg: string) => void;
    onModeChange?: (mode: VisionMode) => void;
    onStatusChange?: (status: string) => void;
  }) {
    if (callbacks) {
      this.onFrameCaptured = callbacks.onFrameCaptured;
      this.onModeChange = callbacks.onModeChange;
      this.onStatusChange = callbacks.onStatusChange;
    }
  }

  public async getAvailableCameras(): Promise<CameraDeviceInfo[]> {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return [];
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === "videoinput")
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${index + 1}`
        }));
    } catch (err) {
      console.warn("[CameraVision] Enumerate cameras error:", err);
      return [];
    }
  }

  public getMode(): VisionMode {
    return this.currentMode;
  }

  public isStreaming(): boolean {
    return this.stream !== null && this.currentMode !== "OFF";
  }

  public async startCamera(deviceId?: string, mode: VisionMode = "CONVERSATION"): Promise<boolean> {
    try {
      this.stopCamera();

      if (deviceId) {
        this.selectedDeviceId = deviceId;
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: this.selectedDeviceId ? { exact: this.selectedDeviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 15 }
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (!this.videoElement) {
        this.videoElement = document.createElement("video");
        this.videoElement.autoplay = true;
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
      }

      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();

      this.setMode(mode);
      if (this.onStatusChange) this.onStatusChange("Camera Connected");
      return true;
    } catch (err: any) {
      console.error("[CameraVision] Failed to start camera:", err);
      if (this.onStatusChange) this.onStatusChange(`Camera Error: ${err.message || err}`);
      this.stopCamera();
      return false;
    }
  }

  public stopCamera(): void {
    if (this.samplingTimer) {
      clearInterval(this.samplingTimer);
      this.samplingTimer = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {}
      });
      this.stream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    this.setMode("OFF");
    if (this.onStatusChange) this.onStatusChange("Camera Dormant (Off)");
  }

  public setMode(mode: VisionMode): void {
    this.currentMode = mode;
    if (this.onModeChange) this.onModeChange(mode);

    if (this.samplingTimer) {
      clearInterval(this.samplingTimer);
      this.samplingTimer = null;
    }

    if (mode === "OFF") {
      return;
    }

    if (mode === "CONVERSATION") {
      // 0.5 FPS (1 frame every 2 seconds)
      const intervalMs = Math.round(1000 / this.config.conversationFps);
      this.samplingTimer = setInterval(() => {
        this.captureAndEmitFrame();
      }, intervalMs);
    } else if (mode === "REAL-TIME") {
      // 1.0 FPS (1 frame every 1 second)
      const intervalMs = Math.round(1000 / this.config.realtimeFps);
      this.samplingTimer = setInterval(() => {
        this.captureAndEmitFrame();
      }, intervalMs);
    }
  }

  public captureSnapshot(): string | null {
    return this.captureAndEmitFrame();
  }

  private captureAndEmitFrame(): string | null {
    if (!this.videoElement || !this.stream || this.videoElement.readyState < 2) {
      return null;
    }

    try {
      if (!this.canvasElement) {
        this.canvasElement = document.createElement("canvas");
      }

      const canvas = this.canvasElement;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      const video = this.videoElement;
      let width = video.videoWidth || 640;
      let height = video.videoHeight || 480;
      const maxDim = this.config.snapshotMaxDim;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(video, 0, 0, width, height);

      const dataUrl = canvas.toDataURL("image/jpeg", this.config.jpegQuality);
      const base64 = dataUrl.split(",")[1];

      if (base64 && this.onFrameCaptured) {
        this.onFrameCaptured(base64);
      }

      return base64;
    } catch (err) {
      console.error("[CameraVision] Frame capture error:", err);
      return null;
    }
  }

  public attachPreviewVideo(targetVideo: HTMLVideoElement): void {
    if (this.stream) {
      targetVideo.srcObject = this.stream;
      targetVideo.play().catch(e => console.warn("[CameraVision] Preview play error:", e));
    }
  }
}
