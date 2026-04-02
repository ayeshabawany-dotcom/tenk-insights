export const config = {
  maxDuration: 60, // seconds — requires Vercel Pro ($20/month)
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const secApiKey   = process.env.SEC_API_KEY;

  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  if (!secApiKey)    return res.status(500).json({ error: "SEC_API_KEY not configured — add it to Vercel environment variables" });

  const { action, companyA, yearA, companyB, yearB, noteSection, tableData, question } = req.body;

  // ── Claude helper ─────────────────────────────────────────────────────────
  async function callClaude(prompt, maxTokens = 2000) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Claude API error ${resp.status}`);
    }
    const data = await resp.json();
    return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  }

  function extractJSON(text) {
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const start = cleaned.indexOf("{");
    const end   = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON in response");
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  // ── Normalize company input for sec-api search ────────────────────────────
  // Handles: "Synaptics Incorporated", "SYNAPTICS", "SYNA", "SoundHound AI", "SOUN"
  function buildSearchQuery(input, year) {
    const yearInt = parseInt(year);
    const clean = input.trim();
    // Always uppercase — handles "soun", "SOUN", "Soun" identically
    const upper = clean.toUpperCase();
    // Ticker: 1-5 letters only, no spaces
    const isTicker = /^[A-Z]{1,5}$/.test(upper);

    if (isTicker) {
      return {
        primary:  `ticker:${upper} AND formType:"10-K" AND periodOfReport:[${year}-01-01 TO ${year}-12-31]`,
        fallback: `ticker:${upper} AND formType:"10-K" AND filedAt:[${year}-01-01 TO ${yearInt + 1}-06-30]`,
      };
    }

    // Company name path
    const stripped = clean
      .replace(/\s+(Inc\.?|Corp\.?|LLC\.?|Ltd\.?|Incorporated|Corporation|Limited)$/i, "")
      .trim();

    return {
      primary:   `companyName:"${clean}" AND formType:"10-K" AND periodOfReport:[${year}-01-01 TO ${year}-12-31]`,
      fallback1: `companyName:"${stripped}" AND formType:"10-K" AND filedAt:[${year}-01-01 TO ${yearInt + 1}-06-30]`,
      fallback2: `companyName:${stripped.split(" ")[0]} AND formType:"10-K" AND filedAt:[${year}-01-01 TO ${yearInt + 1}-06-30]`,
      // Also try as ticker — covers mixed-case input like "Soun"
      fallback3: `ticker:${upper} AND formType:"10-K" AND filedAt:[${year}-01-01 TO ${yearInt + 1}-06-30]`,
    };
  }

  // ── Find 10-K filing via sec-api.io query ─────────────────────────────────
  async function findFiling(company, year) {
    const queries = buildSearchQuery(company, year);
    const queryList = [queries.primary, queries.fallback, queries.fallback1, queries.fallback2].filter(Boolean);

    let lastError = null;
    for (const q of queryList) {
      try {
        const resp = await fetch(`https://api.sec-api.io?token=${secApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, from: "0", size: "3", sort: [{ filedAt: { order: "desc" } }] }),
        });
        if (!resp.ok) {
          lastError = `sec-api.io returned HTTP ${resp.status}`;
          continue;
        }
        const data = await resp.json();
        const filings = data.filings || [];
        if (filings.length > 0) {
          const f = filings[0];
          return {
            url:         f.linkToHtmlAnnualReport || f.linkToFilingDetails,
            companyName: f.companyName,
            ticker:      f.ticker,
            filedAt:     f.filedAt,
            period:      f.periodOfReport,
          };
        }
        lastError = `No 10-K found with query: ${q}`;
      } catch (e) {
        lastError = e.message;
      }
    }
    throw new Error(`Could not find a 10-K for "${company}" fiscal year ${year}. ${lastError || ""}`.trim());
  }

  // ── Fetch Item 8 text via sec-api.io extractor ────────────────────────────
  async function fetchItem8(filingUrl) {
    const url = `https://api.sec-api.io/extractor?url=${encodeURIComponent(filingUrl)}&item=8&type=text&token=${secApiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`sec-api.io extractor returned HTTP ${resp.status} for ${filingUrl}`);
    const text = await resp.text();
    if (!text || text.trim().length < 200) throw new Error("Item 8 came back empty — the filing may not be supported.");
    return text;
  }

  // ── ACTIONS ───────────────────────────────────────────────────────────────

  try {

    // ── COMPARE ────────────────────────────────────────────────────────────
    if (action === "compare") {
      if (!companyA || !yearA || !companyB || !yearB || !noteSection) {
        return res.status(400).json({ error: "All fields are required." });
      }

      // Fetch both filings in parallel (Item 8 text only — no Claude yet)
      let filingA, filingB, item8A, item8B;
      try {
        [filingA, filingB] = await Promise.all([
          findFiling(companyA, yearA),
          findFiling(companyB, yearB),
        ]);
        [item8A, item8B] = await Promise.all([
          fetchItem8(filingA.url),
          fetchItem8(filingB.url),
        ]);
      } catch (e) {
        return res.status(502).json({ error: `Filing retrieval failed: ${e.message}` });
      }

      // Single Claude call: find both notes AND produce the comparison table
      // This replaces 3 sequential Claude calls with 1, cutting time by ~65%
      const combinedPrompt = `You are a senior technical accountant with deep expertise in SEC 10-K filings.

You have been given Item 8 text from two actual 10-K annual filings. Your job is to:
1. Find the section covering "${noteSection}" in each filing (companies use different note titles — find the best match)
2. Compare them across 8-10 meaningful dimensions

DO NOT invent or add anything not present in the filing text below.

════ FILING A: ${filingA.companyName} (${filingA.ticker || companyA}) — FY${yearA} ════
Filed: ${filingA.filedAt?.slice(0,10)} | Period: ${filingA.period}
${item8A.slice(0, 7000)}

════ FILING B: ${filingB.companyName} (${filingB.ticker || companyB}) — FY${yearB} ════  
Filed: ${filingB.filedAt?.slice(0,10)} | Period: ${filingB.period}
${item8B.slice(0, 7000)}

Return ONLY valid JSON, no markdown, nothing before or after the JSON:
{
  "meta": {
    "companyA": "${filingA.companyName}",
    "yearA": "${yearA}",
    "companyB": "${filingB.companyName}",
    "yearB": "${yearB}",
    "note": "${noteSection}"
  },
  "resolvedTitleA": "The exact note title as it appears in Filing A",
  "resolvedTitleB": "The exact note title as it appears in Filing B",
  "rows": [
    { "dimension": "Key disclosure dimension", "a": "What Filing A actually says (quote specific numbers/language)", "b": "What Filing B actually says (quote specific numbers/language)" }
  ],
  "summary": "2-3 sentences on the most significant differences, citing actual numbers and policy language from the filings.",
  "keyInsight": "The single most important finding from this comparison."
}`;

      const claudeText = await callClaude(combinedPrompt, 2000);
      let parsed;
      try { parsed = extractJSON(claudeText); }
      catch (e) { return res.status(500).json({ error: "Could not parse comparison. Please try again." }); }

      if (!parsed.rows || parsed.rows.length === 0) {
        return res.status(500).json({ error: "No comparison rows returned. Try again." });
      }

      const sourceNote = (parsed.resolvedTitleA !== noteSection || parsed.resolvedTitleB !== noteSection)
        ? `Section names auto-resolved — ${filingA.companyName}: "${parsed.resolvedTitleA}" · ${filingB.companyName}: "${parsed.resolvedTitleB}"`
        : null;

      parsed.sourceA    = filingA.url;
      parsed.sourceB    = filingB.url;
      parsed.sourceNote = sourceNote;
      parsed.dataSource = "SEC EDGAR via sec-api.io — actual 10-K filing text";

      return res.status(200).json(parsed);
    }

    // ── SENTIMENT ──────────────────────────────────────────────────────────
    if (action === "sentiment") {
      if (!tableData || !noteSection) return res.status(400).json({ error: "Missing data." });

      const tableText = tableData.rows
        .map(r => `${r.dimension}: ${tableData.meta.companyA}="${r.a}" vs ${tableData.meta.companyB}="${r.b}"`)
        .join("\n");

      const prompt = `Analyze disclosure tone and language from actual 10-K filing data.

${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB}) — ${noteSection}

