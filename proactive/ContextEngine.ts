import {
  UserContext,
  TaskItem,
  ProjectItem,
  LearningTopic,
  CalendarEventItem,
  ProactiveSettings,
  DashboardSummary,
  ActivityItem,
  CybersecurityProficiency,
} from "./types";
import { loadMemories, saveMemories } from "../server_memory";
import { Memory } from "../src/lib/memoryTypes";
import fs from "fs/promises";
import path from "path";

export class ContextEngine {
  private tasks: TaskItem[] = [];
  private projects: ProjectItem[] = [];
  private learningTopics: LearningTopic[] = [];
  private calendarEvents: CalendarEventItem[] = [];
  private activities: ActivityItem[] = [];
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
      if (Array.isArray(parsed.activities)) this.activities = parsed.activities;
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
          name: "AI Desktop Assistant",
          description: "Personal proactive desktop companion with multimodal voice vision",
          status: "Active",
          progressPercent: 82,
          currentMilestone: "Proactive Dashboard & Voice Context Integration",
          nextTask: "Finalize visualizer animations & quick capture bar",
          deadline: new Date(Date.now() + 5 * 86400000).toISOString(),
          lastActiveAt: new Date().toISOString(),
          tasksCount: 6,
          openTasksCount: 2,
        },
        {
          id: "proj-2",
          name: "Cybersecurity Knowledge Platform",
          description: "Hands-on SOC analysis, TryHackMe labs, and Active Directory security",
          status: "On Track",
          progressPercent: 64,
          currentMilestone: "Web Application Pentesting & PortSwigger Labs",
          nextTask: "Complete PortSwigger SQLi & Authentication Lab",
          deadline: new Date(Date.now() + 12 * 86400000).toISOString(),
          lastActiveAt: new Date(Date.now() - 2 * 86400000).toISOString(),
          tasksCount: 8,
          openTasksCount: 3,
        },
        {
          id: "proj-3",
          name: "Developer Portfolio",
          description: "Showcase AI engineering, desktop robotics & security projects",
          status: "Completed",
          progressPercent: 100,
          currentMilestone: "Deployed & verified",
          lastActiveAt: new Date(Date.now() - 10 * 86400000).toISOString(),
          tasksCount: 5,
          openTasksCount: 0,
        },
      ];
    }

    if (this.tasks.length === 0) {
      this.tasks = [
        {
          id: "task-1",
          title: "Finish authentication system & permission handler",
          category: "AI Desktop Assistant",
          priority: "critical",
          status: "pending",
          estimatedMinutes: 60,
          dueDate: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
          createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        },
        {
          id: "task-2",
          title: "Complete PortSwigger Web Security Lab",
          category: "Cybersecurity",
          priority: "high",
          status: "pending",
          estimatedMinutes: 45,
          dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
          createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        },
        {
          id: "task-3",
          title: "Review SQL Injection & Blind SQLi defense",
          category: "Learning",
          priority: "medium",
          status: "pending",
          estimatedMinutes: 20,
          dueDate: new Date(Date.now() + 86400000).toISOString(),
          createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        },
        {
          id: "task-4",
          title: "Explore Linux Privilege Escalation vectors",
          category: "Cybersecurity",
          priority: "low",
          status: "pending",
          estimatedMinutes: 30,
          dueDate: new Date(Date.now() + 4 * 86400000).toISOString(),
          createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        },
      ];
    }

    if (this.learningTopics.length === 0) {
      this.learningTopics = [
        {
          id: "learn-1",
          topic: "SQL Injection",
          domain: "cybersecurity",
          category: "Web Security",
          lastReviewedAt: new Date(Date.now() - 14 * 86400000).toISOString(), // 14 days ago
          retentionScore: 0.55,
          reviewCount: 2,
          dueStatus: "today",
        },
        {
          id: "learn-2",
          topic: "HTTP Authentication & Session Tokens",
          domain: "cybersecurity",
          category: "Web Security",
          lastReviewedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
          retentionScore: 0.72,
          reviewCount: 3,
          dueStatus: "tomorrow",
        },
        {
          id: "learn-3",
          topic: "Linux Privilege Escalation (SUID / Capabilities)",
          domain: "cybersecurity",
          category: "Linux",
          lastReviewedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
          retentionScore: 0.85,
          reviewCount: 4,
          dueStatus: "upcoming",
        },
        {
          id: "learn-4",
          topic: "Active Directory Enumeration & Kerberoasting",
          domain: "cybersecurity",
          category: "Active Directory",
          lastReviewedAt: new Date(Date.now() - 6 * 86400000).toISOString(),
          retentionScore: 0.68,
          reviewCount: 2,
          dueStatus: "upcoming",
        },
      ];
    }

    if (this.activities.length === 0) {
      this.activities = [
        {
          id: "act-1",
          title: "Completed PortSwigger SQLi Lab",
          type: "learning",
          description: "Solved lab on SQL injection UNION attacks querying multiple tables",
          timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
        },
        {
          id: "act-2",
          title: "Created 'Burp Suite Pro Tips' Note",
          type: "notes",
          description: "Saved request matching rules & intruder payload configurations",
          timestamp: new Date(Date.now() - 5 * 3600000).toISOString(),
        },
        {
          id: "act-3",
          title: "Updated AI Assistant Project",
          type: "projects",
          description: "Integrated Proactive Intelligence Engine with EventBus & ScoringEngine",
          timestamp: new Date(Date.now() - 12 * 3600000).toISOString(),
        },
        {
          id: "act-4",
          title: "Added 12 Cybersecurity Flashcards",
          type: "learning",
          description: "Added concepts for Kerberos TGT/TGS request mechanics",
          timestamp: new Date(Date.now() - 24 * 3600000).toISOString(),
        },
        {
          id: "act-5",
          title: "Completed Network Protocols Revision",
          type: "learning",
          description: "Reviewed TCP handshake, DNS records, and TLS 1.3 key exchange",
          timestamp: new Date(Date.now() - 36 * 3600000).toISOString(),
        },
      ];
    }
  }

  public async getContext(settings: ProactiveSettings): Promise<UserContext> {
    const rawMemories = await loadMemories();
    const goals: string[] = [];

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

  // --- Task Operations ---
  public getTasks(): TaskItem[] {
    return [...this.tasks];
  }

  public async addTask(task: Omit<TaskItem, "id" | "createdAt">): Promise<TaskItem> {
    const newTask: TaskItem = {
      id: "task-" + Math.random().toString(36).substring(2, 9),
      ...task,
      createdAt: new Date().toISOString(),
    };
    this.tasks.unshift(newTask);
    this.logActivity({
      title: `Created task "${newTask.title}"`,
      type: "tasks",
      description: `Priority: ${newTask.priority}, Category: ${newTask.category || "General"}`,
    });
    await this.saveData();
    return newTask;
  }

  public async updateTask(id: string, patch: Partial<TaskItem>): Promise<TaskItem | null> {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    
    const wasCompleted = this.tasks[idx].status === "completed";
    this.tasks[idx] = { ...this.tasks[idx], ...patch, updatedAt: new Date().toISOString() };
    
    if (!wasCompleted && patch.status === "completed") {
      this.logActivity({
        title: `Completed task "${this.tasks[idx].title}"`,
        type: "tasks",
        description: `Marked as done in ${this.tasks[idx].category || "Projects"}`,
      });
    }

    await this.saveData();
    return this.tasks[idx];
  }

  public async deleteTask(id: string): Promise<boolean> {
    const prevLen = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length !== prevLen) {
      await this.saveData();
      return true;
    }
    return false;
  }

  // --- Project Operations ---
  public getProjects(): ProjectItem[] {
    return [...this.projects];
  }

  public async addProject(project: Omit<ProjectItem, "id" | "lastActiveAt">): Promise<ProjectItem> {
    const newProj: ProjectItem = {
      id: "proj-" + Math.random().toString(36).substring(2, 9),
      ...project,
      lastActiveAt: new Date().toISOString(),
    };
    this.projects.push(newProj);
    this.logActivity({
      title: `Created project "${newProj.name}"`,
      type: "projects",
      description: newProj.description,
    });
    await this.saveData();
    return newProj;
  }

  public async updateProject(id: string, patch: Partial<ProjectItem>): Promise<ProjectItem | null> {
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    this.projects[idx] = { ...this.projects[idx], ...patch, lastActiveAt: new Date().toISOString() };
    await this.saveData();
    return this.projects[idx];
  }

  public async deleteProject(id: string): Promise<boolean> {
    const prevLen = this.projects.length;
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.projects.length !== prevLen) {
      await this.saveData();
      return true;
    }
    return false;
  }

  // --- Learning & Cybersecurity ---
  public getLearningTopics(): LearningTopic[] {
    return [...this.learningTopics];
  }

  public async recordLearningReview(topicName: string): Promise<void> {
    const idx = this.learningTopics.findIndex((l) => l.topic.toLowerCase() === topicName.toLowerCase());
    if (idx !== -1) {
      this.learningTopics[idx].lastReviewedAt = new Date().toISOString();
      this.learningTopics[idx].retentionScore = Math.min(1.0, this.learningTopics[idx].retentionScore + 0.25);
      this.learningTopics[idx].reviewCount += 1;
      this.learningTopics[idx].dueStatus = "upcoming";
    } else {
      this.learningTopics.push({
        id: "learn-" + Math.random().toString(36).substring(2, 9),
        topic: topicName,
        domain: "cybersecurity",
        lastReviewedAt: new Date().toISOString(),
        retentionScore: 0.9,
        reviewCount: 1,
        dueStatus: "upcoming",
      });
    }

    this.logActivity({
      title: `Reviewed topic "${topicName}"`,
      type: "learning",
      description: "Completed spaced repetition revision session",
    });

    await this.saveData();
  }

  public getCybersecurityProficiency(): CybersecurityProficiency[] {
    return [
      { category: "Networking", proficiencyPercent: 72, completedLabs: 14, totalLabs: 18, status: "improving" },
      { category: "Linux", proficiencyPercent: 84, completedLabs: 21, totalLabs: 25, status: "mastered" },
      { category: "Web Security", proficiencyPercent: 68, completedLabs: 17, totalLabs: 25, status: "active" },
      { category: "SOC", proficiencyPercent: 51, completedLabs: 8, totalLabs: 16, status: "active" },
      { category: "Active Directory", proficiencyPercent: 32, completedLabs: 4, totalLabs: 14, status: "active" },
      { category: "Cloud Security", proficiencyPercent: 24, completedLabs: 3, totalLabs: 12, status: "active" },
    ];
  }

  // --- Activity Stream ---
  public logActivity(act: Omit<ActivityItem, "id" | "timestamp">): void {
    const item: ActivityItem = {
      id: "act-" + Math.random().toString(36).substring(2, 9),
      ...act,
      timestamp: new Date().toISOString(),
    };
    this.activities.unshift(item);
    if (this.activities.length > 100) {
      this.activities = this.activities.slice(0, 80);
    }
  }

  public getActivityList(filter?: string): ActivityItem[] {
    if (!filter || filter === "all") return [...this.activities];
    return this.activities.filter((a) => a.type === filter);
  }

  // --- Quick Capture Auto-Classifier ---
  public async processQuickCapture(input: string, overrideType?: "task" | "note" | "idea" | "project" | "memory"): Promise<{
    type: "task" | "note" | "idea" | "project" | "memory";
    item: any;
    message: string;
  }> {
    const text = input.trim();
    if (!text) throw new Error("Input text is empty");

    let detectedType = overrideType;
    if (!detectedType) {
      const lower = text.toLowerCase();
      if (lower.startsWith("todo:") || lower.startsWith("task:") || lower.includes("finish ") || lower.includes("complete ") || lower.includes("due ")) {
        detectedType = "task";
      } else if (lower.startsWith("project:") || lower.includes("start project ") || lower.includes("build platform")) {
        detectedType = "project";
      } else if (lower.startsWith("remember:") || lower.startsWith("recall:") || lower.includes("my favorite") || lower.includes("i like ") || lower.includes("my goal")) {
        detectedType = "memory";
      } else if (lower.startsWith("idea:") || lower.includes("what if ") || lower.includes("concept:")) {
        detectedType = "idea";
      } else {
        detectedType = "note";
      }
    }

    const cleanTitle = text.replace(/^(todo:|task:|project:|remember:|recall:|idea:|note:)\s*/i, "");

    if (detectedType === "task") {
      const task = await this.addTask({
        title: cleanTitle,
        priority: "medium",
        status: "pending",
        estimatedMinutes: 30,
        category: "Inbox",
      });
      return { type: "task", item: task, message: `Added task: "${task.title}"` };
    }

    if (detectedType === "project") {
      const proj = await this.addProject({
        name: cleanTitle,
        description: "Quick-captured project",
        status: "Active",
        progressPercent: 0,
      });
      return { type: "project", item: proj, message: `Created project: "${proj.name}"` };
    }

    if (detectedType === "memory") {
      const memories = await loadMemories();
      const newMemory: Memory = {
        id: Math.random().toString(36).substring(2, 11),
        category: cleanTitle.toLowerCase().includes("goal") ? "goal" : "preference",
        text: cleanTitle,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      memories.push(newMemory);
      await saveMemories(memories);
      this.logActivity({ title: `Saved recollection: "${cleanTitle}"`, type: "notes" });
      return { type: "memory", item: newMemory, message: `Saved memory: "${cleanTitle}"` };
    }

    // Default: Save as Note / Idea into activities & memories
    this.logActivity({
      title: detectedType === "idea" ? `Captured Idea: "${cleanTitle}"` : `Quick Note: "${cleanTitle}"`,
      type: "notes",
      description: text,
    });

    return {
      type: detectedType,
      item: { title: cleanTitle, text, timestamp: new Date().toISOString() },
      message: `Captured ${detectedType}: "${cleanTitle}"`,
    };
  }

  // --- Universal Search ---
  public async searchAll(query: string): Promise<Array<{
    id: string;
    title: string;
    subtitle: string;
    category: "tasks" | "projects" | "learning" | "memories" | "activities";
    score: number;
    actionType?: string;
  }>> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const results: Array<{
      id: string;
      title: string;
      subtitle: string;
      category: "tasks" | "projects" | "learning" | "memories" | "activities";
      score: number;
      actionType?: string;
    }> = [];

    // Tasks
    for (const t of this.tasks) {
      if (t.title.toLowerCase().includes(q) || (t.category && t.category.toLowerCase().includes(q))) {
        results.push({
          id: t.id,
          title: t.title,
          subtitle: `Task • ${t.category || "Inbox"} • Priority: ${t.priority}`,
          category: "tasks",
          score: t.title.toLowerCase().startsWith(q) ? 1.0 : 0.8,
        });
      }
    }

    // Projects
    for (const p of this.projects) {
      if (p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q))) {
        results.push({
          id: p.id,
          title: p.name,
          subtitle: `Project • ${p.status} • ${p.progressPercent}%`,
          category: "projects",
          score: p.name.toLowerCase().startsWith(q) ? 1.0 : 0.8,
        });
      }
    }

    // Learning
    for (const l of this.learningTopics) {
      if (l.topic.toLowerCase().includes(q) || (l.category && l.category.toLowerCase().includes(q))) {
        results.push({
          id: l.id,
          title: l.topic,
          subtitle: `Learning • ${l.category || "Cybersecurity"} • Retention: ${Math.round(l.retentionScore * 100)}%`,
          category: "learning",
          score: l.topic.toLowerCase().startsWith(q) ? 1.0 : 0.75,
        });
      }
    }

    // Memories
    const rawMemories = await loadMemories();
    for (const m of rawMemories) {
      if (m.text.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)) {
        results.push({
          id: m.id,
          title: m.text,
          subtitle: `Memory Core • ${m.category}`,
          category: "memories",
          score: 0.7,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 15);
  }

  // --- Full Dashboard Summary Aggregator ---
  public async getDashboardSummary(userName: string = "Manish"): Promise<DashboardSummary> {
    const hour = new Date().getHours();
    let greetingText = `Good morning, ${userName}.`;
    let subText = "Here's what matters today.";

    if (hour >= 12 && hour < 17) {
      greetingText = `Good afternoon, ${userName}.`;
      subText = "Here's where you stand on your priorities.";
    } else if (hour >= 17 && hour < 22) {
      greetingText = `Good evening, ${userName}.`;
      subText = "Let's wrap up today's priorities.";
    } else if (hour >= 22 || hour < 5) {
      greetingText = `Late night session, ${userName}.`;
      subText = "Stay focused on what's essential.";
    }

    // Today's focus (top 3 priority pending tasks)
    const pendingTasks = this.tasks.filter((t) => t.status !== "completed");
    const todayFocus = pendingTasks.slice(0, 3);

    // AI Briefing reasoning calculation
    const topProj = this.projects.find((p) => p.status === "Active") || this.projects[0];
    const dueReview = this.learningTopics.find((l) => l.retentionScore < 0.75) || this.learningTopics[0];

    const aiBriefing = {
      title: "AI Daily Focus Briefing",
      summary: `You have ${pendingTasks.length} important priorities today. Your ${topProj ? `"${topProj.name}" project` : "main goal"} is your primary focus, alongside a revision session for ${dueReview ? dueReview.topic : "Web Security"}.`,
      reasoning: `Based on your active milestone in "${topProj?.name || "active project"}" and spaced repetition memory decay curve on ${dueReview?.topic || "cybersecurity"}.`,
      recommendedFocus: `90 minutes on ${topProj?.name || "AI Assistant"} development & 20 min revision.`,
      estimatedMinutes: 110,
      actionLabel: "Start Focus Session",
      planDetails: [
        `01: Work on ${todayFocus[0]?.title || "primary priority"} (~60m)`,
        `02: Revise ${dueReview?.topic || "SQL Injection fundamentals"} (~20m)`,
        `03: Project review & next steps (~30m)`,
      ],
    };

    // Revision queue
    const revisionQueue = [...this.learningTopics].sort((a, b) => a.retentionScore - b.retentionScore);

    // Task stats
    const now = Date.now();
    let upcomingCount = 0;
    let overdueCount = 0;
    let completedCount = 0;

    for (const t of this.tasks) {
      if (t.status === "completed") {
        completedCount++;
      } else {
        if (t.dueDate && new Date(t.dueDate).getTime() < now) {
          overdueCount++;
        } else {
          upcomingCount++;
        }
      }
    }

    const taskStats = {
      today: todayFocus.length,
      upcoming: upcomingCount,
      overdue: overdueCount,
      completed: completedCount,
    };

    // Productivity snapshot
    const productivitySnapshot = {
      focusHours: "12h 40m",
      tasksCompleted: completedCount,
      labsCompleted: 5,
      notesCreated: this.activities.filter((a) => a.type === "notes").length + 6,
    };

    // Recommendations
    const recommendations = [
      {
        id: "rec-1",
        title: `Review ${dueReview?.topic || "SQL Injection"}`,
        reason: "Last reviewed 14 days ago (retention decay threshold reached).",
        category: "learning" as const,
        actionLabel: "Start Review",
      },
      {
        id: "rec-2",
        title: `Continue ${topProj?.name || "AI Desktop Assistant"}`,
        reason: "Highest-priority active project with approaching milestone.",
        category: "projects" as const,
        actionLabel: "Open Project",
      },
      {
        id: "rec-3",
        title: "Complete PortSwigger Access Control Lab",
        reason: "Matches your current Web Security learning path.",
        category: "cybersecurity" as const,
        actionLabel: "Launch Lab",
      },
    ];

    return {
      greeting: {
        greetingText,
        subText,
        userName,
      },
      aiBriefing,
      todayFocus,
      activeProjects: this.projects.filter((p) => p.status !== "Completed"),
      learningSummary: {
        overallProgressPercent: 78,
        currentFocus: "Web Application Security & PortSwigger Labs",
        weeklyCompletions: {
          labs: 3,
          topics: 2,
          revisions: 1,
        },
        nextRecommendation: "Authentication & Access Control Bypass",
        cybersecurityProficiency: this.getCybersecurityProficiency(),
      },
      revisionQueue,
      taskStats,
      productivitySnapshot,
      recentActivity: this.activities.slice(0, 8),
      recommendations,
    };
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
        activities: this.activities,
        activeProject: this.activeProject,
        currentTask: this.currentTask,
      };
      await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.warn("[ContextEngine] Error saving data:", err);
    }
  }
}
