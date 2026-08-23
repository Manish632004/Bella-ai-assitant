/**
 * BELLA 6.0 — Communication suite.
 *
 * - Email: zero-dependency minimal IMAP (993/STARTTLS) + SMTP clients.
 *   Reads unread mail aloud, dictates and sends new email, replies to threads,
 *   clears the spam/junk folder.
 * - Expenses: reads the bank/UPI/card/order mails already in your inbox,
 *   pulls the real transactions out of them and answers spending questions
 *   out loud — totals, top merchants, category split.
 * - WhatsApp: drives WhatsApp Desktop by name-matched deep links plus keyboard
 *   automation through the desktop agent (send text, attach a file, read chats).
 */
import tls from "tls";
import net from "net";
import fs from "fs";
import path from "path";
import { Type } from "@google/genai";
import {
  readJson, writeJson, generateJson, runCommand, resolveUserPath, dataFilePath, HOME,
} from "./util";
import { getCurrentApiKey } from "./util";
import { dispatchTool } from "./runtime";
import type { ToolModule } from "./types";

// ===========================================================================
// Email config
// ===========================================================================
export interface MailConfig {
  address: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpStarttls?: boolean;
}
const MAIL_FILE = dataFilePath("mail.json");
const loadMailConfig = () => readJson<MailConfig | null>(MAIL_FILE, null);

