import { useState } from "react";
import Head from "next/head";

// ── Constants ─────────────────────────────────────────────────────────────────
const YEARS = Array.from({ length: 11 }, (_, i) => String(2024 - i)); // 2024-2014

const NOTE_SECTIONS = [
  "Revenue Recognition",
  "Segment Information",
  "Business Combinations & Acquisitions",
  "Goodwill & Intangible Assets",
  "Long-term Debt & Credit Facilities",
  "Share-Based Compensation",
  "Income Taxes",
  "Leases (ASC 842)",
  "Fair Value Measurements",
  "Commitments & Contingencies",
  "Geographic Information",
  "Related Party Transactions",
  "Earnings Per Share",
  "Restructuring & Impairment",
  "Subsequent Events",
  "Summary of Significant Accounting Policies",
];

const EXAMPLE_PAIRS = [
  { a: "Meta", ya: "2023", b: "Alphabet", yb: "2023", note: "Segment Information" },
  { a: "Mastercard", ya: "2024", b: "Mastercard", yb: "2019", note: "Business Combinations & Acquisitions" },
  { a: "Apple", ya: "2023", b: "Microsoft", yb: "2023", note: "Revenue Recognition" },
  { a: "SoundHound AI", ya: "2023", b: "SoundHound AI", yb: "2022", note: "Summary of Significant Accounting Policies" },
];

// ── CSV Export ────────────────────────────────────────────────────────────────
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

