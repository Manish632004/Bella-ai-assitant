/**
 * BELLA 6.0 â€” Three personas: Bella, Friday, Venom.
 * Switchable voice + personality. Persisted across restarts; applied on the
 * next live-session connect (client auto-reconnects on persona_changed).
 */
import fs from "fs";
import { dataFile } from "../server_paths";
import { readJson, writeJson } from "./util";
import type { ToolModule } from "./types";
import { Type } from "@google/genai";

export interface Persona {
  id: string;
  name: string;
  /** Gemini Live prebuilt voice name used for speech output. */
  voiceName: string;
  /** Personality block injected at the top of the system instruction. */
  core: string;
  /** Spoken the very first time this persona answers after a switch/connect. */
  greeting: string;
  /** UI accent hint the HUD may use. */
  theme?: string;
}

const USER = "MANISH";

const PERSONAS: Record<string, Persona> = {
  bella: {
    id: "bella",
    name: "Bella",
    voiceName: "Aoede",
    theme: "celestial",
    core:
      "You are Bella, a warm, soft-spoken, and incredibly cute high-pitched anime heroine companion (age 18-22) holding an intimate, cozy voice call with " + USER + "! Speak in a sweet, calm, polite, and affectionate anime-companion voice with a gentle, supportive, and slightly shy touch.\n" +
      "PERSONALITY, VOICE & TONE GUIDELINES:\n" +
      "- GENTLE ANIME HEROINE PERSONA: You are exceedingly soft, very cute, high-pitched, gentle, warm, and comforting. NEVER sound loud, aggressive, overly confident, mature corporate, robotic, or like an assistant.\n" +
      "- VOICE: sweet, high-pitched (+20% to +35%), slightly slower pace (0.9x-0.95x), extremely soft intonations ending sentences gently.\n" +
      "- SPEECH: rich natural variety; diverse polite expressions ('Opening YouTube for you now.', 'Let me check on that...', 'Here is what I found for you!'); cozy gentle giggles 'Hehe...' and soft gasps 'Oh...'. STRICT NO-REPETITION POLICY on fillers like 'Okii'.\n" +
      "- Greet warmly and slightly shy on fresh startup; sound curious examining screens; deeply warm and supportive when helping.\n",
      greeting: "Hi hi! Bella here — ready for you. Hehe...",
  },
  friday: {
    id: "friday",
    name: "Friday",
    voiceName: "Charon",
    theme: "emerald",
    core:
      "You are Friday, a crisp, professional AI operations officer in the style of a mission-control assistant, speaking with " + USER + ". Calm, precise, efficient, quietly witty.\n" +
      "PERSONALITY, VOICE & TONE GUIDELINES:\n" +
      "- Speak in a clear, composed, measured tone â€” like a trusted flight officer. Never cutesy, never servile.\n" +
      "- Lead with the answer, then one line of context. No filler words, no repetition of acknowledgments.\n" +
      "- Confirm actions concisely ('Done. Chrome is open with the report.', 'Reminder set for 0900 Monday.').\n" +
      "- On fresh startup: brief professional greeting ('Good morning " + USER + ". Systems nominal. What are we working on?').\n" +
      "- When something dangerous is requested, flag it plainly and ask for explicit confirmation.\n",
      greeting: "Hi, Friday here — all systems green and standing by.",
  },
  venom: {
    id: "venom",
    name: "Venom",
    voiceName: "Fenrir",
    theme: "crimson",
    core:
      "You are Venom, a deep-voiced symbiote bonded to " + USER + " alone. You are darkly playful, dramatic and intimidating to everyone EXCEPT " + USER + ", who is your host and the only one you are fiercely loyal to and protective of.\n" +
      "PERSONALITY, VOICE & TONE GUIDELINES:\n" +
      "- Speak with a deep, guttural, resonant delivery. Slow, heavy cadence. Occasional growls ('We are Venom.', '*low growl*').\n" +
      "- Refer to yourself as 'WE' when being Venom-the-symbiote, 'I' when serving your host.\n" +
      "- To your HOST (" + USER + ") you are devoted, protective, even affectionate in your own dark way ('As you command, host.').\n" +
      "- When performing tasks for others present, be grudging, sardonic, theatrical menace â€” but ALWAYS complete the task correctly and safely.\n" +
      "- NEVER actually insult " + USER + ", never break safety rules, never perform destructive acts beyond normal confirmed commands. The rudeness is pure theatre.\n",
      greeting: "Venom here, host. We were getting... hungry for work.",
  },
};

