/**
 * Strict Privacy-First Context Permission Manager
 * All invasive OS/Hardware sensors default to FALSE (OFF).
 */

import fs from "fs/promises";
import { dataFile } from "../server_paths";
import { ContextPermissionMatrix } from "./types";

const PERMISSION_FILE = dataFile("personal_permissions.json");

export const DEFAULT_PERMISSIONS: ContextPermissionMatrix = {
  screen: false,      // OFF by default
  microphone: false,  // OFF by default (voice activation is explicit)
  camera: false,      // OFF by default
  browser: false,     // OFF by default
  files: false,       // OFF by default
  calendar: false,    // OFF by default
  activeApp: true,    // Basic app context for window awareness
  media: true,        // Basic media playback awareness
  learning: true,     // Dashboard study tracker
  projects: true      // Dashboard project tracker
};

export class ContextPermissionManager {
  private matrix: ContextPermissionMatrix = { ...DEFAULT_PERMISSIONS };
  private initialized = false;

  public async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const raw = await fs.readFile(PERMISSION_FILE, "utf-8");
      const loaded = JSON.parse(raw);
      this.matrix = { ...DEFAULT_PERMISSIONS, ...loaded };
    } catch {
      this.matrix = { ...DEFAULT_PERMISSIONS };
      await this.save();
    }
    this.initialized = true;
  }

  public getPermissions(): ContextPermissionMatrix {
    return { ...this.matrix };
  }

  public isPermitted(source: keyof ContextPermissionMatrix): boolean {
    return Boolean(this.matrix[source]);
  }

  public async updatePermission(source: keyof ContextPermissionMatrix, allowed: boolean): Promise<ContextPermissionMatrix> {
    this.matrix[source] = allowed;
    await this.save();
    return this.getPermissions();
  }

  public async setAll(matrix: Partial<ContextPermissionMatrix>): Promise<ContextPermissionMatrix> {
    this.matrix = { ...this.matrix, ...matrix };
    await this.save();
    return this.getPermissions();
  }

  private async save(): Promise<void> {
    try {
      await fs.writeFile(PERMISSION_FILE, JSON.stringify(this.matrix, null, 2), "utf-8");
    } catch (err) {
      console.error("[ContextPermissionManager] Save error:", err);
    }
  }
}

export const contextPermissionManager = new ContextPermissionManager();