// ── Score Bar Component ───────────────────────────────────────────────────────
function ScoreBar({ score, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
      <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,.08)", borderRadius: 100, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(score / 10) * 100}%`, background: `linear-gradient(90deg, ${color}80, ${color})`, borderRadius: 100, transition: "width 1s ease" }} />
      </div>
      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color, minWidth: 24 }}>{score}</span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Home() {
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

  async function compare() {
    if (!companyA.trim() || !companyB.trim() || !note) return;
    setPhase("loading"); setErrMsg(""); setResult(null);
    setSentiment(null); setSentPhase("idle");
    setQaHistory([]); setQaOpen(false);
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compare", companyA, yearA, companyB, yearB, noteSection: note }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Comparison failed");
      setResult(data); setPhase("done");
    } catch (e) { setErrMsg(e.message); setPhase("error"); }
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
      setSentiment(data.sentiment); setSentPhase("done");
    } catch (e) { setSentPhase("error"); }
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

  const sentimentColor = (s) => {
    if (s === "Positive") return "#10b981";
    if (s === "Cautious") return "#f59e0b";
    if (s === "Negative") return "#fb7185";
    return "#64748b";
  };

  // Design tokens
  const AMBER = "#f59e0b";
  const COBALT = "#4f8ef7";
  const EMERALD = "#10b981";
  const ROSE = "#fb7185";

  const inputBase = {
    width: "100%",
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: 10,
    padding: "12px 16px",
    fontSize: 14,
    fontFamily: "'DM Sans', sans-serif",
    color: "#e2e8f0",
    outline: "none",
    transition: "border-color .2s, box-shadow .2s",
  };

  const labelBase = {
    display: "block",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "1px",
    textTransform: "uppercase",
    marginBottom: 8,
  };

  return (
    <>
      <Head>
        <title>10-K Compare — SEC Filing Analysis</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #030f1c;
          color: #e2e8f0;
          font-family: 'DM Sans', sans-serif;
          min-height: 100vh;
          overflow-x: hidden;
        }

        /* Subtle background mesh */
        body::before {
          content: '';
          position: fixed;
          inset: 0;
          background:
            radial-gradient(ellipse 80% 50% at 20% 10%, rgba(79,142,247,.07) 0%, transparent 60%),
            radial-gradient(ellipse 60% 40% at 80% 80%, rgba(245,158,11,.05) 0%, transparent 60%),
            radial-gradient(ellipse 50% 60% at 50% 50%, rgba(16,185,129,.03) 0%, transparent 70%);
          pointer-events: none;
          z-index: 0;
        }

        /* Fine grid texture */
        body::after {
          content: '';
          position: fixed;
          inset: 0;
          background-image: linear-gradient(rgba(255,255,255,.015) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.015) 1px, transparent 1px);
          background-size: 48px 48px;
          pointer-events: none;
          z-index: 0;
        }

        * { position: relative; z-index: 1; }

        ::selection { background: rgba(79,142,247,.3); }

        input::placeholder, textarea::placeholder { color: #334155; }
        input:focus, select:focus, textarea:focus {
          outline: none !important;
          border-color: rgba(79,142,247,.6) !important;
          box-shadow: 0 0 0 3px rgba(79,142,247,.12) !important;
        }

        select option { background: #0d1e33; color: #e2e8f0; }

        .btn { transition: all .18s; cursor: pointer; border: none; font-family: 'DM Sans', sans-serif; font-weight: 600; }
        .btn:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.1); }
        .btn:active:not(:disabled) { transform: translateY(0); }
        .btn:disabled { opacity: .45; cursor: not-allowed; transform: none !important; }

        .glass {
          background: rgba(255,255,255,.04);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        .card-amber {
          border: 1px solid rgba(245,158,11,.2);
          background: linear-gradient(135deg, rgba(245,158,11,.06) 0%, rgba(245,158,11,.02) 100%);
        }
        .card-cobalt {
          border: 1px solid rgba(79,142,247,.2);
          background: linear-gradient(135deg, rgba(79,142,247,.06) 0%, rgba(79,142,247,.02) 100%);
        }

        /* Gradient border top trick */
        .border-top-amber { border-top: 2px solid ${AMBER}; }
        .border-top-cobalt { border-top: 2px solid ${COBALT}; }

        .chip:hover { background: rgba(255,255,255,.08) !important; transform: translateY(-1px); }
        .chip { transition: all .15s; }

        .trow:hover > td { background: rgba(255,255,255,.025) !important; }

        /* Animations */
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes shimmer {
          0%   { background-position: 0% center; }
          50%  { background-position: 100% center; }
          100% { background-position: 0% center; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes slideIn {
          from { opacity:0; transform: translateX(-8px); }
          to   { opacity:1; transform: translateX(0); }
        }

        .fadeup  { animation: fadeUp .5s cubic-bezier(.16,1,.3,1) forwards; opacity: 0; }
        .fadein  { animation: fadeIn .4s ease forwards; }
        .d1 { animation-delay: .05s; }
        .d2 { animation-delay: .12s; }
        .d3 { animation-delay: .2s;  }
        .d4 { animation-delay: .28s; }
        .d5 { animation-delay: .36s; }

        .shimmer-text {
          background: linear-gradient(90deg, ${AMBER}, #fde68a, ${AMBER}, #d97706, ${AMBER});
          background-size: 300% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 4s ease infinite;
        }

        .spin { animation: spin 1s linear infinite; display: inline-block; }
        .pulse-dot { animation: pulse 1.5s ease infinite; }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }

        /* Table */
        table { border-collapse: collapse; width: 100%; }
        th, td { vertical-align: top; }

        /* Chat bubbles */
        .bubble-q {
          background: rgba(79,142,247,.12);
          border: 1px solid rgba(79,142,247,.2);
          border-radius: 14px 14px 4px 14px;
          padding: 12px 16px;
          font-size: 14px;
          color: #bfdbfe;
          line-height: 1.6;
          animation: slideIn .3s ease forwards;
        }
        .bubble-a {
          background: rgba(255,255,255,.04);
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 4px 14px 14px 14px;
          padding: 12px 16px;
          font-size: 14px;
          color: #94a3b8;
          line-height: 1.75;
          animation: slideIn .3s ease .1s forwards;
          opacity: 0;
        }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: "1px solid rgba(255,255,255,.06)",
        padding: "0 32px",
        height: 64,
        display: "flex",
        alignItems: "center",
        gap: 16,
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(3,15,28,.9)",
        backdropFilter: "blur(20px)",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36,
            background: "linear-gradient(135deg, #f59e0b, #fde68a)",
            borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
            boxShadow: "0 0 20px rgba(245,158,11,.3)",
          }}>📊</div>
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.3px" }}>
              10-K Compare
            </div>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: "1.2px", textTransform: "uppercase", marginTop: 1 }}>
              SEC Filing Intelligence
            </div>
          </div>
        </div>

        {/* Header right */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {phase === "done" && result && (
            <>
              <button className="btn" onClick={runSentiment} disabled={sentPhase === "loading"}
                style={{ background: "rgba(79,142,247,.12)", border: "1px solid rgba(79,142,247,.25)", color: COBALT, borderRadius: 8, padding: "7px 14px", fontSize: 12 }}>
                {sentPhase === "loading" ? <><span className="spin">⟳</span> &nbsp;Analyzing…</> : "🎭 Sentiment"}
              </button>
              <button className="btn" onClick={() => exportCSV(result.rows, result.meta)}
                style={{ background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.25)", color: EMERALD, borderRadius: 8, padding: "7px 14px", fontSize: 12 }}>
                ⬇ Export CSV
              </button>
            </>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(16,185,129,.08)", border: "1px solid rgba(16,185,129,.18)", borderRadius: 7, padding: "5px 12px" }}>
            <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: EMERALD, boxShadow: `0 0 6px ${EMERALD}` }} />
            <span style={{ fontSize: 11, color: EMERALD, fontWeight: 600 }}>AI Ready</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px 120px" }}>

        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        {phase === "idle" && (
          <div className="fadeup" style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "rgba(245,158,11,.08)",
              border: "1px solid rgba(245,158,11,.2)",
              borderRadius: 100, padding: "5px 16px",
              fontSize: 11, color: "#d97706",
              fontWeight: 600, letterSpacing: "1px",
              textTransform: "uppercase", marginBottom: 24,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: AMBER, display: "inline-block" }} />
              Powered by SEC EDGAR · AI Analysis
            </div>

            <h1 style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "clamp(36px, 6vw, 68px)",
              fontWeight: 700,
              color: "#f8fafc",
              lineHeight: 1.1,
              marginBottom: 16,
              letterSpacing: "-1.5px",
            }}>
              Compare any two<br />
              <span className="shimmer-text">10-K disclosures</span>
            </h1>

            <p style={{
              fontSize: 16, color: "#64748b",
              lineHeight: 1.85, maxWidth: 520, margin: "0 auto 32px",
              fontWeight: 400,
            }}>
              Side-by-side analysis of any note section across companies and years.
              Export to CSV, run sentiment scoring, or ask questions in plain English.
            </p>

            {/* Example chips */}
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <div style={{ width: "100%", fontSize: 11, color: "#334155", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>
                Try these examples →
              </div>
              {EXAMPLE_PAIRS.map((ex, i) => (
                <button key={i} className="chip btn" onClick={() => loadExample(ex)} style={{
                  background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.08)",
                  color: "#94a3b8",
                  borderRadius: 8, padding: "7px 14px",
                  fontSize: 12, fontWeight: 500,
                }}>
                  <span style={{ color: AMBER, fontWeight: 700 }}>{ex.a}</span>
                  <span style={{ color: "#334155", margin: "0 4px" }}>vs</span>
                  <span style={{ color: COBALT, fontWeight: 700 }}>{ex.b}</span>
                  <span style={{ color: "#475569", margin: "0 4px" }}>·</span>
                  {ex.note}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── INPUT PANEL ──────────────────────────────────────────────────── */}
        <div className={`glass ${phase === "idle" ? "fadeup d2" : ""}`} style={{
          borderRadius: 20,
          border: "1px solid rgba(255,255,255,.07)",
          padding: 28,
          marginBottom: 28,
          boxShadow: "0 24px 80px rgba(0,0,0,.4)",
        }}>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

            {/* Company A Card */}
            <div className="card-amber border-top-amber" style={{ borderRadius: 14, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(245,158,11,.2)", border: "1px solid rgba(245,158,11,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>A</div>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, color: AMBER, textTransform: "uppercase", letterSpacing: "1px" }}>Company A</span>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ ...labelBase, color: "#92400e" }}>Company name or ticker</label>
                <input
                  value={companyA}
                  onChange={e => setCompanyA(e.target.value)}
                  placeholder="e.g. Meta, AAPL, SoundHound AI"
                  style={{ ...inputBase, borderColor: "rgba(245,158,11,.25)" }}
                />
              </div>
              <div>
                <label style={{ ...labelBase, color: "#92400e" }}>Fiscal Year</label>
                <select value={yearA} onChange={e => setYearA(e.target.value)}
                  style={{ ...inputBase, borderColor: "rgba(245,158,11,.25)", cursor: "pointer" }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            {/* Company B Card */}
            <div className="card-cobalt border-top-cobalt" style={{ borderRadius: 14, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(79,142,247,.2)", border: "1px solid rgba(79,142,247,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>B</div>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, color: COBALT, textTransform: "uppercase", letterSpacing: "1px" }}>Company B</span>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ ...labelBase, color: "#1e3a5f" }}>Company name or ticker</label>
                <input
                  value={companyB}
                  onChange={e => setCompanyB(e.target.value)}
                  placeholder="e.g. Alphabet, MSFT, Visa"
                  style={{ ...inputBase, borderColor: "rgba(79,142,247,.25)" }}
                />
              </div>
              <div>
                <label style={{ ...labelBase, color: "#1e3a5f" }}>Fiscal Year</label>
                <select value={yearB} onChange={e => setYearB(e.target.value)}
                  style={{ ...inputBase, borderColor: "rgba(79,142,247,.25)", cursor: "pointer" }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Note Section */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ ...labelBase, color: "#475569" }}>10-K Note Section</label>
            <select value={note} onChange={e => setNote(e.target.value)}
              style={{ ...inputBase, cursor: "pointer" }}>
              <option value="">— Select the note section to compare —</option>
              {NOTE_SECTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Compare Button */}
          <button className="btn" onClick={compare}
            disabled={phase === "loading" || !companyA.trim() || !companyB.trim() || !note}
            style={{
              width: "100%",
              background: phase === "loading"
                ? "rgba(255,255,255,.05)"
                : "linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)",
              color: phase === "loading" ? "#475569" : "#030f1c",
              borderRadius: 12,
              padding: "15px 0",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: ".3px",
              boxShadow: phase !== "loading" ? "0 8px 32px rgba(245,158,11,.25), inset 0 1px 0 rgba(255,255,255,.2)" : "none",
            }}>
            {phase === "loading"
              ? <><span className="spin" style={{ marginRight: 8 }}>⟳</span>Analyzing filings — this takes ~15 seconds…</>
              : "Compare 10-K Notes →"}
          </button>
        </div>

        {/* ── ERROR ────────────────────────────────────────────────────────── */}
        {phase === "error" && (
          <div className="fadeup" style={{
            background: "rgba(251,113,133,.06)",
            border: "1px solid rgba(251,113,133,.2)",
            borderLeft: `3px solid ${ROSE}`,
            borderRadius: 12,
            padding: "18px 22px",
            marginBottom: 24,
            fontSize: 14, color: "#fda4af", lineHeight: 1.6,
            display: "flex", alignItems: "flex-start", gap: 12,
          }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Error</div>
              {errMsg}
              <button className="btn" onClick={() => setPhase("idle")} style={{
                display: "block", marginTop: 12, background: "rgba(251,113,133,.15)",
                border: "1px solid rgba(251,113,133,.3)", color: ROSE,
                borderRadius: 7, padding: "6px 14px", fontSize: 12,
              }}>← Try again</button>
            </div>
          </div>
        )}

        {/* ── RESULTS ──────────────────────────────────────────────────────── */}
        {phase === "done" && result && (
          <div>
            {/* Result header */}
            <div className="fadeup" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 24 }}>
              <div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 700, color: "#f8fafc", marginBottom: 8, letterSpacing: "-.5px" }}>
                  <span style={{ color: AMBER }}>{result.meta.companyA}</span>
                  <span style={{ color: "#334155", margin: "0 14px", fontSize: 20 }}>versus</span>
                  <span style={{ color: COBALT }}>{result.meta.companyB}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ background: "rgba(245,158,11,.15)", color: AMBER, border: "1px solid rgba(245,158,11,.3)", padding: "3px 10px", borderRadius: 5, fontSize: 12, fontWeight: 700 }}>FY {result.meta.yearA}</span>
                  <span style={{ color: "#334155", fontSize: 12 }}>vs</span>
                  <span style={{ background: "rgba(79,142,247,.15)", color: COBALT, border: "1px solid rgba(79,142,247,.3)", padding: "3px 10px", borderRadius: 5, fontSize: 12, fontWeight: 700 }}>FY {result.meta.yearB}</span>
                  <span style={{ color: "#334155" }}>·</span>
                  <span style={{ color: "#64748b", fontSize: 13 }}>{result.meta.note}</span>
                </div>
              </div>
              <button className="btn" onClick={() => { setPhase("idle"); setResult(null); setSentiment(null); setQaHistory([]); }}
                style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", color: "#64748b", borderRadius: 9, padding: "8px 16px", fontSize: 13 }}>
                ← New comparison
              </button>
            </div>

            {/* Key insight */}
            {result.keyInsight && (
              <div className="fadeup d1" style={{
                background: "linear-gradient(135deg, rgba(245,158,11,.1), rgba(245,158,11,.04))",
                border: "1px solid rgba(245,158,11,.2)",
                borderLeft: `3px solid ${AMBER}`,
                borderRadius: 12,
                padding: "16px 20px",
                marginBottom: 20,
                display: "flex", gap: 14, alignItems: "flex-start",
              }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>💡</span>
                <div>
                  <div style={{ fontSize: 10, color: "#92400e", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6 }}>Key Insight</div>
                  <div style={{ fontSize: 14, color: "#fde68a", lineHeight: 1.7 }}>{result.keyInsight}</div>
                </div>
              </div>
            )}

            {/* Comparison Table */}
            <div className="fadeup d2" style={{
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,.07)",
              marginBottom: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,.3)",
            }}>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{
                        background: "rgba(255,255,255,.03)",
                        padding: "14px 20px",
                        textAlign: "left",
                        fontSize: 11, color: "#475569",
                        fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px",
                        borderBottom: "1px solid rgba(255,255,255,.07)",
                        width: "26%",
                      }}>Disclosure</th>
                      <th style={{
                        background: "rgba(245,158,11,.06)",
                        borderTop: `2px solid ${AMBER}`,
                        padding: "14px 20px",
                        textAlign: "left",
                        fontSize: 11, color: AMBER,
                        fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px",
                        borderBottom: "1px solid rgba(255,255,255,.07)",
                      }}>
                        {result.meta.companyA} · {result.meta.yearA}
                      </th>
                      <th style={{
                        background: "rgba(79,142,247,.06)",
                        borderTop: `2px solid ${COBALT}`,
                        padding: "14px 20px",
                        textAlign: "left",
                        fontSize: 11, color: COBALT,
                        fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px",
                        borderBottom: "1px solid rgba(255,255,255,.07)",
                      }}>
                        {result.meta.companyB} · {result.meta.yearB}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="trow">
                        <td style={{
                          padding: "14px 20px",
                          fontSize: 13, fontWeight: 600, color: "#94a3b8",
                          fontStyle: "italic",
                          borderBottom: i < result.rows.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none",
                          background: "rgba(255,255,255,.01)",
                        }}>{row.dimension}</td>
                        <td style={{
                          padding: "14px 20px",
                          fontSize: 13, color: "#cbd5e1", lineHeight: 1.7,
                          borderBottom: i < result.rows.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none",
                          borderLeft: "1px solid rgba(245,158,11,.08)",
                          background: i % 2 === 0 ? "rgba(245,158,11,.02)" : "transparent",
                        }}>{row.a}</td>
                        <td style={{
                          padding: "14px 20px",
                          fontSize: 13, color: "#cbd5e1", lineHeight: 1.7,
                          borderBottom: i < result.rows.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none",
                          borderLeft: "1px solid rgba(79,142,247,.08)",
                          background: i % 2 === 0 ? "rgba(79,142,247,.02)" : "transparent",
                        }}>{row.b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary */}
            {result.summary && (
              <div className="fadeup d3" style={{
                glass: true,
                background: "rgba(255,255,255,.025)",
                border: "1px solid rgba(255,255,255,.07)",
                borderLeft: "3px solid rgba(79,142,247,.4)",
                borderRadius: 12,
                padding: "18px 22px",
                marginBottom: 20,
              }}>
                <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 10 }}>Analyst Summary</div>
                <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.85 }}>{result.summary}</p>
              </div>
            )}

            {/* Action Bar */}
            <div className="fadeup d4" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
              <button className="btn" onClick={() => exportCSV(result.rows, result.meta)} style={{
                background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.25)",
                color: EMERALD, borderRadius: 10, padding: "11px 20px", fontSize: 13,
                display: "flex", alignItems: "center", gap: 7,
              }}>
                <span>⬇</span> Export to CSV
              </button>
              <button className="btn" onClick={runSentiment} disabled={sentPhase === "loading"} style={{
                background: "rgba(79,142,247,.1)", border: "1px solid rgba(79,142,247,.25)",
                color: COBALT, borderRadius: 10, padding: "11px 20px", fontSize: 13,
                display: "flex", alignItems: "center", gap: 7,
              }}>
                {sentPhase === "loading" ? <><span className="spin">⟳</span> Analyzing tone…</> : <><span>🎭</span> Sentiment Analysis</>}
              </button>
              <button className="btn" onClick={() => setQaOpen(!qaOpen)} style={{
                background: qaOpen ? "rgba(16,185,129,.15)" : "rgba(16,185,129,.08)",
                border: `1px solid ${qaOpen ? "rgba(16,185,129,.4)" : "rgba(16,185,129,.2)"}`,
                color: EMERALD, borderRadius: 10, padding: "11px 20px", fontSize: 13,
                display: "flex", alignItems: "center", gap: 7,
              }}>
                <span>💬</span> {qaOpen ? "Hide Q&A" : "Ask a Question"}
              </button>
            </div>

            {/* Sentiment Panel */}
            {sentPhase === "done" && sentiment && (
              <div className="fadeup" style={{
                background: "rgba(255,255,255,.02)",
                border: "1px solid rgba(255,255,255,.07)",
                borderRadius: 16, padding: 24, marginBottom: 20,
              }}>
                <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 20 }}>Disclosure Sentiment Analysis</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                  {[
                    { company: result.meta.companyA, year: result.meta.yearA, overall: sentiment.overallA, score: Number(sentiment.scoreA), summary: sentiment.summaryA, color: AMBER },
                    { company: result.meta.companyB, year: result.meta.yearB, overall: sentiment.overallB, score: Number(sentiment.scoreB), summary: sentiment.summaryB, color: COBALT },
                  ].map((s, i) => (
                    <div key={i} style={{
                      background: `rgba(${i === 0 ? "245,158,11" : "79,142,247"},.04)`,
                      border: `1px solid rgba(${i === 0 ? "245,158,11" : "79,142,247"},.15)`,
                      borderRadius: 12, padding: 18,
                    }}>
                      <div style={{ fontSize: 12, color: s.color, fontWeight: 700, marginBottom: 12 }}>{s.company} · {s.year}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <span style={{
                          background: `${sentimentColor(s.overall)}20`,
                          color: sentimentColor(s.overall),
                          border: `1px solid ${sentimentColor(s.overall)}40`,
                          borderRadius: 6, padding: "3px 10px",
                          fontSize: 12, fontWeight: 700,
                        }}>{s.overall}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>Tone score: {s.score}/10</div>
                      <ScoreBar score={s.score} color={s.color} />
                      <p style={{ marginTop: 12, fontSize: 13, color: "#64748b", lineHeight: 1.65 }}>{s.summary}</p>
                    </div>
                  ))}
                </div>
                {sentiment.comparison && (
                  <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.75, marginBottom: sentiment.redflags ? 14 : 0 }}>
                    <span style={{ color: "#475569", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginRight: 8 }}>Comparison:</span>
                    {sentiment.comparison}
                  </p>
                )}
                {sentiment.redflags && sentiment.redflags !== "null" && sentiment.redflags !== "None identified" && (
                  <div style={{
                    background: "rgba(251,113,133,.06)", border: "1px solid rgba(251,113,133,.2)",
                    borderLeft: `3px solid ${ROSE}`, borderRadius: 8,
                    padding: "12px 16px", marginTop: 14,
                    fontSize: 13, color: "#fda4af", lineHeight: 1.65,
                  }}>
                    🚩 <strong>Red flags:</strong> {sentiment.redflags}
                  </div>
                )}
              </div>
            )}

            {/* Q&A Panel */}
            {qaOpen && (
              <div className="fadeup" style={{
                background: "rgba(16,185,129,.03)",
                border: "1px solid rgba(16,185,129,.15)",
                borderRadius: 16, padding: 24, marginBottom: 20,
              }}>
                <div style={{ fontSize: 10, color: "#065f46", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 16 }}>
                  Ask anything about this comparison
                </div>

                {/* Chat history */}
                {qaHistory.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
                    {qaHistory.map((item, i) => (
                      <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <div className="bubble-q" style={{ maxWidth: "80%" }}>{item.q}</div>
                        </div>
                        <div className="bubble-a">{item.a}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Input */}
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && qaPhase !== "loading" && askQuestion()}
                    placeholder="e.g. Which company has more concentrated revenue? What changed between years?"
                    disabled={qaPhase === "loading"}
                    style={{ ...inputBase, flex: 1, borderColor: "rgba(16,185,129,.25)" }}
                  />
                  <button className="btn" onClick={askQuestion}
                    disabled={qaPhase === "loading" || !question.trim()} style={{
                      background: qaPhase === "loading" ? "rgba(16,185,129,.15)" : "rgba(16,185,129,.85)",
                      color: qaPhase === "loading" ? EMERALD : "#030f1c",
                      borderRadius: 10, padding: "12px 20px", fontSize: 13, flexShrink: 0,
                    }}>
                    {qaPhase === "loading" ? <span className="spin">⟳</span> : "Ask →"}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "#1e3a2f", marginTop: 8 }}>
                  Press Enter or click Ask. Try: "Which company has more disclosure risk?" or "What's the most notable change?"
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── DISCLAIMER ───────────────────────────────────────────────────── */}
        <div style={{
          marginTop: 48,
          padding: "16px 22px",
          background: "rgba(255,255,255,.02)",
          border: "1px solid rgba(255,255,255,.05)",
          borderRadius: 12,
          fontSize: 11, color: "#334155", lineHeight: 1.8, textAlign: "center",
        }}>
          <span style={{ color: "#475569" }}>ℹ️ </span>
          This tool uses AI trained on SEC 10-K filings through <strong style={{ color: "#475569" }}>early 2025</strong>. Analysis reflects AI training knowledge — not live SEC EDGAR data scraping. Always verify figures directly at{" "}
          <a href="https://efts.sec.gov/LATEST/search-index?forms=10-K" target="_blank" rel="noopener noreferrer" style={{ color: "#475569", textDecoration: "underline" }}>SEC EDGAR</a>
          {" "}before any investment or business decisions. Not financial advice.
        </div>
      </main>
    </>
  );
}
