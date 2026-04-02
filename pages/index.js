import { useState } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────
const YEARS = Array.from({ length: 11 }, (_, i) => String(2024 - i)); // 2024 down to 2014

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
  const csv = header + "\n" + body;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${meta.companyA}_vs_${meta.companyB}_${meta.note}_${meta.yearA}_${meta.yearB}.csv`.replace(/\s+/g, "_");
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Home() {
  const [companyA, setCompanyA] = useState("");
  const [yearA, setYearA]       = useState("2023");
  const [companyB, setCompanyB] = useState("");
  const [yearB, setYearB]       = useState("2023");
  const [note, setNote]         = useState("");
  const [phase, setPhase]       = useState("idle"); // idle | loading | done | error
  const [errMsg, setErrMsg]     = useState("");
  const [result, setResult]     = useState(null);

  // Sentiment state
  const [sentPhase, setSentPhase] = useState("idle"); // idle | loading | done
  const [sentiment, setSentiment] = useState(null);

  // Q&A state
  const [qaOpen, setQaOpen]   = useState(false);
  const [question, setQuestion] = useState("");
  const [qaPhase, setQaPhase] = useState("idle");
  const [qaHistory, setQaHistory] = useState([]); // [{q, a}]

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
      setResult(data);
      setPhase("done");
    } catch (e) {
      setErrMsg(e.message); setPhase("error");
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
      setSentiment(data.sentiment); setSentPhase("done");
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
      setQaHistory(prev => [...prev, { q, a: "Sorry, something went wrong. Try again." }]);
      setQaPhase("idle");
    }
  }

  function loadExample(ex) {
    setCompanyA(ex.a); setYearA(ex.ya);
    setCompanyB(ex.b); setYearB(ex.yb);
    setNote(ex.note);
  }

  const gold = "#d4af37";
  const green = "#3cb878";

  const sentColor = (s) => {
    if (!s) return gold;
    if (s === "Positive") return "#3cb878";
    if (s === "Cautious" || s === "Negative") return "#e07070";
    return gold;
  };

  const inputStyle = {
    width: "100%", background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(212,175,55,.25)", borderRadius: 9,
    padding: "11px 14px", fontSize: 14, fontFamily: "sans-serif",
    color: "#f5ecd5", outline: "none",
  };

  const labelStyle = {
    fontFamily: "sans-serif", fontSize: 11, color: "#4a6878",
    textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 6, display: "block",
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080e1a; color: #ddd5c0; font-family: Georgia, serif; }
        ::selection { background: rgba(212,175,55,.25); }
        input::placeholder, textarea::placeholder { color: #2e4455; }
        input:focus, select:focus, textarea:focus { outline: none; border-color: rgba(212,175,55,.65) !important; box-shadow: 0 0 0 3px rgba(212,175,55,.1) !important; }
        select option { background: #0d1826; color: #ddd5c0; }
        .btn { transition: all .15s; cursor: pointer; border: none; font-family: sans-serif; font-weight: 700; }
        .btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
        .btn:disabled { opacity: .5; cursor: not-allowed; }
        .chip { transition: all .15s; cursor: pointer; }
        .chip:hover { background: rgba(212,175,55,.18) !important; }
        .trow:hover td { background: rgba(212,175,55,.04) !important; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shimmer { 0%,100%{background-position:0% center} 50%{background-position:100% center} }
        @keyframes spin { to { transform: rotate(360deg); } }
        .fadeup { animation: fadeUp .4s ease forwards; }
        .d1{animation-delay:.06s}.d2{animation-delay:.12s}.d3{animation-delay:.18s}.d4{animation-delay:.24s}
        .shimmer-title { background: linear-gradient(90deg,#d4af37,#f5e070,#d4af37,#b8922a,#d4af37); background-size:300% auto; -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; animation:shimmer 3s ease infinite; }
        .spin { animation: spin 1s linear infinite; display: inline-block; }
        a { color: #d4af37; text-decoration: none; }
        a:hover { text-decoration: underline; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(212,175,55,.2); border-radius: 2px; }
      `}</style>

      {/* Header */}
      <header style={{ borderBottom: "1px solid rgba(212,175,55,.12)", padding: "16px 28px", display: "flex", alignItems: "center", gap: 14, position: "sticky", top: 0, zIndex: 10, background: "rgba(8,14,26,.95)", backdropFilter: "blur(12px)" }}>
        <div style={{ width: 36, height: 36, background: "linear-gradient(135deg,#d4af37,#f5e070)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 2px 12px rgba(212,175,55,.3)" }}>📊</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#f5ecd5", letterSpacing: "-.3px" }}>10-K Compare</div>
          <div style={{ fontFamily: "sans-serif", fontSize: 10, color: "#3a5868", letterSpacing: ".8px", textTransform: "uppercase", marginTop: 1 }}>SEC Filing Note Comparison · AI-Powered</div>
        </div>
        {phase === "done" && result && (
          <button className="btn" onClick={() => exportCSV(result.rows, result.meta)}
            style={{ marginLeft: "auto", background: "rgba(212,175,55,.1)", border: "1px solid rgba(212,175,55,.25)", color: gold, borderRadius: 8, padding: "7px 16px", fontSize: 12 }}>
            ⬇ Export CSV
          </button>
        )}
      </header>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "36px 20px 100px" }}>

        {/* Hero */}
        {phase === "idle" && (
          <div className="fadeup" style={{ textAlign: "center", marginBottom: 36 }}>
            <h1 style={{ fontSize: "clamp(26px,5vw,48px)", fontWeight: 700, color: "#f5ecd5", lineHeight: 1.15, marginBottom: 12, letterSpacing: "-1px" }}>
              Compare any two<br /><span className="shimmer-title">10-K disclosures</span>
            </h1>
            <p style={{ fontFamily: "sans-serif", fontSize: 15, color: "#4a6878", lineHeight: 1.8, maxWidth: 520, margin: "0 auto 24px" }}>
              Pick two companies, two years, and a note section. Get a side-by-side breakdown in seconds — then export, analyze sentiment, or ask questions in plain English.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {EXAMPLE_PAIRS.map((ex, i) => (
                <button key={i} className="chip btn" onClick={() => loadExample(ex)}
                  style={{ background: "rgba(212,175,55,.07)", border: "1px solid rgba(212,175,55,.18)", color: "#9a8040", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontFamily: "sans-serif", fontWeight: 600 }}>
                  {ex.a} vs {ex.b} · {ex.note}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Panel */}
        <div className={phase === "idle" ? "fadeup d2" : ""} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(212,175,55,.2)", borderRadius: 18, padding: 24, marginBottom: 28 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

            {/* Company A */}
            <div style={{ background: "rgba(212,175,55,.05)", border: "1px solid rgba(212,175,55,.15)", borderRadius: 12, padding: 18 }}>
              <div style={{ fontFamily: "sans-serif", fontSize: 11, color: gold, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 14, fontWeight: 700 }}>Company A</div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Company name or ticker</label>
                <input value={companyA} onChange={e => setCompanyA(e.target.value)} placeholder="e.g. Meta, AAPL, SoundHound AI" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Fiscal Year</label>
                <select value={yearA} onChange={e => setYearA(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            {/* Company B */}
            <div style={{ background: "rgba(100,149,237,.05)", border: "1px solid rgba(100,149,237,.15)", borderRadius: 12, padding: 18 }}>
              <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#6495ed", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 14, fontWeight: 700 }}>Company B</div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ ...labelStyle, color: "#4a6898" }}>Company name or ticker</label>
                <input value={companyB} onChange={e => setCompanyB(e.target.value)} placeholder="e.g. Alphabet, MSFT, Visa" style={{ ...inputStyle, border: "1px solid rgba(100,149,237,.25)" }} />
              </div>
              <div>
                <label style={{ ...labelStyle, color: "#4a6898" }}>Fiscal Year</label>
                <select value={yearB} onChange={e => setYearB(e.target.value)} style={{ ...inputStyle, border: "1px solid rgba(100,149,237,.25)", cursor: "pointer" }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Note Section */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>10-K Note Section to Compare</label>
            <select value={note} onChange={e => setNote(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">— Select a note section —</option>
              {NOTE_SECTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <button className="btn" onClick={compare} disabled={phase === "loading" || !companyA.trim() || !companyB.trim() || !note}
            style={{ width: "100%", background: phase === "loading" ? "rgba(212,175,55,.2)" : "linear-gradient(135deg,#d4af37,#c49a20)", color: phase === "loading" ? "#6a5020" : "#080e1a", borderRadius: 11, padding: "14px 0", fontSize: 16, fontWeight: 800, boxShadow: phase !== "loading" ? "0 4px 20px rgba(212,175,55,.2)" : "none" }}>
            {phase === "loading" ? <><span className="spin">⟳</span> &nbsp;Analyzing filings…</> : "Compare 10-K Notes →"}
          </button>
        </div>

        {/* Error */}
        {phase === "error" && (
          <div className="fadeup" style={{ background: "rgba(220,60,60,.07)", border: "1px solid rgba(220,60,60,.25)", borderRadius: 14, padding: "18px 22px", fontFamily: "sans-serif", fontSize: 13, color: "#e08080", marginBottom: 20 }}>
            ⚠️ {errMsg}
            <button className="btn" onClick={() => setPhase("idle")} style={{ marginLeft: 16, background: "transparent", border: "1px solid rgba(220,60,60,.3)", color: "#e08080", borderRadius: 6, padding: "4px 12px", fontSize: 12 }}>Try again</button>
          </div>
        )}

        {/* Results */}
        {phase === "done" && result && (
          <div>
            {/* Result header */}
            <div className="fadeup" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#f5ecd5", marginBottom: 4 }}>
                  {result.meta.companyA} <span style={{ color: "#2e4455" }}>vs</span> {result.meta.companyB}
                </div>
                <div style={{ fontFamily: "sans-serif", fontSize: 13, color: "#4a6878" }}>
                  <span style={{ background: "rgba(212,175,55,.15)", color: gold, padding: "2px 8px", borderRadius: 4, fontWeight: 700, marginRight: 8 }}>{result.meta.yearA}</span>
                  vs
                  <span style={{ background: "rgba(100,149,237,.15)", color: "#6495ed", padding: "2px 8px", borderRadius: 4, fontWeight: 700, margin: "0 8px" }}>{result.meta.yearB}</span>
                  · {result.meta.note}
                </div>
              </div>
              <button className="btn" onClick={() => { setPhase("idle"); setResult(null); setSentiment(null); setQaHistory([]); }}
                style={{ background: "transparent", border: "1px solid rgba(212,175,55,.2)", color: "#8a7540", borderRadius: 8, padding: "7px 14px", fontSize: 12 }}>
                ← New comparison
              </button>
            </div>

            {/* Key insight */}
            {result.keyInsight && (
              <div className="fadeup d1" style={{ background: "rgba(212,175,55,.08)", border: "1px solid rgba(212,175,55,.2)", borderRadius: 12, padding: "14px 18px", marginBottom: 20, fontFamily: "sans-serif", fontSize: 14, color: "#c4a030", lineHeight: 1.6 }}>
                💡 <strong>Key insight:</strong> {result.keyInsight}
              </div>
            )}

            {/* Comparison table */}
            <div className="fadeup d2" style={{ overflowX: "auto", marginBottom: 20, borderRadius: 14, border: "1px solid rgba(255,255,255,.07)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ background: "rgba(255,255,255,.04)", padding: "12px 18px", textAlign: "left", fontFamily: "sans-serif", fontSize: 11, color: "#4a6878", textTransform: "uppercase", letterSpacing: ".8px", borderBottom: "1px solid rgba(255,255,255,.07)", width: "28%" }}>
                      Disclosure / Dimension
                    </th>
                    <th style={{ background: "rgba(212,175,55,.07)", padding: "12px 18px", textAlign: "left", fontFamily: "sans-serif", fontSize: 11, color: gold, textTransform: "uppercase", letterSpacing: ".8px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                      {result.meta.companyA} · {result.meta.yearA}
                    </th>
                    <th style={{ background: "rgba(100,149,237,.07)", padding: "12px 18px", textAlign: "left", fontFamily: "sans-serif", fontSize: 11, color: "#6495ed", textTransform: "uppercase", letterSpacing: ".8px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                      {result.meta.companyB} · {result.meta.yearB}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="trow">
                      <td style={{ padding: "13px 18px", fontFamily: "sans-serif", fontSize: 13, fontWeight: 600, color: "#8aacb8", borderBottom: "1px solid rgba(255,255,255,.04)", verticalAlign: "top", background: i % 2 === 0 ? "rgba(255,255,255,.015)" : "transparent" }}>
                        {row.dimension}
                      </td>
                      <td style={{ padding: "13px 18px", fontFamily: "sans-serif", fontSize: 13, color: "#c8d8e0", lineHeight: 1.6, borderBottom: "1px solid rgba(255,255,255,.04)", verticalAlign: "top", background: i % 2 === 0 ? "rgba(212,175,55,.02)" : "transparent" }}>
                        {row.a}
                      </td>
                      <td style={{ padding: "13px 18px", fontFamily: "sans-serif", fontSize: 13, color: "#c8d8e0", lineHeight: 1.6, borderBottom: "1px solid rgba(255,255,255,.04)", verticalAlign: "top", background: i % 2 === 0 ? "rgba(100,149,237,.02)" : "transparent" }}>
                        {row.b}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary */}
            {result.summary && (
              <div className="fadeup d3" style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)", borderLeft: "3px solid rgba(212,175,55,.4)", borderRadius: 12, padding: "18px 22px", marginBottom: 20, fontFamily: "sans-serif", fontSize: 14, color: "#8aacb8", lineHeight: 1.78 }}>
                <div style={{ fontSize: 12, color: "#4a6878", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 }}>Analyst Summary</div>
                {result.summary}
              </div>
            )}

            {/* Action bar */}
            <div className="fadeup d4" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
              <button className="btn" onClick={() => exportCSV(result.rows, result.meta)}
                style={{ background: "rgba(212,175,55,.1)", border: "1px solid rgba(212,175,55,.25)", color: gold, borderRadius: 9, padding: "10px 18px", fontSize: 13 }}>
                ⬇ Export to CSV
              </button>
              <button className="btn" onClick={runSentiment} disabled={sentPhase === "loading"}
                style={{ background: "rgba(100,149,237,.1)", border: "1px solid rgba(100,149,237,.25)", color: "#6495ed", borderRadius: 9, padding: "10px 18px", fontSize: 13 }}>
                {sentPhase === "loading" ? <><span className="spin">⟳</span> Analyzing…</> : "🎭 Sentiment Analysis"}
              </button>
              <button className="btn" onClick={() => setQaOpen(!qaOpen)}
                style={{ background: qaOpen ? "rgba(60,184,120,.15)" : "rgba(60,184,120,.08)", border: "1px solid rgba(60,184,120,.25)", color: green, borderRadius: 9, padding: "10px 18px", fontSize: 13 }}>
                💬 Ask a Question
              </button>
            </div>

            {/* Sentiment Results */}
            {sentPhase === "done" && sentiment && (
              <div className="fadeup" style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 14, padding: 22, marginBottom: 20 }}>
                <div style={{ fontFamily: "sans-serif", fontSize: 12, color: "#4a6878", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 16 }}>Sentiment Analysis</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
                  {[
                    { company: result.meta.companyA, year: result.meta.yearA, overall: sentiment.overallA, score: sentiment.scoreA, summary: sentiment.summaryA, color: gold },
                    { company: result.meta.companyB, year: result.meta.yearB, overall: sentiment.overallB, score: sentiment.scoreB, summary: sentiment.summaryB, color: "#6495ed" },
                  ].map((s, i) => (
                    <div key={i} style={{ background: "rgba(255,255,255,.03)", borderRadius: 10, padding: 16, border: `1px solid ${s.color}30` }}>
                      <div style={{ fontFamily: "sans-serif", fontSize: 12, color: s.color, fontWeight: 700, marginBottom: 8 }}>{s.company} · {s.year}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <span style={{ background: `${sentColor(s.overall)}20`, color: sentColor(s.overall), border: `1px solid ${sentColor(s.overall)}40`, borderRadius: 6, padding: "3px 10px", fontFamily: "sans-serif", fontSize: 12, fontWeight: 700 }}>{s.overall}</span>
                        <span style={{ fontFamily: "sans-serif", fontSize: 12, color: "#4a6878" }}>Score: {s.score}/10</span>
                      </div>
                      <div style={{ fontFamily: "sans-serif", fontSize: 13, color: "#8aacb8", lineHeight: 1.6 }}>{s.summary}</div>
                    </div>
                  ))}
                </div>
                {sentiment.comparison && (
                  <div style={{ fontFamily: "sans-serif", fontSize: 13, color: "#8aacb8", lineHeight: 1.7, marginBottom: sentiment.redflags && sentiment.redflags !== "None identified" ? 12 : 0 }}>
                    <span style={{ color: "#4a6878", fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px" }}>Comparison: </span>{sentiment.comparison}
                  </div>
                )}
                {sentiment.redflags && sentiment.redflags !== "None identified" && (
                  <div style={{ background: "rgba(220,60,60,.07)", border: "1px solid rgba(220,60,60,.2)", borderRadius: 8, padding: "10px 14px", fontFamily: "sans-serif", fontSize: 13, color: "#e08080", lineHeight: 1.6, marginTop: 10 }}>
                    🚩 <strong>Red flags:</strong> {sentiment.redflags}
                  </div>
                )}
              </div>
            )}

            {/* Q&A Panel */}
            {qaOpen && (
              <div className="fadeup" style={{ background: "rgba(60,184,120,.04)", border: "1px solid rgba(60,184,120,.2)", borderRadius: 14, padding: 22, marginBottom: 20 }}>
                <div style={{ fontFamily: "sans-serif", fontSize: 12, color: green, textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 16 }}>Ask anything about this comparison</div>

                {/* Q&A History */}
                {qaHistory.length > 0 && (
                  <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    {qaHistory.map((item, i) => (
                      <div key={i}>
                        <div style={{ fontFamily: "sans-serif", fontSize: 13, color: green, marginBottom: 4 }}>Q: {item.q}</div>
                        <div style={{ fontFamily: "sans-serif", fontSize: 14, color: "#8aacb8", lineHeight: 1.75, background: "rgba(255,255,255,.025)", borderRadius: 8, padding: "10px 14px" }}>{item.a}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Question input */}
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && qaPhase !== "loading" && askQuestion()}
                    placeholder="e.g. Which company has more concentrated revenue? What changed between the years?"
                    disabled={qaPhase === "loading"}
                    style={{ ...inputStyle, border: "1px solid rgba(60,184,120,.25)", flex: 1 }}
                  />
                  <button className="btn" onClick={askQuestion} disabled={qaPhase === "loading" || !question.trim()}
                    style={{ background: qaPhase === "loading" ? "rgba(60,184,120,.15)" : "rgba(60,184,120,.85)", color: qaPhase === "loading" ? green : "#080e1a", borderRadius: 9, padding: "10px 18px", fontSize: 13, whiteSpace: "nowrap" }}>
                    {qaPhase === "loading" ? <span className="spin">⟳</span> : "Ask →"}
                  </button>
                </div>
                <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#2e4455", marginTop: 8 }}>
                  Tip: Ask about specific line items, year-over-year changes, accounting policy differences, or what the numbers mean for investors.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Data disclaimer */}
        <div style={{ marginTop: 40, padding: "14px 20px", background: "rgba(255,255,255,.015)", borderRadius: 10, fontFamily: "sans-serif", fontSize: 11, color: "#2a3a48", lineHeight: 1.7, textAlign: "center", border: "1px solid rgba(255,255,255,.04)" }}>
          ℹ️ This tool uses AI (Claude) trained on SEC 10-K filings through early 2025. Data reflects training knowledge, not live SEC EDGAR scraping. Always verify figures at{" "}
          <a href="https://efts.sec.gov/LATEST/search-index?forms=10-K" target="_blank" rel="noopener noreferrer" style={{ color: "#3a5a68" }}>SEC EDGAR</a>{" "}
          before making any investment or business decisions. Not financial advice.
        </div>
      </main>
    </>
  );
}
