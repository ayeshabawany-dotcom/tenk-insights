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

const FEATURES = [
  {
    icon: "⚖️",
    title: "Side-by-Side Comparison",
    desc: "Any two companies. Any two fiscal years. Any of 16 note sections. Structured table output in seconds.",
  },
  {
    icon: "🎭",
    title: "Disclosure Sentiment Scoring",
    desc: "Quantify the tone of each company's language. Identify cautious disclosures, hedging, and red flags.",
  },
  {
    icon: "💬",
    title: "Natural Language Q&A",
    desc: "Ask anything about the comparison. Get answers grounded in the actual filing data — not hallucinations.",
  },
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

// ── Score Bar ─────────────────────────────────────────────────────────────────
function ScoreBar({ score, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
      <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,.07)", borderRadius: 100, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(score / 10) * 100}%`, background: `linear-gradient(90deg, ${color}70, ${color})`, borderRadius: 100, transition: "width 1s ease" }} />
      </div>
      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color, minWidth: 28, textAlign: "right" }}>{score}<span style={{ fontSize: 10, color: "rgba(255,255,255,.2)", fontWeight: 400 }}>/10</span></span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
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

  const AMBER  = "#f59e0b";
  const COBALT = "#4f8ef7";
  const EMERALD = "#10b981";
  const ROSE   = "#fb7185";

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
        <title>10-K Compare — Institutional-Grade Filing Analysis</title>
        <meta name="description" content="Compare any two SEC 10-K filing notes side by side. Segment data, revenue recognition, M&A accounting — structured analysis in seconds." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,600&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body {
          background: #030f1c;
          color: #e2e8f0;
          font-family: 'DM Sans', sans-serif;
          min-height: 100vh;
          overflow-x: hidden;
        }
        body::before {
          content: '';
          position: fixed; inset: 0;
          background:
            radial-gradient(ellipse 70% 50% at 15% 15%, rgba(79,142,247,.08) 0%, transparent 55%),
            radial-gradient(ellipse 50% 40% at 85% 75%, rgba(245,158,11,.06) 0%, transparent 55%),
            radial-gradient(ellipse 40% 60% at 55% 45%, rgba(16,185,129,.03) 0%, transparent 65%);
          pointer-events: none; z-index: 0;
        }
        body::after {
          content: '';
          position: fixed; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px);
          background-size: 52px 52px;
          pointer-events: none; z-index: 0;
        }
        * { position: relative; z-index: 1; }
        ::selection { background: rgba(79,142,247,.3); }
        input::placeholder, textarea::placeholder { color: #2d3f52; }
        input:focus, select:focus, textarea:focus {
          outline: none !important;
          border-color: rgba(79,142,247,.65) !important;
          box-shadow: 0 0 0 3px rgba(79,142,247,.12) !important;
        }
        select option { background: #0a1a2e; color: #e2e8f0; }
        .btn { transition: all .18s cubic-bezier(.16,1,.3,1); cursor: pointer; border: none; font-family: 'DM Sans', sans-serif; font-weight: 600; }
        .btn:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.1); }
        .btn:active:not(:disabled) { transform: translateY(0); }
        .btn:disabled { opacity: .4; cursor: not-allowed; transform: none !important; }
        .glass { background: rgba(255,255,255,.035); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); }
        .chip:hover { background: rgba(255,255,255,.07) !important; transform: translateY(-1px); }
        .chip { transition: all .15s; }
        .trow:hover > td { background: rgba(255,255,255,.03) !important; }
        .feat-card:hover { border-color: rgba(255,255,255,.12) !important; transform: translateY(-2px); box-shadow: 0 16px 40px rgba(0,0,0,.3) !important; }
        .feat-card { transition: all .2s; }
        @keyframes fadeUp   { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn   { from { opacity:0; } to { opacity:1; } }
        @keyframes shimmer  { 0%,100%{background-position:0% center} 50%{background-position:100% center} }
        @keyframes spin     { to { transform: rotate(360deg); } }
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes slideR   { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideL   { from{opacity:0;transform:translateX(10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes glow     { 0%,100%{box-shadow:0 0 20px rgba(245,158,11,.2)} 50%{box-shadow:0 0 40px rgba(245,158,11,.4)} }
        .fadeup  { animation: fadeUp .55s cubic-bezier(.16,1,.3,1) forwards; opacity:0; }
        .fadein  { animation: fadeIn .4s ease forwards; }
        .d1{animation-delay:.07s}.d2{animation-delay:.14s}.d3{animation-delay:.21s}
        .d4{animation-delay:.28s}.d5{animation-delay:.35s}.d6{animation-delay:.42s}
        .shimmer-text {
          background: linear-gradient(90deg, #f59e0b 0%, #fde68a 25%, #f59e0b 50%, #d97706 75%, #f59e0b 100%);
          background-size: 300% auto;
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text; animation: shimmer 4s ease infinite;
        }
        .spin { animation: spin 1s linear infinite; display: inline-block; }
        .pulse-dot { animation: pulse 2s ease infinite; }
        .bubble-q { background: rgba(79,142,247,.12); border: 1px solid rgba(79,142,247,.22); border-radius: 14px 14px 4px 14px; padding: 12px 16px; font-size: 14px; color: #bfdbfe; line-height: 1.65; animation: slideL .3s ease forwards; }
        .bubble-a { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 4px 14px 14px 14px; padding: 12px 16px; font-size: 14px; color: #94a3b8; line-height: 1.8; animation: slideR .3s ease .08s forwards; opacity: 0; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { vertical-align: top; }
        a { color: ${AMBER}; text-decoration: none; }
        a:hover { text-decoration: underline; }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={{ borderBottom: "1px solid rgba(255,255,255,.055)", padding: "0 36px", height: 66, display: "flex", alignItems: "center", gap: 16, position: "sticky", top: 0, zIndex: 50, background: "rgba(3,15,28,.92)", backdropFilter: "blur(24px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 38, height: 38, background: "linear-gradient(135deg, #f59e0b, #fde68a)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, boxShadow: "0 0 24px rgba(245,158,11,.35)", animation: "glow 3s ease infinite" }}>📊</div>
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 21, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.4px", lineHeight: 1 }}>10-K Compare</div>
            <div style={{ fontSize: 10, color: "#334155", letterSpacing: "1.4px", textTransform: "uppercase", marginTop: 3 }}>Institutional Filing Intelligence</div>
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {phase === "done" && result && (
            <>
              <button className="btn" onClick={runSentiment} disabled={sentPhase === "loading"} style={{ background: "rgba(79,142,247,.1)", border: "1px solid rgba(79,142,247,.22)", color: COBALT, borderRadius: 8, padding: "7px 15px", fontSize: 12 }}>
                {sentPhase === "loading" ? <><span className="spin">⟳</span>&nbsp;Analyzing…</> : "🎭 Sentiment"}
              </button>
              <button className="btn" onClick={() => exportCSV(result.rows, result.meta)} style={{ background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.22)", color: EMERALD, borderRadius: 8, padding: "7px 15px", fontSize: 12 }}>
                ⬇ Export CSV
              </button>
            </>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(16,185,129,.07)", border: "1px solid rgba(16,185,129,.18)", borderRadius: 7, padding: "5px 12px" }}>
            <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: EMERALD, boxShadow: `0 0 8px ${EMERALD}` }} />
            <span style={{ fontSize: 11, color: EMERALD, fontWeight: 600 }}>AI Ready</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 980, margin: "0 auto", padding: "56px 24px 120px" }}>

        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        {phase === "idle" && (
          <>
            <div className="fadeup" style={{ textAlign: "center", marginBottom: 56 }}>

              {/* Eyebrow */}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.18)", borderRadius: 100, padding: "5px 18px", fontSize: 11, color: "#b45309", fontWeight: 600, letterSpacing: "1.2px", textTransform: "uppercase", marginBottom: 28 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: AMBER, display: "inline-block" }} />
                SEC Filing Intelligence · Powered by AI
              </div>

              {/* Headline */}
              <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(40px, 6.5vw, 76px)", fontWeight: 700, color: "#f8fafc", lineHeight: 1.08, marginBottom: 20, letterSpacing: "-2px" }}>
                The footnotes tell<br />
                <span className="shimmer-text">the real story.</span>
              </h1>

              {/* Subheadline */}
              <p style={{ fontSize: 18, color: "#64748b", lineHeight: 1.75, maxWidth: 600, margin: "0 auto 16px", fontWeight: 400 }}>
                Every 10-K contains disclosures that analysts spend <em style={{ color: "#94a3b8", fontStyle: "italic" }}>days</em> manually comparing.
                Pick two companies, any year, any note section.
              </p>
              <p style={{ fontSize: 16, color: "#475569", lineHeight: 1.7, maxWidth: 520, margin: "0 auto 36px" }}>
                Get a structured, side-by-side breakdown in seconds — with sentiment scoring, CSV export, and an AI analyst you can interrogate.
              </p>

              {/* Stats bar */}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 0, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, overflow: "hidden", marginBottom: 40 }}>
                {[
                  { val: "16", label: "Note Categories" },
                  { val: "10", label: "Fiscal Years" },
                  { val: "3", label: "Analysis Modes" },
                ].map((stat, i) => (
                  <div key={i} style={{ padding: "12px 24px", borderRight: i < 2 ? "1px solid rgba(255,255,255,.06)" : "none", textAlign: "center" }}>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, fontWeight: 700, color: AMBER, lineHeight: 1 }}>{stat.val}</div>
                    <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "1px", marginTop: 4, fontWeight: 600 }}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Example chips */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#2d3f52", textTransform: "uppercase", letterSpacing: "1.2px", fontWeight: 600, marginBottom: 12 }}>
                  Live examples — click to load →
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  {EXAMPLE_PAIRS.map((ex, i) => (
                    <button key={i} className="chip btn" onClick={() => loadExample(ex)} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", color: "#64748b", borderRadius: 9, padding: "8px 16px", fontSize: 12, fontWeight: 500, lineHeight: 1.4 }}>
                      <span style={{ color: AMBER, fontWeight: 700 }}>{ex.a} {ex.ya}</span>
                      <span style={{ color: "#2d3f52", margin: "0 6px" }}>vs</span>
                      <span style={{ color: COBALT, fontWeight: 700 }}>{ex.b} {ex.yb}</span>
                      <span style={{ display: "block", fontSize: 10, color: "#334155", marginTop: 2 }}>{ex.note}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Feature Cards */}
            <div className="fadeup d2" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 36 }}>
              {FEATURES.map((f, i) => (
                <div key={i} className="feat-card" style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 14, padding: "22px 20px", boxShadow: "0 4px 24px rgba(0,0,0,.2)" }}>
                  <div style={{ fontSize: 26, marginBottom: 12 }}>{f.icon}</div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 17, fontWeight: 700, color: "#e2e8f0", marginBottom: 8, letterSpacing: "-.2px" }}>{f.title}</div>
                  <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── INPUT PANEL ──────────────────────────────────────────────────── */}
        <div className={`glass ${phase === "idle" ? "fadeup d3" : ""}`} style={{ borderRadius: 20, border: "1px solid rgba(255,255,255,.07)", padding: 28, marginBottom: 28, boxShadow: "0 32px 80px rgba(0,0,0,.4)" }}>

          {phase === "idle" && (
            <div style={{ marginBottom: 22, paddingBottom: 20, borderBottom: "1px solid rgba(255,255,255,.06)" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.3px" }}>
                Build your comparison
              </div>
              <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
                Select two companies, their fiscal years, and the note section you want to compare.
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

            {/* Company A */}
            <div style={{ background: "linear-gradient(135deg, rgba(245,158,11,.06), rgba(245,158,11,.02))", border: "1px solid rgba(245,158,11,.18)", borderTop: `2px solid ${AMBER}`, borderRadius: 14, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(245,158,11,.18)", border: "1px solid rgba(245,158,11,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Cormorant Garamond', serif", fontSize: 16, fontWeight: 700, color: AMBER }}>A</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: AMBER, textTransform: "uppercase", letterSpacing: "1px" }}>Company A</div>
                  <div style={{ fontSize: 11, color: "#78350f", marginTop: 1 }}>First filing</div>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ ...labelBase, color: "#92400e" }}>Company name or ticker</label>
                <input value={companyA} onChange={e => setCompanyA(e.target.value)} placeholder="e.g. Meta, AAPL, Goldman Sachs" style={{ ...inputBase, borderColor: "rgba(245,158,11,.22)" }} />
              </div>
              <div>
                <label style={{ ...labelBase, color: "#92400e" }}>Fiscal Year</label>
                <select value={yearA} onChange={e => setYearA(e.target.value)} style={{ ...inputBase, borderColor: "rgba(245,158,11,.22)", cursor: "pointer" }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            {/* Company B */}
            <div style={{ background: "linear-gradient(135deg, rgba(79,142,247,.06), rgba(79,142,247,.02))", border: "1px solid rgba(79,142,247,.18)", borderTop: `2px solid ${COBALT}`, borderRadius: 14, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(79,142,247,.18)", border: "1px solid rgba(79,142,247,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Cormorant Garamond', serif", fontSize: 16, fontWeight: 700, color: COBALT }}>B</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: COBALT, textTransform: "uppercase", letterSpacing: "1px" }}>Company B</div>
                  <div style={{ fontSize: 11, color: "#1e3a5f", marginTop: 1 }}>Second filing</div>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ ...labelBase, color: "#1e3a5f" }}>Company name or ticker</label>
                <input value={companyB} onChange={e => setCompanyB(e.target.value)} placeholder="e.g. Alphabet, MSFT, JPMorgan" style={{ ...inputBase, borderColor: "rgba(79,142,247,.22)" }} />
              </div>
              <div>
                <label style={{ ...labelBase, color: "#1e3a5f" }}>Fiscal Year</label>
                <select value={yearB} onChange={e => setYearB(e.target.value)} style={{ ...inputBase, borderColor: "rgba(79,142,247,.22)", cursor: "pointer" }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Note Section */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ ...labelBase, color: "#475569" }}>
              Note section to compare
              <span style={{ marginLeft: 8, color: "#2d3f52", fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>— 16 categories available</span>
            </label>
            <select value={note} onChange={e => setNote(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
              <option value="">— Choose the note you want to analyze —</option>
              {NOTE_SECTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* CTA */}
          <button className="btn" onClick={compare} disabled={phase === "loading" || !companyA.trim() || !companyB.trim() || !note} style={{
            width: "100%",
            background: phase === "loading" ? "rgba(255,255,255,.04)" : "linear-gradient(135deg, #f59e0b 0%, #d97706 60%, #b45309 100%)",
            color: phase === "loading" ? "#475569" : "#030f1c",
            borderRadius: 13, padding: "16px 0",
            fontSize: 16, fontWeight: 800, letterSpacing: ".3px",
            boxShadow: phase !== "loading" ? "0 8px 40px rgba(245,158,11,.3), inset 0 1px 0 rgba(255,255,255,.25)" : "none",
          }}>
            {phase === "loading"
              ? <><span className="spin" style={{ marginRight: 10 }}>⟳</span>Reading the filings — typically 15 seconds…</>
              : "Run Comparison →"}
          </button>

          {phase === "idle" && (
            <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: "#2d3f52" }}>
              Analysis takes ~15 seconds · Works for any US-listed public company
            </div>
          )}
        </div>

        {/* ── ERROR ────────────────────────────────────────────────────────── */}
        {phase === "error" && (
          <div className="fadeup" style={{ background: "rgba(251,113,133,.05)", border: "1px solid rgba(251,113,133,.18)", borderLeft: `3px solid ${ROSE}`, borderRadius: 12, padding: "18px 22px", marginBottom: 24, display: "flex", gap: 14, alignItems: "flex-start" }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fda4af", marginBottom: 4 }}>Something went wrong</div>
              <div style={{ fontSize: 13, color: "#9f7070", lineHeight: 1.6 }}>{errMsg}</div>
              <button className="btn" onClick={() => setPhase("idle")} style={{ marginTop: 12, background: "rgba(251,113,133,.12)", border: "1px solid rgba(251,113,133,.25)", color: ROSE, borderRadius: 7, padding: "6px 14px", fontSize: 12 }}>← Try again</button>
            </div>
          </div>
        )}

        {/* ── RESULTS ──────────────────────────────────────────────────────── */}
        {phase === "done" && result && (
          <div>

            {/* Result header */}
            <div className="fadeup" style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 30, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.6px", lineHeight: 1.15 }}>
                    <span style={{ color: AMBER }}>{result.meta.companyA}</span>
                    <span style={{ color: "#1e2d3d", fontStyle: "italic", margin: "0 16px", fontSize: 22 }}>versus</span>
                    <span style={{ color: COBALT }}>{result.meta.companyB}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <span style={{ background: "rgba(245,158,11,.12)", color: AMBER, border: "1px solid rgba(245,158,11,.25)", padding: "3px 10px", borderRadius: 5, fontSize: 12, fontWeight: 700 }}>FY {result.meta.yearA}</span>
                    <span style={{ color: "#1e2d3d", fontSize: 12 }}>vs</span>
                    <span style={{ background: "rgba(79,142,247,.12)", color: COBALT, border: "1px solid rgba(79,142,247,.25)", padding: "3px 10px", borderRadius: 5, fontSize: 12, fontWeight: 700 }}>FY {result.meta.yearB}</span>
                    <span style={{ color: "#1e2d3d" }}>·</span>
                    <span style={{ color: "#64748b", fontSize: 13, fontStyle: "italic" }}>{result.meta.note}</span>
                  </div>
                </div>
                <button className="btn" onClick={() => { setPhase("idle"); setResult(null); setSentiment(null); setQaHistory([]); }} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", color: "#64748b", borderRadius: 9, padding: "8px 16px", fontSize: 13 }}>
                  ← New comparison
                </button>
              </div>
            </div>

            {/* Key Insight */}
            {result.keyInsight && (
              <div className="fadeup d1" style={{ background: "linear-gradient(135deg, rgba(245,158,11,.1), rgba(245,158,11,.03))", border: "1px solid rgba(245,158,11,.18)", borderLeft: `3px solid ${AMBER}`, borderRadius: 13, padding: "16px 22px", marginBottom: 20, display: "flex", gap: 14, alignItems: "flex-start" }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>💡</span>
                <div>
                  <div style={{ fontSize: 10, color: "#92400e", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: 7 }}>What Stood Out</div>
                  <div style={{ fontSize: 14, color: "#fde68a", lineHeight: 1.72, fontWeight: 500 }}>{result.keyInsight}</div>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="fadeup d2" style={{ borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,.07)", marginBottom: 20, boxShadow: "0 24px 60px rgba(0,0,0,.35)" }}>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ background: "rgba(255,255,255,.03)", padding: "14px 20px", textAlign: "left", fontSize: 10, color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", borderBottom: "1px solid rgba(255,255,255,.07)", width: "25%" }}>
                        Disclosure Dimension
                      </th>
                      <th style={{ background: "rgba(245,158,11,.06)", borderTop: `2px solid ${AMBER}`, padding: "14px 20px", textAlign: "left", fontSize: 10, color: AMBER, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                        {result.meta.companyA} · FY{result.meta.yearA}
                      </th>
                      <th style={{ background: "rgba(79,142,247,.06)", borderTop: `2px solid ${COBALT}`, padding: "14px 20px", textAlign: "left", fontSize: 10, color: COBALT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                        {result.meta.companyB} · FY{result.meta.yearB}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="trow">
                        <td style={{ padding: "14px 20px", fontSize: 12, fontWeight: 600, color: "#64748b", fontStyle: "italic", borderBottom: i < result.rows.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none", background: "rgba(255,255,255,.01)" }}>
                          {row.dimension}
                        </td>
                        <td style={{ padding: "14px 20px", fontSize: 13, color: "#cbd5e1", lineHeight: 1.72, borderBottom: i < result.rows.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none", borderLeft: "1px solid rgba(245,158,11,.07)", background: i % 2 === 0 ? "rgba(245,158,11,.02)" : "transparent" }}>
                          {row.a}
                        </td>
                        <td style={{ padding: "14px 20px", fontSize: 13, color: "#cbd5e1", lineHeight: 1.72, borderBottom: i < result.rows.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none", borderLeft: "1px solid rgba(79,142,247,.07)", background: i % 2 === 0 ? "rgba(79,142,247,.02)" : "transparent" }}>
                          {row.b}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Analyst Summary */}
            {result.summary && (
              <div className="fadeup d3" style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)", borderLeft: `3px solid rgba(79,142,247,.4)`, borderRadius: 12, padding: "18px 22px", marginBottom: 22 }}>
                <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: 10 }}>What This Means</div>
                <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.88 }}>{result.summary}</p>
              </div>
            )}

            {/* Action Bar */}
            <div className="fadeup d4" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 26 }}>
              <button className="btn" onClick={() => exportCSV(result.rows, result.meta)} style={{ background: "rgba(16,185,129,.08)", border: "1px solid rgba(16,185,129,.22)", color: EMERALD, borderRadius: 10, padding: "11px 20px", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                ⬇ Download for Excel
              </button>
              <button className="btn" onClick={runSentiment} disabled={sentPhase === "loading"} style={{ background: "rgba(79,142,247,.08)", border: "1px solid rgba(79,142,247,.22)", color: COBALT, borderRadius: 10, padding: "11px 20px", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                {sentPhase === "loading" ? <><span className="spin">⟳</span>&nbsp;Scoring tone…</> : "🎭 Score the Tone"}
              </button>
              <button className="btn" onClick={() => setQaOpen(!qaOpen)} style={{ background: qaOpen ? "rgba(16,185,129,.12)" : "rgba(16,185,129,.06)", border: `1px solid ${qaOpen ? "rgba(16,185,129,.35)" : "rgba(16,185,129,.18)"}`, color: EMERALD, borderRadius: 10, padding: "11px 20px", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                💬 {qaOpen ? "Close Q&A" : "Ask the Data"}
              </button>
            </div>

            {/* Sentiment */}
            {sentPhase === "done" && sentiment && (
              <div className="fadeup" style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 16, padding: 24, marginBottom: 22 }}>
                <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: 20 }}>Tone & Language Analysis</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
                  {[
                    { company: result.meta.companyA, year: result.meta.yearA, overall: sentiment.overallA, score: Number(sentiment.scoreA), summary: sentiment.summaryA, color: AMBER, bg: "rgba(245,158,11,.04)", border: "rgba(245,158,11,.14)" },
                    { company: result.meta.companyB, year: result.meta.yearB, overall: sentiment.overallB, score: Number(sentiment.scoreB), summary: sentiment.summaryB, color: COBALT, bg: "rgba(79,142,247,.04)", border: "rgba(79,142,247,.14)" },
                  ].map((s, i) => (
                    <div key={i} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: 18 }}>
                      <div style={{ fontSize: 12, color: s.color, fontWeight: 700, marginBottom: 12 }}>{s.company} · FY{s.year}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <span style={{ background: `${sentimentColor(s.overall)}18`, color: sentimentColor(s.overall), border: `1px solid ${sentimentColor(s.overall)}35`, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{s.overall}</span>
                        <span style={{ fontSize: 11, color: "#475569" }}>Tone confidence</span>
                      </div>
                      <ScoreBar score={s.score} color={s.color} />
                      <p style={{ marginTop: 12, fontSize: 13, color: "#64748b", lineHeight: 1.68 }}>{s.summary}</p>
                    </div>
                  ))}
                </div>
                {sentiment.comparison && (
                  <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.78, marginBottom: sentiment.redflags && sentiment.redflags !== "null" && sentiment.redflags !== "None identified" ? 14 : 0 }}>
                    <span style={{ fontSize: 10, color: "#334155", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginRight: 8 }}>Comparison:</span>
                    {sentiment.comparison}
                  </p>
                )}
                {sentiment.redflags && sentiment.redflags !== "null" && sentiment.redflags !== "None identified" && (
                  <div style={{ background: "rgba(251,113,133,.05)", border: "1px solid rgba(251,113,133,.18)", borderLeft: `3px solid ${ROSE}`, borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#fda4af", lineHeight: 1.68, marginTop: 6 }}>
                    🚩 <strong>Red flags:</strong> {sentiment.redflags}
                  </div>
                )}
              </div>
            )}

            {/* Q&A */}
            {qaOpen && (
              <div className="fadeup" style={{ background: "rgba(16,185,129,.03)", border: "1px solid rgba(16,185,129,.14)", borderRadius: 16, padding: 24, marginBottom: 22 }}>
                <div style={{ fontSize: 10, color: "#064e3b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: 6 }}>Interrogate the Data</div>
                <div style={{ fontSize: 13, color: "#134e4a", marginBottom: 20 }}>
                  Ask anything about this comparison. The AI answers from the filing data — not from generic knowledge.
                </div>
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
                <div style={{ display: "flex", gap: 10 }}>
                  <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === "Enter" && qaPhase !== "loading" && askQuestion()} placeholder="e.g. Which company has more revenue concentration risk? What changed most between the years?" disabled={qaPhase === "loading"} style={{ ...inputBase, flex: 1, borderColor: "rgba(16,185,129,.22)" }} />
                  <button className="btn" onClick={askQuestion} disabled={qaPhase === "loading" || !question.trim()} style={{ background: qaPhase === "loading" ? "rgba(16,185,129,.12)" : "rgba(16,185,129,.8)", color: qaPhase === "loading" ? EMERALD : "#030f1c", borderRadius: 10, padding: "12px 20px", fontSize: 13, flexShrink: 0 }}>
                    {qaPhase === "loading" ? <span className="spin">⟳</span> : "Ask →"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <div style={{ marginTop: 56, padding: "18px 24px", background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 12, fontSize: 12, color: "#2d3f52", lineHeight: 1.85, textAlign: "center" }}>
          <span style={{ color: "#334155", fontWeight: 600 }}>ℹ️ About this tool:</span> 10-K Compare is powered by Claude AI, trained on SEC EDGAR filings through <strong style={{ color: "#334155" }}>early 2025</strong>. It reflects AI training knowledge — not live data scraping. Designed for research, analysis, and comparative work.
          {" "}<strong style={{ color: "#334155" }}>Always verify figures at{" "}
          <a href="https://efts.sec.gov/LATEST/search-index?forms=10-K" target="_blank" rel="noopener noreferrer" style={{ color: "#475569" }}>SEC EDGAR</a>
          </strong> before making investment or business decisions. Not financial advice.
        </div>
      </main>
    </>
  );
}