function providerHosts(address: string): Omit<MailConfig, "address" | "password"> {
  const domain = address.split("@")[1]?.toLowerCase() || "";
  if (/gmail|googlemail/.test(domain)) return { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465 };
  if (/outlook|hotmail|live\.|msn/.test(domain)) return { imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp.office365.com", smtpPort: 587, smtpStarttls: true };
  if (/yahoo/.test(domain)) return { imapHost: "imap.mail.yahoo.com", imapPort: 993, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465 };
  if (/icloud|me\.com/.test(domain)) return { imapHost: "imap.mail.me.com", imapPort: 993, smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpStarttls: true };
  const base = domain.replace(/^(mail|imap|smtp)\./, "");
  return { imapHost: `imap.${base}`, imapPort: 993, smtpHost: `smtp.${base}`, smtpPort: 465 };
}

// ===========================================================================
// Minimal IMAP client
// ===========================================================================
class ImapClient {
  private sock?: tls.TLSSocket;
  private tag = 0;

  static async connect(host: string, port = 993): Promise<ImapClient> {
    const c = new ImapClient();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`IMAP connect timeout (${host})`)), 15000);
      c.sock = tls.connect({ host, port, servername: host }, () => { clearTimeout(timer); resolve(); });
      c.sock.once("error", (e) => { clearTimeout(timer); reject(e); });
      c.sock.setTimeout(60000, () => c.sock?.destroy());
    });
    // Greeting
    await c.readUntilTag(`g${++c.tag}`);
    return c;
  }

  private readUntilTag(tagName: string, timeoutMs = 30000): Promise<string[]> {
    return new Promise((resolve, reject) => {
      let acc = Buffer.alloc(0);
      const timer = setTimeout(() => { cleanup(); reject(new Error("IMAP timeout")); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.sock?.removeListener("data", onData); this.sock?.removeListener("error", onErr); };
      const onErr = (e: Error) => { cleanup(); reject(e); };
      const onData = (chunk: Buffer) => {
        acc = Buffer.concat([acc, chunk]);
        // Parse complete lines, handling IMAP literals {N}
        const lines: string[] = [];
        let pos = 0;
        while (pos < acc.length) {
          const nl = acc.indexOf("\r\n", pos);
          if (nl === -1) break;
          let line = acc.toString("utf-8", pos, nl);
          const litMatch = line.match(/\{(\d+)\}$/);
          if (litMatch) {
            const n = parseInt(litMatch[1], 10);
            const litStart = nl + 2;
            if (acc.length < litStart + n) break; // wait for more bytes
            lines.push(line);
            lines.push("<L>" + acc.toString("utf-8", litStart, litStart + n).replace(/\r?\n/g, " ") + "</L>");
            pos = litStart + n;
          } else {
            lines.push(line);
            pos = nl + 2;
            if (line.startsWith(`${tagName} `)) {
              // consume parsed bytes
              acc = acc.subarray(pos);
              cleanup();
              resolve(lines);
              return;
            }
          }
        }
        acc = acc.subarray(0);
      };
      this.sock?.on("data", onData);
      this.sock?.once("error", onErr);
    });
  }

  async command(cmd: string): Promise<string[]> {
    const tag = `a${++this.tag}`;
    this.sock!.write(`${tag} ${cmd}\r\n`);
    const lines = await this.readUntilTag(tag);
    const statusLine = lines[lines.length - 1] || "";
    if (/^a\d+ NO|^a\d+ BAD/.test(statusLine)) throw new Error(`IMAP error: ${statusLine}`);
    return lines;
  }

  async login(user: string, pass: string): Promise<void> {
    await this.command(`LOGIN "${user.replace(/"/g, "")}" "${pass.replace(/"/g, "")}"`);
  }
  async select(mailbox = "INBOX"): Promise<number> {
    const lines = await this.command(`SELECT "${mailbox}"`);
    const exists = lines.find(l => /^\* \d+ EXISTS/i.test(l));
    return exists ? parseInt(exists.split(" ")[1], 10) : 0;
  }

  /**
   * Returns messages [{seq, headerLiteral, bodyLiteral}] for a SEARCH query.
   */
  async searchAndFetch(query: string, limit = 15, bodySlice = 2500): Promise<{ seq: string; raw: string }[]> {
    const lines = await this.command(`SEARCH ${query}`);
    const searchLine = lines.find(l => /^\* SEARCH/i.test(l));
    const seqs = searchLine ? searchLine.replace(/^\* SEARCH/i, "").trim().split(/\s+/).filter(Boolean) : [];
    const wanted = seqs.slice(-limit); // most recent N
    const out: { seq: string; raw: string }[] = [];
    for (const seq of wanted) {
      try {
        const resp = await this.command(
          `FETCH ${seq} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT]<0.${bodySlice}>)`,
        );
        out.push({ seq, raw: resp.join("\n") });
      } catch { /* skip bad message */ }
    }
    return out;
  }

  /** Empty a mailbox (spam cleanup): mark every message deleted then expunge. */
  async emptyMailbox(mailbox = "[Gmail]/Spam"): Promise<number> {
    const count = await this.select(mailbox);
    if (!count) return 0;
    await this.command("STORE 1:* +FLAGS.SILENT (\\Deleted)");
    await this.command("EXPUNGE");
    return count;
  }

  logout(): void {
    try { this.sock?.write("q99 LOGOUT\r\n"); } catch {}
    try { this.sock?.destroy(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Mail parsing helpers
// ---------------------------------------------------------------------------
function decodeMimeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, _cs, enc, data) => {
    try {
      if (enc.toLowerCase() === "b") return Buffer.from(data, "base64").toString("utf-8");
      return decodeURIComponent(String(data).replace(/_/g, "%20").replace(/=([0-9A-F]{2})/gi, "%$1"));
    } catch { return data; }
  });
}

interface ParsedMail { from: string; subject: string; date: string; body: string; }

function parseFetchedMail(raw: string): ParsedMail {
  const headerBlock = raw.match(/<L>([\s\S]*?)<\/L>/)?.[1] || "";
  const from = decodeMimeWords(headerBlock.match(/from:\s*(.*)/i)?.[1]?.trim() || "");
  const subject = decodeMimeWords(headerBlock.match(/subject:\s*(.*)/i)?.[1]?.trim() || "(no subject)");
  const date = headerBlock.match(/date:\s*(.*)/i)?.[1]?.trim() || "";
  const bodies = [...raw.matchAll(/<L>([\s\S]*?)<\/L>/g)].map(m => m[1]);
  const bodyRaw = bodies.length > 1 ? bodies[bodies.length - 1] : "";
  const isHtml = /<html|<div|<table|<p>/i.test(bodyRaw.slice(0, 500));
  const body = isHtml
    ? bodyRaw.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
    : bodyRaw.replace(/\s+/g, " ").trim();
  return { from, subject, date, body: body.slice(0, bodySliceMax()) };
}
let _bodyCap = 2000;
function bodySliceMax() { return _bodyCap; }

// ===========================================================================
// Minimal SMTP client (implicit TLS or STARTTLS)
// ===========================================================================
class SmtpClient {
  private sock!: tls.TLSSocket;

  static async connect(cfg: MailConfig): Promise<SmtpClient> {
    const c = new SmtpClient();
    if (cfg.smtpStarttls) {
      const plain = net.createConnection({ host: cfg.smtpHost, port: cfg.smtpPort || 587 });
      await c.expect(plain, [220], 15000);
      plain.write(`EHLO bella.local\r\n`);
      await c.expect(plain, [250], 15000);
      plain.write("STARTTLS\r\n");
      await c.expect(plain, [220], 15000);
      c.sock = tls.connect({ socket: plain, servername: cfg.smtpHost });
      await new Promise<void>((resolve, reject) => {
        c.sock.once("secureConnect", resolve);
        c.sock.once("error", reject);
      });
      c.sock.write(`EHLO bella.local\r\n`);
      await c.expect(c.sock, [250], 15000);
    } else {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("SMTP connect timeout")), 15000);
        c.sock = tls.connect({ host: cfg.smtpHost, port: cfg.smtpPort || 465, servername: cfg.smtpHost }, () => {
          clearTimeout(timer); resolve();
        });
        c.sock.once("error", (e) => { clearTimeout(timer); reject(e); });
      });
      await c.expect(c.sock, [220], 15000);
      c.sock.write(`EHLO bella.local\r\n`);
      await c.expect(c.sock, [250], 15000);
    }
    return c;
  }

  private expect(sock: tls.TLSSocket | net.Socket, codes: number[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let acc = "";
      const timer = setTimeout(() => { sock.removeListener("data", onData); reject(new Error("SMTP timeout")); }, timeoutMs);
      const onData = (d: Buffer) => {
        acc += d.toString("utf-8");
        const lines = acc.split(/\r?\n/).filter(Boolean);
        if (lines.length) {
          const last = lines[lines.length - 1];
          if (/^\d{3} /.test(last)) {
            clearTimeout(timer);
            sock.removeListener("data", onData);
            const code = parseInt(last.slice(0, 3), 10);
            if (codes.includes(code)) resolve(acc);
            else reject(new Error(`SMTP ${code}: ${last}`));
          }
        }
      };
      sock.on("data", onData);
      sock.once("error", (e) => { clearTimeout(timer); reject(e); });
    });
  }

  async authLogin(user: string, pass: string): Promise<void> {
    this.sock.write("AUTH LOGIN\r\n");
    await this.expect(this.sock, [334], 15000);
    this.sock.write(Buffer.from(user).toString("base64") + "\r\n");
    await this.expect(this.sock, [334], 15000);
    this.sock.write(Buffer.from(pass).toString("base64") + "\r\n");
    await this.expect(this.sock, [235], 15000);
  }

  async send(from: string, to: string, subject: string, body: string): Promise<void> {
    const subjAscii = /^[\x20-\x7e]*$/.test(subject)
      ? subject
      : `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const message =
      `From: ${from}\r\nTo: ${to}\r\nSubject: ${subjAscii}\r\n` +
      `Date: ${new Date().toUTCString()}\r\nMIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=UTF-8\r\n\r\n${body.replace(/^\./gm, "..")}`;
    this.sock.write(`MAIL FROM:<${from}>\r\n`);
    await this.expect(this.sock, [250], 15000);
    this.sock.write(`RCPT TO:<${to}>\r\n`);
    await this.expect(this.sock, [250, 251], 15000);
    this.sock.write("DATA\r\n");
    await this.expect(this.sock, [354], 15000);
    this.sock.write(message + "\r\n.\r\n");
    await this.expect(this.sock, [250], 30000);
  }

  quit(): void {
    try { this.sock.write("QUIT\r\n"); this.sock.destroy(); } catch {}
  }
}

// ===========================================================================
// Tool module — Email
// ===========================================================================
async function withImap<T>(cfg: MailConfig, fn: (imap: ImapClient) => Promise<T>): Promise<T> {
  const imap = await ImapClient.connect(cfg.imapHost, cfg.imapPort);
  try {
    await imap.login(cfg.address, cfg.password);
    return await fn(imap);
  } finally {
    imap.logout();
  }
}

export const emailModule: ToolModule = {
  name: "email",
  declarations: [
    {
      name: "configureEmail",
      description: "Configure the user's email account (IMAP/SMTP). Requires an app password for Gmail/Yahoo/Outlook. Tests the connection before saving.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          email: { type: Type.STRING },
          appPassword: { type: Type.STRING },
        },
        required: ["email", "appPassword"],
      },
    },
    {
      name: "checkUnreadEmail",
      description: "Fetch the user's unread emails (sender, subject, snippet) so they can be summarized or read aloud.",
      parameters: {
        type: Type.OBJECT,
        properties: { maxCount: { type: Type.INTEGER, description: "How many recent unread mails (default 5)." } },
      },
    },
    {
      name: "sendEmail",
      description: "Send an email from the configured account.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          to: { type: Type.STRING, description: "Recipient email address." },
          subject: { type: Type.STRING },
          body: { type: Type.STRING },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "replyToLatest",
      description: "Reply to the most recent email matching a sender/subject query using IMAP threading.",
      parameters: {
        type: Type.OBJECT,
        properties: { query: { type: Type.STRING }, replyText: { type: Type.STRING } },
        required: ["query", "replyText"],
      },
    },
    {
      name: "clearJunkFolder",
      description: "Empty the spam/junk folder of the configured email account.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
  ],
  async execute(name, args) {
    switch (name) {
      case "configureEmail": {
        const address = String(args.email || "").trim();
        const password = String(args.appPassword || "");
        if (!address.includes("@")) throw new Error("That doesn't look like an email address.");
        const hosts = providerHosts(address);
        const cfg: MailConfig = { address, password, ...hosts };
        // Test IMAP login
        const imap = await ImapClient.connect(cfg.imapHost, cfg.imapPort);
        try {
          await imap.login(address, password);
        } catch (err: any) {
          imap.logout();
          throw new Error(`Login failed (${err.message}). Check the address and APP password (Gmail needs 2FA + app password).`);
        }
        const count = await imap.select("INBOX");
        imap.logout();
        writeJson(MAIL_FILE, cfg);
        try { fs.chmodSync(MAIL_FILE, 0o600); } catch {}
        return { result: `Email connected: ${address}. Inbox has ${count} messages. I can now read your mail aloud, send new email and scan expenses.` };
      }
      case "checkUnreadEmail": {
        const cfg = loadMailConfig();
        if (!cfg) return { result: "No email account configured yet. Give me your email address and app password and I'll set it up." };
        const maxCount = Number(args.maxCount || 5);
        _bodyCap = 400;
        const mails = await withImap(cfg, async (imap) => {
          await imap.select("INBOX");
          const fetched = await imap.searchAndFetch("UNSEEN", maxCount);
          return fetched.map(f => parseFetchedMail(f.raw));
        });
        if (!mails.length) return { result: "Your inbox has no unread emails. You're all caught up!" };
        return {
          result: `${mails.length} unread:\n` + mails.map((m, i) =>
            `${i + 1}. From ${m.from} — "${m.subject}"\n   ${m.body.slice(0, 150)}`).join("\n"),
        };
      }
      case "sendEmail": {
        const cfg = loadMailConfig();
        if (!cfg) throw new Error("No email account configured. Use configureEmail first.");
        const smtp = await SmtpClient.connect(cfg);
        try {
          await smtp.authLogin(cfg.address, cfg.password);
          await smtp.send(cfg.address, String(args.to), String(args.subject || ""), String(args.body || ""));
        } finally {
          smtp.quit();
        }
        return { result: `Email sent to ${args.to}: "${args.subject}".` };
      }
      case "replyToLatest": {
        const cfg = loadMailConfig();
        if (!cfg) throw new Error("No email configured.");
        const q = String(args.query || "").toLowerCase();
        _bodyCap = 800;
        const mails = await withImap(cfg, async (imap) => {
          await imap.select("INBOX");
          const fetched = await imap.searchAndFetch("ALL", 40);
          return fetched.map(f => ({ ...parseFetchedMail(f.raw), seq: f.seq }));
        });
        const match = mails.reverse().find(m =>
          m.from.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q));
        if (!match) throw new Error(`No recent mail matches "${args.query}".`);
        const addr = match.from.match(/[\w.+-]+@[\w.-]+/)?.[0];
        if (!addr) throw new Error("Could not find the sender's address.");
        const smtp = await SmtpClient.connect(cfg);
        try {
          await smtp.authLogin(cfg.address, cfg.password);
          await smtp.send(cfg.address, addr, match.subject.startsWith("Re:") ? match.subject : `Re: ${match.subject}`, String(args.replyText));
        } finally { smtp.quit(); }
        return { result: `Replied to ${addr} about "${match.subject}".` };
      }
      case "clearJunkFolder": {
        const cfg = loadMailConfig();
        if (!cfg) throw new Error("No email configured.");
        const cleared = await withImap(cfg, async (imap) => {
          for (const box of ["[Gmail]/Spam", "Junk", "Spam"]) {
            try { return await imap.emptyMailbox(box); } catch { continue; }
          }
          return 0;
        });
        return { result: cleared ? `Cleared ${cleared} junk/spam messages.` : "No accessible junk folder found (or already empty)." };
      }
    }
    throw new Error(`Unknown email tool: ${name}`);
  },
};

// ===========================================================================
// WhatsApp (Windows desktop automation)
// ===========================================================================
interface ContactsFile { defaultCountryCode: string; contacts: Record<string, string>; }
const CONTACTS_FILE = dataFilePath("whatsapp_contacts.json");
const loadContacts = (): ContactsFile => readJson<ContactsFile>(CONTACTS_FILE, { defaultCountryCode: "91", contacts: {} });

function normalizePhone(input: string): string {
  let digits = String(input).replace(/[^\d]/g, "");
  const store = loadContacts();
  if (digits.length <= 10 && !digits.startsWith(store.defaultCountryCode)) {
    digits = store.defaultCountryCode + digits;
  }
  return digits;
}

function resolvePhone(nameOrNumber: string): string | null {
  const store = loadContacts();
  const key = String(nameOrNumber).trim().toLowerCase();
  for (const [name, num] of Object.entries(store.contacts)) {
    if (name.toLowerCase() === key) return normalizePhone(num);
  }
  // fuzzy: startsWith match
  for (const [name, num] of Object.entries(store.contacts)) {
    if (name.toLowerCase().startsWith(key) && key.length >= 3) return normalizePhone(num);
  }
  if (/\d{6,}/.test(key.replace(/\D/g, ""))) return normalizePhone(nameOrNumber);
  return null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function openChat(phone: string, message?: string): Promise<void> {
  const url = message !== undefined
    ? `whatsapp://send?phone=${phone}&text=${encodeURIComponent(message)}`
    : `whatsapp://send?phone=${phone}`;
  await runCommand(`start "" "${url}"`, undefined, 10000);
  await sleep(2800);
}

