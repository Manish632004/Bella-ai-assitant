import { UserContext, TaskItem, ProjectItem, LearningTopic, CalendarEventItem, ProactiveSettings } from "./types";
import { loadMemories } from "../server_memory";
import fs from "fs/promises";
import path from "path";

export class ContextEngine {
  private tasks: TaskItem[] = [];
  private projects: ProjectItem[] = [];
  private learningTopics: LearningTopic[] = [];
  private calendarEvents: CalendarEventItem[] = [];
  private activeProject?: string;
  private currentTask?: string;
  private currentApplication?: string;
  private dataFile: string;

  constructor(filePath?: string) {
    this.dataFile = filePath || path.join(process.cwd(), "proactive_data.json");
  }

  public async init(): Promise<void> {
    try {
      const content = await fs.readFile(this.dataFile, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.tasks)) this.tasks = parsed.tasks;
      if (Array.isArray(parsed.projects)) this.projects = parsed.projects;
      if (Array.isArray(parsed.learningTopics)) this.learningTopics = parsed.learningTopics;
      if (Array.isArray(parsed.calendarEvents)) this.calendarEvents = parsed.calendarEvents;
      if (parsed.activeProject) this.activeProject = parsed.activeProject;
      if (parsed.currentTask) this.currentTask = parsed.currentTask;
    } catch {
      // Seed initial sample projects/learning items if empty
      this.seedInitialContext();
      await this.saveData();
    }
  }

  private seedInitialContext(): void {
    if (this.projects.length === 0) {
      this.projects = [
        {
          id: "proj-1",
          name: "Bella AI Assistant",
          description: "Personal proactive desktop companion with multimodal voice vision",
          status: "active",
          lastActiveAt: new Date(Date.now() - 4 * 86400000).toISOString(), // 4 days ago
          tasksCount: 5,
          openTasksCount: 2,
        },
        {
          id: "proj-2",
          name: "Cybersecurity SOC Portfolio",
          description: "Hands-on SOC analysis, TryHackMe labs, and Active Directory security",
          status: "active",
          lastActiveAt: new Date(Date.now() - 2 * 86400000).toISOString(),
          tasksCount: 4,
          openTasksCount: 3,
        },
      ];
    }

    if (this.tasks.length === 0) {
      this.tasks = [
        {
          id: "task-1",
          title: "Finish authentication module & permission handler",
          category: "Bella AI Assistant",
          priority: "high",
          status: "pending",
          dueDate: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
          createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        },
        {
          id: "task-2",
          title: "Review SQL Injection & Web Security fundamentals",
          category: "Cybersecurity",
          priority: "medium",
          status: "pending",
          createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        },
      ];
    }

    if (this.learningTopics.length === 0) {
      this.learningTopics = [
        {
          id: "learn-1",
          topic: "SQL Injection",
          domain: "cybersecurity",
          lastReviewedAt: new Date(Date.now() - 14 * 86400000).toISOString(), // 14 days ago
          retentionScore: 0.65,
          reviewCount: 2,
        },
        {
          id: "learn-2",
          topic: "Active Directory Enumeration & Kerberos",
          domain: "cybersecurity",
          lastReviewedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
          retentionScore: 0.8,
          reviewCount: 3,
        },
        {
          id: "learn-3",
          topic: "Cross-Site Scripting (XSS)",
          domain: "cybersecurity",
          lastReviewedAt: new Date(Date.now() - 20 * 86400000).toISOString(),
          retentionScore: 0.5,
          reviewCount: 1,
        },
      ];
    }
  }

  public async getContext(settings: ProactiveSettings): Promise<UserContext> {
    const rawMemories = await loadMemories();
    const goals: string[] = [];

    // Extract goals from memories
    rawMemories.forEach((m) => {
      if (m.category === "goal") goals.push(m.text);
    });

    return {
      currentTime: new Date(),
      currentApplication: this.currentApplication,
      activeProject: this.activeProject,
      currentTask: this.currentTask,
      goals,
      tasks: [...this.tasks],
      projects: [...this.projects],
      calendarEvents: [...this.calendarEvents],
      learningTopics: [...this.learningTopics],
      memories: rawMemories.map((m) => ({ id: m.id, category: m.category, text: m.text })),
      settings,
    };
  }

  public async addTask(task: Omit<TaskItem, "id" | "createdAt">): Promise<TaskItem> {
    const newTask: TaskItem = {
      id: "task-" + Math.random().toString(36).substring(2, 9),
      ...task,
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(newTask);
    await this.saveData();
    return newTask;
  }

  public async updateTask(id: string, patch: Partial<TaskItem>): Promise<TaskItem | null> {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    this.tasks[idx] = { ...this.tasks[idx], ...patch, updatedAt: new Date().toISOString() };
    await this.saveData();
    return this.tasks[idx];
  }

  public async recordLearningReview(topicName: string): Promise<void> {
    const idx = this.learningTopics.findIndex((l) => l.topic.toLowerCase() === topicName.toLowerCase());
    if (idx !== -1) {
      this.learningTopics[idx].lastReviewedAt = new Date().toISOString();
      this.learningTopics[idx].retentionScore = Math.min(1.0, this.learningTopics[idx].retentionScore + 0.2);
      this.learningTopics[idx].reviewCount += 1;
    } else {
      this.learningTopics.push({
        id: "learn-" + Math.random().toString(36).substring(2, 9),
        topic: topicName,
        domain: "cybersecurity",
        lastReviewedAt: new Date().toISOString(),
        retentionScore: 0.9,
        reviewCount: 1,
      });
    }
    await this.saveData();
  }

  public setActiveContext(active: { project?: string; task?: string; application?: string }): void {
    if (active.project !== undefined) this.activeProject = active.project;
    if (active.task !== undefined) this.currentTask = active.task;
    if (active.application !== undefined) this.currentApplication = active.application;
  }

  private async saveData(): Promise<void> {
    try {
      const data = {
        tasks: this.tasks,
        projects: this.projects,
        learningTopics: this.learningTopics,
        calendarEvents: this.calendarEvents,
        activeProject: this.activeProject,
        currentTask: this.currentTask,
      };
      await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.warn("[ContextEngine] Error saving data:", err);
    }
  }
}