${tableText}

Return ONLY valid JSON, no markdown:
{
  "overallA": "Positive or Neutral or Cautious or Negative",
  "scoreA": 7,
  "summaryA": "2 sentences on tone and language of Company A",
  "overallB": "Positive or Neutral or Cautious or Negative",
  "scoreB": 6,
  "summaryB": "2 sentences on tone and language of Company B",
  "comparison": "2 sentences comparing both",
  "redflags": "Any concerning language, or null"
}`;

      const text = await callClaude(prompt, 800);
      let sentiment;
      try { sentiment = extractJSON(text); }
      catch (e) { return res.status(500).json({ error: "Could not parse sentiment. Try again." }); }
      return res.status(200).json({ sentiment });
    }

    // ── ASK ────────────────────────────────────────────────────────────────
    if (action === "ask") {
      if (!question || !tableData) return res.status(400).json({ error: "Missing question or data." });

      const tableText = tableData.rows
        .map(r => `${r.dimension}: ${tableData.meta.companyA}="${r.a}" | ${tableData.meta.companyB}="${r.b}"`)
        .join("\n");

      const prompt = `You are a senior financial analyst. Answer based ONLY on the actual 10-K filing data below.

${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB}) — ${tableData.meta.note}

${tableText}

Summary: ${tableData.summary}

Question: ${question}

Answer in 2-4 sentences. If the answer is not in the data, say so explicitly.`;

      const answer = await callClaude(prompt, 600);
      return res.status(200).json({ answer: answer.trim() });
    }

    return res.status(400).json({ error: "Unknown action." });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error. Please try again." });
  }
}
