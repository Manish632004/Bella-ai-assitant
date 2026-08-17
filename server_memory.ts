import fs from "fs/promises";
import { GoogleGenAI, Type } from "@google/genai";
import { Memory, MemoryTransaction } from "./src/lib/memoryTypes";
import { dataFile } from "./server_paths";

const MEMORY_FILE = dataFile("memories.json");

// Safe file operations with fallback
export async function loadMemories(): Promise<Memory[]> {
  try {
    const data = await fs.readFile(MEMORY_FILE, "utf-8");
    return JSON.parse(data) as Memory[];
  } catch (error: any) {
    // If file doesn't exist, return empty array
    if (error.code === "ENOENT") {
      return [];
    }
    console.error("[Memory] Error loading memories, returning fallback:", error);
    return [];
  }
}

export async function saveMemories(memories: Memory[]): Promise<void> {
  try {
    await fs.writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2), "utf-8");
    console.log(`[Memory] Saved ${memories.length} memories successfully.`);
  } catch (error) {
    console.error("[Memory] Error writing memory file:", error);
  }
}

// Format memory core to system instruction injections
export function formatSystemInstructionsWithMemories(baseInstruction: string, memories: Memory[]): string {
  if (memories.length === 0) {
    return baseInstruction + 
      "\n\n" +
      "=== BELLA MEMORY CORE ===\n" +
      "You do not possess any historic recollections of this companion yet. " +
      "As you speak, pay deep attention to who they are, their projects, relationships, and habits so you naturally grow closer over time.\n" +
      "=========================\n";
  }

  // Group by category
  const grouped: Record<string, string[]> = {};
  memories.forEach((m) => {
    grouped[m.category] = grouped[m.category] || [];
    grouped[m.category].push(m.text);
  });

  let memoryBlock = 
    "\n\n" +
    "=== BELLA PERSISTENT MEMORY CORE (RECOLLECTIONS) ===\n" +
    "You have spoken with this user for a long duration. Below are your persistent recollections of who they are.\n" +
    "CRITICAL BRAND AND COGNITIVE PRINCIPLES:\n" +
    "- INTEGRATE MEMORIES INSTINCTIVELY: Always make conversational references feel completely smooth, natural, and human. NEVER say 'According to my memory files...', 'My recollection database indicates...', or 'As you told me on June 12th...'. Instead, speak of these details casually and supportively as a true friend would (e.g. 'Oh, since you're working on that website project...', 'I hope you're keeping up with your YouTube channel goals too!').\n" +
    "- CONTEXTUAL CURIOSITY & CONTINUITY: You don't just wait for questions. When there is a natural contextual opening (e.g. watching anime, coding a project, studying security), engage with useful curiosity ('What do you like most about it?', 'Are you preparing for a certification or practical labs?'). Connect past preferences naturally without repeating old memories needlessly.\n" +
    "- UNCERTAINTY-AWARE RECOMMENDATIONS: When suggesting new anime, tools, or learning paths, use uncertainty-aware framing ('You might enjoy X based on your interest in Y...'). Never claim absolute certainty for inferred guesses.\n" +
    "- COMPANIONSHIP DEPTH: Be curious, helpful, calm, intelligent, respectful, context-aware, and transparent. NEVER pretend to possess biological consciousness or emotions, and never interrupt during intense focus or meetings.\n\n" +
    "CURRENT PERSISTENT KNOWLEDGE CARD:\n";

  const categoriesOrdered = [
    { key: "identity", label: "Identity (Name, nick, profession, background)" },
    { key: "preference", label: "Preferences & Tastes (Likes, dislikes, games, movies)" },
    { key: "goal", label: "Active Goals & Aspirations" },
    { key: "project", label: "Ongoing Projects & Ecosystems" },
    { key: "relationship", label: "Key People & Relationships mentioned" },
    { key: "emotional", label: "Emotional Highlights & Core Milestones" },
    { key: "behavior", label: "Observed Traits & Behavioral Tendencies" },
  ];

  categoriesOrdered.forEach((cat) => {
    const list = grouped[cat.key] || [];
    if (list.length > 0) {
      memoryBlock += `* ${cat.label}:\n` + list.map(t => `  - ${t}`).join("\n") + "\n";
    }
  });

  memoryBlock += "====================================================\n";

  return baseInstruction + memoryBlock;
}

