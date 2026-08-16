import { PermissionState, ProactiveCategory } from "./types";

export const DEFAULT_PERMISSIONS: PermissionState = {
  tasks: true,
  projects: true,
  learning: true,
  calendar: true,
  coding: true,
  cybersecurity: true,
  files: false,       // Default deny: file monitoring requires explicit opt-in
  browser: false,     // Default deny
  screen: false,      // Default deny
  mic: false,         // Default deny
  camera: false,      // Default deny
};

export class PermissionManager {
  private permissions: PermissionState;

  constructor(initial?: Partial<PermissionState>) {
    this.permissions = { ...DEFAULT_PERMISSIONS, ...initial };
  }

  public isCategoryAllowed(category: ProactiveCategory): boolean {
    return !!this.permissions[category];
  }

  public getPermissions(): PermissionState {
    return { ...this.permissions };
  }

  public updatePermissions(patch: Partial<PermissionState>): PermissionState {
    this.permissions = { ...this.permissions, ...patch };
    return this.getPermissions();
  }

  public setCategory(category: ProactiveCategory, allowed: boolean): void {
    this.permissions[category] = allowed;
  }
}
