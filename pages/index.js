import { useState, useEffect, useRef } from "react";

function parseMeta(text) {
  const block = text.match(/%%META%%([\s\S]*?)%%END%%/);
  if (!block) return {};
  const out = {};
  for (const line of block[1].split("\n")) {
    const pipe = line.indexOf("|");
    if (pipe === -1) continue;
    const key = line.slice(0, pipe).trim();
    const val = line.slice(pipe + 1).trim();
    if (key && val && val !== "N/A" && val !== "") out[key] = val;
  }
  return out;
}

function parseAnalysis(text) {
  const block = text.match(/%%ANALYSIS%%([\s\S]*?)%%END%%/);
  if (!block) return [];
  const sections = [];
  let cur = null;
  for (const raw of block[1].split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("##")) {
      if (cur) sections.push(cur);
      cur = { title: line.replace(/^##/, "").trim(), body: "", bullets: [] };
    } else if (/^[-•]/.test(line) && cur) {
      cur.bullets.push(line.replace(/^[-•]\s*/, ""));
    } else if (cur) {
      cur.body = (cur.body ? cur.body + " " : "") + line;
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

const METRICS = [
  ["revenue","Revenue"],["netincome","Net Income"],["opincome","Operating Income"],
  ["ocf","Cash from Ops"],["assets","Total Assets"],["liabilities","Liabilities"],
  ["equity","Equity"],["cash","Cash"],["debt","Long-term Debt"],
  ["eps","EPS"],["employees","Employees"],
];

const getIcon = (t) => {
  const tl = t.toLowerCase();
  if (tl.includes("do")) return "🏢";
  if (tl.includes("doing") || tl.includes("business")) return "📈";
  if (tl.includes("balance") || tl.includes("health")) return "🩺";
  if (tl.includes("watch")) return "👁️";
  if (tl.includes("verdict")) return "⭐";
  return "📌";
};

const TICKERS = ["AAPL","NVDA","MSFT","AMZN","TSLA","META","SOUN"];

export default function Home() {
  const [ticker, setTicker]     = useState("");
  const [phase, setPhase]       = useState("idle");
  const [pct, setPct]           = useState(0);
  const [meta, setMeta]         = useState({});
  const [sections, setSections] = useState([]);
  const [errMsg, setErrMsg]     = useState("");
  const [copied, setCopied]     = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (phase !== "loading") return;
    const t1 = setTimeout(() => setPct(30), 500);
    const t2 = setTimeout(() => setPct(60), 3000);
    const t3 = setTimeout(() => setPct(85), 7000);
    return () => [t1,t2,t3].forEach(clearTimeout);
  }, [phase]);

  async function analyze() {
    const sym = ticker.trim().toUpperCase();
    if (!sym || phase === "loading") return;
    setPhase("loading"); setPct(5);
    setMeta({}); setSections([]); setErrMsg("");
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: sym }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Error " + resp.status);
      setMeta(parseMeta(data.text));
      setSections(parseAnalysis(data.text));
      setPct(100);
      setPhase("done");
    } catch (e) {
      setErrMsg(e.message);
      setPhase("error");
    }
  }

  function handleShare() {
    const verdict = sections.find(s => s.title.toLowerCase().includes("verdict"));
    const lines = [
      "📊 " + (meta.name || ticker) + " (" + ticker + ") — 10-K Analysis",
      "Period: " + (meta.period || "—") + " | Filed: " + (meta.filed || "—"),
      "",
      meta.revenue   ? "Revenue: " + meta.revenue : "",
      meta.netincome ? "Net Income: " + meta.netincome : "",
      meta.eps       ? "EPS: " + meta.eps : "",
      "",
      verdict ? "Verdict: " + verdict.body : "",
      "",
      "Via 10-K Insights — plain-English SEC filing analysis",
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(lines).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function reset() {
    setPhase("idle"); setTicker("");
    setMeta({}); setSections([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const isNeg = (v = "") => v.startsWith("-");
  const metricEntries = METRICS.map(([k,l]) => meta[k] ? [l, meta[k], k] : null).filter(Boolean);

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080e1a; color: #ddd5c0; font-family: Georgia, serif; }
        ::selection { background: rgba(212,175,55,.3); }
        .inp::placeholder { color: #2e4455; }
        .inp:focus { outline: none; border-color: rgba(212,175,55,.7) !important; box-shadow: 0 0 0 3px rgba(212,175,55,.12) !important; }
        .chip { transition: all .15s; cursor: pointer; }
        .chip:hover { background: rgba(212,175,55,.2) !important; transform: translateY(-1px); }
        .abtn { transition: all .15s; }
        .abtn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
        .seccard { transition: border-color .2s, box-shadow .2s; }
        .seccard:hover { border-color: rgba(212,175,55,.22) !important; box-shadow: 0 4px 24px rgba(212,175,55,.07); }
        .metcard:hover .mv { transform: scale(1.04); }
        .mv { transition: transform .15s; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shimmer { 0%,100% { background-position: 0% center; } 50% { background-position: 100% center; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .fadeup { animation: fadeUp .45s ease forwards; }
        .d1{animation-delay:.05s}.d2{animation-delay:.12s}.d3{animation-delay:.19s}
        .d4{animation-delay:.26s}.d5{animation-delay:.33s}.d6{animation-delay:.4s}
        .shimmer-title {
          background: linear-gradient(90deg, #d4af37, #f5e070, #d4af37, #b8922a, #d4af37);
          background-size: 300% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 3s ease infinite;
        }
        .spin { animation: spin 1s linear infinite; display: inline-block; }
        a { color: #d4af37; }
        a:hover { text-decoration: underline; }
      `}</style>

      <header style={{ borderBottom:"1px solid rgba(212,175,55,.12)", padding:"16px 28px", display:"flex", alignItems:"center", gap:14, position:"sticky", top:0, zIndex:10, background:"rgba(8,14,26,.95)", backdropFilter:"blur(12px)" }}>
        <div style={{ width:36, height:36, background:"linear-gradient(135deg,#d4af37,#f5e070)", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, boxShadow:"0 2px 12px rgba(212,175,55,.3)" }}>📊</div>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:"#f5ecd5", letterSpacing:"-.3px" }}>10-K Insights</div>
          <div style={{ fontFamily:"sans-serif", fontSize:10, color:"#3a5868", letterSpacing:".8px", textTransform:"uppercase", marginTop:1 }}>Plain-English SEC Analysis</div>
        </div>
        {phase === "done" && (
          <button onClick={handleShare} className="abtn" style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:7, background: copied ? "rgba(60,184,120,.12)" : "rgba(212,175,55,.1)", border:"1px solid " + (copied ? "rgba(60,184,120,.4)" : "rgba(212,175,55,.25)"), color: copied ? "#3cb878" : "#d4af37", borderRadius:8, padding:"7px 14px", cursor:"pointer", fontFamily:"sans-serif", fontSize:12, fontWeight:600 }}>
            {copied ? "✓ Copied!" : "⎘ Share Analysis"}
          </button>
        )}
      </header>

      <main style={{ maxWidth:760, margin:"0 auto", padding:"40px 20px 100px" }}>
        {phase === "idle" && (
          <div className="fadeup" style={{ textAlign:"center", marginBottom:12 }}>
            <div style={{ display:"inline-block", background:"rgba(212,175,55,.08)", border:"1px solid rgba(212,175,55,.2)", borderRadius:100, padding:"5px 16px", fontFamily:"sans-serif", fontSize:11, color:"#c4a030", letterSpacing:"1px", textTransform:"uppercase", marginBottom:22 }}>
              Free · No signup · Any US ticker
            </div>
            <h1 style={{ fontSize:"clamp(28px,5.5vw,52px)", fontWeight:700, color:"#f5ecd5", lineHeight:1.15, marginBottom:14, letterSpacing:"-1.5px" }}>
              What is your stock<br />
              <span className="shimmer-title">actually doing?</span>
            </h1>
            <p style={{ fontFamily:"sans-serif", fontSize:15, color:"#4a6878", lineHeight:1.8, maxWidth:460, margin:"0 auto 32px" }}>
              Annual reports are 200-page documents written for accountants. This reads them for you and explains what actually matters — in plain English.
            </p>
          </div>
        )}

        <div className={phase === "idle" ? "fadeup d2" : ""} style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(212,175,55,.2)", borderRadius:18, padding:"24px", marginBottom:32, boxShadow:"0 8px 40px rgba(0,0,0,.3)" }}>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <input ref={inputRef} className="inp" value={ticker} placeholder="Enter any US ticker — AAPL, NVDA, SOUN…" disabled={phase === "loading"} onChange={e => setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g,""))} onKeyDown={e => e.key === "Enter" && analyze()} style={{ flex:1, minWidth:200, background:"rgba(255,255,255,.05)", border:"1px solid rgba(212,175,55,.22)", borderRadius:11, padding:"14px 18px", fontSize:20, fontFamily:"sans-serif", fontWeight:700, color:"#f5ecd5", letterSpacing:"3px" }} />
            <button className="abtn" onClick={analyze} disabled={phase==="loading"||!ticker.trim()} style={{ background: phase==="loading" ? "rgba(212,175,55,.18)" : "linear-gradient(135deg,#d4af37,#c49a20)", color: phase==="loading" ? "#6a5020" : "#080e1a", border:"none", borderRadius:11, padding:"14px 28px", fontSize:16, fontFamily:"sans-serif", fontWeight:800, cursor: phase==="loading"?"not-allowed":"pointer", boxShadow: phase!=="loading" ? "0 4px 20px rgba(212,175,55,.25)" : "none" }}>
              {phase === "loading" ? <span className="spin">⟳</span> : "Analyze →"}
            </button>
          </div>
          <div style={{ marginTop:16, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontFamily:"sans-serif", fontSize:11, color:"#2e4455", letterSpacing:".5px", textTransform:"uppercase" }}>Try:</span>
            {TICKERS.map(t => (
              <button key={t} className="chip" onClick={() => setTicker(t)} style={{ background: ticker===t ? "rgba(212,175,55,.22)" : "rgba(212,175,55,.07)", border:"1px solid " + (ticker===t ? "rgba(212,175,55,.5)" : "rgba(212,175,55,.18)"), color: ticker===t ? "#d4af37" : "#7a6540", borderRadius:7, padding:"4px 11px", fontSize:12, fontFamily:"sans-serif", fontWeight:700, letterSpacing:"1.5px" }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {phase === "loading" && (
          <div style={{ textAlign:"center", padding:"50px 24px" }}>
            <div style={{ fontFamily:"sans-serif", fontSize:12, color:"#3a5868", letterSpacing:"1px", textTransform:"uppercase", marginBottom:28 }}>Reading {ticker} annual report…</div>
            <div style={{ background:"rgba(255,255,255,.05)", borderRadius:100, height:3, overflow:"hidden", maxWidth:320, margin:"0 auto 16px" }}>
              <div style={{ background:"linear-gradient(90deg,#d4af37,#f5e070)", height:"100%", width:pct+"%", borderRadius:100, transition:"width 1.5s ease" }} />
            </div>
            <div style={{ fontFamily:"sans-serif", fontSize:12, color:"#2e4455" }}>
              {pct < 40 ? "Locating filing…" : pct < 75 ? "Extracting financials…" : "Building your report…"}
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="fadeup">
            <div style={{ background:"rgba(220,60,60,.07)", border:"1px solid rgba(220,60,60,.25)", borderRadius:14, padding:"20px 24px", fontFamily:"sans-serif", fontSize:13, color:"#e08080", lineHeight:1.7 }}>
              ⚠️ {errMsg}
            </div>
            <button onClick={() => setPhase("idle")} style={{ marginTop:14, background:"transparent", border:"1px solid rgba(212,175,55,.25)", color:"#d4af37", padding:"9px 18px", borderRadius:9, cursor:"pointer", fontFamily:"sans-serif", fontSize:13, fontWeight:600 }}>← Try again</button>
          </div>
        )}

        {phase === "done" && (
          <div>
            <div className="fadeup" style={{ background:"linear-gradient(135deg,rgba(212,175,55,.09),rgba(212,175,55,.04))", border:"1px solid rgba(212,175,55,.22)", borderRadius:18, padding:"28px", marginBottom:20, boxShadow:"0 4px 40px rgba(212,175,55,.06)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:14, marginBottom:20 }}>
                <div>
                  <div style={{ fontSize:26, fontWeight:700, color:"#f5ecd5", marginBottom:8 }}>{meta.name || ticker}</div>
                  <div style={{ fontFamily:"sans-serif", display:"flex", flexWrap:"wrap", alignItems:"center", gap:8, fontSize:13, color:"#5a7888" }}>
                    <span style={{ background:"rgba(212,175,55,.2)", color:"#d4af37", padding:"3px 10px", borderRadius:5, fontWeight:800, letterSpacing:"1.5px" }}>{ticker}</span>
                    {meta.period && <span>📅 {meta.period}</span>}
                    {meta.filed && <span style={{ color:"#2e4455" }}>· Filed {meta.filed}</span>}
                    <a href={"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + encodeURIComponent(meta.cik||ticker) + "&type=10-K"} target="_blank" rel="noopener noreferrer" style={{ fontSize:12, borderBottom:"1px solid rgba(212,175,55,.3)", textDecoration:"none" }}>Verify on SEC EDGAR ↗</a>
                  </div>
                </div>
                <button onClick={reset} style={{ background:"transparent", border:"1px solid rgba(212,175,55,.22)", color:"#8a7540", padding:"8px 16px", borderRadius:9, cursor:"pointer", fontFamily:"sans-serif", fontSize:12, fontWeight:600 }}>← New search</button>
              </div>
              {metricEntries.length > 0 && (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
                  {metricEntries.map(([label, val, key], i) => (
                    <div key={key} className={"metcard fadeup d" + Math.min(i+1,6)} style={{ background:"rgba(8,14,26,.6)", borderRadius:11, padding:"14px 16px", border:"1px solid rgba(255,255,255,.06)" }}>
                      <div style={{ fontFamily:"sans-serif", fontSize:10, color:"#3a5868", textTransform:"uppercase", letterSpacing:".9px", marginBottom:7 }}>{label}</div>
                      <div className="mv" style={{ fontSize: val.length > 8 ? 15 : 20, fontWeight:700, color: isNeg(val) ? "#e07070" : "#d4af37" }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {sections.map((sec, i) => (
                <div key={i} className={"seccard fadeup d" + Math.min(i+2,6)} style={{ background:"rgba(255,255,255,.025)", border:"1px solid rgba(255,255,255,.07)", borderLeft:"3px solid rgba(212,175,55,.35)", borderRadius:14, padding:"22px 26px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <span style={{ fontSize:18 }}>{getIcon(sec.title)}</span>
                    <span style={{ fontSize:15, fontWeight:700, color:"#d4af37" }}>{sec.title}</span>
                  </div>
                  {sec.body && <p style={{ fontFamily:"sans-serif", fontSize:15, lineHeight:1.82, color:"#8aacb8", marginBottom: sec.bullets.length ? 12 : 0 }}>{sec.body}</p>}
                  {sec.bullets.length > 0 && (
                    <ul style={{ listStyle:"none", padding:0 }}>
                      {sec.bullets.map((b, j) => (
                        <li key={j} style={{ fontFamily:"sans-serif", fontSize:14, lineHeight:1.75, color:"#8aacb8", padding:"7px 0 7px 20px", position:"relative", borderBottom: j < sec.bullets.length-1 ? "1px solid rgba(255,255,255,.04)" : "none" }}>
                          <span style={{ position:"absolute", left:0, color:"#d4af37", fontWeight:700 }}>›</span>{b}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop:32, padding:"16px 20px", background:"rgba(255,255,255,.015)", borderRadius:12, fontFamily:"sans-serif", fontSize:11, color:"#1e3040", lineHeight:1.7, textAlign:"center" }}>
              For informational purposes only · Not financial advice · Based on SEC 10-K filings ·{" "}
              <a href={"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + encodeURIComponent(meta.cik||ticker) + "&type=10-K"} target="_blank" rel="noopener noreferrer" style={{ color:"#2a4858" }}>Verify on SEC EDGAR</a>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