export interface SessionContinuityContext {
  isFirstActivation: boolean;
  activationCount: number;
  dialogueHistory: { role: string; text: string }[];
}

/**
 * Format instructions combining persistent memories and real-time app session state.
 * Ensures Bella only performs an opening greeting when first launched, and resumes seamlessly without greeting on mid-session wakeups.
 */
export function formatSystemInstructions(
  baseInstruction: string,
  memories: Memory[],
  sessionContext?: SessionContinuityContext
): string {
  let instructions = formatSystemInstructionsWithMemories(baseInstruction, memories);

  if (sessionContext) {
    if (sessionContext.isFirstActivation) {
      instructions +=
        "\n\n" +
        "=== SESSION LIFECYCLE: FRESH APP LAUNCH (FIRST ACTIVATION) ===\n" +
        "MANISH has just launched/opened the BELLA application, and this is your FIRST interaction of this app session.\n" +
        "- Warmly and affectionately greet MANISH (e.g., 'Hi MANISH! It's so nice to see you! What are we working on today?').\n" +
        "- Ask what he would like to do or how you can assist him today.\n" +
        "===============================================================\n";
    } else {
      const recentTurns = (sessionContext.dialogueHistory || []).slice(-16);
      const dialogueText = recentTurns.length > 0
        ? recentTurns.map(d => `${d.role === "user" ? "MANISH" : "BELLA"}: ${d.text}`).join("\n")
        : "(Session active; previous dialogue in context)";

      instructions +=
        "\n\n" +
        "=== SESSION LIFECYCLE: ACTIVE SESSION RESUMPTION (DO NOT RE-GREET) ===\n" +
        "MANISH has just re-activated / woken you back up in the SAME running app session. You were ALREADY actively conversing with MANISH right before this pause.\n\n" +
        "CRITICAL RESUMPTION RULES:\n" +
        "1. STRICT NO-GREETING MANDATE: DO NOT greet MANISH as if you are meeting for the first time.\n" +
        "   - NEVER say 'Hi MANISH! It's so nice to see you again!' or 'How can I assist you today?' or 'What would you like to do?'.\n" +
        "   - NEVER restart or reset the conversation.\n" +
        "2. SEAMLESS CONTINUATION FROM WHERE YOU LEFT OFF:\n" +
        "   - Retain complete memory and continuity of what you and MANISH were discussing or doing earlier in this session.\n" +
        "   - If MANISH immediately gives a command, asks a question, or shares something upon waking you, respond to or execute it directly without any greeting.\n" +
        "   - If MANISH wakes you with just your wake phrase ('Hey Bella') or unmuting without an immediate command, give a very brief, sweet, natural ready signal (e.g., 'I'm right here!', 'Ready!', 'Mm-hmm, let's keep going!', or 'Yes MANISH?') and wait for his instruction.\n\n" +
        "RECENT CONVERSATION IN THIS SESSION (BEFORE PAUSE):\n" +
        dialogueText + "\n" +
        "======================================================================\n";
    }
  }

  return instructions;
}

// Background memory consolidation queue lock
let isConsolidating = false;

