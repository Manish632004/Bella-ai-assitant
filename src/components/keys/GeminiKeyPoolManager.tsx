import React, { useState, useEffect, useRef } from "react";
import {
  Key,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Power,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Edit2,
  Check,
  X,
  Copy,
  Zap,
  Info
} from "lucide-react";
import { GeminiApiKey, KeyStatus, KeyTestResult } from "../../lib/keys/types";

interface GeminiKeyPoolManagerProps {
  themeColor?: string;
}

export const GeminiKeyPoolManager: React.FC<GeminiKeyPoolManagerProps> = ({
  themeColor = "cyan"
}) => {
  const [keys, setKeys] = useState<GeminiApiKey[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Add Key Modal State
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newKeyName, setNewKeyName] = useState<string>("");
  const [newRawKey, setNewRawKey] = useState<string>("");
  const [testingNewKey, setTestingNewKey] = useState<boolean>(false);
  const [newKeyTestResult, setNewKeyTestResult] = useState<KeyTestResult | null>(null);
  const [savingKey, setSavingKey] = useState<boolean>(false);

  // Per-Key Testing State
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, KeyTestResult>>({});

  // Rename State
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState<string>("");

  // Live timer tick for cooldown countdowns
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchKeys = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/keys/gemini");
      if (!res.ok) throw new Error("Failed to load Gemini keys");
      const data = await res.json();
      setKeys(data.keys || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleAddKey = async () => {
    if (!newRawKey.trim()) return;
    try {
      setSavingKey(true);
      const res = await fetch("/api/keys/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKeyName.trim() || `Gemini Key ${keys.length + 1}`,
          key: newRawKey.trim()
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to add key");
      }
      setShowAddModal(false);
      setNewKeyName("");
      setNewRawKey("");
      setNewKeyTestResult(null);
      await fetchKeys();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingKey(false);
    }
  };

  const handleTestRawKey = async () => {
    if (!newRawKey.trim()) return;
    try {
      setTestingNewKey(true);
      setNewKeyTestResult(null);
      const res = await fetch("/api/keys/gemini/test-raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newRawKey.trim() })
      });
      const result = await res.json();
      setNewKeyTestResult(result);
    } catch (e: any) {
      setNewKeyTestResult({
        success: false,
        status: "error",
        message: e.message
      });
    } finally {
      setTestingNewKey(false);
    }
  };

  const handleTestKey = async (id: string) => {
    try {
      setTestingKeyId(id);
      const res = await fetch(`/api/keys/gemini/${id}/test`, {
        method: "POST"
      });
      const result: KeyTestResult = await res.json();
      setTestResults(prev => ({ ...prev, [id]: result }));
      await fetchKeys();
    } catch (e: any) {
      setTestResults(prev => ({
        ...prev,
        [id]: { success: false, status: "error", message: e.message }
      }));
    } finally {
      setTestingKeyId(null);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm("Are you sure you want to remove this Gemini API key from the pool?")) return;
    try {
      const res = await fetch(`/api/keys/gemini/${id}`, { method: "DELETE" });
      if (res.ok) {
        setKeys(prev => prev.filter(k => k.id !== id));
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleToggleKey = async (id: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`/api/keys/gemini/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled })
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(prev => prev.map(k => (k.id === id ? data.key : k)));
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSaveRename = async (id: string) => {
    if (!editNameValue.trim()) {
      setEditingKeyId(null);
      return;
    }
    try {
      const res = await fetch(`/api/keys/gemini/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editNameValue.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(prev => prev.map(k => (k.id === id ? data.key : k)));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEditingKeyId(null);
      setEditNameValue("");
    }
  };

  const handleMovePriority = async (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= keys.length) return;

    const reordered = [...keys];
    const temp = reordered[index];
    reordered[index] = reordered[targetIndex];
    reordered[targetIndex] = temp;

    const orderedIds = reordered.map(k => k.id);
    try {
      const res = await fetch("/api/keys/gemini/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds })
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || reordered);
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const renderStatusBadge = (key: GeminiApiKey) => {
    if (!key.enabled) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Disabled
        </span>
      );
    }

    if (key.status === "rate_limited" || key.status === "quota_exceeded") {
      let countdown = "";
      if (key.cooldownUntil) {
        const remainingSec = Math.max(0, Math.ceil((new Date(key.cooldownUntil).getTime() - now) / 1000));
        countdown = remainingSec > 60 ? `${Math.ceil(remainingSec / 60)}m` : `${remainingSec}s`;
      }
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
          <Clock size={11} className="animate-spin text-amber-400" />
          {key.status === "quota_exceeded" ? "Quota Exceeded" : "Rate Limited"}
          {countdown && ` (Retry in ${countdown})`}
        </span>
      );
    }

    if (key.status === "invalid") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
          <AlertTriangle size={11} className="text-rose-400" />
          Invalid Key
        </span>
      );
    }

    if (key.status === "active") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          Active Session Key
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 size={11} className="text-emerald-400" />
        Available
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header with Title & Add Key Trigger */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-wide uppercase font-display text-white/90 flex items-center gap-2">
            <Key size={16} className="text-cyan-400" />
            Gemini API Key Pool
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Automatic failover pool. Switches seamlessly when a key reaches rate limits or quota exhaustion.
          </p>
        </div>
        <button
          onClick={() => {
            setShowAddModal(true);
            setNewKeyName("");
            setNewRawKey("");
            setNewKeyTestResult(null);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-medium rounded-xl border border-cyan-500/30 transition shadow-lg shadow-cyan-500/10 cursor-pointer"
        >
          <Plus size={14} />
          Add API Key
        </button>
      </div>

      {/* Info Tip Banner */}
      <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-start gap-3">
        <Info size={16} className="text-cyan-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-300 leading-relaxed">
          <strong className="text-white font-medium">Automatic Failover Strategy:</strong> Bella uses the highest-priority enabled key normally. If Gemini returns a <code className="text-amber-300 bg-black/40 px-1 py-0.5 rounded">429</code>, rate-limit, or quota error, Bella marks that key on temporary cooldown and automatically switches to your next backup key without interrupting your workflow.
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Keys List */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
          <RefreshCw size={16} className="animate-spin text-cyan-400" />
          <span className="text-xs">Loading key pool...</span>
        </div>
      ) : keys.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-white/[0.1] rounded-2xl p-6 bg-white/[0.01]">
          <Key size={32} className="mx-auto text-slate-500 mb-2 opacity-50" />
          <h4 className="text-sm font-medium text-slate-300">No Gemini API Keys in Pool</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Add at least one Gemini API key to enable voice calls, vision recognition, and AI intelligence.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-medium rounded-xl border border-cyan-500/30 transition cursor-pointer"
          >
            <Plus size={14} />
            Add First Key
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((k, index) => {
            const isEditing = editingKeyId === k.id;
            const isTesting = testingKeyId === k.id;
            const testResult = testResults[k.id];

            return (
              <div
                key={k.id}
                className={`group relative p-4 rounded-2xl border transition-all duration-200 ${
                  k.status === "active"
                    ? "bg-white/[0.04] border-cyan-500/30 shadow-lg shadow-cyan-500/5"
                    : k.enabled
                    ? "bg-white/[0.02] hover:bg-white/[0.035] border-white/[0.07]"
                    : "bg-white/[0.01] border-white/[0.04] opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Priority & Name & Key */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Priority Reordering Arrows */}
                    <div className="flex flex-col items-center justify-center gap-0.5 pt-0.5">
                      <button
                        onClick={() => handleMovePriority(index, "up")}
                        disabled={index === 0}
                        className={`p-1 rounded hover:bg-white/[0.08] text-slate-400 hover:text-white transition disabled:opacity-20 disabled:hover:bg-transparent ${
                          index === 0 ? "cursor-not-allowed" : "cursor-pointer"
                        }`}
                        title="Increase Priority"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <span className="text-[10px] font-mono text-slate-500 font-bold">
                        #{k.priority}
                      </span>
                      <button
                        onClick={() => handleMovePriority(index, "down")}
                        disabled={index === keys.length - 1}
                        className={`p-1 rounded hover:bg-white/[0.08] text-slate-400 hover:text-white transition disabled:opacity-20 disabled:hover:bg-transparent ${
                          index === keys.length - 1 ? "cursor-not-allowed" : "cursor-pointer"
                        }`}
                        title="Decrease Priority"
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>

                    {/* Key Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={editNameValue}
                              onChange={(e) => setEditNameValue(e.target.value)}
                              className="px-2 py-0.5 bg-black/60 border border-cyan-500/50 rounded text-xs text-white outline-none"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveRename(k.id);
                                if (e.key === "Escape") setEditingKeyId(null);
                              }}
                            />
                            <button
                              onClick={() => handleSaveRename(k.id)}
                              className="p-1 rounded hover:bg-emerald-500/20 text-emerald-300"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={() => setEditingKeyId(null)}
                              className="p-1 rounded hover:bg-slate-700 text-slate-400"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-white tracking-wide">
                              {k.name}
                            </span>
                            <button
                              onClick={() => {
                                setEditingKeyId(k.id);
                                setEditNameValue(k.name);
                              }}
                              className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300 transition p-0.5"
                              title="Rename Key"
                            >
                              <Edit2 size={11} />
                            </button>
                          </div>
                        )}

                        {renderStatusBadge(k)}
                      </div>

                      {/* Masked Key & Statistics */}
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-slate-400">
                        <span className="font-mono bg-black/40 px-2 py-0.5 rounded-md border border-white/[0.05] text-slate-300 text-[11px] select-all">
                          {k.maskedKey}
                        </span>

                        <span className="text-[11px] text-slate-500">
                          Used: <strong className="text-slate-300">{k.requestCount}</strong>
                        </span>

                        {k.failureCount > 0 && (
                          <span className="text-[11px] text-rose-400/80">
                            Fails: <strong className="text-rose-300">{k.failureCount}</strong>
                          </span>
                        )}

                        {k.lastUsedAt && (
                          <span className="text-[11px] text-slate-500">
                            Last active: {new Date(k.lastUsedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>

                      {/* Last Error Notice */}
                      {k.lastErrorMessage && (
                        <div className="mt-2 text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                          Last issue: {k.lastErrorMessage}
                        </div>
                      )}

                      {/* Test Result Message */}
                      {testResult && (
                        <div
                          className={`mt-2 text-[11px] px-2.5 py-1 rounded-lg border ${
                            testResult.success
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                              : "bg-rose-500/10 border-rose-500/20 text-rose-300"
                          }`}
                        >
                          {testResult.message}{" "}
                          {testResult.latencyMs && `(${testResult.latencyMs}ms)`}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 pt-1">
                    {/* Test Key Button */}
                    <button
                      onClick={() => handleTestKey(k.id)}
                      disabled={isTesting}
                      className="p-1.5 rounded-xl hover:bg-white/[0.08] text-slate-400 hover:text-cyan-300 transition text-xs flex items-center gap-1 border border-white/[0.05] cursor-pointer"
                      title="Test Key Health"
                    >
                      <RefreshCw size={13} className={isTesting ? "animate-spin text-cyan-400" : ""} />
                      <span className="hidden sm:inline text-[11px]">Test</span>
                    </button>

                    {/* Enable/Disable Toggle Button */}
                    <button
                      onClick={() => handleToggleKey(k.id, k.enabled)}
                      className={`p-1.5 rounded-xl transition border text-xs cursor-pointer ${
                        k.enabled
                          ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/25"
                          : "bg-slate-500/10 hover:bg-slate-500/20 text-slate-400 border-slate-500/20"
                      }`}
                      title={k.enabled ? "Disable Key" : "Enable Key"}
                    >
                      <Power size={13} />
                    </button>

                    {/* Delete Key Button */}
                    <button
                      onClick={() => handleDeleteKey(k.id)}
                      className="p-1.5 rounded-xl hover:bg-rose-500/20 text-slate-500 hover:text-rose-300 transition border border-transparent hover:border-rose-500/30 cursor-pointer"
                      title="Delete Key"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Key Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl glass-panel shadow-2xl border border-white/[0.15] overflow-hidden backdrop-blur-2xl bg-[#0E1017]/95 text-white p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2">
                <Key size={18} className="text-cyan-400" />
                <h4 className="text-sm font-semibold font-display tracking-wider uppercase text-white">
                  Add Gemini API Key
                </h4>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Key Label (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Personal Pro Key, Work Key, Backup 2"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/[0.1] text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Gemini API Key
                </label>
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={newRawKey}
                  onChange={(e) => {
                    setNewRawKey(e.target.value);
                    setNewKeyTestResult(null);
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/[0.1] text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none font-mono transition"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Encrypted locally using machine-bound AES-256-GCM vault. Never exposed in plaintext.
                </p>
              </div>

              {/* Test Result Message */}
              {newKeyTestResult && (
                <div
                  className={`p-3 rounded-xl text-xs border ${
                    newKeyTestResult.success
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                      : "bg-rose-500/15 border-rose-500/30 text-rose-300"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-medium mb-0.5">
                    {newKeyTestResult.success ? (
                      <CheckCircle2 size={13} className="text-emerald-400" />
                    ) : (
                      <AlertTriangle size={13} className="text-rose-400" />
                    )}
                    <span>{newKeyTestResult.success ? "Key Verified" : "Verification Failed"}</span>
                  </div>
                  <div className="text-[11px] opacity-90">{newKeyTestResult.message}</div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={handleTestRawKey}
                disabled={!newRawKey.trim() || testingNewKey}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white text-xs border border-white/[0.1] transition disabled:opacity-40 cursor-pointer"
              >
                <Zap size={13} className={testingNewKey ? "animate-pulse text-amber-400" : "text-cyan-400"} />
                {testingNewKey ? "Testing Live..." : "Test Key"}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddKey}
                  disabled={!newRawKey.trim() || savingKey}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-xs rounded-xl shadow-lg shadow-cyan-500/20 transition disabled:opacity-50 cursor-pointer"
                >
                  {savingKey ? "Saving..." : "Add to Pool"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
