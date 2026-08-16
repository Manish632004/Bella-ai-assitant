/**
 * Whitelisted Safe Application Registry
 */

import { ApplicationDefinition } from "../types";

export class AppRegistry {
  private static applications: Map<string, ApplicationDefinition> = new Map();

  static {
    const defaultApps: ApplicationDefinition[] = [
      {
        id: "chrome",
        name: "Google Chrome",
        executable: "chrome.exe",
        aliases: ["chrome", "google chrome", "browser", "google-chrome"],
        category: "Browser",
      },
      {
        id: "brave",
        name: "Brave Browser",
        executable: "brave.exe",
        aliases: ["brave", "brave browser"],
        category: "Browser",
      },
      {
        id: "edge",
        name: "Microsoft Edge",
        executable: "msedge.exe",
        aliases: ["edge", "msedge", "microsoft edge"],
        category: "Browser",
      },
      {
        id: "firefox",
        name: "Mozilla Firefox",
        executable: "firefox.exe",
        aliases: ["firefox", "mozilla firefox"],
        category: "Browser",
      },
      {
        id: "vscode",
        name: "Visual Studio Code",
        executable: "Code.exe",
        aliases: ["vscode", "code", "visual studio code", "vs code"],
        category: "Development",
      },
      {
        id: "notepad",
        name: "Notepad",
        executable: "notepad.exe",
        aliases: ["notepad", "text editor"],
        category: "Utility",
      },
      {
        id: "calculator",
        name: "Calculator",
        executable: "calc.exe",
        aliases: ["calc", "calculator"],
        category: "Utility",
      },
      {
        id: "spotify",
        name: "Spotify",
        executable: "Spotify.exe",
        aliases: ["spotify", "music"],
        category: "Media",
      },
      {
        id: "discord",
        name: "Discord",
        executable: "Discord.exe",
        aliases: ["discord"],
        category: "Communication",
      },
      {
        id: "terminal",
        name: "Windows Terminal / PowerShell",
        executable: "wt.exe",
        aliases: ["terminal", "powershell", "cmd", "command prompt", "wt"],
        category: "System",
      },
      {
        id: "explorer",
        name: "File Explorer",
        executable: "explorer.exe",
        aliases: ["explorer", "file explorer", "files", "folder"],
        category: "System",
      },
      {
        id: "notion",
        name: "Notion",
        executable: "Notion.exe",
        aliases: ["notion"],
        category: "Productivity",
      },
      {
        id: "burpsuite",
        name: "Burp Suite",
        executable: "BurpSuiteCommunity.exe",
        aliases: ["burp", "burp suite", "burpsuite"],
        category: "Security",
      },
      {
        id: "wireshark",
        name: "Wireshark",
        executable: "Wireshark.exe",
        aliases: ["wireshark"],
        category: "Security",
      },
      {
        id: "taskmgr",
        name: "Task Manager",
        executable: "taskmgr.exe",
        aliases: ["task manager", "taskmgr"],
        category: "System",
      },
    ];

    defaultApps.forEach((app) => this.register(app));
  }

  public static register(app: ApplicationDefinition): void {
    this.applications.set(app.id.toLowerCase(), app);
  }

  public static resolve(query: string): ApplicationDefinition | null {
    if (!query) return null;
    const q = query.trim().toLowerCase();

    // Direct ID match
    if (this.applications.has(q)) {
      return this.applications.get(q)!;
    }

    // Alias or Name match
    for (const app of this.applications.values()) {
      if (app.name.toLowerCase() === q) return app;
      if (app.executable.toLowerCase() === q) return app;
      if (app.aliases.some((a) => a.toLowerCase() === q || q.includes(a.toLowerCase()))) {
        return app;
      }
    }

    return null;
  }

  public static getAll(): ApplicationDefinition[] {
    return Array.from(this.applications.values());
  }
}
