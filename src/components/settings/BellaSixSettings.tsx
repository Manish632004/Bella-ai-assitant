import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  UserRoundCog, Smartphone, ShieldCheck, Mail, RefreshCw, Check, X,
  ClipboardList, Wallet, Puzzle, Rocket,
} from "lucide-react";

interface PersonaInfo { id: string; name: string; theme?: string; voice?: string; }
interface DeviceInfo { id: string; name: string; lastSeen: string; }
interface ReminderRow { id: string; text: string; when: string; }
interface ExpenseRow { id: string; date: string; amount: number; currency: string; merchant: string; category: string; }
interface SkillRow { name: string; version: number; type: string; description: string; }

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-cyan-400" />
        <h4 className="text-xs font-mono uppercase tracking-widest text-slate-300">{title}</h4>
      </div>
      {children}
    </div>
  );
}

export function BellaSixSettings() {
  const [personas, setPersonas] = useState<PersonaInfo[]>([]);
  const [activePersona, setActivePersonaState] = useState<string>("bella");
  const [pairUrl, setPairUrl] = useState("");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [guardian, setGuardian] = useState<{ enrolled: boolean; printCount: number; armed: boolean } | null>(null);
  const [emailStatus, setEmailStatus] = useState<{ configured: boolean; address: string } | null>(null);
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [spend, setSpend] = useState<{ todayTotal: string; currency: string; transactions: ExpenseRow[] } | null>(null);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [updateMsg, setUpdateMsg] = useState("");

  const refreshDashboards = useCallback(async () => {
    try {
      const [r, ex, sk] = await Promise.all([
        fetch("/api/bella/reminders").then(r2 => r2.json()).catch(() => null),
        fetch("/api/bella/expenses?limit=8").then(r2 => r2.json()).catch(() => null),
        fetch("/api/skills").then(r2 => r2.json()).catch(() => null),
      ]);
      if (r?.reminders) setReminders(r.reminders);
      if (ex) setSpend(ex);
      if (sk?.result && Array.isArray(sk.result)) setSkills(sk.result.map((s: string) => {
        const m = s.match(/- (.+) v(\d+) \[(.+)\] — (.*)$/);
        return m ? { name: m[1], version: Number(m[2]), type: m[3], description: m[4] } : null;
      }).filter(Boolean));
    } catch { /* non-fatal */ }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [p, ph, g, e] = await Promise.all([
        fetch("/api/bella/personas").then(r => r.json()).catch(() => null),
        fetch("/api/phone/pair-info").then(r => r.json()).catch(() => null),
        fetch("/api/guardian/status").then(r => r.json()).catch(() => null),
        fetch("/api/email/status").then(r => r.json()).catch(() => null),
      ]);
      if (p?.personas) { setPersonas(p.personas); setActivePersonaState(p.active); }
      if (ph?.pairUrl) { setPairUrl(ph.pairUrl); setDevices(ph.devices || []); }
      if (g) setGuardian(g);
      if (e) setEmailStatus(e);
    } catch { /* panel still renders */ }
  }, []);

  useEffect(() => { void refreshAll(); }, [refreshAll]);
  useEffect(() => { void refreshDashboards(); }, [refreshDashboards]);

  const switchPersona = async (id: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/bella/persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: id }),
      });
      const j = await r.json();
      if (j.ok) {
        setActivePersonaState(id);
        // Ask the HUD to reconnect so the new voice applies immediately.
        window.dispatchEvent(new CustomEvent("bella:reconnect-persona"));
      }
    } finally { setBusy(false); }
  };

  const saveEmail = async () => {
    if (!email.includes("@") || appPassword.length < 4) return;
    setBusy(true);
    setEmailMsg(null);
    try {
      const r = await fetch("/api/email/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, appPassword }),
      });
      const j = await r.json();
      const resultText = String((j as any)?.result || j?.error || "");
      const ok = !j?.error;
      setEmailMsg({ ok, text: resultText.slice(0, 220) });
      if (ok) { setEmailStatus({ configured: true, address: email }); setAppPassword(""); }
    } catch (err: any) {
      setEmailMsg({ ok: false, text: err.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
        BELLA 6.0 Capability Hub
      </div>

      {/* ---------- Personas ---------- */}
      <Section icon={UserRoundCog} title="Personas">
        <div className="grid grid-cols-3 gap-2">
          {personas.map(p => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => void switchPersona(p.id)}
              className={`px-3 py-2 rounded-xl border text-left transition cursor-pointer ${
                activePersona === p.id
                  ? "border-cyan-400 bg-cyan-400/10 text-cyan-200"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-[10px] font-mono text-slate-500">{p.voice}</div>
            </button>
          ))}
        </div>
        <p className="text-[10px] font-mono text-slate-500">
          Switching reconnects the voice session so the new voice applies instantly.
        </p>
      </Section>

      {/* ---------- Phone link ---------- */}
      <Section icon={Smartphone} title="Phone Link">
        {pairUrl ? (
          <div className="flex items-center gap-4">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(pairUrl)}`}
              alt="Pairing QR"
              className="w-[110px] h-[110px] rounded-lg bg-white p-1"
            />
            <div className="space-y-1 min-w-0">
              <p className="text-[11px] text-slate-400">
                Scan with your phone (same Wi-Fi) to join this session — ask your phone questions, push notes, wake Bella remotely.
              </p>
              <p className="text-[10px] font-mono text-cyan-300 truncate">{pairUrl}</p>
              {devices.length > 0 && (
                <div className="pt-1 space-y-0.5">
                  {devices.map(d => (
                    <div key={d.id} className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                      <Check size={11} /> {d.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">Generating pairing link…</p>
        )}
      </Section>

      {/* ---------- Voice guardian ---------- */}
      <Section icon={ShieldCheck} title="Voice Guardian">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("bella:guardian-enroll"))}
            className="px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 text-xs font-mono transition cursor-pointer"
          >
            ENROLL VOICEPRINT
          </button>
          <button
            onClick={() =>
              fetch("/api/guardian/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ armed: !(guardian?.armed ?? false) }),
              }).then(() => refreshAll())
            }
            disabled={!guardian?.enrolled}
            className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition cursor-pointer ${
              guardian?.armed
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            } ${!guardian?.enrolled ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            {guardian?.armed ? "ARMED ✓ (click to disarm)" : "ARM GUEST MODE"}
          </button>
          <button
            onClick={() => void refreshAll()}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <p className="text-[10px] font-mono text-slate-500">
          {guardian?.enrolled
            ? `${guardian.printCount} voiceprint(s) enrolled · guests get restricted tools when armed.`
            : "Say “Hey Bella” three times to enroll your voiceprint."}
        </p>
      </Section>

      {/* ---------- Dashboards ---------- */}
      <Section icon={ClipboardList} title="Reminders & spending">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 flex items-center gap-1"><ClipboardList size={11} /> Active reminders</p>
            {reminders.length ? reminders.map(r => (
              <div key={r.id} className="text-[11px] text-slate-300">• {r.text} <span className="text-cyan-400 font-mono">({r.when})</span></div>
            )) : <p className="text-[11px] text-slate-500">None set.</p>}
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 flex items-center gap-1"><Wallet size={11} /> Today: {spend ? `${spend.todayTotal} ${spend.currency}` : "—"}</p>
            {spend?.transactions?.slice(0, 4).map(t => (
              <div key={t.id} className="text-[11px] text-slate-300 truncate">{t.date} · {t.merchant} — {t.amount.toFixed(0)} {t.currency}</div>
            ))}
            {!spend?.transactions?.length && <p className="text-[11px] text-slate-500">Run "scan my expenses" to import from bank mails.</p>}
          </div>
        </div>
      </Section>

      <Section icon={Puzzle} title="Skills">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-slate-400">
            {skills.length ? `${skills.length} learned skill${skills.length > 1 ? "s" : ""}: ${skills.map(s => s.name).join(", ")}` : "No custom skills yet — ask Bella to learn one."}
          </p>
          <button
            onClick={() => void refreshDashboards()}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </Section>

      <Section icon={Rocket} title="Updates">
        <button
          onClick={async () => {
            setUpdateMsg("Checking…");
            try {
              const r = await fetch("/api/bella/check-updates", { method: "POST" });
              const j = await r.json();
              setUpdateMsg(String(j?.result || j?.error || ""));
            } catch (e: any) { setUpdateMsg(e.message); }
          }}
          className="px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 text-xs font-mono transition cursor-pointer"
        >
          CHECK FOR UPDATES
        </button>
        {updateMsg && <p className="text-[11px] font-mono text-slate-300">{updateMsg}</p>}
      </Section>

      {/* ---------- Email ---------- */}
      <Section icon={Mail} title="Email account">
        {emailStatus?.configured && (
          <p className="text-[11px] text-emerald-300 flex items-center gap-1">
            <Check size={12} /> Connected: {emailStatus.address}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@gmail.com"
            className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50"
          />
          <input
            value={appPassword}
            onChange={e => setAppPassword(e.target.value)}
            type="password"
            placeholder="App password (not login password)"
            className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50"
          />
        </div>
        <button
          onClick={() => void saveEmail()}
          disabled={busy || !email.includes("@")}
          className="px-3 py-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-200 text-xs font-mono transition cursor-pointer disabled:opacity-40"
        >
          CONNECT &amp; TEST
        </button>
        {emailMsg && (
          <p className={`text-[11px] font-mono flex items-start gap-1 ${emailMsg.ok ? "text-emerald-300" : "text-rose-300"}`}>
            {emailMsg.ok ? <Check size={12} /> : <X size={12} />} {emailMsg.text}
          </p>
        )}
        <p className="text-[10px] font-mono text-slate-500">
          Gmail/Outlook/Yahoo need an APP password (Google Account → Security → App passwords).
        </p>
      </Section>
    </div>
  );
}