export const whatsappModule: ToolModule = {
  name: "whatsapp",
  declarations: [
    {
      name: "addContact",
      description: "Save a contact name → phone number mapping used by all WhatsApp tools.",
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, phone: { type: Type.STRING } },
        required: ["name", "phone"],
      },
    },
    {
      name: "listContacts",
      description: "List saved WhatsApp contacts.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "sendWhatsAppMessage",
      description: "Send a WhatsApp message to a saved contact (by name) or raw phone number via WhatsApp Desktop.",
      parameters: {
        type: Type.OBJECT,
        properties: { contact: { type: Type.STRING }, message: { type: Type.STRING } },
        required: ["contact", "message"],
      },
    },
    {
      name: "attachFileToWhatsApp",
      description: "Send a file/folder attachment over WhatsApp Desktop to a contact (opens chat and pastes the file).",
      parameters: {
        type: Type.OBJECT,
        properties: { contact: { type: Type.STRING }, filePath: { type: Type.STRING } },
        required: ["contact", "filePath"],
      },
    },
    {
      name: "readWhatsAppChats",
      description: "Open WhatsApp Desktop, screenshot the inbox/chat and OCR it so unread conversations can be read aloud.",
      parameters: {
        type: Type.OBJECT,
        properties: { contact: { type: Type.STRING, description: "Optional: open a specific chat first." } },
      },
    },
  ],
  async execute(name, args) {
    switch (name) {
      case "addContact": {
        const store = loadContacts();
        store.contacts[String(args.name).trim()] = String(args.phone);
        writeJson(CONTACTS_FILE, store);
        return { result: `Saved ${args.name} → ${args.phone}.` };
      }
      case "listContacts": {
        const store = loadContacts().contacts;
        const entries = Object.entries(store);
        return { result: entries.length ? entries.map(([n, p]) => `- ${n}: ${p}`).join("\n") : "No contacts saved." };
      }
      case "sendWhatsAppMessage": {
        const phone = resolvePhone(String(args.contact));
        if (!phone) throw new Error(`Unknown contact "${args.contact}". Save them first with addContact.`);
        await openChat(phone, String(args.message));
        await dispatchTool("pressEnter", {});
        return { result: `Message sent to ${args.contact} on WhatsApp.` };
      }
      case "attachFileToWhatsApp": {
        const phone = resolvePhone(String(args.contact));
        if (!phone) throw new Error(`Unknown contact "${args.contact}".`);
        const filePath = resolveUserPath(String(args.filePath));
        if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
        await openChat(phone);
        await runPowerShellSetClipboardFile(filePath);
        await sleep(600);
        await dispatchTool("keyboardHotkey", { keys: "ctrl+v" });
        await sleep(1800);
        await dispatchTool("pressEnter", {});
        return { result: `Sent ${path.basename(filePath)} to ${args.contact} on WhatsApp.` };
      }
      case "readWhatsAppChats": {
        if (args.contact) {
          const phone = resolvePhone(String(args.contact));
          if (phone) await openChat(phone);
        } else {
          await dispatchTool("openApplication", { name: "WhatsApp" });
          await sleep(3200);
        }
        await dispatchTool("takeScreenshot", {});
        const ocr = await dispatchTool("analyzeScreenshot", {});
        return { result: `Here's what the screen shows:\n${JSON.stringify(ocr).slice(0, 1500)}` };
      }
    }
    throw new Error(`Unknown whatsapp tool: ${name}`);
  },
};

