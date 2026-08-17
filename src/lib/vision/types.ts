/**
 * Core Types for Privacy-First Vision & Camera Intelligence System
 */

export type VisionMode = "OFF" | "SNAPSHOT" | "CONVERSATION" | "REAL-TIME";

export type VisionSubject =
  | "general"
  | "object"
  | "text_ocr"
  | "document"
  | "diagram"
  | "device"
  | "cybersecurity"
  | "code_error"
  | "comparison";

export interface VisualObservation {
  id: string;
  timestamp: string; // ISO
  mode: VisionMode;
  subject: VisionSubject;
  summary: string;
  details?: string;
  detectedText?: string[];
  labels?: string[];
  suggestedFollowUps?: string[];
}

export interface VisualMemoryItem {
  id: string;
  type: "visual_context";
  summary: string;
  subject: VisionSubject;
  timestamp: string; // ISO
  expiresAt: string; // ISO (typically expires after 24-48 hours)
  topicTags: string[];
}

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
}

export interface VisionSamplingConfig {
  snapshotMaxDim: number;         // e.g. 960px
  jpegQuality: number;            // e.g. 0.65
  conversationFps: number;        // e.g. 0.5 FPS (1 frame every 2s)
  realtimeFps: number;            // e.g. 1.0 FPS (1 frame every 1s)
}
