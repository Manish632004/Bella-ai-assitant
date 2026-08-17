/**
 * Interaction Timing, Proactive Scheduler & Conversation Initiator
 * Enforces focus modes, quiet hours (22:00 -> 08:00), minimum intervals, and hourly caps.
 */

import { contextEngine } from "./ContextEngine";
import { curiosityEngine } from "./CuriosityEngine";
import { ProjectIntelligence } from "./ProjectIntelligence";
import { CuriosityQuestion, CurrentContextSnapshot, ProactiveTimingPolicy } from "./types";

export const DEFAULT_TIMING_POLICY: ProactiveTimingPolicy = {
  enabled: true,
  curiosityEnabled: true,
  automaticMemory: "MEDIUM",
  recommendationsEnabled: true,
  voiceInitiationEnabled: true,
  minMinutesBetweenInteractions: 20, // At least 20 minutes between unsolicited interventions
  maxInteractionsPerHour: 2,         // Max 2 unsolicited per hour
  quietHours: {
    enabled: true,
    startHour: 22,                   // 10:00 PM
    endHour: 8                       // 8:00 AM
  },
  focusModeSuppression: true
};

export class InteractionTiming {
  private policy: ProactiveTimingPolicy = { ...DEFAULT_TIMING_POLICY };
  private interactionHistory: number[] = []; // Timestamps of past interactions

  public getPolicy(): ProactiveTimingPolicy {
    return { ...this.policy };
  }

  public updatePolicy(patch: Partial<ProactiveTimingPolicy>): ProactiveTimingPolicy {
    this.policy = { ...this.policy, ...patch };
    return this.getPolicy();
  }

  /**
   * Check if right now is within configured quiet hours.
   */
  public isQuietHours(currentTime: Date = new Date()): boolean {
    if (!this.policy.quietHours.enabled) return false;
    const hour = currentTime.getHours();
    const { startHour, endHour } = this.policy.quietHours;

    if (startHour > endHour) {
      // Overnight (e.g. 22 to 8)
      return hour >= startHour || hour < endHour;
    } else {
      return hour >= startHour && hour < endHour;
    }
  }

  /**
   * Checks if an unsolicited proactive interaction is permitted at this moment.
   */
  public canInitiateInteraction(context: CurrentContextSnapshot, currentTimeMs: number = Date.now()): {
    allowed: boolean;
    reason?: string;
  } {
    if (!this.policy.enabled) {
      return { allowed: false, reason: "Proactive intelligence is disabled in settings." };
    }

    if (this.isQuietHours(new Date(currentTimeMs))) {
      return { allowed: false, reason: "Quiet hours are currently active." };
    }

    if (context.activityState === "meeting") {
      return { allowed: false, reason: "User is in a meeting or voice call." };
    }

    if (context.activityState === "speaking") {
      return { allowed: false, reason: "User is currently speaking." };
    }

    if (this.policy.focusModeSuppression && context.activityState === "focus") {
      return { allowed: false, reason: "User is in critical focus mode." };
    }

    // Minimum time since last interaction
    if (this.interactionHistory.length > 0) {
      const last = this.interactionHistory[this.interactionHistory.length - 1];
      const elapsedMinutes = (currentTimeMs - last) / (1000 * 60);
      if (elapsedMinutes < this.policy.minMinutesBetweenInteractions) {
        return {
          allowed: false,
          reason: `Minimum interval (${this.policy.minMinutesBetweenInteractions} min) not met (${Math.round(elapsedMinutes)} min elapsed).`
        };
      }
    }

    // Max interactions per hour
    const oneHourAgo = currentTimeMs - 60 * 60 * 1000;
    const recentCount = this.interactionHistory.filter(t => t > oneHourAgo).length;
    if (recentCount >= this.policy.maxInteractionsPerHour) {
      return {
        allowed: false,
        reason: `Maximum hourly limit (${this.policy.maxInteractionsPerHour}/hr) reached.`
      };
    }

    return { allowed: true };
  }

  public recordInteraction(timestampMs: number = Date.now()): void {
    this.interactionHistory.push(timestampMs);
    // Keep last 24h
    const cutoff = timestampMs - 24 * 60 * 60 * 1000;
    this.interactionHistory = this.interactionHistory.filter(t => t > cutoff);
  }
}

export class ConversationInitiator {
  private timing = new InteractionTiming();

  public getTiming(): InteractionTiming {
    return this.timing;
  }

  /**
   * Evaluates current conditions and returns a proactive opportunity if one is ripe.
   */
  public async evaluateProactiveOpportunity(): Promise<{
    type: "curiosity" | "project_checkin";
    payload: any;
  } | null> {
    const context = contextEngine.getSnapshot();
    const timingCheck = this.timing.canInitiateInteraction(context);

    if (!timingCheck.allowed) {
      return null;
    }

    // 1. Check for stalled project check-in
    if (context.activeProject && context.activeProject.daysInactive && context.activeProject.daysInactive >= 3) {
      const analysis = ProjectIntelligence.analyzeProject(context.activeProject);
      const checkIn = ProjectIntelligence.generateStalledProjectCheckIn(analysis);
      if (checkIn) {
        this.timing.recordInteraction();
        return {
          type: "project_checkin",
          payload: {
            title: `Project Check-in: ${context.activeProject.name}`,
            message: checkIn.message,
            actions: checkIn.actions,
            explanation: `You have an active project "${context.activeProject.name}" that has been idle for ${context.activeProject.daysInactive} days.`
          }
        };
      }
    }

    // 2. Check for high-quality curiosity question
    if (this.timing.getPolicy().curiosityEnabled) {
      const bestQuestion = await curiosityEngine.evaluateBestQuestion(context, 0.60);
      if (bestQuestion) {
        this.timing.recordInteraction();
        return {
          type: "curiosity",
          payload: bestQuestion
        };
      }
    }

    return null;
  }
}

export const interactionTiming = new InteractionTiming();
export const conversationInitiator = new ConversationInitiator();
