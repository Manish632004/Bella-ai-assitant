/**
 * Session Context Manager
 * Layer 1: ACTIVE CONTEXT (Last few minutes / turns)
 * Layer 2: SESSION MEMORY (Current Day working logs)
 */

import { TemporalMemoryItem, TemporalTurn } from "./types";

export class SessionContextManager {
  private currentSessionId: string = `sess_${Date.now()}`;
  private activeTurns: TemporalTurn[] = [];
  private currentProject?: string;
  private currentTasksCompleted: string[] = [];
  private currentDecisions: string[] = [];
  private currentProblems: string[] = [];
  private lastActivityAt: number = Date.now();

  constructor() {
    this.currentSessionId = `sess_${Date.now()}`;
  }

  public getSessionId(): string {
    return this.currentSessionId;
  }

  public startNewSession(projectId?: string): string {
    this.currentSessionId = `sess_${Date.now()}`;
    this.activeTurns = [];
    this.currentTasksCompleted = [];
    this.currentDecisions = [];
    this.currentProblems = [];
    this.currentProject = projectId;
    this.lastActivityAt = Date.now();
    return this.currentSessionId;
  }

  public setActiveProject(projectName?: string): void {
    this.currentProject = projectName;
  }

  public getActiveProject(): string | undefined {
    return this.currentProject;
  }

  public recordTurn(role: "user" | "model" | "system", text: string, actionTaken?: string): TemporalTurn {
    this.lastActivityAt = Date.now();
    const turn: TemporalTurn = {
      id: `turn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role,
      text: text.trim(),
      timestamp: new Date().toISOString(),
      actionTaken
    };

    this.activeTurns.push(turn);
    // Keep max 25 turns in active memory sliding window
    if (this.activeTurns.length > 25) {
      this.activeTurns.shift();
    }

    // Auto-detect decisions, completed tasks, and errors from turn text
    this.inspectTurnContent(role, text, actionTaken);

    return turn;
  }

  private inspectTurnContent(role: string, text: string, actionTaken?: string): void {
    const lower = text.toLowerCase();

    // Decisions
    if (
      lower.includes("let's go with") ||
      lower.includes("we decided to") ||
      lower.includes("i chose") ||
      lower.includes("agreed on") ||
      lower.includes("let's use")
    ) {
      if (!this.currentDecisions.includes(text)) {
        this.currentDecisions.push(text);
      }
    }

    // Tasks Completed
    if (
      lower.includes("finished") ||
      lower.includes("implemented") ||
      lower.includes("completed") ||
      lower.includes("fixed the") ||
      lower.includes("built the")
    ) {
      if (!this.currentTasksCompleted.includes(text)) {
        this.currentTasksCompleted.push(text);
      }
    }

    // Problems Encountered
    if (
      lower.includes("error:") ||
      lower.includes("failed with") ||
      lower.includes("issue:") ||
      lower.includes("bug:") ||
      lower.includes("problem:") ||
      lower.includes("stuck on")
    ) {
      if (!this.currentProblems.includes(text)) {
        this.currentProblems.push(text);
      }
    }

    if (actionTaken && !this.currentTasksCompleted.includes(actionTaken)) {
      this.currentTasksCompleted.push(`Action executed: ${actionTaken}`);
    }
  }

  public recordDecision(decision: string): void {
    if (!this.currentDecisions.includes(decision)) {
      this.currentDecisions.push(decision);
    }
  }

  public recordCompletedTask(task: string): void {
    if (!this.currentTasksCompleted.includes(task)) {
      this.currentTasksCompleted.push(task);
    }
  }

  public recordProblem(problem: string): void {
    if (!this.currentProblems.includes(problem)) {
      this.currentProblems.push(problem);
    }
  }

  public getActiveContext(): TemporalTurn[] {
    return [...this.activeTurns];
  }

  public getSessionWorkingState(): {
    sessionId: string;
    project?: string;
    decisions: string[];
    tasksCompleted: string[];
    problemsEncountered: string[];
    turnCount: number;
    lastActivityAt: number;
  } {
    return {
      sessionId: this.currentSessionId,
      project: this.currentProject,
      decisions: [...this.currentDecisions],
      tasksCompleted: [...this.currentTasksCompleted],
      problemsEncountered: [...this.currentProblems],
      turnCount: this.activeTurns.length,
      lastActivityAt: this.lastActivityAt
    };
  }
}

export const sessionContextManager = new SessionContextManager();