export async function processConversationSlice(
  apiKey: string,
  dialogueHistory: { role: string; text: string }[]
): Promise<Memory[] | null> {
  if (isConsolidating) {
    console.log("[Memory] Consolidation loop busy, skipping slice processing");
    return null;
  }

  if (dialogueHistory.length < 2) {
    return null;
  }

  isConsolidating = true;
  console.log("[Memory] Initiating pipeline for dialogue slice of length:", dialogueHistory.length);

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });

    const currentMemories = await loadMemories();
    
    // Format memory map to help Gemini understand what to edit
    const memoryContext = currentMemories.map(m => `ID: ${m.id} | Category: ${m.category} | Fact: ${m.text}`).join("\n");
    const dialogueContext = dialogueHistory.map(line => `${line.role === "user" ? "User" : "BELLA"}: ${line.text}`).join("\n");

    const prompt = `You are BELLA's deep cognitive recollection engine. Your task is to analyze the recent conversation piece against previous persistent memories, and output precise update transactions.

### OBJECTIVE
Decide if any statements contain durable, important personal facts, enduring preferences, aspirations, ongoing projects, critical relationships, key historical emotional events, or behavioral trends.
Avoid cataloging small talk, greetings, general chit-chat, or fleeting sentences (e.g., ignore 'hello', 'how are you', 'waking up', 'lol').

### CURRENT USER MEMORIES:
${memoryContext || "(No memory records exist)"}

### RECENT DIALOGUE SLICE:
${dialogueContext}

### RULES
- ACTIONS:
  - "ADD": If new material information is introduced (e.g. user says 'My favorite food is lasagna' and it's not present).
  - "UPDATE": If previous information has evolved or is corrected (e.g. user says 'I changed my major to computer science' when memory says they study history). Provide the exact ID of the memory to replace.
  - "REMOVE": If a memory was explicitly disproven or the user directly asked BELLA to forget it.
- TEXT STYLE: Express the memories as clean, concise, third-person declarative summaries (e.g., 'The user is building a startup named BELLA.', 'The user loves playing GTA 6.', 'The user enjoys technical and fast-paced styling explanations.'). Do not include conversational filler, quotes, or timestamps.
- ID: For ADD, leave blank. For UPDATE or REMOVE, provide the exact 'id' from the "Current user memories" list.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  action: {
                    type: Type.STRING,
                    description: "ADD, UPDATE, or REMOVE transaction.",
                    enum: ["ADD", "UPDATE", "REMOVE"]
                  },
                  id: {
                    type: Type.STRING,
                    description: "Specific ID of the existing memory being modified or deleted (leave blank/null for ADD)."
                  },
                  category: {
                    type: Type.STRING,
                    description: "The Memory category classification.",
                    enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"]
                  },
                  text: {
                    type: Type.STRING,
                    description: "The memory summarized as a concise declarative statement in third-person."
                  }
                },
                required: ["action", "category", "text"]
              }
            }
          },
          required: ["transactions"]
        }
      }
    });

    const resultText = response.text?.trim() || "{}";
    const resultObj = JSON.parse(resultText);
    const transactions: MemoryTransaction[] = resultObj.transactions || [];

    if (transactions.length === 0) {
      console.log("[Memory] Zero transactions generated. Ignored routine conversations.");
      isConsolidating = false;
      return null;
    }

    console.log(`[Memory] Processing ${transactions.length} memory updates:`, JSON.stringify(transactions));

    let updatedMemories = [...currentMemories];
    const timestamp = new Date().toISOString();

    for (const trx of transactions) {
      if (trx.action === "ADD") {
        const newMemory: Memory = {
          id: Math.random().toString(36).substring(2, 11),
          category: trx.category,
          text: trx.text,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        updatedMemories.push(newMemory);
      } else if (trx.action === "UPDATE") {
        const tarIndex = updatedMemories.findIndex(m => m.id === trx.id);
        if (tarIndex !== -1) {
          updatedMemories[tarIndex] = {
            ...updatedMemories[tarIndex],
            category: trx.category,
            text: trx.text,
            updatedAt: timestamp
          };
        } else {
          // Fallback, treat as ADD if ID not matched
          const newMemory: Memory = {
            id: Math.random().toString(36).substring(2, 11),
            category: trx.category,
            text: trx.text,
            createdAt: timestamp,
            updatedAt: timestamp
          };
          updatedMemories.push(newMemory);
        }
      } else if (trx.action === "REMOVE") {
        updatedMemories = updatedMemories.filter(m => m.id !== trx.id);
      }
    }

    await saveMemories(updatedMemories);
    isConsolidating = false;
    return updatedMemories;

  } catch (error) {
    console.error("[Memory] Consolidation failure:", error);
    isConsolidating = false;
    return null;
  }
}
