export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const secApiKey   = process.env.SEC_API_KEY;

  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  if (!secApiKey)    return res.status(500).json({ error: "SEC_API_KEY not configured — add it to Vercel environment variables" });

  const { action, companyA, yearA, companyB, yearB, noteSection, tableData, question } = req.body;

  // ── sec-api.io helpers ───────────────────────────────────────────────────────

  // Step 1: Find the 10-K filing URL for a company + fiscal year
  async function findFilingUrl(company, year) {
    const yearInt = parseInt(year);
    // Fiscal year N typically ends Dec 31 N, filed Jan-Mar N+1
    // Search for 10-Ks filed in a window that covers the target fiscal year
    const query = {
      query: `(ticker:${company.toUpperCase()} OR companyName:"${company}") AND formType:"10-K" AND periodOfReport:[${year}-01-01 TO ${year}-12-31]`,
      from: "0",
      size: "3",
      sort: [{ filedAt: { order: "desc" } }],
    };

    const resp = await fetch(`https://api.sec-api.io?token=${secApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`sec-api.io query failed (${resp.status}): ${err.message || "unknown error"}`);
    }

    const data = await resp.json();
    const filings = data.filings || [];

    if (filings.length === 0) {
      // Try broader search — some companies have non-calendar fiscal years
      const query2 = {
        query: `(ticker:${company.toUpperCase()} OR companyName:"${company}") AND formType:"10-K" AND filedAt:[${year}-01-01 TO ${yearInt + 1}-06-30]`,
        from: "0",
        size: "3",
        sort: [{ filedAt: { order: "desc" } }],
      };
      const resp2 = await fetch(`https://api.sec-api.io?token=${secApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query2),
      });
      const data2 = await resp2.json();
      const filings2 = data2.filings || [];
      if (filings2.length === 0) {
        throw new Error(`No 10-K found for "${company}" fiscal year ${year}. Check the company name or ticker and year.`);
      }
      return {
        url: filings2[0].linkToHtmlAnnualReport || filings2[0].linkToFilingDetails,
        companyName: filings2[0].companyName,
        filedAt: filings2[0].filedAt,
        periodOfReport: filings2[0].periodOfReport,
      };
    }

    return {
      url: filings[0].linkToHtmlAnnualReport || filings[0].linkToFilingDetails,
      companyName: filings[0].companyName,
      filedAt: filings[0].filedAt,
      periodOfReport: filings[0].periodOfReport,
    };
  }

  // Step 2: Extract Item 8 (Financial Statements + Notes) as clean text
  async function extractItem8(filingUrl) {
    const extractUrl = `https://api.sec-api.io/extractor?url=${encodeURIComponent(filingUrl)}&item=8&type=text&token=${secApiKey}`;
    const resp = await fetch(extractUrl);
    if (!resp.ok) throw new Error(`Section extractor failed (HTTP ${resp.status}). The filing may not be in a supported format.`);
    const text = await resp.text();
    if (!text || text.trim().length < 100) throw new Error("Item 8 returned empty. The filing format may not be supported.");
    return text;
  }

  // Step 3: Find the specific note within Item 8 text
  function extractNote(item8Text, noteKeyword) {
    // Clean up the keyword for searching
    const kw = noteKeyword
      .replace(/\(.*?\)/g, "")   // remove "(ASC 842)" etc
      .replace(/&/g, "and")
      .trim()
      .toLowerCase();

    // Primary search words (first 2-3 significant words)
    const words = kw.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
    const primaryWord = words[0] || kw;

    // Build search patterns from most to least specific
    const patterns = [
      // "NOTE 3 — Business Combinations" or "NOTE 3. BUSINESS COMBINATIONS"
      new RegExp(`note\\s+\\d+[^\\n]{0,60}${primaryWord}`, "i"),
      // "3. Business Combinations and Acquisitions"
      new RegExp(`\\d+\\.\\s+${primaryWord}`, "i"),
      // Just the full keyword as a standalone header
      new RegExp(`\\n\\s*${kw.replace(/\s+/g, "[\\s\\S]{0,20}")}\\s*\\n`, "i"),
      // First significant word as a section start
      new RegExp(`\\n\\s*${primaryWord}s?\\s*\\n`, "i"),
    ];

    let startIdx = -1;
    let headerMatch = "";

    for (const pat of patterns) {
      const m = pat.exec(item8Text);
      if (m) {
        startIdx = m.index;
        headerMatch = m[0].trim();
        break;
      }
    }

    if (startIdx === -1) {
      return { text: null, found: false, headerMatch: null };
    }

    // Extract from match point onwards
    const fromHere = item8Text.slice(startIdx);

    // Find where the next note starts to trim properly
    // Next note pattern: "NOTE X" or standalone number heading or next major header
    const nextNotePattern = /\bnote\s+\d+[^a-z]/i;
    const nextMatch = fromHere.slice(500).search(nextNotePattern);

    let extracted;
    if (nextMatch > 0 && nextMatch < 8000) {
      extracted = fromHere.slice(0, nextMatch + 500);
    } else {
      extracted = fromHere.slice(0, 7000);
    }

    // Clean up excessive whitespace
    extracted = extracted.replace(/\n{3,}/g, "\n\n").trim();

    return {
      text: extracted,
      found: true,
      headerMatch,
      length: extracted.length,
    };
  }

  // Claude API call
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
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON in response");
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  // ── ACTIONS ──────────────────────────────────────────────────────────────────

  try {

    // ── COMPARE ──────────────────────────────────────────────────────────────
    if (action === "compare") {
      if (!companyA || !yearA || !companyB || !yearB || !noteSection) {
        return res.status(400).json({ error: "All fields are required." });
      }

      // Fetch both filings in parallel
      async function getFilingData(company, year) {
        const filing = await findFilingUrl(company, year);
        if (!filing.url) throw new Error(`No document URL found for ${company} ${year}`);
        const item8 = await extractItem8(filing.url);
        const note  = extractNote(item8, noteSection);
        return { ...filing, note };
      }

      let dataA, dataB;
      try {
        [dataA, dataB] = await Promise.all([
          getFilingData(companyA, yearA),
          getFilingData(companyB, yearB),
        ]);
      } catch (e) {
        return res.status(502).json({ error: `Filing retrieval failed: ${e.message}` });
      }

      const textA = dataA.note.found
        ? dataA.note.text
        : `[The "${noteSection}" section was not clearly identified in the ${dataA.companyName} ${yearA} 10-K. The filing may use different section naming.]`;

      const textB = dataB.note.found
        ? dataB.note.text
        : `[The "${noteSection}" section was not clearly identified in the ${dataB.companyName} ${yearB} 10-K. The filing may use different section naming.]`;

      const sourceNote = (!dataA.note.found || !dataB.note.found)
        ? `One or both note sections could not be precisely located. Results below are based on the best match found.`
        : null;

      // Pass REAL extracted text to Claude
      const prompt = `You are a senior technical accountant. Compare these two ACTUAL note sections extracted directly from SEC 10-K annual filings using sec-api.io.

Do NOT invent, assume, or add anything not present in the text below. Base your entire analysis only on what is written here.

════════════════════════════════
${dataA.companyName} — FY${yearA} — ${noteSection}
Filed: ${dataA.filedAt?.slice(0,10)} | Period: ${dataA.periodOfReport}
════════════════════════════════
${textA.slice(0, 5000)}

════════════════════════════════
${dataB.companyName} — FY${yearB} — ${noteSection}
Filed: ${dataB.filedAt?.slice(0,10)} | Period: ${dataB.periodOfReport}
════════════════════════════════
${textB.slice(0, 5000)}

Identify 8-10 specific dimensions of comparison that an investment banker or technical accountant would find meaningful. Reference actual numbers, policy language, and disclosures from the text above.

Return ONLY valid JSON, no markdown, no text before or after:
{
  "meta": {
    "companyA": "${dataA.companyName}",
    "yearA": "${yearA}",
    "companyB": "${dataB.companyName}",
    "yearB": "${yearB}",
    "note": "${noteSection}"
  },
  "rows": [
    { "dimension": "Key disclosure dimension", "a": "What the filing actually says for Company A", "b": "What the filing actually says for Company B" }
  ],
  "summary": "2-3 sentences citing specific numbers or policies from the actual filing text.",
  "keyInsight": "The single most important finding from comparing these real disclosures."
}`;

      const claudeText = await callClaude(prompt, 2000);
      let parsed;
      try { parsed = extractJSON(claudeText); }
      catch (e) { return res.status(500).json({ error: "Could not parse comparison response. Please try again." }); }

      if (!parsed.rows || parsed.rows.length === 0) {
        return res.status(500).json({ error: "No comparison data returned. Try again." });
      }

      parsed.sourceA    = dataA.url;
      parsed.sourceB    = dataB.url;
      parsed.sourceNote = sourceNote;
      parsed.dataSource = "SEC EDGAR via sec-api.io — actual 10-K filing text";

      return res.status(200).json(parsed);
    }

    // ── SENTIMENT ────────────────────────────────────────────────────────────
    if (action === "sentiment") {
      if (!tableData || !noteSection) return res.status(400).json({ error: "Missing data." });

      const tableText = tableData.rows
        .map(r => `${r.dimension}: ${tableData.meta.companyA}="${r.a}" vs ${tableData.meta.companyB}="${r.b}"`)
        .join("\n");

      const prompt = `Analyze the disclosure tone and language from these actual 10-K filing excerpts.

${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB}) — ${noteSection}
Data source: ${tableData.dataSource || "SEC EDGAR 10-K filings"}

${tableText}

Return ONLY valid JSON, no markdown:
{
  "overallA": "Positive or Neutral or Cautious or Negative",
  "scoreA": 7,
  "summaryA": "2 sentences on tone and language in Company A's disclosures",
  "overallB": "Positive or Neutral or Cautious or Negative",
  "scoreB": 6,
  "summaryB": "2 sentences on tone and language in Company B's disclosures",
  "comparison": "2 sentences comparing both",
  "redflags": "Any concerning language or disclosures, or null"
}`;

      const text = await callClaude(prompt, 800);
      let sentiment;
      try { sentiment = extractJSON(text); }
      catch(e) { return res.status(500).json({ error: "Could not parse sentiment. Try again." }); }
      return res.status(200).json({ sentiment });
    }

    // ── ASK ──────────────────────────────────────────────────────────────────
    if (action === "ask") {
      if (!question || !tableData) return res.status(400).json({ error: "Missing question or data." });

      const tableText = tableData.rows
        .map(r => `${r.dimension}: ${tableData.meta.companyA}="${r.a}" | ${tableData.meta.companyB}="${r.b}"`)
        .join("\n");

      const prompt = `You are a senior financial analyst answering a question about actual SEC 10-K filing disclosures.

${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB}) — ${tableData.meta.note}
Source: ${tableData.dataSource || "SEC EDGAR 10-K filings"}

Filing data:
${tableText}

Summary: ${tableData.summary}

Question: ${question}

Answer in 2-4 sentences. Base your answer strictly on the filing data above. If the answer is not in the data, say so explicitly.`;

      const answer = await callClaude(prompt, 600);
      return res.status(200).json({ answer: answer.trim() });
    }

    return res.status(400).json({ error: "Unknown action." });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error. Please try again." });
  }
}
