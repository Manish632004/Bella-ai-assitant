import { ProactiveSuggestion, ProactiveSettings, SuggestionStatus } from "./types";

export class NotificationManager {
  private lastNotificationTime: number = 0;
  private dailyCount: number = 0;
  private lastResetDay: string = new Date().toISOString().slice(0, 10);
  private snoozedUntil = new Map<string, number>(); // suggestionId -> timestamp ms
  private activeSuggestions = new Map<string, ProactiveSuggestion>();

  public isQuietHours(settings: ProactiveSettings): boolean {
    if (!settings.quietHours?.enabled) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = (settings.quietHours.start || "22:00").split(":").map(Number);
    const [endH, endM] = (settings.quietHours.end || "08:00").split(":").map(Number);

    const startMinutes = (startH || 22) * 60 + (startM || 0);
    const endMinutes = (endH || 8) * 60 + (endM || 0);

    if (startMinutes > endMinutes) {
      // Overnight (e.g. 22:00 to 08:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    } else {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
  }

  public canDeliverSuggestion(
    suggestion: ProactiveSuggestion,
    settings: ProactiveSettings
  ): { allowed: boolean; reason?: string } {
    if (!settings.enabled || settings.level === "OFF") {
      return { allowed: false, reason: "Proactive intelligence is disabled" };
    }

    // Critical alerts bypass quiet hours and standard cooldowns
    if (suggestion.level === "critical") {
      return { allowed: true };
    }

    // Quiet hours check
    if (this.isQuietHours(settings)) {
      return { allowed: false, reason: "Quiet hours active" };
    }

    // Snooze check
    const snoozedExp = this.snoozedUntil.get(suggestion.id);
    if (snoozedExp && Date.now() < snoozedExp) {
      return { allowed: false, reason: "Suggestion is currently snoozed" };
    }

    // Check daily reset
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.lastResetDay) {
      this.dailyCount = 0;
      this.lastResetDay = today;
    }

    // Max per day check
    if (this.dailyCount >= (settings.maxSuggestionsPerDay || 10)) {
      return { allowed: false, reason: "Daily suggestion limit reached" };
    }

    // Cooldown check (default 15 minutes between proactive popups)
    const cooldownMs = (settings.cooldownMinutes || 15) * 60000;
    const timeSinceLast = Date.now() - this.lastNotificationTime;
    if (this.lastNotificationTime > 0 && timeSinceLast < cooldownMs) {
      return { allowed: false, reason: `Cooldown active (${Math.round((cooldownMs - timeSinceLast) / 60000)}m remaining)` };
    }

    // Duplicate check: if already active and shown
    const existing = this.activeSuggestions.get(suggestion.id);
    if (existing && (existing.status === "shown" || existing.status === "pending")) {
      return { allowed: false, reason: "Suggestion already active in UI" };
    }

    return { allowed: true };
  }

  public recordDelivery(suggestion: ProactiveSuggestion): void {
    this.lastNotificationTime = Date.now();
    this.dailyCount++;
    suggestion.status = "shown";
    this.activeSuggestions.set(suggestion.id, suggestion);
  }

  public snoozeSuggestion(id: string, durationMinutes: number = 60): void {
    this.snoozedUntil.set(id, Date.now() + durationMinutes * 60000);
    const existing = this.activeSuggestions.get(id);
    if (existing) {
      existing.status = "snoozed";
    }
  }

  public dismissSuggestion(id: string): void {
    const existing = this.activeSuggestions.get(id);
    if (existing) {
      existing.status = "dismissed";
      this.activeSuggestions.delete(id);
    }
  }

  public acceptSuggestion(id: string): void {
    const existing = this.activeSuggestions.get(id);
    if (existing) {
      existing.status = "accepted";
      this.activeSuggestions.delete(id);
    }
  }

  public getActiveSuggestions(): ProactiveSuggestion[] {
    return Array.from(this.activeSuggestions.values()).filter((s) => s.status === "shown" || s.status === "pending");
  }
}
