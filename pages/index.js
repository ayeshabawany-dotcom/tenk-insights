import { useState } from "react";
import Head from "next/head";

const YEARS = Array.from({ length: 12 }, (_, i) => String(2025 - i));

const NOTE_SECTIONS = [
  "Business Combinations & Acquisitions",
  "Goodwill & Intangible Assets",
  "Long-term Debt & Credit Facilities",
  "Share-Based Compensation",
  "Income Taxes",
  "Leases (ASC 842)",
  "Commitments & Contingencies",
  "Earnings Per Share",
  "Summary of Significant Accounting Policies",
  "Revenue Recognition",
  "Fair Value Measurements",
  "Segment Information",
  "Related Party Transactions",
  "Restructuring Charges",
  "Pension & Post-Retirement Benefits",
  "Derivative Instruments & Hedging",
];

const EXAMPLE_PAIRS = [
  { a: "Mastercard", ya: "2024", b: "Mastercard", yb: "2019", note: "Business Combinations & Acquisitions" },
  { a: "SOUN", ya: "2024", b: "SYNA", yb: "2023", note: "Business Combinations & Acquisitions" },
  { a: "Apple", ya: "2023", b: "Microsoft", yb: "2023", note: "Income Taxes" },
  { a: "SoundHound AI", ya: "2023", b: "SoundHound AI", yb: "2022", note: "Summary of Significant Accounting Policies" },
];

const FEATURES = [
  { icon: "⚖️", title: "Side-by-Side Comparison", desc: "Any two companies. Any two fiscal years. Any of 16 note sections. Structured, institutional-grade output in seconds." },
  { icon: "🎭", title: "Disclosure Sentiment Scoring", desc: "Quantify the language of each filing. Surface hedging, caution, and red flags invisible to the naked eye." },
  { icon: "💬", title: "Natural Language Q&A", desc: "Interrogate the comparison directly. Answers grounded in the actual filing text — not generic knowledge." },
];

const EXAMPLE_SEARCHES = [
  { keywords: '"asset acquisition" "purchase price"', label: "Asset Acquisitions", icon: "🏢" },
  { keywords: '"going concern"', label: "Going Concern", icon: "⚠️" },
  { keywords: '"data breach" "unauthorized access"', label: "Data Breaches", icon: "🔒" },
  { keywords: '"material weakness" "internal control"', label: "Internal Control Issues", icon: "📋" },
  { keywords: '"license agreement" "customer contracts"', label: "License Agreements", icon: "📜" },
  { keywords: '"CEO" "resignation" "effective immediately"', label: "Executive Departures", icon: "👔" },
];

function exportCSV(rows, meta) {
  const header = `"Dimension","${meta.companyA} (${meta.yearA})","${meta.companyB} (${meta.yearB})"`;
  const body = rows.map(r =>
    `"${r.dimension}","${r.a.replace(/"/g, '""')}","${r.b.replace(/"/g, '""')}"`
  ).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${meta.companyA}_vs_${meta.companyB}_${meta.note}_${meta.yearA}_${meta.yearB}.csv`.replace(/\s+/g, "_");
  a.click();
  URL.revokeObjectURL(url);
}

function renderMarkdown(text) {
  if (!text) return "";
  const lines = text.split("\n");
  const html = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith("|")) {
      const cells = line.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.every(c => /^[-:]+$/.test(c))) continue;
      if (!inTable) {
        html.push('<div style="overflowX:auto;marginBottom:12px"><table style="width:100%;borderCollapse:collapse;fontSize:13px">');
        html.push('<thead><tr>' + cells.map(c =>
          `<th style="padding:8px 12px;textAlign:left;borderBottom:1px solid rgba(255,255,255,.15);color:#94a3b8;fontWeight:700;fontSize:11px;textTransform:uppercase;letterSpacing:.8px;whiteSpace:nowrap">${c}</th>`
        ).join("") + "</tr></thead><tbody>");
        inTable = true;
        continue;
      }
      html.push("<tr>" + cells.map(c =>
        `<td style="padding:8px 12px;borderBottom:1px solid rgba(255,255,255,.06);color:#374151;lineHeight:1.6;verticalAlign:top">${c}</td>`
      ).join("") + "</tr>");
      continue;
    }

    if (inTable) { html.push("</tbody></table></div>"); inTable = false; }

    if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
      const content = line.trim().slice(2).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      html.push(`<div style="display:flex;gap:8px;marginBottom:4px"><span style="color:#b45309;flexShrink:0;marginTop:2px">•</span><span style="color:#374151;fontSize:13px;lineHeight:1.7">${content}</span></div>`);
      continue;
    }

    if (/^\*\*(.+)\*\*$/.test(line.trim())) {
      const heading = line.trim().replace(/^\*\*/, "").replace(/\*\*$/, "");
      html.push(`<div style="fontSize:12px;fontWeight:700;color:#92400e;textTransform:uppercase;letterSpacing:.8px;marginTop:14px;marginBottom:6px">${heading}</div>`);
      continue;
    }

    const formatted = line.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#111827">$1</strong>');
    if (formatted.trim()) {
      html.push(`<p style="color:#374151;fontSize:13px;lineHeight:1.78;marginBottom:6px">${formatted}</p>`);
    }
  }

  if (inTable) html.push("</tbody></table></div>");
  return html.join("\n");
}

function ScoreBar({ score, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
      <div style={{ flex: 1, height: 5, background: "#e5e7eb", borderRadius: 100, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(score / 10) * 100}%`, background: color, borderRadius: 100, transition: "width 1s ease" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 32, textAlign: "right" }}>
        {score}<span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 400 }}>/10</span>
      </span>
    </div>
  );
}