async function runPowerShellSetClipboardFile(filePath: string): Promise<void> {
  await runCommand(
    `powershell -NoProfile -NonInteractive -Command "Set-Clipboard -Path '${filePath.replace(/'/g, "''")}'"`,
    undefined, 15000,
  );
}

// ===========================================================================
// Expenses from bank/UPI/order mails
// ===========================================================================
export interface Expense {
  id: string; date: string; amount: number; currency: string;
  merchant: string; category: string; description: string; source: string;
}
const EXPENSES_FILE = dataFilePath("expenses.json");
const loadExpenses = (): Expense[] => readJson<Expense[]>(EXPENSES_FILE, []);
const saveExpenses = (list: Expense[]) => writeJson(EXPENSES_FILE, list);

const BANK_HINT_RE = /(debited|credited\s+(rs|inr|₹)|spent|purchase|txn|transaction|upi|order confirmed|payment successful|card used)/i;
const MONEY_HINT_RE = /(₹|\brs\.?\b|\binr\b|\$\s?\d|usd)/i;

function periodStart(days: number): Date {
  return new Date(Date.now() - days * 86400000);
}

export const expensesModule: ToolModule = {
  name: "expenses",
  declarations: [
    {
      name: "scanExpenseMails",
      description: "Scan the inbox for bank / UPI / card / order-receipt mails from the last N days, extract the real transactions and store them.",
      parameters: {
        type: Type.OBJECT,
        properties: { days: { type: Type.INTEGER, description: "Look back N days (default 30)." } },
      },
    },
    {
      name: "totalSpending",
      description: "Total spending over a period ('today', 'week', 'month', 'all'). Answers 'how much did I spend today?'",
      parameters: {
        type: Type.OBJECT,
        properties: { period: { type: Type.STRING } },
      },
    },
    {
      name: "topMerchants",
      description: "Top merchants by total spend in the last N days (default 30).",
      parameters: {
        type: Type.OBJECT,
        properties: { limit: { type: Type.INTEGER }, days: { type: Type.INTEGER } },
      },
    },
    {
      name: "spendingByCategory",
      description: "Category-wise spending split for the last N days.",
      parameters: { type: Type.OBJECT, properties: { days: { type: Type.INTEGER } } },
    },
    {
      name: "listTransactions",
      description: "List the most recent stored transactions.",
      parameters: { type: Type.OBJECT, properties: { limit: { type: Type.INTEGER } } },
    },
  ],
  async execute(name, args) {
    switch (name) {
      case "scanExpenseMails": {
        const cfg = loadMailConfig();
        if (!cfg) throw new Error("Email not configured yet.");
        const days = Number(args.days || 30);
        const since = periodStart(days);
        const dd = `${String(since.getDate()).padStart(2, "0")}-${since.toLocaleString("en", { month: "short" })}-${since.getFullYear()}`;

        _bodyCap = 1600;
        const mails = await withImap(cfg, async (imap) => {
          await imap.select("INBOX");
          const fetched = await imap.searchAndFetch(`SINCE ${dd}`, 80, 1600);
          return fetched.map(f => parseFetchedMail(f.raw)).filter(m => BANK_HINT_RE.test(m.subject) || BANK_HINT_RE.test(m.body) || MONEY_HINT_RE.test(m.subject));
        });
        if (!mails.length) return { result: `No transaction-looking mails found in the last ${days} days.` };

        const existing = new Set(loadExpenses().map(e => e.id));
        let added = 0;
        for (let i = 0; i < mails.length; i += 6) {
          const batch = mails.slice(i, i + 6);
          try {
            const apiKey = getCurrentApiKey();
            const extracted = await generateJson<{ transactions: Omit<Expense, "id">[] }>(
              apiKey,
              `Extract financial TRANSACTIONS (money the user PAID — debits/purchases/orders; ignore credits/refunds/salary) from these emails. Return {"transactions":[{"date":"YYYY-MM-DD","amount":123.45,"currency":"INR","merchant":"...","category":"food|travel|shopping|utilities|entertainment|health|other","description":"short"}]}.\n\nEMAILS:\n` +
              batch.map((m, j) => `[${j}] From: ${m.from}\nDate: ${m.date}\nSubject: ${m.subject}\nBody: ${m.body}`).join("\n---\n"),
              "You are a precise financial-data extractor. Only include transactions you are confident about.",
            );
            for (const t of extracted.transactions || []) {
              const id = `${t.date}|${t.amount}|${t.merchant}`.toLowerCase().replace(/\s+/g, "-");
              if (existing.has(id) || !(t.amount > 0)) continue;
              existing.add(id);
              saveExpenses([...loadExpenses(), { id, source: "email-scan", ...t }]);
              added++;
            }
          } catch (err) {
            console.warn("[Expenses] batch extraction failed:", err);
          }
        }
        return { result: added ? `Found ${added} new transactions from ${mails.length} mails. Ask me anything about your spending!` : `Scanned ${mails.length} mails but found no new transactions.` };
      }
      case "totalSpending": {
        const period = String(args.period || "month").toLowerCase();
        const days = period.startsWith("today") ? 1 : period.startsWith("week") ? 7 : period.startsWith("all") ? 36500 : 30;
        const cutoff = periodStart(days);
        const list = loadExpenses().filter(e => new Date(e.date) >= cutoff);
        const totals: Record<string, number> = {};
        for (const e of list) totals[e.currency] = (totals[e.currency] || 0) + e.amount;
        const parts = Object.entries(totals).map(([c, v]) => `${v.toFixed(2)} ${c}`);
        const todayOnly = days === 1;
        return { result: `You spent ${parts.join(" + ") || "nothing"} ${todayOnly ? "today" : `in the last ${days} days`} across ${list.length} transactions.` };
      }
      case "topMerchants": {
        const days = Number(args.days || 30);
        const cutoff = periodStart(days);
        const agg: Record<string, number> = {};
        for (const e of loadExpenses().filter(e => new Date(e.date) >= cutoff)) {
          agg[e.merchant] = (agg[e.merchant] || 0) + e.amount;
        }
        const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, Number(args.limit || 5));
        return { result: top.length ? top.map(([m, v], i) => `${i + 1}. ${m}: ${v.toFixed(2)}`).join("\n") : "No expenses recorded yet — try scanExpenseMails first." };
      }
      case "spendingByCategory": {
        const days = Number(args.days || 30);
        const cutoff = periodStart(days);
        const agg: Record<string, number> = {};
        for (const e of loadExpenses().filter(e => new Date(e.date) >= cutoff)) {
          agg[e.category] = (agg[e.category] || 0) + e.amount;
        }
        const total = Object.values(agg).reduce((a, b) => a + b, 0) || 1;
        return {
          result: Object.entries(agg).sort((a, b) => b[1] - a[1])
            .map(([c, v]) => `- ${c}: ${v.toFixed(2)} (${Math.round(v / total * 100)}%)`).join("\n") || "No expenses recorded yet.",
        };
      }
      case "listTransactions": {
        const list = loadExpenses().slice(-Number(args.limit || 10)).reverse();
        return {
          result: list.length ? list.map(e => `${e.date} — ${e.amount} ${e.currency} @ ${e.merchant} [${e.category}]`).join("\n") : "No transactions stored yet.",
        };
      }
    }
    throw new Error(`Unknown expenses tool: ${name}`);
  },
};