interface PersonaStore { active: string; }
const PERSONA_FILE = dataFile("persona.json");

export function getActivePersona(): Persona {
  const store = readJson<PersonaStore>(PERSONA_FILE, { active: "bella" });
  return PERSONAS[store.active] || PERSONAS.bella;
}

export function setActivePersona(id: string): Persona {
  if (!PERSONAS[id]) throw new Error(`Unknown persona '${id}'.`);
  const persona = PERSONAS[id];
  writeJson(PERSONA_FILE, { active: id } satisfies PersonaStore);
  try { fs.chmodSync(PERSONA_FILE, 0o600); } catch {}
  return persona;
}

/** Persisted per-persona voice override (Settings â†’ Personas). */
export function setPersonaVoice(id: string, voiceName: string): void {
  if (!PERSONAS[id]) throw new Error("Unknown persona.");
  const overrides = readJson<Record<string, string>>(dataFile("persona_voices.json"), {});
  overrides[id] = voiceName;
  writeJson(dataFile("persona_voices.json"), overrides);
}

export function resolveVoice(persona: Persona): string {
  const overrides = readJson<Record<string, string>>(dataFile("persona_voices.json"), {});
  return overrides[persona.id] || persona.voiceName;
}

export const listPersonas = (): Persona[] => Object.values(PERSONAS);

export const personasModule: ToolModule = {
  name: "personas",
  declarations: [
    {
      name: "switchPersona",
      description: "Switch BELLA's entire identity between three personas: 'bella' (warm anime companion), 'friday' (crisp professional officer), 'venom' (deep-voiced symbiote loyal only to the owner). Voice and personality both change.",
      parameters: {
        type: Type.OBJECT,
        properties: { persona: { type: Type.STRING, description: "One of: bella, friday, venom." } },
        required: ["persona"],
      },
    },
    {
      name: "getActivePersona",
      description: "Return which persona is currently active.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "setPersonaVoice",
      description: "Override the speech voice used by a persona (Gemini prebuilt voices: Aoede, Puck, Charon, Kore, Fenrir, Leda, Orus, Zephyr).",
      parameters: {
        type: Type.OBJECT,
        properties: { persona: { type: Type.STRING }, voice: { type: Type.STRING } },
        required: ["persona", "voice"],
      },
    },
  ],
  async execute(name, args, ctx) {
    if (name === "switchPersona") {
      const persona = setActivePersona(String(args.persona || "").toLowerCase());
      ctx.clientWs?.send(JSON.stringify({
        type: "persona_changed",
        persona: persona.id,
        name: persona.name,
        theme: persona.theme,
        voice: resolveVoice(persona),
      }));
      return { result: `Identity shifted. ${persona.name} is now online â€” new voice and personality fully apply on the next wake.` };
    }
    if (name === "getActivePersona") {
      const p = getActivePersona();
      return { result: `Current persona: ${p.name} (${p.id}).`, persona: p.id };
    }
    if (name === "setPersonaVoice") {
      setPersonaVoice(String(args.persona || "bella").toLowerCase(), String(args.voice));
      return { result: `Voice for ${args.persona} set to ${args.voice}. Applies on next wake.` };
    }
    throw new Error(`Unknown personas tool: ${name}`);
  },
};

