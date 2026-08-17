/**
 * Context Awareness Engine
 * Ingests only explicitly permitted sources and infers current user activity state.
 */

import { contextPermissionManager } from "./ContextPermissionManager";
import { ActivityState, CurrentContextSnapshot } from "./types";

export class ContextEngine {
  private currentSnapshot: CurrentContextSnapshot = {
    timestamp: new Date().toISOString(),
    activityState: "general",
    recentTopics: [],
    recentErrors: []
  };

  private lastActivityAt = Date.now();
  private userIsSpeaking = false;

  public setUserSpeaking(speaking: boolean): void {
    this.userIsSpeaking = speaking;
    if (speaking) {
      this.lastActivityAt = Date.now();
    }
  }

  public recordTopic(topic: string): void {
    if (!topic || this.currentSnapshot.recentTopics.includes(topic)) return;
    this.currentSnapshot.recentTopics.unshift(topic);
    if (this.currentSnapshot.recentTopics.length > 15) {
      this.currentSnapshot.recentTopics.pop();
    }
  }

  public recordError(errorText: string): void {
    if (!errorText) return;
    this.currentSnapshot.recentErrors.unshift(errorText);
    if (this.currentSnapshot.recentErrors.length > 10) {
      this.currentSnapshot.recentErrors.pop();
    }
  }

  public updateContext(partial: {
    activeApp?: string;
    activeWindow?: string;
    browserUrl?: string;
    browserTitle?: string;
    mediaPlaying?: CurrentContextSnapshot["mediaPlaying"];
    activeProject?: CurrentContextSnapshot["activeProject"];
    activeTask?: CurrentContextSnapshot["activeTask"];
    screenContentSummary?: string;
  }): CurrentContextSnapshot {
    this.lastActivityAt = Date.now();
    const permissions = contextPermissionManager.getPermissions();

    if (permissions.activeApp) {
      if (partial.activeApp !== undefined) this.currentSnapshot.activeApp = partial.activeApp;
      if (partial.activeWindow !== undefined) this.currentSnapshot.activeWindow = partial.activeWindow;
    } else {
      delete this.currentSnapshot.activeApp;
      delete this.currentSnapshot.activeWindow;
    }

    if (permissions.browser) {
      if (partial.browserUrl !== undefined) this.currentSnapshot.browserUrl = partial.browserUrl;
      if (partial.browserTitle !== undefined) this.currentSnapshot.browserTitle = partial.browserTitle;
    } else {
      delete this.currentSnapshot.browserUrl;
      delete this.currentSnapshot.browserTitle;
    }

    if (permissions.media && partial.mediaPlaying !== undefined) {
      this.currentSnapshot.mediaPlaying = partial.mediaPlaying;
    } else if (!permissions.media) {
      delete this.currentSnapshot.mediaPlaying;
    }

    if (permissions.projects && partial.activeProject !== undefined) {
      this.currentSnapshot.activeProject = partial.activeProject;
    }

    if (partial.activeTask !== undefined) {
      this.currentSnapshot.activeTask = partial.activeTask;
    }

    if (permissions.screen && partial.screenContentSummary !== undefined) {
      this.currentSnapshot.screenContentSummary = partial.screenContentSummary;
    } else if (!permissions.screen) {
      delete this.currentSnapshot.screenContentSummary;
    }

    this.currentSnapshot.activityState = this.inferActivityState();
    this.currentSnapshot.timestamp = new Date().toISOString();

    return this.getSnapshot();
  }

  public inferActivityState(): ActivityState {
    if (this.userIsSpeaking) return "speaking";

    const idleMinutes = (Date.now() - this.lastActivityAt) / (1000 * 60);
    if (idleMinutes > 3.0) return "idle";

    const app = (this.currentSnapshot.activeApp || "").toLowerCase();
    const win = (this.currentSnapshot.activeWindow || "").toLowerCase();
    const title = (this.currentSnapshot.browserTitle || "").toLowerCase();
    const combined = `${app} ${win} ${title}`;

    // Meetings / Calls (Never interrupt)
    if (
      combined.includes("zoom") ||
      combined.includes("microsoft teams") ||
      combined.includes("google meet") ||
      combined.includes("webex") ||
      combined.includes("discord call")
    ) {
      return "meeting";
    }

    // Gaming
    if (
      combined.includes("steam") ||
      combined.includes("epic games") ||
      combined.includes("valorant") ||
      combined.includes("minecraft") ||
      combined.includes("genshin") ||
      combined.includes("game")
    ) {
      return "gaming";
    }

    // Coding & Development
    if (
      app.includes("code") ||
      app.includes("cursor") ||
      app.includes("visual studio") ||
      app.includes("pycharm") ||
      app.includes("terminal") ||
      app.includes("powershell") ||
      combined.includes("github") ||
      combined.includes("stack overflow")
    ) {
      return "coding";
    }

    // Studying & Learning
    if (
      combined.includes("course") ||
      combined.includes("udemy") ||
      combined.includes("coursera") ||
      combined.includes("tutorial") ||
      combined.includes("documentation") ||
      combined.includes("arxiv") ||
      combined.includes("study") ||
      combined.includes("burp suite") ||
      combined.includes("tryhackme") ||
      combined.includes("hackthebox")
    ) {
      return "studying";
    }

    // Watching Media / Entertainment
    if (
      combined.includes("youtube") ||
      combined.includes("netflix") ||
      combined.includes("crunchyroll") ||
      combined.includes("anime") ||
      combined.includes("spotify") ||
      combined.includes("vlc")
    ) {
      return "media";
    }

    // Focus mode explicit
    if (this.currentSnapshot.activeTask && this.currentSnapshot.activeTask.priority === "critical") {
      return "focus";
    }

    return "general";
  }

  public getSnapshot(): CurrentContextSnapshot {
    return JSON.parse(JSON.stringify(this.currentSnapshot));
  }
}

export const contextEngine = new ContextEngine();
