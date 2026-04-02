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

  // ── Step 1: Ask Claude to find the correct note title ─────────────────────
  // Uses the first ~4000 chars of Item 8 (table of contents area)
  async function findNoteTitle(item8Text, noteKeyword, companyName) {
    const tocSection = item8Text.slice(0, 4000);

    const prompt = `You are reading the beginning of Item 8 (Financial Statements and Supplementary Data) from ${companyName}'s 10-K annual report.

The user wants to find the note that covers: "${noteKeyword}"

Here is the beginning of Item 8 (which usually contains a table of contents for the notes):
---
${tocSection}
---

Your job: identify the EXACT note title or header in this filing that best matches "${noteKeyword}".

Companies use different names for the same disclosure. For example:
- "Revenue Recognition" might be called "Revenue from Contracts with Customers" or appear within "Segment, Customers, and Geographic Information"
- "Business Combinations" might be "Acquisitions" or "Business Acquisitions and Divestitures"
- "Share-Based Compensation" might be "Stock-Based Compensation" or "Equity Awards"

Return ONLY a JSON object, no markdown:
{
  "found": true,
  "noteTitle": "The exact note title as it appears in this filing",
  "noteNumber": "e.g. 3 or 15 (if visible)",
  "confidence": "high or medium or low",
  "reasoning": "One sentence explaining why this is the right note"
}

If you cannot find a matching note, return:
{ "found": false, "noteTitle": null, "noteNumber": null, "confidence": "low", "reasoning": "Why not found" }`;

    const response = await callClaude(prompt, 400);
    try {
      return extractJSON(response);
    } catch (e) {
      // Fallback — just use the original keyword
      return { found: false, noteTitle: null, noteNumber: null, confidence: "low", reasoning: "Could not parse response" };
    }
  }

  // ── Step 2: Extract the note section using the correct title ──────────────
  function extractNoteByTitle(item8Text, noteTitle, noteNumber) {
    if (!noteTitle) return { text: null, found: false };

    // Build search patterns using the exact title Claude identified
    const title = noteTitle.trim();
    const titleLower = title.toLowerCase();

    const patterns = [];

    // If we have a note number, search for "NOTE X — Title" patterns
    if (noteNumber) {
      patterns.push(new RegExp(`note\\s+${noteNumber}[^\\n]{0,80}`, "i"));
      patterns.push(new RegExp(`${noteNumber}\\.\\s+${titleLower.split(" ").slice(0,3).join("[\\s\\S]{0,10}")}`, "i"));
    }

    // Exact title match
    patterns.push(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

    // First 3 significant words of title
    const words = title.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
    if (words.length >= 2) {
      patterns.push(new RegExp(words.join("[\\s\\S]{0,20}"), "i"));
    }

    // First significant word
    if (words[0]) {
      patterns.push(new RegExp(`\\n\\s*${words[0]}[^\\n]{0,60}\\n`, "i"));
    }

    let startIdx = -1;
    for (const pat of patterns) {
      const m = pat.exec(item8Text);
      if (m) {
        startIdx = m.index;
        break;
      }
    }

    if (startIdx === -1) {
      return { text: null, found: false };
    }

    const fromHere = item8Text.slice(startIdx);

    // Find where next note starts
    const nextNoteMatch = fromHere.slice(400).search(/\bnote\s+\d+[^a-z]/i);
    const extracted = nextNoteMatch > 0 && nextNoteMatch < 8000
      ? fromHere.slice(0, nextNoteMatch + 400)
      : fromHere.slice(0, 7000);

    return {
      text: extracted.replace(/\n{3,}/g, "\n\n").trim(),
      found: true,
    };
  }

  // ── Main filing data retrieval ────────────────────────────────────────────
  async function getFilingData(company, year, noteKeyword) {
    // 1. Find the filing
    const filing = await findFiling(company, year);
    if (!filing.url) throw new Error(`No document URL found for ${company} ${year}`);

    // 2. Fetch Item 8 text
    const item8 = await fetchItem8(filing.url);

    // 3. Ask Claude to identify the correct note title
    const noteInfo = await findNoteTitle(item8, noteKeyword, filing.companyName);

    // 4. Extract using the correct title
    const searchTitle = noteInfo.found ? noteInfo.noteTitle : noteKeyword;
    const noteNumber  = noteInfo.noteNumber || null;
    const section     = extractNoteByTitle(item8, searchTitle, noteNumber);

    // 5. If still not found, try a broader fallback using just the first keyword
    if (!section.found) {
      const fallback = extractNoteByTitle(item8, noteKeyword, null);
      if (fallback.found) {
        return { ...filing, section: fallback, noteInfo, resolvedTitle: noteKeyword };
      }
    }

    return {
      ...filing,
      section,
      noteInfo,
      resolvedTitle: noteInfo.found ? noteInfo.noteTitle : noteKeyword,
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
