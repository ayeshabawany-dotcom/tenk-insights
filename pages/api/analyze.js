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

  // ── Claude-powered note finder + extractor ──────────────────────────────
  // Replaces brittle regex extraction — Claude reads Item 8 and returns
  // exactly the right section text, regardless of how the company named it.
  async function extractNoteViaClaude(item8Text, noteKeyword, companyName) {
    // Send up to 12,000 chars of Item 8 — enough to cover most notes
    // For very long filings we send in two windows if first attempt fails
    const chunk1 = item8Text.slice(0, 12000);

    const prompt = `You are a technical accounting expert reading Item 8 of a 10-K annual filing for ${companyName}.

The user wants to find and extract the note section covering: "${noteKeyword}"

Important: Companies do not always use standard note titles. For example:
- "Revenue Recognition" may appear within "Segment, Customers, and Geographic Information" or "Revenue from Contracts with Customers"  
- "Business Combinations" may be called "Acquisitions", "Business Acquisitions and Divestitures", etc.
- "Share-Based Compensation" may be "Stock-Based Compensation" or "Equity Awards"

Here is the Item 8 text (may be truncated for very long filings):
---
${chunk1}
---

Your task:
1. Identify which note section best covers "${noteKeyword}" — even if named differently
2. Extract the COMPLETE text of that note section

Return JSON only, no markdown:
{
  "found": true,
  "resolvedTitle": "The exact title as it appears in this filing",
  "noteNumber": "e.g. 3 or 15",
  "extractedText": "The complete text of the note section, verbatim from the filing",
  "confidence": "high or medium or low"
}

If you genuinely cannot find a relevant section, return:
{ "found": false, "resolvedTitle": null, "noteNumber": null, "extractedText": null, "confidence": "low" }`;

    const response = await callClaude(prompt, 1500);
    try {
      const parsed = extractJSON(response);
      if (parsed.found && parsed.extractedText && parsed.extractedText.length > 100) {
        return parsed;
      }
      // If first chunk didn't work, try middle section of the filing
      if (!parsed.found && item8Text.length > 12000) {
        const chunk2 = item8Text.slice(8000, 22000);
        const prompt2 = prompt.replace(chunk1, chunk2);
        const response2 = await callClaude(prompt2, 1500);
        const parsed2 = extractJSON(response2);
        if (parsed2.found && parsed2.extractedText) return parsed2;
      }
      return parsed;
    } catch (e) {
      return { found: false, resolvedTitle: null, noteNumber: null, extractedText: null, confidence: "low" };
    }
  }

  // ── Main filing data retrieval ─────────────────────────────────────────────
  async function getFilingData(company, year, noteKeyword) {
    const filing = await findFiling(company, year);
    if (!filing.url) throw new Error(`No document URL for ${company} ${year}`);

    const item8 = await fetchItem8(filing.url);
    const result = await extractNoteViaClaude(item8, noteKeyword, filing.companyName);

    return {
      ...filing,
      section: {
        found: result.found,
        text:  result.extractedText,
      },
      resolvedTitle: result.resolvedTitle || noteKeyword,
      noteNumber:    result.noteNumber,
      confidence:    result.confidence,
    };
  }


  // ── ACTIONS ───────────────────────────────────────────────────────────────

  try {

    // ── COMPARE ────────────────────────────────────────────────────────────
    if (action === "compare") {
      if (!companyA || !yearA || !companyB || !yearB || !noteSection) {
        return res.status(400).json({ error: "All fields are required." });
      }

      let dataA, dataB;
      try {
        [dataA, dataB] = await Promise.all([
          getFilingData(companyA, yearA, noteSection),
          getFilingData(companyB, yearB, noteSection),
        ]);
      } catch (e) {
        return res.status(502).json({ error: `Filing retrieval failed: ${e.message}` });
      }

      const textA = dataA.section.found
        ? dataA.section.text
        : `[Could not locate the "${noteSection}" section in ${dataA.companyName} ${yearA} 10-K. Claude identified it as "${dataA.resolvedTitle}" but extraction failed.]`;

      const textB = dataB.section.found
        ? dataB.section.text
        : `[Could not locate the "${noteSection}" section in ${dataB.companyName} ${yearB} 10-K. Claude identified it as "${dataB.resolvedTitle}" but extraction failed.]`;

      // Build context note about resolved titles
      const resolvedA = dataA.resolvedTitle !== noteSection ? `(found as "${dataA.resolvedTitle}")` : "";
      const resolvedB = dataB.resolvedTitle !== noteSection ? `(found as "${dataB.resolvedTitle}")` : "";
      const sourceNote = (resolvedA || resolvedB)
        ? `Note: Filing section names were automatically resolved — ${dataA.companyName} ${resolvedA} · ${dataB.companyName} ${resolvedB}`.replace(/· $/,"").trim()
        : null;

      // Pass real text to Claude for comparison
      const prompt = `You are a senior technical accountant comparing actual SEC 10-K filing disclosures.

DO NOT invent or assume any information not present in the text below. Base your entire analysis only on what is written here.

════ ${dataA.companyName} (${dataA.ticker || companyA}) — FY${yearA}
Filed: ${dataA.filedAt?.slice(0,10)} | Period: ${dataA.period}
Note as filed: "${dataA.resolvedTitle}"
════
${textA.slice(0, 5000)}

════ ${dataB.companyName} (${dataB.ticker || companyB}) — FY${yearB}
Filed: ${dataB.filedAt?.slice(0,10)} | Period: ${dataB.period}
Note as filed: "${dataB.resolvedTitle}"
════
${textB.slice(0, 5000)}

Compare these two disclosures across 8-10 specific dimensions an investment banker or technical accountant would find meaningful. Reference actual numbers, specific policy language, and concrete disclosures from the text.

Return ONLY valid JSON, no markdown, no preamble:
{
  "meta": {
    "companyA": "${dataA.companyName}",
    "yearA": "${yearA}",
    "companyB": "${dataB.companyName}",
    "yearB": "${yearB}",
    "note": "${noteSection}"
  },
  "rows": [
    { "dimension": "Disclosure dimension name", "a": "What Company A's filing actually says", "b": "What Company B's filing actually says" }
  ],
  "summary": "2-3 sentences citing specific numbers or policy language from the actual filing text.",
  "keyInsight": "The single most important finding from comparing these real disclosures."
}`;

      const claudeText = await callClaude(prompt, 2000);
      let parsed;
      try { parsed = extractJSON(claudeText); }
      catch (e) { return res.status(500).json({ error: "Could not parse comparison response. Please try again." }); }

      if (!parsed.rows || parsed.rows.length === 0) {
        return res.status(500).json({ error: "No comparison rows returned. Try again." });
      }

      parsed.sourceA    = dataA.url;
      parsed.sourceB    = dataB.url;
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
