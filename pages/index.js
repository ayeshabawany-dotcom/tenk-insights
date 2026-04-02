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
  { icon: "⚖️", title: "Side-by-Side Comparison", desc: "Any two companies. Any two fiscal years. Any of 16 note sections. Structured, institutional-grade output." },
  { icon: "🎭", title: "Disclosure Sentiment Scoring", desc: "Quantify the language of each filing. Surface hedging, caution, and red flags invisible to the naked eye." },
  { icon: "💬", title: "Natural Language Q&A", desc: "Interrogate the comparison directly. Answers grounded in the filing data — not generic knowledge." },
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
      <div style={{ flex:1, height:3, background:"linear-gradient(180deg, #f0f4f8 0%, #f5f6f8 100%)""#e2e8f0", borderRadius:100, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${(score/10)*100}%`, background:color, borderRadius:100, transition:"width 1s ease" }} />
      </div>
      <span style={{ fontSize:12, fontWeight:600, color, minWidth:32, textAlign:"right", fontFamily:"'Libre Baskerville',serif" }}>{score}<span style={{ fontSize:10, opacity:.5, fontWeight:400 }}>/10</span></span>
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
    if (s === "Positive") return "#6dbf9e";
    if (s === "Cautious")  return "#c4a35a";
    if (s === "Negative")  return "#c47a6d";
    return "#8fa3b8";
  };

  // Dynasty-inspired palette
  const NAVY    = "#ffffff";
  const NAVY2   = "#f8f9fa";
  const GOLD    = "#c4974a";  // muted champagne gold
  const GOLD2   = "#a87d3a";
  const STEEL   = "#f0f4f8";  // mid-navy for cards
  const BORDER  = "#dde1e7";
  const BORDER2 = "rgba(196,151,74,.6)"; // gold border
  const TEXT    = "#111827";  // warm white
  const MUTED   = "#6b7280";  // blue-grey
  const DIMMED  = "#374151";

  const inputBase = {
    width:"100%",
    background:"#ffffff",
    border:`1px solid ${BORDER}`,
    borderRadius:8,
    padding:"12px 16px",
    fontSize:14,
    fontFamily:"'Source Sans 3',sans-serif",
    color:TEXT,
    outline:"none",
    transition:"border-color .2s, box-shadow .2s",
  };

  const labelBase = {
    display:"block",
    fontFamily:"'Source Sans 3',sans-serif",
    fontSize:10,
    fontWeight:700,
    letterSpacing:"1.5px",
    textTransform:"uppercase",
    marginBottom:8,
    color:MUTED,
  };

  return (
    <>
      <Head>
        <title>10-K Compare — Institutional Filing Intelligence</title>
        <meta name="description" content="Side-by-side analysis of any 10-K note section. Institutional-grade. Seconds." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@300;400;600;700&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        html { scroll-behavior:smooth; }
        body {
          background:${NAVY};
          color:${TEXT};
          font-family:'Source Sans 3',sans-serif;
          min-height:100vh;
        }
        /* Subtle diagonal texture */
        body::before { display:none; }
        * { position:relative; z-index:1; }
        ::selection { background:rgba(196,151,74,.25); }
        input::placeholder, textarea::placeholder { color:rgba(143,163,184,.5); }
        input:focus, select:focus, textarea:focus {
          outline:none!important;
          border-color:${GOLD}!important;
          box-shadow:0 0 0 3px rgba(196,151,74,.15)!important;
        }
        select option { background:${NAVY2}; color:${TEXT}; }
        .btn { transition:all .2s cubic-bezier(.16,1,.3,1); cursor:pointer; border:none; font-family:'Source Sans 3',sans-serif; font-weight:600; }
        .btn:hover:not(:disabled) { transform:translateY(-2px); }
        .btn:active:not(:disabled) { transform:translateY(0); }
        .btn:disabled { opacity:.35; cursor:not-allowed; transform:none!important; }
        .chip:hover { border-color:${GOLD}!important; color:${GOLD}!important; }
        .chip { transition:all .18s; }
        .trow:hover > td { background:#f9fafb!important; }
        .feat-card:hover { border-color:#d97706!important; transform:translateY(-3px); }
        .feat-card { transition:all .2s; }

        @keyframes fadeUp   { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer  { 0%,100%{background-position:0% center} 50%{background-position:100% center} }
        @keyframes spin     { to{transform:rotate(360deg)} }
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes slideR   { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideL   { from{opacity:0;transform:translateX(8px)}  to{opacity:1;transform:translateX(0)} }
        @keyframes borderGlow { 0%,100%{border-color:rgba(196,151,74,.3)} 50%{border-color:rgba(196,151,74,.7)} }

        .fadeup { animation:fadeUp .55s cubic-bezier(.16,1,.3,1) forwards; opacity:0; }
        .d1{animation-delay:.07s}.d2{animation-delay:.14s}.d3{animation-delay:.21s}
        .d4{animation-delay:.28s}.d5{animation-delay:.35s}

        .gold-shimmer {
          background:linear-gradient(90deg,#b45309 0%,#d97706 30%,#b45309 55%,#92400e 80%,#b45309 100%);
          background-size:280% auto;
          -webkit-background-clip:text; -webkit-text-fill-color:transparent;
          background-clip:text; animation:shimmer 5s ease infinite;
        }
        .spin     { animation:spin 1s linear infinite; display:inline-block; }
        .pulse-dot{ animation:pulse 2s ease infinite; }

        /* Divider line with gold gradient */
        .gold-rule { height:1px; background:linear-gradient(90deg,transparent,${GOLD},transparent); border:none; margin:0; }

        .bubble-q {
          background:rgba(196,151,74,.12);
          border:1px solid rgba(196,151,74,.3);
          border-radius:12px 12px 3px 12px;
          padding:12px 16px; font-size:14px; color:#e8d5a8;
          line-height:1.65; animation:slideL .3s ease forwards;
        }
        .bubble-a {
          background:#f9fafb;
          border:1px solid ${BORDER};
          border-radius:3px 12px 12px 12px;
          padding:12px 16px; font-size:14px; color:${DIMMED};
          line-height:1.8; animation:slideR .3s ease .08s forwards; opacity:0;
        }

        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:2px; }
        table { border-collapse:collapse; width:100%; }
        th, td { vertical-align:top; }
        a { color:${GOLD}; text-decoration:none; }
        a:hover { color:#e8c87a; text-decoration:underline; }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={{ background:NAVY2, borderBottom:"1px solid #e2e8f0""1px solid #e2e8f0", padding:"0 40px", height:68, display:"flex", alignItems:"center", gap:16, position:"sticky", top:0, zIndex:50 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          {/* Wordmark */}
          <div style={{ borderRight:"1px solid #dde1e7", paddingRight:14, marginRight:2 }}>
            <div style={{ fontFamily:"'Libre Baskerville',serif", fontSize:18, fontWeight:700, color:TEXT, letterSpacing:"-.2px", lineHeight:1.1 }}>10-K Compare</div>
            <div style={{ fontSize:9, color:MUTED, letterSpacing:"2px", textTransform:"uppercase", marginTop:3 }}>Filing Intelligence</div>
          </div>
          <div style={{ width:6, height:6, borderRadius:"50%", background:GOLD, opacity:.7 }} />
        </div>

        <nav style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12 }}>
          {phase === "done" && result && (
            <>
              <button className="btn" onClick={runSentiment} disabled={sentPhase==="loading"} style={{ background:"transparent", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:6, padding:"7px 16px", fontSize:12, letterSpacing:".3px" }}>
                {sentPhase==="loading" ? <><span className="spin">⟳</span>&nbsp;Analyzing…</> : "Sentiment Analysis"}
              </button>
              <button className="btn" onClick={() => exportCSV(result.rows, result.meta)} style={{ background:"transparent", border:`1px solid ${BORDER2}`, color:GOLD, borderRadius:6, padding:"7px 16px", fontSize:12, letterSpacing:".3px" }}>
                Export CSV
              </button>
            </>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 12px", border:`1px solid rgba(196,151,74,.25)`, borderRadius:6 }}>
            <div className="pulse-dot" style={{ width:5, height:5, borderRadius:"50%", background:GOLD }} />
            <span style={{ fontSize:11, color:GOLD, letterSpacing:".5px", fontFamily:"'Source Sans 3',sans-serif", fontWeight:600 }}>LIVE</span>
          </div>
        </nav>
      </header>

      {/* ── HERO BAND ───────────────────────────────────────────────────────── */}
      {phase === "idle" && (
        <div style={{ background:`linear-gradient(180deg, ${NAVY2} 0%, ${NAVY} 100%)`, borderBottom:`1px solid #f0f4f8`, padding:"80px 40px 72px", textAlign:"center" }}>
          <div className="fadeup">
            {/* Category label */}
            <div style={{ display:"inline-flex", alignItems:"center", gap:10, marginBottom:28 }}>
              <hr className="gold-rule" style={{ width:40 }} />
              <span style={{ fontSize:10, color:GOLD, letterSpacing:"3px", textTransform:"uppercase", fontFamily:"'Source Sans 3',sans-serif", fontWeight:700 }}>
                SEC 10-K Filing Intelligence
              </span>
              <hr className="gold-rule" style={{ width:40 }} />
            </div>

            {/* Headline */}
            <h1 style={{ fontFamily:"'Libre Baskerville',serif", fontSize:"clamp(36px,5.5vw,68px)", fontWeight:700, color:TEXT, lineHeight:1.12, marginBottom:20, letterSpacing:"-1px" }}>
              The footnotes tell<br />
              <span className="gold-shimmer">the real story.</span>
            </h1>

            {/* Subhead */}
            <p style={{ fontSize:18, color:DIMMED, lineHeight:1.8, maxWidth:580, margin:"0 auto 14px", fontWeight:300, fontFamily:"'Libre Baskerville',serif", fontStyle:"italic" }}>
              Every 10-K contains disclosures analysts spend days manually comparing.
            </p>
            <p style={{ fontSize:15, color:MUTED, lineHeight:1.75, maxWidth:500, margin:"0 auto 40px", fontFamily:"'Source Sans 3',sans-serif", fontWeight:400 }}>
              Select two companies, any fiscal year, any note section — and receive a structured, side-by-side analysis in seconds. With sentiment scoring, CSV export, and AI-powered Q&A.
            </p>

            {/* Stats */}
            <div style={{ display:"inline-flex", alignItems:"center", gap:0, border:`1px solid ${BORDER}`, borderRadius:8, overflow:"hidden", marginBottom:44 }}>
              {[
                { val:"16", label:"Note Categories" },
                { val:"10", label:"Fiscal Years"    },
                { val:"3",  label:"Analysis Modes"  },
              ].map((s,i) => (
                <div key={i} style={{ padding:"14px 30px", borderRight:i<2?`1px solid ${BORDER}`:"none", textAlign:"center", background:"#ffffff" }}>
                  <div style={{ fontFamily:"'Libre Baskerville',serif", fontSize:26, fontWeight:700, color:GOLD, lineHeight:1 }}>{s.val}</div>
                  <div style={{ fontSize:9, color:MUTED, textTransform:"uppercase", letterSpacing:"1.5px", marginTop:5, fontWeight:700 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Example chips */}
            <div>
              <div style={{ fontSize:9, color:MUTED, textTransform:"uppercase", letterSpacing:"2px", fontWeight:700, marginBottom:12 }}>
                Load a live example
              </div>
              <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
                {EXAMPLE_PAIRS.map((ex,i) => (
                  <button key={i} className="chip btn" onClick={() => loadExample(ex)} style={{ background:"transparent", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:6, padding:"8px 16px", fontSize:12, lineHeight:1.5 }}>
                    <span style={{ color:GOLD, fontWeight:700 }}>{ex.a} {ex.ya}</span>
                    <span style={{ color:"#cbd5e1", margin:"0 7px" }}>vs</span>
                    <span style={{ color:"#7aabcf", fontWeight:700 }}>{ex.b} {ex.yb}</span>
                    <span style={{ display:"block", fontSize:10, color:"rgba(143,163,184,.5)", marginTop:2 }}>{ex.note}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <main style={{ maxWidth:980, margin:"0 auto", padding:"44px 24px 100px" }}>

        {/* ── FEATURE CARDS ─────────────────────────────────────────────────── */}
        {phase === "idle" && (
          <div className="fadeup d2" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:1, marginBottom:40, border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden" }}>
            {FEATURES.map((f,i) => (
              <div key={i} className="feat-card" style={{ background:"#f8f9fa", padding:"28px 24px", borderRight:i<2?`1px solid ${BORDER}`:"none" }}>
                <div style={{ fontSize:22, marginBottom:14 }}>{f.icon}</div>
                <div style={{ fontFamily:"'Libre Baskerville',serif", fontSize:16, fontWeight:700, color:TEXT, marginBottom:8, lineHeight:1.35 }}>{f.title}</div>
                <div style={{ fontSize:13, color:MUTED, lineHeight:1.78 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── INPUT PANEL ──────────────────────────────────────────────────── */}
        <div className={phase==="idle" ? "fadeup d3" : ""} style={{ background:STEEL, border:`1px solid ${BORDER}`, borderRadius:12, padding:32, marginBottom:24 }}>

          {phase === "idle" && (
            <div style={{ marginBottom:24, paddingBottom:20, borderBottom:`1px solid ${BORDER}` }}>
              <div style={{ fontFamily:"'Libre Baskerville',serif", fontSize:20, fontWeight:700, color:TEXT, marginBottom:4 }}>Build your comparison</div>
              <div style={{ fontSize:13, color:MUTED }}>Select two companies, their fiscal years, and the note section to compare.</div>
            </div>
          )}

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>

            {/* Company A */}
            <div style={{ background:"#fffbeb", border:`1px solid rgba(196,151,74,.22)`, borderTop:`2px solid ${GOLD}`, borderRadius:10, padding:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                <div style={{ width:28, height:28, borderRadius:6, border:`1px solid rgba(196,151,74,.4)`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Libre Baskerville',serif", fontSize:14, fontWeight:700, color:GOLD }}>A</div>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:GOLD, textTransform:"uppercase", letterSpacing:"1.5px" }}>Company A</div>
                  <div style={{ fontSize:10, color:"rgba(196,151,74,.5)", marginTop:1 }}>First filing</div>
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={{ ...labelBase, color:"rgba(196,151,74,.6)" }}>Company name or ticker</label>
                <input value={companyA} onChange={e => setCompanyA(e.target.value)} placeholder="e.g. Meta, Goldman Sachs, AAPL" style={{ ...inputBase, borderColor:"rgba(196,151,74,.25)" }} />
              </div>
              <div>
                <label style={{ ...labelBase, color:"rgba(196,151,74,.6)" }}>Fiscal Year</label>
                <select value={yearA} onChange={e => setYearA(e.target.value)} style={{ ...inputBase, borderColor:"rgba(196,151,74,.25)", cursor:"pointer" }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            {/* Company B */}
            <div style={{ background:"#eff6ff", border:"1px solid rgba(122,171,207,.22)", borderTop:"2px solid #7aabcf", borderRadius:10, padding:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                <div style={{ width:28, height:28, borderRadius:6, border:"1px solid rgba(122,171,207,.4)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Libre Baskerville',serif", fontSize:14, fontWeight:700, color:"#7aabcf" }}>B</div>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:"#7aabcf", textTransform:"uppercase", letterSpacing:"1.5px" }}>Company B</div>
                  <div style={{ fontSize:10, color:"rgba(122,171,207,.5)", marginTop:1 }}>Second filing</div>
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={{ ...labelBase, color:"rgba(122,171,207,.6)" }}>Company name or ticker</label>
                <input value={companyB} onChange={e => setCompanyB(e.target.value)} placeholder="e.g. Alphabet, JPMorgan, MSFT" style={{ ...inputBase, borderColor:"rgba(122,171,207,.25)" }} />
              </div>
              <div>
                <label style={{ ...labelBase, color:"rgba(122,171,207,.6)" }}>Fiscal Year</label>
                <select value={yearB} onChange={e => setYearB(e.target.value)} style={{ ...inputBase, borderColor:"rgba(122,171,207,.25)", cursor:"pointer" }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Note section */}
          <div style={{ marginBottom:24 }}>
            <label style={{ ...labelBase }}>Note section <span style={{ color:"rgba(143,163,184,.4)", textTransform:"none", letterSpacing:0, fontWeight:400, fontSize:11 }}>— 16 categories</span></label>
            <select value={note} onChange={e => setNote(e.target.value)} style={{ ...inputBase, cursor:"pointer" }}>
              <option value="">— Select the note section to compare —</option>
              {NOTE_SECTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* CTA */}
          <button className="btn" onClick={compare} disabled={phase==="loading"||!companyA.trim()||!companyB.trim()||!note} style={{
            width:"100%",
            background: phase==="loading" ? "#f9fafb" : `linear-gradient(135deg, ${GOLD} 0%, ${GOLD2} 100%)`,
            color: phase==="loading" ? MUTED : NAVY,
            borderRadius:8, padding:"15px 0", fontSize:15,
            fontWeight:700, letterSpacing:".5px",
            boxShadow: phase!=="loading" ? "0 4px 24px rgba(196,151,74,.25)" : "none",
          }}>
            {phase==="loading"
              ? <><span className="spin" style={{ marginRight:10 }}>⟳</span>Analyzing — typically 15 seconds…</>
              : "Run Comparison →"}
          </button>

          {phase === "idle" && (
            <p style={{ textAlign:"center", marginTop:12, fontSize:12, color:"rgba(143,163,184,.4)", letterSpacing:".3px" }}>
              Any US-listed public company · Results in approximately 15 seconds
            </p>
          )}
        </div>

        {/* ── ERROR ────────────────────────────────────────────────────────── */}
        {phase === "error" && (
          <div className="fadeup" style={{ background:"rgba(196,80,70,.08)", border:"1px solid rgba(196,80,70,.25)", borderLeft:"3px solid #c45046", borderRadius:10, padding:"18px 22px", marginBottom:20, display:"flex", gap:14 }}>
            <span style={{ fontSize:18, flexShrink:0 }}>⚠</span>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"#e8938d", marginBottom:4 }}>An error occurred</div>
              <div style={{ fontSize:13, color:"rgba(232,147,141,.7)", lineHeight:1.6 }}>{errMsg}</div>
              <button className="btn" onClick={() => setPhase("idle")} style={{ marginTop:10, background:"transparent", border:"1px solid rgba(196,80,70,.3)", color:"#e8938d", borderRadius:6, padding:"5px 14px", fontSize:12 }}>← Try again</button>
            </div>
          </div>
        )}

        {/* ── RESULTS ──────────────────────────────────────────────────────── */}
        {phase === "done" && result && (
          <div>
            {/* Result header */}
            <div className="fadeup" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:14, marginBottom:28 }}>
              <div>
                <div style={{ fontFamily:"'Libre Baskerville',serif", fontSize:28, fontWeight:700, color:TEXT, letterSpacing:"-.5px", lineHeight:1.15 }}>
                  <span style={{ color:GOLD }}>{result.meta.companyA}</span>
                  <span style={{ fontStyle:"italic", fontWeight:400, color:MUTED, margin:"0 16px", fontSize:20 }}>versus</span>
                  <span style={{ color:"#7aabcf" }}>{result.meta.companyB}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10, flexWrap:"wrap" }}>
                  <span style={{ border:`1px solid rgba(196,151,74,.35)`, color:GOLD, padding:"2px 10px", borderRadius:4, fontSize:11, fontWeight:700, letterSpacing:".5px" }}>FY {result.meta.yearA}</span>
                  <span style={{ color:MUTED, fontSize:11 }}>vs</span>
                  <span style={{ border:"1px solid rgba(122,171,207,.35)", color:"#7aabcf", padding:"2px 10px", borderRadius:4, fontSize:11, fontWeight:700, letterSpacing:".5px" }}>FY {result.meta.yearB}</span>
                  <span style={{ color:BORDER }}>·</span>
                  <span style={{ color:MUTED, fontSize:13, fontStyle:"italic", fontFamily:"'Libre Baskerville',serif" }}>{result.meta.note}</span>
                </div>
              </div>
              <button className="btn" onClick={() => { setPhase("idle"); setResult(null); setSentiment(null); setQaHistory([]); }} style={{ background:"transparent", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:6, padding:"8px 16px", fontSize:12 }}>
                ← New comparison
              </button>
            </div>

            {/* Real filing source badge */}
            <div className="fadeup" style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:10, marginBottom:18 }}>
              <div style={{ display:"inline-flex", alignItems:"center", gap:7, background:"#f0fdf4", border:"1px solid rgba(109,191,158,.25)", borderRadius:6, padding:"5px 12px" }}>
                <span style={{ color:"#6dbf9e", fontSize:14 }}>✓</span>
                <span style={{ fontSize:11, color:"#6dbf9e", fontWeight:700, letterSpacing:".5px" }}>From actual SEC EDGAR filings</span>
              </div>
              {result.sourceA && (
                <a href={result.sourceA} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:"rgba(196,151,74,.7)", border:"1px solid rgba(196,151,74,.2)", borderRadius:5, padding:"4px 10px" }}>
                  {result.meta?.companyA} filing ↗
                </a>
              )}
              {result.sourceB && (
                <a href={result.sourceB} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:"rgba(122,171,207,.7)", border:"1px solid rgba(122,171,207,.2)", borderRadius:5, padding:"4px 10px" }}>
                  {result.meta?.companyB} filing ↗
                </a>
              )}
            </div>
            {result.sourceNote && (
              <div style={{ background:"#fffbeb", border:"1px solid rgba(196,151,74,.18)", borderRadius:8, padding:"10px 16px", marginBottom:14, fontSize:12, color:"rgba(196,151,74,.8)", lineHeight:1.6 }}>
                ⚠ {result.sourceNote}
              </div>
            )}

            {/* Key Insight */}
            {result.keyInsight && (
              <div className="fadeup d1" style={{ background:"#fef9ec", border:`1px solid rgba(196,151,74,.2)`, borderLeft:`3px solid ${GOLD}`, borderRadius:10, padding:"16px 22px", marginBottom:20, display:"flex", gap:14 }}>
                <span style={{ fontSize:18, flexShrink:0, color:GOLD }}>◈</span>
                <div>
                  <div style={{ fontSize:9, color:"rgba(196,151,74,.6)", fontWeight:700, textTransform:"uppercase", letterSpacing:"2px", marginBottom:6 }}>Key Insight</div>
                  <div style={{ fontSize:14, color:"#92400e", lineHeight:1.72 }}>{result.keyInsight}</div>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="fadeup d2" style={{ borderRadius:10, overflow:"hidden", border:`1px solid ${BORDER}`, marginBottom:20 }}>
              <div style={{ overflowX:"auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ background:STEEL, padding:"13px 20px", textAlign:"left", fontSize:9, color:MUTED, fontWeight:700, textTransform:"uppercase", letterSpacing:"1.5px", borderBottom:`1px solid ${BORDER}`, width:"24%" }}>Disclosure</th>
                      <th style={{ background:"rgba(196,151,74,.08)", borderTop:`2px solid ${GOLD}`, padding:"13px 20px", textAlign:"left", fontSize:9, color:GOLD, fontWeight:700, textTransform:"uppercase", letterSpacing:"1.5px", borderBottom:`1px solid ${BORDER}` }}>
                        {result.meta.companyA} · FY{result.meta.yearA}
                      </th>
                      <th style={{ background:"rgba(122,171,207,.08)", borderTop:"2px solid #7aabcf", padding:"13px 20px", textAlign:"left", fontSize:9, color:"#7aabcf", fontWeight:700, textTransform:"uppercase", letterSpacing:"1.5px", borderBottom:`1px solid ${BORDER}` }}>
                        {result.meta.companyB} · FY{result.meta.yearB}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row,i) => (
                      <tr key={i} className="trow">
                        <td style={{ padding:"13px 20px", fontSize:12, fontWeight:600, color:MUTED, fontStyle:"italic", fontFamily:"'Libre Baskerville',serif", borderBottom:i<result.rows.length-1?"1px solid #f0f0f0"`1px solid #f9fafb`:"none", background:"#fafafa" }}>{row.dimension}</td>
                        <td style={{ padding:"13px 20px", fontSize:13, color:TEXT, lineHeight:1.72, borderBottom:i<result.rows.length-1?"1px solid #f0f0f0"`1px solid #f9fafb`:"none", borderLeft:`1px solid rgba(196,151,74,.08)`, background:i%2===0?"#fffdf7":"#ffffff" }}>{row.a}</td>
                        <td style={{ padding:"13px 20px", fontSize:13, color:TEXT, lineHeight:1.72, borderBottom:i<result.rows.length-1?"1px solid #f0f0f0"`1px solid #f9fafb`:"none", borderLeft:"1px solid rgba(122,171,207,.08)", background:i%2===0?"#f5f9ff":"#ffffff" }}>{row.b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary */}
            {result.summary && (
              <div className="fadeup d3" style={{ background:"#f9fafb", border:`1px solid ${BORDER}`, borderLeft:"3px solid rgba(122,171,207,.5)", borderRadius:10, padding:"18px 22px", marginBottom:20 }}>
                <div style={{ fontSize:9, color:MUTED, fontWeight:700, textTransform:"uppercase", letterSpacing:"2px", marginBottom:10 }}>Analyst Summary</div>
                <p style={{ fontSize:14, color:DIMMED, lineHeight:1.9, fontFamily:"'Libre Baskerville',serif" }}>{result.summary}</p>
              </div>
            )}

            {/* Actions */}
            <div className="fadeup d4" style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:24 }}>
              <button className="btn" onClick={() => exportCSV(result.rows, result.meta)} style={{ background:"transparent", border:`1px solid ${BORDER2}`, color:GOLD, borderRadius:7, padding:"10px 20px", fontSize:13 }}>
                ↓ Download for Excel
              </button>
              <button className="btn" onClick={runSentiment} disabled={sentPhase==="loading"} style={{ background:"transparent", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"10px 20px", fontSize:13 }}>
                {sentPhase==="loading" ? <><span className="spin">⟳</span>&nbsp;Scoring…</> : "Score the Tone"}
              </button>
              <button className="btn" onClick={() => setQaOpen(!qaOpen)} style={{ background:qaOpen?"rgba(196,151,74,.1)":"transparent", border:`1px solid ${qaOpen?BORDER2:BORDER}`, color:qaOpen?GOLD:MUTED, borderRadius:7, padding:"10px 20px", fontSize:13 }}>
                {qaOpen ? "Close Q&A" : "Ask the Data"}
              </button>
            </div>

            {/* Sentiment */}
            {sentPhase==="done" && sentiment && (
              <div className="fadeup" style={{ background:STEEL, border:`1px solid ${BORDER}`, borderRadius:12, padding:24, marginBottom:20 }}>
                <div style={{ fontSize:9, color:MUTED, fontWeight:700, textTransform:"uppercase", letterSpacing:"2px", marginBottom:20 }}>Tone & Language Analysis</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
                  {[
                    { company:result.meta.companyA, year:result.meta.yearA, overall:sentiment.overallA, score:Number(sentiment.scoreA), summary:sentiment.summaryA, color:GOLD, border:"rgba(196,151,74,.2)" },
                    { company:result.meta.companyB, year:result.meta.yearB, overall:sentiment.overallB, score:Number(sentiment.scoreB), summary:sentiment.summaryB, color:"#7aabcf", border:"rgba(122,171,207,.2)" },
                  ].map((s,i) => (
                    <div key={i} style={{ background:"#f9fafb", border:"1px solid #e2e8f0"`1px solid ${s.border}`, borderRadius:10, padding:18 }}>
                      <div style={{ fontSize:11, color:s.color, fontWeight:700, marginBottom:12, letterSpacing:".5px" }}>{s.company} · FY{s.year}</div>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                        <span style={{ border:`1px solid ${sentimentColor(s.overall)}50`, color:sentimentColor(s.overall), borderRadius:4, padding:"2px 10px", fontSize:11, fontWeight:700, letterSpacing:".5px" }}>{s.overall}</span>
                      </div>
                      <ScoreBar score={s.score} color={s.color} />
                      <p style={{ marginTop:12, fontSize:13, color:DIMMED, lineHeight:1.72 }}>{s.summary}</p>
                    </div>
                  ))}
                </div>
                {sentiment.comparison && (
                  <p style={{ fontSize:13, color:DIMMED, lineHeight:1.8, marginBottom:sentiment.redflags&&sentiment.redflags!=="null"&&sentiment.redflags!=="None identified"?14:0 }}>
                    <span style={{ fontSize:9, color:MUTED, fontWeight:700, textTransform:"uppercase", letterSpacing:"1.5px", marginRight:8 }}>Comparison:</span>
                    {sentiment.comparison}
                  </p>
                )}
                {sentiment.redflags && sentiment.redflags!=="null" && sentiment.redflags!=="None identified" && (
                  <div style={{ background:"rgba(196,80,70,.07)", border:"1px solid rgba(196,80,70,.2)", borderLeft:"3px solid #c45046", borderRadius:7, padding:"12px 16px", fontSize:13, color:"#e8938d", lineHeight:1.65, marginTop:6 }}>
                    ⚑ <strong>Red flags:</strong> {sentiment.redflags}
                  </div>
                )}
              </div>
            )}

            {/* Q&A */}
            {qaOpen && (
              <div className="fadeup" style={{ background:STEEL, border:`1px solid ${BORDER}`, borderRadius:12, padding:24, marginBottom:20 }}>
                <div style={{ fontSize:9, color:MUTED, fontWeight:700, textTransform:"uppercase", letterSpacing:"2px", marginBottom:6 }}>Interrogate the Data</div>
                <div style={{ fontSize:13, color:MUTED, marginBottom:20 }}>Ask anything about this comparison. Answers are grounded in the filing data.</div>
                {qaHistory.length > 0 && (
                  <div style={{ display:"flex", flexDirection:"column", gap:14, marginBottom:20 }}>
                    {qaHistory.map((item,i) => (
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
                  <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key==="Enter"&&qaPhase!=="loading"&&askQuestion()} placeholder="e.g. Which company carries more concentration risk?" disabled={qaPhase==="loading"} style={{ ...inputBase, flex:1, borderColor:"rgba(196,151,74,.2)" }} />
                  <button className="btn" onClick={askQuestion} disabled={qaPhase==="loading"||!question.trim()} style={{ background:qaPhase==="loading"?"rgba(196,151,74,.1)":`linear-gradient(135deg,${GOLD},${GOLD2})`, color:qaPhase==="loading"?GOLD:NAVY, borderRadius:8, padding:"11px 20px", fontSize:13, flexShrink:0 }}>
                    {qaPhase==="loading" ? <span className="spin">⟳</span> : "Ask"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <hr className="gold-rule" style={{ marginBottom:20 }} />
        <p style={{ fontSize:11, color:"rgba(143,163,184,.4)", lineHeight:1.85, textAlign:"center", letterSpacing:".2px" }}>
          10-K Compare fetches and parses actual 10-K filings directly from <a href="https://www.sec.gov/edgar/search/" target="_blank" rel="noopener noreferrer" style={{ color:"rgba(196,151,74,.5)" }}>SEC EDGAR</a>.
          Claude AI reads the real filing text — it does not rely on training data recall.
          Always review the original filing before making investment or business decisions. Not financial advice.
        </p>
      </main>
    </>
  );
}
