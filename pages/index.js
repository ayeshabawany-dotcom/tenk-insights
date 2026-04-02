import { useState } from "react";
import Head from "next/head";

const YEARS = Array.from({ length: 11 }, (_, i) => String(2024 - i));

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
  { icon: "⚖️", title: "Side-by-Side Comparison", desc: "Any two companies. Any two fiscal years. Any of 16 note sections. Structured table output in seconds." },
  { icon: "🎭", title: "Disclosure Sentiment Scoring", desc: "Quantify the tone of each company's language. Identify cautious disclosures, hedging, and red flags." },
  { icon: "💬", title: "Natural Language Q&A", desc: "Ask anything about the comparison. Get answers grounded in the actual filing data." },
];

function exportCSV(rows, meta) {
  const header = `"Dimension","${meta.companyA} (${meta.yearA})","${meta.companyB} (${meta.yearB})"`;
  const body = rows.map(r => `"${r.dimension}","${r.a.replace(/"/g,'""')}","${r.b.replace(/"/g,'""')}"`).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${meta.companyA}_vs_${meta.companyB}_${meta.note}_${meta.yearA}_${meta.yearB}.csv`.replace(/\s+/g,"_");
  a.click();
  URL.revokeObjectURL(url);
}

function ScoreBar({ score, color }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:8 }}>
      <div style={{ flex:1, height:6, background:"#e5e7eb", borderRadius:100, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${(score/10)*100}%`, background:`linear-gradient(90deg,${color}80,${color})`, borderRadius:100, transition:"width 1s ease" }} />
      </div>
      <span style={{ fontSize:13, fontWeight:700, color, minWidth:32, textAlign:"right" }}>{score}<span style={{ fontSize:10, color:"#9ca3af", fontWeight:400 }}>/10</span></span>
    </div>
  );
}

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
    setSentiment(null); setSentPhase("idle"); setQaHistory([]); setQaOpen(false);
    try {
      const resp = await fetch("/api/analyze", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"compare", companyA, yearA, companyB, yearB, noteSection:note }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Comparison failed");
      setResult(data); setPhase("done");
    } catch(e) { setErrMsg(e.message); setPhase("error"); }
  }

  async function runSentiment() {
    if (!result) return;
    setSentPhase("loading"); setSentiment(null);
    try {
      const resp = await fetch("/api/analyze", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"sentiment", noteSection:note, tableData:result }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setSentiment(data.sentiment); setSentPhase("done");
    } catch(e) { setSentPhase("error"); }
  }

  async function askQuestion() {
    if (!question.trim() || !result) return;
    const q = question.trim();
    setQuestion(""); setQaPhase("loading");
    try {
      const resp = await fetch("/api/analyze", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"ask", question:q, tableData:result }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setQaHistory(prev => [...prev, { q, a:data.answer }]);
      setQaPhase("idle");
    } catch(e) {
      setQaHistory(prev => [...prev, { q, a:"Something went wrong. Please try again." }]);
      setQaPhase("idle");
    }
  }

  function loadExample(ex) {
    setCompanyA(ex.a); setYearA(ex.ya); setCompanyB(ex.b); setYearB(ex.yb); setNote(ex.note);
  }

  const sentimentColor = (s) => {
    if (s === "Positive") return "#059669";
    if (s === "Cautious")  return "#d97706";
    if (s === "Negative")  return "#dc2626";
    return "#6b7280";
  };

  const AMBER   = "#d97706";
  const COBALT  = "#2563eb";
  const EMERALD = "#059669";
  const ROSE    = "#dc2626";

  const inputBase = {
    width:"100%", background:"#ffffff",
    border:"1.5px solid #d1d5db", borderRadius:10,
    padding:"11px 14px", fontSize:14,
    fontFamily:"'DM Sans', sans-serif", color:"#111827",
    outline:"none", transition:"border-color .2s, box-shadow .2s",
  };

  const labelBase = {
    display:"block", fontFamily:"'DM Sans', sans-serif",
    fontSize:11, fontWeight:700, letterSpacing:"0.8px",
    textTransform:"uppercase", marginBottom:7, color:"#6b7280",
  };

  return (
    <>
      <Head>
        <title>10-K Compare — Institutional-Grade Filing Analysis</title>
        <meta name="description" content="Compare any two SEC 10-K filing notes side by side. Structured analysis in seconds." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,600&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        html { scroll-behavior:smooth; }
        body { background:#f0f2f5; color:#111827; font-family:'DM Sans',sans-serif; min-height:100vh; }
        ::selection { background:rgba(37,99,235,.15); }
        input::placeholder, textarea::placeholder { color:#9ca3af; }
        input:focus, select:focus, textarea:focus { outline:none!important; border-color:#2563eb!important; box-shadow:0 0 0 3px rgba(37,99,235,.1)!important; }
        select option { background:#fff; color:#111827; }
        .btn { transition:all .18s; cursor:pointer; border:none; font-family:'DM Sans',sans-serif; font-weight:600; }
        .btn:hover:not(:disabled) { transform:translateY(-2px); filter:brightness(1.05); }
        .btn:active:not(:disabled) { transform:translateY(0); }
        .btn:disabled { opacity:.45; cursor:not-allowed; transform:none!important; }
        .chip:hover { background:#f3f4f6!important; transform:translateY(-1px); }
        .chip { transition:all .15s; }
        .trow:hover > td { background:#f9fafb!important; }
        .feat-card:hover { box-shadow:0 8px 32px rgba(0,0,0,.1)!important; transform:translateY(-3px); }
        .feat-card { transition:all .2s; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%,100%{background-position:0% center} 50%{background-position:100% center} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes slideR { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideL { from{opacity:0;transform:translateX(8px)} to{opacity:1;transform:translateX(0)} }
        .fadeup { animation:fadeUp .5s cubic-bezier(.16,1,.3,1) forwards; opacity:0; }
        .d1{animation-delay:.06s}.d2{animation-delay:.12s}.d3{animation-delay:.18s}
        .d4{animation-delay:.24s}.d5{animation-delay:.3s}
        .shimmer-text {
          background:linear-gradient(90deg,#d97706 0%,#f59e0b 25%,#d97706 50%,#b45309 75%,#d97706 100%);
          background-size:300% auto;
          -webkit-background-clip:text; -webkit-text-fill-color:transparent;
          background-clip:text; animation:shimmer 4s ease infinite;
        }
        .spin { animation:spin 1s linear infinite; display:inline-block; }
        .pulse-dot { animation:pulse 2s ease infinite; }
        .bubble-q { background:#eff6ff; border:1.5px solid #bfdbfe; border-radius:14px 14px 4px 14px; padding:12px 16px; font-size:14px; color:#1e40af; line-height:1.65; animation:slideL .3s ease forwards; }
        .bubble-a { background:#ffffff; border:1.5px solid #e5e7eb; border-radius:4px 14px 14px 14px; padding:12px 16px; font-size:14px; color:#374151; line-height:1.8; animation:slideR .3s ease .08s forwards; opacity:0; box-shadow:0 2px 8px rgba(0,0,0,.06); }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#d1d5db; border-radius:2px; }
        table { border-collapse:collapse; width:100%; }
        th, td { vertical-align:top; }
        a { color:${COBALT}; text-decoration:none; }
        a:hover { text-decoration:underline; }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={{ background:"#ffffff", borderBottom:"1.5px solid #e5e7eb", padding:"0 36px", height:64, display:"flex", alignItems:"center", gap:16, position:"sticky", top:0, zIndex:50, boxShadow:"0 1px 12px rgba(0,0,0,.06)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:38, height:38, background:"linear-gradient(135deg,#d97706,#f59e0b)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:19, boxShadow:"0 2px 12px rgba(217,119,6,.3)" }}>📊</div>
          <div>
            <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:21, fontWeight:700, color:"#111827", letterSpacing:"-.4px", lineHeight:1 }}>10-K Compare</div>
            <div style={{ fontSize:10, color:"#9ca3af", letterSpacing:"1.2px", textTransform:"uppercase", marginTop:3 }}>Institutional Filing Intelligence</div>
          </div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:10 }}>
          {phase === "done" && result && (
            <>
              <button className="btn" onClick={runSentiment} disabled={sentPhase==="loading"}
                style={{ background:"#eff6ff", border:"1.5px solid #bfdbfe", color:COBALT, borderRadius:8, padding:"7px 15px", fontSize:12 }}>
                {sentPhase==="loading" ? <><span className="spin">⟳</span>&nbsp;Analyzing…</> : "🎭 Sentiment"}
              </button>
              <button className="btn" onClick={() => exportCSV(result.rows, result.meta)}
                style={{ background:"#f0fdf4", border:"1.5px solid #bbf7d0", color:EMERALD, borderRadius:8, padding:"7px 15px", fontSize:12 }}>
                ⬇ Export CSV
              </button>
            </>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:6, background:"#f0fdf4", border:"1.5px solid #bbf7d0", borderRadius:7, padding:"5px 12px" }}>
            <div className="pulse-dot" style={{ width:6, height:6, borderRadius:"50%", background:EMERALD, boxShadow:`0 0 6px ${EMERALD}` }} />
            <span style={{ fontSize:11, color:EMERALD, fontWeight:700 }}>AI Ready</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth:960, margin:"0 auto", padding:"52px 24px 100px" }}>

        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        {phase === "idle" && (
          <>
            <div className="fadeup" style={{ textAlign:"center", marginBottom:52 }}>

              {/* Eyebrow */}
              <div style={{ display:"inline-flex", alignItems:"center", gap:8, background:"#fffbeb", border:"1.5px solid #fde68a", borderRadius:100, padding:"5px 18px", fontSize:11, color:"#92400e", fontWeight:700, letterSpacing:"1px", textTransform:"uppercase", marginBottom:24 }}>
                <span style={{ width:5, height:5, borderRadius:"50%", background:AMBER, display:"inline-block" }} />
                Powered by AI · Based on SEC 10-K Filings
              </div>

              {/* Headline */}
              <h1 style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"clamp(38px,6vw,72px)", fontWeight:700, color:"#111827", lineHeight:1.1, marginBottom:18, letterSpacing:"-2px" }}>
                The footnotes tell<br />
                <span className="shimmer-text">the real story.</span>
              </h1>

              {/* Subheadline */}
              <p style={{ fontSize:18, color:"#374151", lineHeight:1.78, maxWidth:580, margin:"0 auto 14px", fontWeight:400 }}>
                Every 10-K contains disclosures that analysts spend <em style={{ color:"#111827", fontWeight:600 }}>days</em> manually comparing. Pick two companies, any year, any note section.
              </p>
              <p style={{ fontSize:16, color:"#6b7280", lineHeight:1.7, maxWidth:500, margin:"0 auto 36px" }}>
                Get a structured, side-by-side breakdown in seconds — with sentiment scoring, CSV export, and an AI analyst you can interrogate.
              </p>

              {/* Stats bar */}
              <div style={{ display:"inline-flex", alignItems:"center", background:"#ffffff", border:"1.5px solid #e5e7eb", borderRadius:12, overflow:"hidden", marginBottom:40, boxShadow:"0 2px 12px rgba(0,0,0,.06)" }}>
                {[
                  { val:"16", label:"Note Categories" },
                  { val:"10", label:"Fiscal Years" },
                  { val:"3",  label:"Analysis Modes" },
                ].map((stat, i) => (
                  <div key={i} style={{ padding:"14px 28px", borderRight:i<2?"1.5px solid #e5e7eb":"none", textAlign:"center" }}>
                    <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:28, fontWeight:700, color:AMBER, lineHeight:1 }}>{stat.val}</div>
                    <div style={{ fontSize:10, color:"#9ca3af", textTransform:"uppercase", letterSpacing:"1px", marginTop:4, fontWeight:700 }}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Example chips */}
              <div>
                <div style={{ fontSize:11, color:"#9ca3af", textTransform:"uppercase", letterSpacing:"1.2px", fontWeight:600, marginBottom:10 }}>
                  Click to load a live example →
                </div>
                <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
                  {EXAMPLE_PAIRS.map((ex, i) => (
                    <button key={i} className="chip btn" onClick={() => loadExample(ex)} style={{ background:"#ffffff", border:"1.5px solid #e5e7eb", color:"#6b7280", borderRadius:10, padding:"8px 16px", fontSize:12, fontWeight:500, lineHeight:1.5, boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
                      <span style={{ color:AMBER, fontWeight:700 }}>{ex.a} {ex.ya}</span>
                      <span style={{ color:"#d1d5db", margin:"0 6px" }}>vs</span>
                      <span style={{ color:COBALT, fontWeight:700 }}>{ex.b} {ex.yb}</span>
                      <span style={{ display:"block", fontSize:10, color:"#9ca3af", marginTop:2 }}>{ex.note}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Feature Cards */}
            <div className="fadeup d2" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:36 }}>
              {FEATURES.map((f, i) => (
                <div key={i} className="feat-card" style={{ background:"#ffffff", border:"1.5px solid #e5e7eb", borderRadius:14, padding:"22px 20px", boxShadow:"0 2px 12px rgba(0,0,0,.05)" }}>
                  <div style={{ fontSize:26, marginBottom:12 }}>{f.icon}</div>
                  <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:18, fontWeight:700, color:"#111827", marginBottom:8 }}>{f.title}</div>
                  <div style={{ fontSize:13, color:"#6b7280", lineHeight:1.72 }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── INPUT PANEL ──────────────────────────────────────────────────── */}
        <div className={phase==="idle" ? "fadeup d3" : ""} style={{ background:"#ffffff", borderRadius:20, border:"1.5px solid #e5e7eb", padding:28, marginBottom:24, boxShadow:"0 4px 24px rgba(0,0,0,.07)" }}>

          {phase === "idle" && (
            <div style={{ marginBottom:22, paddingBottom:18, borderBottom:"1.5px solid #f3f4f6" }}>
              <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:22, fontWeight:700, color:"#111827" }}>Build your comparison</div>
              <div style={{ fontSize:13, color:"#6b7280", marginTop:4 }}>Select two companies, their fiscal years, and the note section you want to compare.</div>
            </div>
          )}

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>

            {/* Company A */}
            <div style={{ background:"#fffbeb", border:"1.5px solid #fde68a", borderTop:`3px solid ${AMBER}`, borderRadius:14, padding:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:18 }}>
                <div style={{ width:30, height:30, borderRadius:8, background:"#fef3c7", border:`1.5px solid #fde68a`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Cormorant Garamond',serif", fontSize:17, fontWeight:700, color:AMBER }}>A</div>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:AMBER, textTransform:"uppercase", letterSpacing:"1px" }}>Company A</div>
                  <div style={{ fontSize:11, color:"#92400e", marginTop:1 }}>First filing</div>
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={{ ...labelBase, color:"#92400e" }}>Company name or ticker</label>
                <input value={companyA} onChange={e => setCompanyA(e.target.value)} placeholder="e.g. Meta, AAPL, Goldman Sachs" style={{ ...inputBase, borderColor:"#fcd34d" }} />
              </div>
              <div>
                <label style={{ ...labelBase, color:"#92400e" }}>Fiscal Year</label>
                <select value={yearA} onChange={e => setYearA(e.target.value)} style={{ ...inputBase, borderColor:"#fcd34d", cursor:"pointer" }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            {/* Company B */}
            <div style={{ background:"#eff6ff", border:"1.5px solid #bfdbfe", borderTop:`3px solid ${COBALT}`, borderRadius:14, padding:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:18 }}>
                <div style={{ width:30, height:30, borderRadius:8, background:"#dbeafe", border:"1.5px solid #bfdbfe", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Cormorant Garamond',serif", fontSize:17, fontWeight:700, color:COBALT }}>B</div>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:COBALT, textTransform:"uppercase", letterSpacing:"1px" }}>Company B</div>
                  <div style={{ fontSize:11, color:"#1e40af", marginTop:1 }}>Second filing</div>
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={{ ...labelBase, color:"#1e40af" }}>Company name or ticker</label>
                <input value={companyB} onChange={e => setCompanyB(e.target.value)} placeholder="e.g. Alphabet, MSFT, JPMorgan" style={{ ...inputBase, borderColor:"#93c5fd" }} />
              </div>
              <div>
                <label style={{ ...labelBase, color:"#1e40af" }}>Fiscal Year</label>
                <select value={yearB} onChange={e => setYearB(e.target.value)} style={{ ...inputBase, borderColor:"#93c5fd", cursor:"pointer" }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Note Section */}
          <div style={{ marginBottom:22 }}>
            <label style={{ ...labelBase }}>
              Note section to compare
              <span style={{ marginLeft:8, color:"#9ca3af", fontWeight:400, textTransform:"none", letterSpacing:0, fontSize:11 }}>— 16 categories available</span>
            </label>
            <select value={note} onChange={e => setNote(e.target.value)} style={{ ...inputBase, cursor:"pointer" }}>
              <option value="">— Choose the note you want to analyze —</option>
              {NOTE_SECTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* CTA */}
          <button className="btn" onClick={compare} disabled={phase==="loading"||!companyA.trim()||!companyB.trim()||!note} style={{
            width:"100%",
            background: phase==="loading" ? "#f3f4f6" : "linear-gradient(135deg,#d97706 0%,#b45309 100%)",
            color: phase==="loading" ? "#9ca3af" : "#ffffff",
            borderRadius:12, padding:"15px 0", fontSize:16, fontWeight:800,
            boxShadow: phase!=="loading" ? "0 4px 20px rgba(217,119,6,.35)" : "none",
            letterSpacing:".2px",
          }}>
            {phase==="loading"
              ? <><span className="spin" style={{ marginRight:10 }}>⟳</span>Reading the filings — typically 15 seconds…</>
              : "Run Comparison →"}
          </button>

          {phase === "idle" && (
            <div style={{ textAlign:"center", marginTop:12, fontSize:12, color:"#9ca3af" }}>
              Works for any US-listed public company · Analysis in ~15 seconds
            </div>
          )}
        </div>

        {/* ── ERROR ────────────────────────────────────────────────────────── */}
        {phase === "error" && (
          <div className="fadeup" style={{ background:"#fef2f2", border:"1.5px solid #fecaca", borderLeft:`3px solid ${ROSE}`, borderRadius:12, padding:"18px 22px", marginBottom:20, display:"flex", gap:14, alignItems:"flex-start" }}>
            <span style={{ fontSize:20, flexShrink:0 }}>⚠️</span>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"#991b1b", marginBottom:4 }}>Something went wrong</div>
              <div style={{ fontSize:13, color:"#b91c1c", lineHeight:1.6 }}>{errMsg}</div>
              <button className="btn" onClick={() => setPhase("idle")} style={{ marginTop:10, background:"#ffffff", border:"1.5px solid #fca5a5", color:ROSE, borderRadius:7, padding:"6px 14px", fontSize:12 }}>← Try again</button>
            </div>
          </div>
        )}

        {/* ── RESULTS ──────────────────────────────────────────────────────── */}
        {phase === "done" && result && (
          <div>
            {/* Header */}
            <div className="fadeup" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:14, marginBottom:24 }}>
              <div>
                <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:30, fontWeight:700, color:"#111827", letterSpacing:"-.6px", lineHeight:1.15 }}>
                  <span style={{ color:AMBER }}>{result.meta.companyA}</span>
                  <span style={{ color:"#d1d5db", fontStyle:"italic", margin:"0 14px", fontSize:22 }}>versus</span>
                  <span style={{ color:COBALT }}>{result.meta.companyB}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10, flexWrap:"wrap" }}>
                  <span style={{ background:"#fffbeb", color:AMBER, border:"1.5px solid #fde68a", padding:"3px 10px", borderRadius:5, fontSize:12, fontWeight:700 }}>FY {result.meta.yearA}</span>
                  <span style={{ color:"#d1d5db", fontSize:12 }}>vs</span>
                  <span style={{ background:"#eff6ff", color:COBALT, border:"1.5px solid #bfdbfe", padding:"3px 10px", borderRadius:5, fontSize:12, fontWeight:700 }}>FY {result.meta.yearB}</span>
                  <span style={{ color:"#e5e7eb" }}>·</span>
                  <span style={{ color:"#6b7280", fontSize:13 }}>{result.meta.note}</span>
                </div>
              </div>
              <button className="btn" onClick={() => { setPhase("idle"); setResult(null); setSentiment(null); setQaHistory([]); }}
                style={{ background:"#f9fafb", border:"1.5px solid #e5e7eb", color:"#6b7280", borderRadius:9, padding:"8px 16px", fontSize:13 }}>
                ← New comparison
              </button>
            </div>

            {/* Key Insight */}
            {result.keyInsight && (
              <div className="fadeup d1" style={{ background:"#fffbeb", border:"1.5px solid #fde68a", borderLeft:`4px solid ${AMBER}`, borderRadius:12, padding:"16px 20px", marginBottom:20, display:"flex", gap:14 }}>
                <span style={{ fontSize:22, flexShrink:0 }}>💡</span>
                <div>
                  <div style={{ fontSize:10, color:"#92400e", fontWeight:700, textTransform:"uppercase", letterSpacing:"1.2px", marginBottom:6 }}>What Stood Out</div>
                  <div style={{ fontSize:14, color:"#78350f", lineHeight:1.72, fontWeight:500 }}>{result.keyInsight}</div>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="fadeup d2" style={{ borderRadius:16, overflow:"hidden", border:"1.5px solid #e5e7eb", marginBottom:20, boxShadow:"0 4px 24px rgba(0,0,0,.07)" }}>
              <div style={{ overflowX:"auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ background:"#f9fafb", padding:"13px 20px", textAlign:"left", fontSize:11, color:"#9ca3af", fontWeight:700, textTransform:"uppercase", letterSpacing:"1px", borderBottom:"1.5px solid #e5e7eb", width:"24%" }}>
                        Disclosure Dimension
                      </th>
                      <th style={{ background:"#fffbeb", borderTop:`3px solid ${AMBER}`, padding:"13px 20px", textAlign:"left", fontSize:11, color:AMBER, fontWeight:700, textTransform:"uppercase", letterSpacing:"1px", borderBottom:"1.5px solid #e5e7eb" }}>
                        {result.meta.companyA} · FY{result.meta.yearA}
                      </th>
                      <th style={{ background:"#eff6ff", borderTop:`3px solid ${COBALT}`, padding:"13px 20px", textAlign:"left", fontSize:11, color:COBALT, fontWeight:700, textTransform:"uppercase", letterSpacing:"1px", borderBottom:"1.5px solid #e5e7eb" }}>
                        {result.meta.companyB} · FY{result.meta.yearB}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="trow">
                        <td style={{ padding:"13px 20px", fontSize:12, fontWeight:700, color:"#6b7280", fontStyle:"italic", borderBottom:i<result.rows.length-1?"1.5px solid #f3f4f6":"none", background:"#fafafa" }}>{row.dimension}</td>
                        <td style={{ padding:"13px 20px", fontSize:13, color:"#1f2937", lineHeight:1.72, borderBottom:i<result.rows.length-1?"1.5px solid #f3f4f6":"none", borderLeft:"2px solid #fde68a", background:i%2===0?"#fffdf5":"#ffffff" }}>{row.a}</td>
                        <td style={{ padding:"13px 20px", fontSize:13, color:"#1f2937", lineHeight:1.72, borderBottom:i<result.rows.length-1?"1.5px solid #f3f4f6":"none", borderLeft:"2px solid #bfdbfe", background:i%2===0?"#f5f9ff":"#ffffff" }}>{row.b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Analyst Summary */}
            {result.summary && (
              <div className="fadeup d3" style={{ background:"#ffffff", border:"1.5px solid #e5e7eb", borderLeft:`4px solid ${COBALT}`, borderRadius:12, padding:"18px 22px", marginBottom:20, boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
                <div style={{ fontSize:10, color:"#9ca3af", fontWeight:700, textTransform:"uppercase", letterSpacing:"1.2px", marginBottom:10 }}>What This Means</div>
                <p style={{ fontSize:14, color:"#374151", lineHeight:1.88 }}>{result.summary}</p>
              </div>
            )}

            {/* Action Bar */}
            <div className="fadeup d4" style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:24 }}>
              <button className="btn" onClick={() => exportCSV(result.rows, result.meta)} style={{ background:"#f0fdf4", border:"1.5px solid #bbf7d0", color:EMERALD, borderRadius:10, padding:"11px 20px", fontSize:13 }}>
                ⬇ Download for Excel
              </button>
              <button className="btn" onClick={runSentiment} disabled={sentPhase==="loading"} style={{ background:"#eff6ff", border:"1.5px solid #bfdbfe", color:COBALT, borderRadius:10, padding:"11px 20px", fontSize:13 }}>
                {sentPhase==="loading" ? <><span className="spin">⟳</span>&nbsp;Scoring tone…</> : "🎭 Score the Tone"}
              </button>
              <button className="btn" onClick={() => setQaOpen(!qaOpen)} style={{ background:qaOpen?"#f0fdf4":"#f9fafb", border:`1.5px solid ${qaOpen?"#bbf7d0":"#e5e7eb"}`, color:qaOpen?EMERALD:"#374151", borderRadius:10, padding:"11px 20px", fontSize:13 }}>
                💬 {qaOpen ? "Close Q&A" : "Ask the Data"}
              </button>
            </div>

            {/* Sentiment */}
            {sentPhase==="done" && sentiment && (
              <div className="fadeup" style={{ background:"#ffffff", border:"1.5px solid #e5e7eb", borderRadius:16, padding:24, marginBottom:20, boxShadow:"0 2px 12px rgba(0,0,0,.05)" }}>
                <div style={{ fontSize:10, color:"#9ca3af", fontWeight:700, textTransform:"uppercase", letterSpacing:"1.2px", marginBottom:20 }}>Tone & Language Analysis</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
                  {[
                    { company:result.meta.companyA, year:result.meta.yearA, overall:sentiment.overallA, score:Number(sentiment.scoreA), summary:sentiment.summaryA, color:AMBER, bg:"#fffbeb", border:"#fde68a" },
                    { company:result.meta.companyB, year:result.meta.yearB, overall:sentiment.overallB, score:Number(sentiment.scoreB), summary:sentiment.summaryB, color:COBALT, bg:"#eff6ff", border:"#bfdbfe" },
                  ].map((s, i) => (
                    <div key={i} style={{ background:s.bg, border:`1.5px solid ${s.border}`, borderRadius:12, padding:18 }}>
                      <div style={{ fontSize:12, color:s.color, fontWeight:700, marginBottom:10 }}>{s.company} · FY{s.year}</div>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                        <span style={{ background:"#ffffff", color:sentimentColor(s.overall), border:`1.5px solid ${sentimentColor(s.overall)}40`, borderRadius:6, padding:"3px 10px", fontSize:12, fontWeight:700 }}>{s.overall}</span>
                      </div>
                      <ScoreBar score={s.score} color={s.color} />
                      <p style={{ marginTop:12, fontSize:13, color:"#374151", lineHeight:1.7 }}>{s.summary}</p>
                    </div>
                  ))}
                </div>
                {sentiment.comparison && (
                  <p style={{ fontSize:13, color:"#374151", lineHeight:1.78, marginBottom:sentiment.redflags&&sentiment.redflags!=="null"&&sentiment.redflags!=="None identified"?14:0 }}>
                    <span style={{ fontSize:10, color:"#9ca3af", fontWeight:700, textTransform:"uppercase", letterSpacing:"1px", marginRight:8 }}>Comparison:</span>
                    {sentiment.comparison}
                  </p>
                )}
                {sentiment.redflags && sentiment.redflags!=="null" && sentiment.redflags!=="None identified" && (
                  <div style={{ background:"#fef2f2", border:"1.5px solid #fecaca", borderLeft:`3px solid ${ROSE}`, borderRadius:8, padding:"12px 16px", fontSize:13, color:"#991b1b", lineHeight:1.68 }}>
                    🚩 <strong>Red flags:</strong> {sentiment.redflags}
                  </div>
                )}
              </div>
            )}

            {/* Q&A */}
            {qaOpen && (
              <div className="fadeup" style={{ background:"#f0fdf4", border:"1.5px solid #bbf7d0", borderRadius:16, padding:24, marginBottom:20 }}>
                <div style={{ fontSize:10, color:"#065f46", fontWeight:700, textTransform:"uppercase", letterSpacing:"1.2px", marginBottom:6 }}>Interrogate the Data</div>
                <div style={{ fontSize:13, color:"#047857", marginBottom:20, lineHeight:1.6 }}>
                  Ask anything about this comparison. Answers are grounded in the actual filing data — not generic knowledge.
                </div>
                {qaHistory.length > 0 && (
                  <div style={{ display:"flex", flexDirection:"column", gap:14, marginBottom:20 }}>
                    {qaHistory.map((item, i) => (
                      <div key={i} style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        <div style={{ display:"flex", justifyContent:"flex-end" }}>
                          <div className="bubble-q" style={{ maxWidth:"80%" }}>{item.q}</div>
                        </div>
                        <div className="bubble-a">{item.a}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display:"flex", gap:10 }}>
                  <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key==="Enter"&&qaPhase!=="loading"&&askQuestion()} placeholder="e.g. Which company has more revenue concentration risk?" disabled={qaPhase==="loading"} style={{ ...inputBase, flex:1, borderColor:"#6ee7b7" }} />
                  <button className="btn" onClick={askQuestion} disabled={qaPhase==="loading"||!question.trim()} style={{ background:qaPhase==="loading"?"#d1fae5":EMERALD, color:qaPhase==="loading"?EMERALD:"#ffffff", borderRadius:10, padding:"11px 20px", fontSize:13, flexShrink:0 }}>
                    {qaPhase==="loading" ? <span className="spin">⟳</span> : "Ask →"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <div style={{ marginTop:52, padding:"16px 22px", background:"#ffffff", border:"1.5px solid #e5e7eb", borderRadius:12, fontSize:12, color:"#9ca3af", lineHeight:1.85, textAlign:"center" }}>
          <strong style={{ color:"#6b7280" }}>ℹ️ About this tool:</strong> 10-K Compare is powered by Claude AI, trained on SEC EDGAR filings through <strong style={{ color:"#6b7280" }}>early 2025</strong>. Reflects AI training knowledge — not live data scraping. Designed for research and comparative analysis.{" "}
          <strong style={{ color:"#6b7280" }}>Always verify at{" "}
            <a href="https://efts.sec.gov/LATEST/search-index?forms=10-K" target="_blank" rel="noopener noreferrer">SEC EDGAR</a>
          </strong>{" "}before investment decisions. Not financial advice.
        </div>
      </main>
    </>
  );
}