export default function Home() {
  // ── 10-K Compare state ─────────────────────────────────────────────────────
  const [companyA, setCompanyA] = useState("");
  const [yearA, setYearA]       = useState("2023");
  const [companyB, setCompanyB] = useState("");
  const [yearB, setYearB]       = useState("2023");
  const [note, setNote]         = useState("");
  const [phase, setPhase]       = useState("idle");
  const [errMsg, setErrMsg]     = useState("");
  const [result, setResult]     = useState(null);
  const [sentPhase, setSentPhase] = useState("idle");
  const [sentiment, setSentiment] = useState(null);
  const [qaOpen, setQaOpen]     = useState(false);
  const [question, setQuestion] = useState("");
  const [qaPhase, setQaPhase]   = useState("idle");
  const [qaHistory, setQaHistory] = useState([]);

  // ── Paywall / usage ────────────────────────────────────────────────────────
  const FREE_LIMIT = 5;
  const [usageCount, setUsageCount] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("tenk_usage") || "0", 10);
  });
  const [showPaywall, setShowPaywall] = useState(false);
  const isPro = typeof window !== "undefined" && localStorage.getItem("tenk_pro") === "true";
  const remaining = Math.max(0, FREE_LIMIT - usageCount);

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("compare");

  // ── 8-K Search state ───────────────────────────────────────────────────────
  const [searchKeywords, setSearchKeywords] = useState("");
  const [searchStart, setSearchStart]       = useState("2025-01-01");
  const [searchEnd, setSearchEnd]           = useState("2026-04-14");
  const [searchTicker, setSearchTicker]     = useState("");
  const [searchPhase, setSearchPhase]       = useState("idle");
  const [searchResults, setSearchResults]   = useState([]);
  const [searchTotal, setSearchTotal]       = useState(0);
  const [searchErrMsg, setSearchErrMsg]     = useState("");
  const [rewrittenQuery, setRewrittenQuery] = useState("");
  const [queryRewritten, setQueryRewritten] = useState(false);
  const [expandedResults, setExpandedResults] = useState({});

  // ── 10-K Compare functions ─────────────────────────────────────────────────
  async function compare() {
    if (!companyA.trim() || !companyB.trim() || !note) return;
    const currentUsage = parseInt(localStorage.getItem("tenk_usage") || "0", 10);
    if (!isPro && currentUsage >= FREE_LIMIT) { setShowPaywall(true); return; }
    setPhase("loading"); setErrMsg(""); setResult(null);
    setSentiment(null); setSentPhase("idle"); setQaHistory([]); setQaOpen(false);
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compare", companyA, yearA, companyB, yearB, noteSection: note }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Comparison failed");
      setResult(data);
      setPhase("done");
      const newCount = parseInt(localStorage.getItem("tenk_usage") || "0", 10) + 1;
      localStorage.setItem("tenk_usage", newCount.toString());
      setUsageCount(newCount);
    } catch (e) {
      setErrMsg(e.message);
      setPhase("error");
    }
  }

  async function runSentiment() {
    if (!result) return;
    setSentPhase("loading"); setSentiment(null);
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sentiment", noteSection: note, tableData: result }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setSentiment(data.sentiment);
      setSentPhase("done");
    } catch (e) {
      setSentPhase("error");
    }
  }

  async function askQuestion() {
    if (!question.trim() || !result) return;
    const q = question.trim();
    setQuestion(""); setQaPhase("loading");
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ask", question: q, tableData: result }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setQaHistory(prev => [...prev, { q, a: data.answer }]);
      setQaPhase("idle");
    } catch (e) {
      setQaHistory(prev => [...prev, { q, a: "Something went wrong. Please try again." }]);
      setQaPhase("idle");
    }
  }

  function loadExample(ex) {
    setCompanyA(ex.a); setYearA(ex.ya);
    setCompanyB(ex.b); setYearB(ex.yb);
    setNote(ex.note);
  }

  // ── 8-K Search functions ───────────────────────────────────────────────────
  async function searchFilings() {
    if (!searchKeywords.trim()) return;
    setSearchPhase("loading");
    setSearchResults([]);
    setExpandedResults({});
    setSearchErrMsg("");
    setRewrittenQuery("");
    setQueryRewritten(false);
    try {
      const resp = await fetch("/api/search8k", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "search",
          keywords: searchKeywords,
          startDate: searchStart,
          endDate: searchEnd,
          ticker: searchTicker,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Search failed");
      setSearchResults(data.results || []);
      setSearchTotal(data.total || 0);
      setRewrittenQuery(data.searchQuery || searchKeywords);
      setQueryRewritten(data.queryRewritten || false);
      setSearchPhase("done");
    } catch (e) {
      setSearchErrMsg(e.message);
      setSearchPhase("error");
    }
  }

  async function summarizeResult(result8k) {
    const rid = result8k.id;
    setExpandedResults(prev => ({ ...prev, [rid]: "loading" }));
    try {
      const resp = await fetch("/api/search8k", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "summarize",
          cik: result8k.cik,
          accessionNo: result8k.accessionNo,
          companyName: result8k.companyName,
          filedAt: result8k.filedAt,
          keywords: searchKeywords,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Could not summarize");
      setExpandedResults(prev => ({ ...prev, [rid]: data.summary }));
    } catch (e) {
      setExpandedResults(prev => ({ ...prev, [rid]: "Error: " + e.message }));
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const sentimentColor = (s) => {
    if (s === "Positive") return "#059669";
    if (s === "Cautious")  return "#d97706";
    if (s === "Negative")  return "#dc2626";
    return "#6b7280";
  };

  const GOLD  = "#b45309";
  const BLUE  = "#1d4ed8";
  const GREEN = "#059669";
  const RED   = "#dc2626";

  const inputStyle = {
    width: "100%",
    background: "#ffffff",
    border: "1.5px solid #d1d5db",
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 14,
    fontFamily: "'Source Sans 3', sans-serif",
    color: "#111827",
    outline: "none",
  };

  const labelStyle = {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.8px",
    textTransform: "uppercase",
    marginBottom: 7,
    color: "#9ca3af",
    fontFamily: "'Source Sans 3', sans-serif",
  };

  return (
    <>
      <Head>
        <title>10-K Compare — Institutional Filing Intelligence</title>
        <meta name="description" content="Compare any two 10-K note sections side by side. Search 8-K filings by keyword. Real SEC filing text. Seconds." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@300;400;600;700&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { background: #f5f7fa; color: #111827; font-family: 'Source Sans 3', sans-serif; min-height: 100vh; }
        ::selection { background: rgba(180,83,9,.15); }
        input::placeholder, textarea::placeholder { color: #9ca3af; }
        input:focus, select:focus, textarea:focus { outline: none !important; border-color: #b45309 !important; box-shadow: 0 0 0 3px rgba(180,83,9,.1) !important; }
        select option { background: #fff; color: #111827; }
        .btn { transition: all .18s; cursor: pointer; border: none; font-family: 'Source Sans 3', sans-serif; font-weight: 600; }
        .btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); }
        .btn:active:not(:disabled) { transform: translateY(0); }
        .btn:disabled { opacity: .4; cursor: not-allowed; transform: none !important; }
        .chip:hover { border-color: #b45309 !important; color: #b45309 !important; background: #fffbeb !important; }
        .chip { transition: all .15s; }
        .trow:hover > td { background: #fafafa !important; }
        .feat:hover { box-shadow: 0 8px 24px rgba(0,0,0,.1) !important; transform: translateY(-2px); }
        .feat { transition: all .2s; }
        .result-card:hover { border-color: #d1d5db !important; box-shadow: 0 4px 16px rgba(0,0,0,.08) !important; }
        .result-card { transition: all .18s; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes shimmer { 0%,100%{background-position:0% center} 50%{background-position:100% center} }
        .fadeup { animation: fadeUp .5s cubic-bezier(.16,1,.3,1) forwards; opacity:0; }
        .d1{animation-delay:.07s}.d2{animation-delay:.14s}.d3{animation-delay:.21s}.d4{animation-delay:.28s}
        .spin { animation: spin 1s linear infinite; display: inline-block; }
        .pulse { animation: pulse 2s ease infinite; }
        .gold-shimmer {
          background: linear-gradient(90deg, #b45309 0%, #d97706 30%, #b45309 55%, #92400e 80%, #b45309 100%);
          background-size: 280% auto;
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text; animation: shimmer 5s ease infinite;
        }
        .gold-rule { height: 1px; background: linear-gradient(90deg, transparent, #d97706, transparent); border: none; }
        a { color: #b45309; text-decoration: none; }
        a:hover { text-decoration: underline; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { vertical-align: top; }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={{ background: "#ffffff", borderBottom: "1.5px solid #e5e7eb", padding: "0 36px", height: 64, display: "flex", alignItems: "center", gap: 16, position: "sticky", top: 0, zIndex: 50, boxShadow: "0 1px 8px rgba(0,0,0,.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, background: "linear-gradient(135deg,#d97706,#f59e0b)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, boxShadow: "0 2px 8px rgba(217,119,6,.3)" }}>📊</div>
          <div>
            <div style={{ fontFamily: "'Libre Baskerville',serif", fontSize: 20, fontWeight: 700, color: "#111827", letterSpacing: "-.3px" }}>10-K Compare</div>
            <div style={{ fontSize: 10, color: "#9ca3af", letterSpacing: "1.5px", textTransform: "uppercase", marginTop: 2 }}>Institutional Filing Intelligence</div>
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {activeTab === "compare" && phase === "done" && result && (
            <>
              <button className="btn" onClick={runSentiment} disabled={sentPhase === "loading"}
                style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", color: BLUE, borderRadius: 7, padding: "7px 15px", fontSize: 12 }}>
                {sentPhase === "loading" ? <><span className="spin">⟳</span>&nbsp;Analyzing…</> : "🎭 Sentiment"}
              </button>
              <button className="btn" onClick={() => exportCSV(result.rows, result.meta)}
                style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", color: GREEN, borderRadius: 7, padding: "7px 15px", fontSize: 12 }}>
                ⬇ Export CSV
              </button>
            </>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 7, padding: "5px 12px" }}>
            <div className="pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN, boxShadow: "0 0 6px #059669" }} />
            <span style={{ fontSize: 11, color: GREEN, fontWeight: 700 }}>LIVE</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6,
            background: remaining <= 1 ? "rgba(239,68,68,.08)" : "rgba(0,0,0,.03)",
            border: `1.5px solid ${remaining <= 1 ? "rgba(239,68,68,.25)" : "#e5e7eb"}`,
            borderRadius: 7, padding: "5px 12px",
            cursor: remaining === 0 ? "pointer" : "default" }}
            onClick={() => remaining === 0 && setShowPaywall(true)}>
            <span style={{ fontSize: 11, fontWeight: 600, color: remaining <= 1 ? "#ef4444" : "#9ca3af" }}>
              {isPro ? "✦ Pro" : remaining === 0 ? "⚠ Limit reached" : `${remaining} free left`}
            </span>
            {!isPro && remaining === 0 && (
              <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginLeft: 4 }}>· Upgrade →</span>
            )}
          </div>
        </div>
      </header>

      {/* ── TAB BAR ────────────────────────────────────────────────────────── */}
      <div style={{ background: "#ffffff", borderBottom: "1.5px solid #e5e7eb", padding: "0 36px", display: "flex", gap: 0 }}>
        {[
          { id: "compare", label: "📊 10-K Note Compare" },
          { id: "search8k", label: "🔍 8-K Filing Search" },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              background: "none", border: "none",
              borderBottom: activeTab === tab.id ? "2.5px solid #b45309" : "2.5px solid transparent",
              padding: "14px 20px", marginBottom: -1.5,
              fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 400,
              color: activeTab === tab.id ? "#b45309" : "#6b7280",
              cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif",
              transition: "all .15s",
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          10-K COMPARE TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "compare" && (
        <>
          {/* ── HERO ─────────────────────────────────────────────────────── */}
          {phase === "idle" && (
            <div style={{ background: "linear-gradient(180deg,#ffffff 0%,#f5f7fa 100%)", borderBottom: "1.5px solid #e5e7eb", padding: "72px 36px 64px", textAlign: "center" }}>
              <div className="fadeup">
                <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                  <hr className="gold-rule" style={{ width: 36 }} />
                  <span style={{ fontSize: 10, color: "#b45309", letterSpacing: "2.5px", textTransform: "uppercase", fontWeight: 700 }}>SEC 10-K Filing Intelligence</span>
                  <hr className="gold-rule" style={{ width: 36 }} />
                </div>
                <h1 style={{ fontFamily: "'Libre Baskerville',serif", fontSize: "clamp(34px,5.5vw,64px)", fontWeight: 700, color: "#111827", lineHeight: 1.1, marginBottom: 18, letterSpacing: "-1px" }}>
                  The footnotes tell<br /><span className="gold-shimmer">the real story.</span>
                </h1>
                <p style={{ fontSize: 18, color: "#374151", lineHeight: 1.8, maxWidth: 580, margin: "0 auto 12px", fontFamily: "'Libre Baskerville',serif", fontStyle: "italic", fontWeight: 400 }}>
                  Every 10-K contains disclosures analysts spend days manually comparing.
                </p>
                <p style={{ fontSize: 15, color: "#6b7280", lineHeight: 1.75, maxWidth: 500, margin: "0 auto 36px" }}>
                  Pick two companies, any year, any note section — get a structured side-by-side breakdown in seconds. With sentiment scoring, CSV export, and AI-powered Q&A.
                </p>
                <div style={{ display: "inline-flex", alignItems: "center", border: "1.5px solid #e5e7eb", borderRadius: 10, overflow: "hidden", marginBottom: 40, boxShadow: "0 2px 8px rgba(0,0,0,.06)", background: "#ffffff" }}>
                  {[{ val: "16", label: "Note Categories" }, { val: "10", label: "Fiscal Years" }, { val: "3", label: "Analysis Modes" }].map((s, i) => (
                    <div key={i} style={{ padding: "14px 28px", borderRight: i < 2 ? "1.5px solid #e5e7eb" : "none", textAlign: "center" }}>
                      <div style={{ fontFamily: "'Libre Baskerville',serif", fontSize: 26, fontWeight: 700, color: "#b45309", lineHeight: 1 }}>{s.val}</div>
                      <div style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "1.5px", marginTop: 5, fontWeight: 700 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "2px", fontWeight: 700, marginBottom: 12 }}>Load a live example</div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    {EXAMPLE_PAIRS.map((ex, i) => (
                      <button key={i} className="chip btn" onClick={() => loadExample(ex)}
                        style={{ background: "#ffffff", border: "1.5px solid #e5e7eb", color: "#6b7280", borderRadius: 8, padding: "8px 16px", fontSize: 12, lineHeight: 1.5, boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
                        <span style={{ color: "#b45309", fontWeight: 700 }}>{ex.a} {ex.ya}</span>
                        <span style={{ color: "#d1d5db", margin: "0 6px" }}>vs</span>
                        <span style={{ color: "#1d4ed8", fontWeight: 700 }}>{ex.b} {ex.yb}</span>
                        <span style={{ display: "block", fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{ex.note}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── PAYWALL MODAL ─────────────────────────────────────────── */}
          {showPaywall && (
            <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.6)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
              onClick={(e) => e.target === e.currentTarget && setShowPaywall(false)}>
              <div style={{ background: "#ffffff", borderRadius: 20, padding: "40px 36px", maxWidth: 440, width: "100%", boxShadow: "0 32px 80px rgba(0,0,0,.25)", position: "relative", textAlign: "center" }}>
                <button onClick={() => setShowPaywall(false)}
                  style={{ position: "absolute", top: 16, right: 16, background: "#f3f4f6", border: "none", borderRadius: 7, width: 28, height: 28, cursor: "pointer", fontSize: 14, color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
                <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 24, fontWeight: 700, color: "#111827", marginBottom: 8, letterSpacing: "-.5px" }}>You&apos;ve used your 5 free comparisons</div>
                <p style={{ fontSize: 15, color: "#6b7280", lineHeight: 1.7, marginBottom: 28 }}>Upgrade to Pro for unlimited comparisons, full Q&A, sentiment scoring, and CSV exports.</p>
                <div style={{ background: "linear-gradient(135deg, #fffbeb, #fef3c7)", border: "2px solid #f59e0b", borderRadius: 14, padding: "20px 24px", marginBottom: 24 }}>
                  <div style={{ fontSize: 13, color: "#92400e", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>Pro Plan</div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
                    <span style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 42, fontWeight: 700, color: "#111827" }}>$7</span>
                    <span style={{ fontSize: 14, color: "#6b7280" }}>/month</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#78716c", marginTop: 6 }}>Unlimited comparisons · All 16 note sections · CSV export · Q&A</div>
                </div>
                <button className="btn" style={{ width: "100%", background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#111827", borderRadius: 12, padding: "14px 0", fontSize: 16, fontWeight: 800, marginBottom: 12, boxShadow: "0 4px 20px rgba(245,158,11,.3)" }}
                  onClick={() => { alert("Stripe integration coming soon! Email ayesha@tenk-insights.com to get Pro access."); }}>
                  Upgrade to Pro →
                </button>
                <button className="btn" style={{ width: "100%", background: "transparent", border: "1.5px solid #e5e7eb", color: "#9ca3af", borderRadius: 10, padding: "10px 0", fontSize: 13 }}
                  onClick={() => setShowPaywall(false)}>Maybe later</button>
                <p style={{ fontSize: 11, color: "#d1d5db", marginTop: 16 }}>Cancel anytime · Secure payment via Stripe</p>
              </div>
            </div>
          )}

          <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px 100px" }}>

            {/* ── FEATURE CARDS ───────────────────────────────────────── */}
            {phase === "idle" && (
              <div className="fadeup d2" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 36 }}>
                {FEATURES.map((f, i) => (
                  <div key={i} className="feat" style={{ background: "#ffffff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: "24px 20px", boxShadow: "0 2px 8px rgba(0,0,0,.05)" }}>
                    <div style={{ fontSize: 26, marginBottom: 12 }}>{f.icon}</div>
                    <div style={{ fontFamily: "'Libre Baskerville',serif", fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 8 }}>{f.title}</div>
                    <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.75 }}>{f.desc}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── INPUT PANEL ─────────────────────────────────────────── */}
            <div className={phase === "idle" ? "fadeup d3" : ""} style={{ background: "#ffffff", border: "1.5px solid #e5e7eb", borderRadius: 16, padding: 28, marginBottom: 24, boxShadow: "0 2px 12px rgba(0,0,0,.06)" }}>
              {phase === "idle" && (
                <div style={{ marginBottom: 22, paddingBottom: 18, borderBottom: "1.5px solid #f3f4f6" }}>
                  <div style={{ fontFamily: "'Libre Baskerville',serif", fontSize: 20, fontWeight: 700, color: "#111827" }}>Build your comparison</div>
                  <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>Select two companies, their fiscal years, and the note section to compare.</div>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
                {/* Company A */}
                <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderTop: "3px solid #d97706", borderRadius: 12, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: "#fef3c7", border: "1.5px solid #fcd34d", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Libre Baskerville',serif", fontSize: 14, fontWeight: 700, color: "#b45309" }}>A</div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: "1.2px" }}>Company A</div>
                      <div style={{ fontSize: 10, color: "#92400e", marginTop: 1 }}>First filing</div>
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ ...labelStyle, color: "#92400e" }}>Company name or ticker</label>
                    <input value={companyA} onChange={e => setCompanyA(e.target.value)} placeholder="e.g. Meta, Goldman Sachs, AAPL"
                      style={{ ...inputStyle, borderColor: "#fcd34d" }} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, color: "#92400e" }}>Fiscal Year</label>
                    <select value={yearA} onChange={e => setYearA(e.target.value)} style={{ ...inputStyle, borderColor: "#fcd34d", cursor: "pointer" }}>
                      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
                {/* Company B */}
                <div style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", borderTop: "3px solid #1d4ed8", borderRadius: 12, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: "#dbeafe", border: "1.5px solid #93c5fd", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Libre Baskerville',serif", fontSize: 14, fontWeight: 700, color: "#1d4ed8" }}>B</div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "1.2px" }}>Company B</div>
                      <div style={{ fontSize: 10, color: "#1e40af", marginTop: 1 }}>Second filing</div>
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ ...labelStyle, color: "#1e40af" }}>Company name or ticker</label>
                    <input value={companyB} onChange={e => setCompanyB(e.target.value)} placeholder="e.g. Alphabet, JPMorgan, MSFT"
                      style={{ ...inputStyle, borderColor: "#93c5fd" }} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, color: "#1e40af" }}>Fiscal Year</label>
                    <select value={yearB} onChange={e => setYearB(e.target.value)} style={{ ...inputStyle, borderColor: "#93c5fd", cursor: "pointer" }}>
                      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              {/* Note section */}
              <div style={{ marginBottom: 22 }}>
                <label style={labelStyle}>
                  Note section
                  <span style={{ marginLeft: 6, color: "#d1d5db", fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>— 16 categories available</span>
                </label>
                <select value={note} onChange={e => setNote(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                  <option value="">— Select the note section to compare —</option>
                  {NOTE_SECTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <button className="btn" onClick={compare}
                disabled={phase === "loading" || !companyA.trim() || !companyB.trim() || !note}
                style={{
                  width: "100%",
                  background: phase === "loading" ? "#f3f4f6" : "linear-gradient(135deg,#d97706 0%,#b45309 100%)",
                  color: phase === "loading" ? "#9ca3af" : "#ffffff",
                  borderRadius: 10, padding: "15px 0", fontSize: 15, fontWeight: 800,
                  boxShadow: phase !== "loading" ? "0 4px 16px rgba(217,119,6,.3)" : "none",
                }}>
                {phase === "loading"
                  ? <><span className="spin" style={{ marginRight: 8 }}>⟳</span>Reading the filings — typically 20 seconds…</>
                  : "Run Comparison →"}
              </button>
              {phase === "idle" && (
                <p style={{ textAlign: "center", marginTop: 10, fontSize: 12, color: "#9ca3af" }}>
                  Reads actual 10-K filing text from SEC EDGAR · Any US-listed public company
                </p>
              )}
            </div>

            {/* ── ERROR ────────────────────────────────────────────────── */}
            {phase === "error" && (
              <div className="fadeup" style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderLeft: "3px solid #dc2626", borderRadius: 10, padding: "18px 22px", marginBottom: 20, display: "flex", gap: 14 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#991b1b", marginBottom: 4 }}>Something went wrong</div>
                  <div style={{ fontSize: 13, color: "#b91c1c", lineHeight: 1.6 }}>{errMsg}</div>
                  <button className="btn" onClick={() => setPhase("idle")}
                    style={{ marginTop: 10, background: "#ffffff", border: "1.5px solid #fca5a5", color: RED, borderRadius: 6, padding: "5px 14px", fontSize: 12 }}>
                    ← Try again
                  </button>
                </div>
              </div>
            )}

            {/* ── RESULTS ──────────────────────────────────────────────── */}
            {phase === "done" && result && (
              <div>
                <div className="fadeup" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
                  <div>
                    <div style={{ fontFamily: "'Libre Baskerville',serif", fontSize: 28, fontWeight: 700, color: "#111827", letterSpacing: "-.5px", lineHeight: 1.15 }}>
                      <span style={{ color: "#b45309" }}>{result.meta.companyA}</span>
                      <span style={{ fontStyle: "italic", fontWeight: 400, color: "#9ca3af", margin: "0 14px", fontSize: 20 }}>versus</span>
                      <span style={{ color: "#1d4ed8" }}>{result.meta.companyB}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <span style={{ background: "#fffbeb", color: "#b45309", border: "1.5px solid #fde68a", padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>FY {result.meta.yearA}</span>
                      <span style={{ color: "#d1d5db", fontSize: 11 }}>vs</span>
                      <span style={{ background: "#eff6ff", color: "#1d4ed8", border: "1.5px solid #bfdbfe", padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>FY {result.meta.yearB}</span>
                      <span style={{ color: "#e5e7eb" }}>·</span>
                      <span style={{ color: "#6b7280", fontSize: 13, fontStyle: "italic", fontFamily: "'Libre Baskerville',serif" }}>{result.meta.note}</span>
                    </div>
                  </div>
                  <button className="btn" onClick={() => { setPhase("idle"); setResult(null); setSentiment(null); setQaHistory([]); }}
                    style={{ background: "#f9fafb", border: "1.5px solid #e5e7eb", color: "#6b7280", borderRadius: 8, padding: "8px 16px", fontSize: 12 }}>
                    ← New comparison
                  </button>
                </div>

                <div className="fadeup d1" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 6, padding: "5px 12px" }}>
                    <span style={{ color: "#059669", fontSize: 13 }}>✓</span>
                    <span style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>From actual SEC EDGAR 10-K filing text</span>
                  </div>
                  {result.sourceA && (
                    <a href={result.sourceA} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "#b45309", border: "1.5px solid #fde68a", borderRadius: 5, padding: "4px 10px", background: "#fffbeb" }}>
                      {result.meta.companyA} filing ↗
                    </a>
                  )}
                  {result.sourceB && (
                    <a href={result.sourceB} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "#1d4ed8", border: "1.5px solid #bfdbfe", borderRadius: 5, padding: "4px 10px", background: "#eff6ff" }}>
                      {result.meta.companyB} filing ↗
                    </a>
                  )}
                </div>

                {result.sourceNote && (
                  <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 8, padding: "10px 16px", marginBottom: 14, fontSize: 12, color: "#92400e", lineHeight: 1.6 }}>
                    ⚠ {result.sourceNote}
                  </div>
                )}

                {result.keyInsight && (
                  <div className="fadeup d1" style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderLeft: "4px solid #d97706", borderRadius: 10, padding: "16px 20px", marginBottom: 20, display: "flex", gap: 14 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>💡</span>
                    <div>
                      <div style={{ fontSize: 9, color: "#92400e", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 6 }}>Key Insight</div>
                      <div style={{ fontSize: 14, color: "#78350f", lineHeight: 1.72, fontWeight: 500 }}>{result.keyInsight}</div>
                    </div>
                  </div>
                )}

                <div className="fadeup d2" style={{ borderRadius: 12, overflow: "hidden", border: "1.5px solid #e5e7eb", marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,.06)" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ background: "#f9fafb", padding: "13px 20px", textAlign: "left", fontSize: 10, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", borderBottom: "1.5px solid #e5e7eb", width: "24%" }}>Disclosure</th>
                          <th style={{ background: "#fffbeb", borderTop: "3px solid #d97706", padding: "13px 20px", textAlign: "left", fontSize: 10, color: "#b45309", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", borderBottom: "1.5px solid #e5e7eb" }}>
                            {result.meta.companyA} · FY{result.meta.yearA}
                          </th>
                          <th style={{ background: "#eff6ff", borderTop: "3px solid #1d4ed8", padding: "13px 20px", textAlign: "left", fontSize: 10, color: "#1d4ed8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", borderBottom: "1.5px solid #e5e7eb" }}>
                            {result.meta.companyB} · FY{result.meta.yearB}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, i) => (
                          <tr key={i} className="trow">
                            <td style={{ padding: "13px 20px", fontSize: 12, fontWeight: 700, color: "#6b7280", fontStyle: "italic", fontFamily: "'Libre Baskerville',serif", borderBottom: i < result.rows.length - 1 ? "1px solid #f3f4f6" : "none", background: "#fafafa" }}>{row.dimension}</td>
                            <td style={{ padding: "13px 20px", fontSize: 13, color: "#1f2937", lineHeight: 1.72, borderBottom: i < result.rows.length - 1 ? "1px solid #f3f4f6" : "none", borderLeft: "2px solid #fde68a", background: i % 2 === 0 ? "#fffdf7" : "#ffffff" }}>{row.a}</td>
                            <td style={{ padding: "13px 20px", fontSize: 13, color: "#1f2937", lineHeight: 1.72, borderBottom: i < result.rows.length - 1 ? "1px solid #f3f4f6" : "none", borderLeft: "2px solid #bfdbfe", background: i % 2 === 0 ? "#f5f9ff" : "#ffffff" }}>{row.b}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {result.summary && (
                  <div className="fadeup d3" style={{ background: "#ffffff", border: "1.5px solid #e5e7eb", borderLeft: "4px solid #1d4ed8", borderRadius: 10, padding: "18px 22px", marginBottom: 20, boxShadow: "0 1px 6px rgba(0,0,0,.05)" }}>
                    <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 10 }}>Analyst Summary</div>
                    <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.88, fontFamily: "'Libre Baskerville',serif" }}>{result.summary}</p>
                  </div>
                )}

                <div className="fadeup d4" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
                  <button className="btn" onClick={() => exportCSV(result.rows, result.meta)}
                    style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", color: GREEN, borderRadius: 8, padding: "10px 20px", fontSize: 13 }}>
                    ⬇ Download for Excel
                  </button>
                  <button className="btn" onClick={runSentiment} disabled={sentPhase === "loading"}
                    style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", color: BLUE, borderRadius: 8, padding: "10px 20px", fontSize: 13 }}>
                    {sentPhase === "loading" ? <><span className="spin">⟳</span>&nbsp;Scoring…</> : "🎭 Score the Tone"}
                  </button>
                  <button className="btn" onClick={() => setQaOpen(!qaOpen)}
                    style={{ background: qaOpen ? "#f0fdf4" : "#f9fafb", border: qaOpen ? "1.5px solid #bbf7d0" : "1.5px solid #e5e7eb", color: qaOpen ? GREEN : "#374151", borderRadius: 8, padding: "10px 20px", fontSize: 13 }}>
                    💬 {qaOpen ? "Close Q&A" : "Ask the Data"}
                  </button>
                </div>

                {sentPhase === "done" && sentiment && (
                  <div className="fadeup" style={{ background: "#ffffff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: 24, marginBottom: 20, boxShadow: "0 1px 8px rgba(0,0,0,.05)" }}>
                    <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 18 }}>Tone & Language Analysis</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                      {[
                        { company: result.meta.companyA, year: result.meta.yearA, overall: sentiment.overallA, score: Number(sentiment.scoreA), summary: sentiment.summaryA, color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
                        { company: result.meta.companyB, year: result.meta.yearB, overall: sentiment.overallB, score: Number(sentiment.scoreB), summary: sentiment.summaryB, color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
                      ].map((s, i) => (
                        <div key={i} style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 10, padding: 18 }}>
                          <div style={{ fontSize: 12, color: s.color, fontWeight: 700, marginBottom: 10 }}>{s.company} · FY{s.year}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                            <span style={{ background: "#ffffff", color: sentimentColor(s.overall), border: `1.5px solid ${sentimentColor(s.overall)}`, borderRadius: 5, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{s.overall}</span>
                          </div>
                          <ScoreBar score={s.score} color={s.color} />
                          <p style={{ marginTop: 12, fontSize: 13, color: "#374151", lineHeight: 1.7 }}>{s.summary}</p>
                        </div>
                      ))}
                    </div>
                    {sentiment.comparison && (
                      <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.78, marginBottom: sentiment.redflags && sentiment.redflags !== "null" && sentiment.redflags !== "None identified" ? 14 : 0 }}>
                        <span style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", marginRight: 8 }}>Comparison:</span>
                        {sentiment.comparison}
                      </p>
                    )}
                    {sentiment.redflags && sentiment.redflags !== "null" && sentiment.redflags !== "None identified" && (
                      <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderLeft: "3px solid #dc2626", borderRadius: 7, padding: "12px 16px", fontSize: 13, color: "#991b1b", lineHeight: 1.65 }}>
                        🚩 <strong>Red flags:</strong> {sentiment.redflags}
                      </div>
                    )}
                  </div>
                )}

                {qaOpen && (
                  <div className="fadeup" style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 14, padding: 24, marginBottom: 20 }}>
                    <div style={{ fontSize: 9, color: "#065f46", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 6 }}>Interrogate the Data</div>
                    <div style={{ fontSize: 13, color: "#047857", marginBottom: 20 }}>Ask anything about this comparison. Answers grounded in the actual filing text.</div>
                    {qaHistory.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                        {qaHistory.map((item, i) => (
                          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <div style={{ background: "#dcfce7", border: "1.5px solid #bbf7d0", borderRadius: "12px 12px 3px 12px", padding: "10px 14px", fontSize: 14, color: "#065f46", lineHeight: 1.6, maxWidth: "80%" }}>{item.q}</div>
                            </div>
                            <div style={{ background: "#ffffff", border: "1.5px solid #e5e7eb", borderRadius: "3px 12px 12px 12px", padding: "10px 14px", fontSize: 14, color: "#374151", lineHeight: 1.8, boxShadow: "0 1px 4px rgba(0,0,0,.05)" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(item.a) }} />
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 10 }}>
                      <input value={question} onChange={e => setQuestion(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && qaPhase !== "loading" && askQuestion()}
                        placeholder="e.g. Which company has more acquisition risk? What changed most between the years?"
                        disabled={qaPhase === "loading"}
                        style={{ ...inputStyle, flex: 1, borderColor: "#6ee7b7" }} />
                      <button className="btn" onClick={askQuestion} disabled={qaPhase === "loading" || !question.trim()}
                        style={{ background: qaPhase === "loading" ? "#d1fae5" : "#059669", color: qaPhase === "loading" ? "#059669" : "#ffffff", borderRadius: 8, padding: "11px 20px", fontSize: 13, flexShrink: 0 }}>
                        {qaPhase === "loading" ? <span className="spin">⟳</span> : "Ask →"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <hr className="gold-rule" style={{ marginBottom: 20 }} />
            <p style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.85, textAlign: "center" }}>
              10-K Compare fetches and parses actual 10-K filing text directly from SEC EDGAR via sec-api.io.
              Claude AI reads the real filing — it does not rely on training data recall for comparisons.
              Always review the source filing before making investment decisions. Not financial advice. ·{" "}
              <a href="https://www.sec.gov/edgar/search/" target="_blank" rel="noopener noreferrer">SEC EDGAR</a>
            </p>
          </main>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          8-K SEARCH TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "search8k" && (
        <>
          {/* ── Search Hero ──────────────────────────────────────────────── */}
          <div style={{ background: "linear-gradient(180deg,#ffffff 0%,#f5f7fa 100%)", borderBottom: "1.5px solid #e5e7eb", padding: "56px 36px 48px", textAlign: "center" }}>
            <div className="fadeup">
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <hr className="gold-rule" style={{ width: 36 }} />
                <span style={{ fontSize: 10, color: "#b45309", letterSpacing: "2.5px", textTransform: "uppercase", fontWeight: 700 }}>SEC 8-K Filing Search</span>
                <hr className="gold-rule" style={{ width: 36 }} />
              </div>
              <h2 style={{ fontFamily: "'Libre Baskerville',serif", fontSize: "clamp(26px,4vw,48px)", fontWeight: 700, color: "#111827", lineHeight: 1.15, marginBottom: 14, letterSpacing: "-.5px" }}>
                Find any 8-K by<br /><span className="gold-shimmer">keyword or topic.</span>
              </h2>
              <p style={{ fontSize: 15, color: "#6b7280", lineHeight: 1.75, maxWidth: 520, margin: "0 auto 36px" }}>
                Search millions of 8-K filings from SEC EDGAR by keyword, phrase, or topic. Surface acquisitions, breaches, executive changes, and more — then summarize any filing with AI.
              </p>

              {/* Example chips */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "2px", fontWeight: 700, marginBottom: 12 }}>Try an example</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  {EXAMPLE_SEARCHES.map((ex, i) => (
                    <button key={i} className="chip btn" onClick={() => setSearchKeywords(ex.keywords)}
                      style={{ background: "#ffffff", border: "1.5px solid #e5e7eb", color: "#6b7280", borderRadius: 8, padding: "7px 14px", fontSize: 12, boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
                      <span style={{ marginRight: 6 }}>{ex.icon}</span>
                      <span style={{ color: "#b45309", fontWeight: 700 }}>{ex.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px 100px" }}>

            {/* ── Search panel ─────────────────────────────────────────── */}
            <div className="fadeup" style={{ background: "#ffffff", border: "1.5px solid #e5e7eb", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 2px 12px rgba(0,0,0,.06)" }}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Keywords or phrase</label>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    value={searchKeywords}
                    onChange={e => setSearchKeywords(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && searchPhase !== "loading" && searchFilings()}
                    placeholder={`e.g. "asset acquisition" "purchase price"  or  "going concern"  or  "data breach"`}
                    style={{ ...inputStyle, flex: 1, fontSize: 13 }}
                  />
                  <button className="btn" onClick={searchFilings}
                    disabled={searchPhase === "loading" || !searchKeywords.trim()}
                    style={{
                      background: searchPhase === "loading" ? "#f3f4f6" : "linear-gradient(135deg,#d97706,#b45309)",
                      color: searchPhase === "loading" ? "#9ca3af" : "#ffffff",
                      borderRadius: 9, padding: "11px 24px", fontSize: 14, fontWeight: 800, flexShrink: 0,
                      boxShadow: searchPhase !== "loading" ? "0 3px 12px rgba(217,119,6,.3)" : "none",
                    }}>
                    {searchPhase === "loading" ? <><span className="spin">⟳</span>&nbsp;Searching…</> : "Search →"}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>Use quotes for exact phrases. Multiple quoted phrases will match filings containing all of them.</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>From date</label>
                  <input type="date" value={searchStart} onChange={e => setSearchStart(e.target.value)}
                    style={{ ...inputStyle, fontSize: 13 }} />
                </div>
                <div>
                  <label style={labelStyle}>To date</label>
                  <input type="date" value={searchEnd} onChange={e => setSearchEnd(e.target.value)}
                    style={{ ...inputStyle, fontSize: 13 }} />
                </div>
                <div>
                  <label style={labelStyle}>Company / ticker <span style={{ color: "#d1d5db", fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
                  <input value={searchTicker} onChange={e => setSearchTicker(e.target.value)}
                    placeholder="e.g. AAPL or Apple Inc"
                    style={{ ...inputStyle, fontSize: 13 }} />
                </div>
              </div>
            </div>

            {/* ── Error ────────────────────────────────────────────────── */}
            {searchPhase === "error" && (
              <div className="fadeup" style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderLeft: "3px solid #dc2626", borderRadius: 10, padding: "16px 20px", marginBottom: 20, display: "flex", gap: 12 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", marginBottom: 3 }}>Search failed</div>
                  <div style={{ fontSize: 13, color: "#b91c1c", lineHeight: 1.6 }}>{searchErrMsg}</div>
                  <button className="btn" onClick={() => setSearchPhase("idle")}
                    style={{ marginTop: 8, background: "#ffffff", border: "1.5px solid #fca5a5", color: RED, borderRadius: 6, padding: "4px 12px", fontSize: 12 }}>
                    ← Try again
                  </button>
                </div>
              </div>
            )}

            {/* ── Results count ─────────────────────────────────────────── */}
            {searchPhase === "done" && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: "#374151" }}>
                  <span style={{ fontWeight: 700, color: "#111827" }}>
                    {searchResults.length === 0 ? "No results" : `Showing ${searchResults.length}`}
                  </span>
                  {searchTotal > 0 && searchResults.length > 0 && (
                    <span style={{ color: "#6b7280" }}> of {searchTotal.toLocaleString()} filings matching </span>
                  )}
                  {searchTotal > 0 && <span style={{ color: "#b45309", fontWeight: 600 }}>{searchKeywords}</span>}
                </div>
                {queryRewritten && (
                  <div style={{ fontSize: 11, background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 6, padding: "5px 12px", color: "#92400e", display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>✦ Query rewritten:</span>
                    <code style={{ fontFamily: "monospace", color: "#b45309" }}>{rewrittenQuery}</code>
                  </div>
                )}
              </div>
            )}
            {searchPhase === "done" && searchResults.length === 0 && (
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>Try broader keywords or a wider date range</div>
            )}
            {searchPhase === "done" && searchTotal > 20 && (
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 16 }}>Showing top 20 · Refine to narrow results</div>
            )}
            {/* ── Result cards ─────────────────────────────────────────── */}
            {searchPhase === "done" && searchResults.map((r, i) => {
              const summaryState = expandedResults[r.id];
              const isSummarizing = summaryState === "loading";
              const hasSummary = summaryState && summaryState !== "loading";

              return (
                <div key={r.id} className="fadeup result-card"
                  style={{ animationDelay: `${i * 0.04}s`, background: "#ffffff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: "18px 20px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>

                  {/* Card header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: r.snippets.length > 0 || hasSummary ? 12 : 0 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: "#111827", fontSize: 15, marginBottom: 6, lineHeight: 1.3 }}>{r.companyName}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {r.filedAt && <span style={{ fontSize: 11, color: "#6b7280" }}>Filed {r.filedAt}</span>}
                        {r.period && r.period !== r.filedAt && <span style={{ fontSize: 11, color: "#9ca3af" }}>· Period {r.period}</span>}
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, padding: "1px 7px" }}>8-K</span>
                        {r.accessionNo && <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>{r.accessionNo}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
                      {r.edgarLink && (
                        <a href={r.edgarLink} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, padding: "5px 10px", textDecoration: "none", background: "#f9fafb" }}>
                          EDGAR ↗
                        </a>
                      )}
                      <button className="btn" onClick={() => summarizeResult(r)} disabled={isSummarizing}
                        style={{
                          fontSize: 11, fontWeight: 700,
                          color: hasSummary ? GREEN : GOLD,
                          background: hasSummary ? "#f0fdf4" : "#fffbeb",
                          border: `1.5px solid ${hasSummary ? "#bbf7d0" : "#fde68a"}`,
                          borderRadius: 6, padding: "5px 12px", cursor: isSummarizing ? "wait" : "pointer",
                        }}>
                        {isSummarizing ? <><span className="spin">⟳</span>&nbsp;Reading filing…</> : hasSummary ? "✓ Summarized" : "✦ AI Summary"}
                      </button>
                    </div>
                  </div>

                  {/* Keyword snippets */}
                  {r.snippets.length > 0 && (
                    <div style={{ background: "#f9fafb", border: "1px solid #f3f4f6", borderRadius: 7, padding: "10px 14px", marginBottom: hasSummary ? 12 : 0 }}>
                      {r.snippets.map((s, si) => {
                        // Render **bold** as actual bold in snippets
                        const parts = s.split(/(\*\*[^*]+\*\*)/g);
                        return (
                          <div key={si} style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.7, marginBottom: si < r.snippets.length - 1 ? 5 : 0 }}>
                            "…{parts.map((p, pi) => {
                              if (p.startsWith("**") && p.endsWith("**")) {
                                return <strong key={pi} style={{ color: "#111827", background: "#fef3c7", borderRadius: 2, padding: "0 2px" }}>{p.slice(2, -2)}</strong>;
                              }
                              return p;
                            })}…"
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* AI Summary */}
                  {hasSummary && (
                    <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 9, padding: "16px 18px", marginTop: r.snippets.length > 0 ? 0 : 12 }}>
                      <div style={{ fontSize: 9, color: "#92400e", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: 10 }}>
                        ✦ AI Summary — {r.companyName} · {r.filedAt}
                      </div>
                      <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.78 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(summaryState) }} />
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Empty state ───────────────────────────────────────────── */}
            {searchPhase === "idle" && (
              <div style={{ textAlign: "center", padding: "60px 0 40px", color: "#9ca3af" }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
                <div style={{ fontFamily: "'Libre Baskerville',serif", fontSize: 18, color: "#374151", marginBottom: 8 }}>Search across all 8-K filings</div>
                <div style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.7, maxWidth: 400, margin: "0 auto" }}>
                  Enter keywords above to search SEC EDGAR full-text. Results come from actual filing text — not summaries or metadata.
                </div>
              </div>
            )}

            <hr className="gold-rule" style={{ marginTop: 40, marginBottom: 20 }} />
            <p style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.85, textAlign: "center" }}>
              8-K Search queries SEC EDGAR full-text search directly. Results reflect actual filing disclosures.
              AI summaries are generated from the real SEC filing text. Not financial advice. ·{" "}
              <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=8-K&dateb=&owner=include&count=40" target="_blank" rel="noopener noreferrer">Browse 8-Ks on EDGAR</a>
            </p>
          </main>
        </>
      )}
    </>
  );
}
