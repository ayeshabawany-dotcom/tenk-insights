export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const { action, companyA, yearA, companyB, yearB, noteSection, tableData, question } = req.body;

  // SEC requires this exact User-Agent format
  const UA = "10KCompare research@10kcompare.app";

  // ── EDGAR helpers ───────────────────────────────────────────────────────────

  async function edgarFetch(url) {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!resp.ok) throw new Error(`EDGAR returned HTTP ${resp.status} for ${url}`);
    return resp;
  }

  // Resolve company name/ticker → CIK
  async function resolveCIK(query) {
    const resp = await edgarFetch("https://data.sec.gov/files/company_tickers.json");
    const data = await resp.json();
    const q = query.trim().toUpperCase();
    const entries = Object.values(data);

    // 1. Exact ticker match
    let entry = entries.find(e => e.ticker === q);
    // 2. Exact name match
    if (!entry) entry = entries.find(e => e.title.toUpperCase() === q);
    // 3. Starts with
    if (!entry) entry = entries.find(e => e.title.toUpperCase().startsWith(q));
    // 4. Contains
    if (!entry) entry = entries.find(e => e.title.toUpperCase().includes(q));

    if (!entry) throw new Error(`"${query}" not found in SEC EDGAR. Try the exact ticker (e.g. SOUN) or full legal name.`);
    return {
      cik: String(entry.cik_str).padStart(10, "0"),
      cikRaw: String(entry.cik_str),
      name: entry.title,
    };
  }

  // Find the 10-K for a specific fiscal year
  async function findFiling(cik, year) {
    const resp = await edgarFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const data = await resp.json();
    const recent = data.filings.recent;

    // Look for 10-K where reportDate (period end) falls in target year
    for (let i = 0; i < recent.form.length; i++) {
      const form = recent.form[i];
      const reportDate = recent.reportDate?.[i] || "";
      const filingDate = recent.filingDate?.[i] || "";
      if ((form === "10-K" || form === "10-K/A") && reportDate.startsWith(year)) {
        return {
          accessionNo: recent.accessionNumber[i],
          filingDate,
          periodEnd: reportDate,
        };
      }
    }

    // Also check older filings pages if available
    if (data.filings.files) {
      for (const file of data.filings.files) {
        try {
          const oldResp = await edgarFetch(`https://data.sec.gov/submissions/${file.name}`);
          const oldData = await oldResp.json();
          for (let i = 0; i < oldData.form.length; i++) {
            const form = oldData.form[i];
            const reportDate = oldData.reportDate?.[i] || "";
            const filingDate = oldData.filingDate?.[i] || "";
            if ((form === "10-K" || form === "10-K/A") && reportDate.startsWith(year)) {
              return { accessionNo: oldData.accessionNumber[i], filingDate, periodEnd: reportDate };
            }
          }
        } catch (_) { continue; }
      }
    }

    throw new Error(`No 10-K filing found for fiscal year ${year}. Note: FY${year} means the period ending in ${year}.`);
  }

  // Get the primary 10-K document URL from the filing index
  async function getDocumentURL(cikRaw, accessionNo) {
    const accNoClean = accessionNo.replace(/-/g, "");
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikRaw}/${accNoClean}/${accessionNo}-index.json`;
    const resp = await fetch(indexUrl, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!resp.ok) {
      // Try alternate index format
      const altUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikRaw}&type=10-K&dateb=&owner=include&count=5&search_text=&output=atom`;
      throw new Error(`Could not load filing index (HTTP ${resp.status})`);
    }
    const data = await resp.json();

    // Find the main 10-K document (not exhibits)
    const docs = data.documents || [];
    const primary = docs.find(d =>
      d.type === "10-K" || d.type === "10-K/A" ||
      (d.description && (d.description.toLowerCase().includes("10-k") || d.description.toLowerCase().includes("annual report")))
    ) || docs.find(d => d.document && (d.document.endsWith(".htm") || d.document.endsWith(".html")));

    if (!primary) throw new Error("Could not locate the primary 10-K document in the filing index.");
    return `https://www.sec.gov/Archives/edgar/data/${cikRaw}/${accNoClean}/${primary.document}`;
  }

  // Fetch the 10-K HTML and extract just the relevant note section
  async function extractNoteSection(docUrl, noteKeyword) {
    const resp = await fetch(docUrl, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    });
    if (!resp.ok) throw new Error(`Could not fetch 10-K document (HTTP ${resp.status})`);

    // Read up to 8MB to avoid memory issues on very large filings
    const buffer = await resp.arrayBuffer();
    const html = new TextDecoder().decode(buffer.slice(0, 8_000_000));

    // Strip HTML tags → plain text
    let text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#[0-9]+;/g, " ")
      .replace(/\s{3,}/g, "\n\n")
      .trim();

    // Build search patterns for the note section
    const keywords = noteKeyword.toLowerCase()
      .replace(/\(.*?\)/g, "") // remove parentheticals like (ASC 842)
      .replace(/&/g, "and")
      .trim();

    // Try to find the note section using multiple patterns
    const notePatterns = [
      // "NOTE X — Business Combinations" or "Note X. Business Combinations"
      new RegExp(`note\\s+\\d+[^\\n]*${keywords.split(" ")[0]}[^\\n]*`, "i"),
      // Just the keyword as a section header
      new RegExp(`\\n\\s*${keywords}\\s*\\n`, "i"),
      // With "and" variations
      new RegExp(keywords.replace(/\s+/g, "[\\s\\S]{0,30}"), "i"),
    ];

    let sectionStart = -1;
    let matchedPattern = null;

    for (const pattern of notePatterns) {
      const match = pattern.exec(text);
      if (match) {
        sectionStart = match.index;
        matchedPattern = match[0];
        break;
      }
    }

    if (sectionStart === -1) {
      // Fallback: return a generous chunk of the filing around the keyword area
      const keyIdx = text.toLowerCase().indexOf(keywords.split(" ")[0]);
      if (keyIdx !== -1) sectionStart = Math.max(0, keyIdx - 200);
      else return { text: null, found: false };
    }

    // Extract from the match point — find the end of this note (next note heading or ~8000 chars)
    const sectionText = text.slice(sectionStart, sectionStart + 10000);

    // Find where the next note section starts to trim properly
    const nextNoteMatch = sectionText.slice(300).search(/\bnote\s+\d+[^a-z]/i);
    const trimmed = nextNoteMatch > 0
      ? sectionText.slice(0, nextNoteMatch + 300)
      : sectionText.slice(0, 7000);

    return {
      text: trimmed.trim(),
      found: true,
      header: matchedPattern,
    };
  }

  // Call Claude
  async function callClaude(prompt, maxTokens = 1500) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
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

  // ── ACTIONS ─────────────────────────────────────────────────────────────────

  try {

    // ── COMPARE ─────────────────────────────────────────────────────────────
    if (action === "compare") {
      if (!companyA || !yearA || !companyB || !yearB || !noteSection) {
        return res.status(400).json({ error: "All fields are required." });
      }

      // Fetch both filings in parallel
      async function getFilingText(company, year) {
        const { cik, cikRaw, name } = await resolveCIK(company);
        const filing = await findFiling(cik, year);
        const docUrl = await getDocumentURL(cikRaw, filing.accessionNo);
        const section = await extractNoteSection(docUrl, noteSection);
        return { name, cik: cikRaw, filing, section, docUrl };
      }

      let dataA, dataB;
      try {
        [dataA, dataB] = await Promise.all([
          getFilingText(companyA, yearA),
          getFilingText(companyB, yearB),
        ]);
      } catch (e) {
        return res.status(502).json({ error: `Filing retrieval failed: ${e.message}` });
      }

      // Check if we found the sections
      const foundA = dataA.section.found;
      const foundB = dataB.section.found;

      const textA = dataA.section.text || `[${noteSection} section not found in ${dataA.name} ${yearA} 10-K]`;
      const textB = dataB.section.text || `[${noteSection} section not found in ${dataB.name} ${yearB} 10-K]`;

      const sourceNote = (!foundA || !foundB)
        ? `Note: ${!foundA ? `${dataA.name} ${yearA}` : `${dataB.name} ${yearB}`} — section was not clearly identified in the filing. Results may be incomplete.`
        : null;

      // Ask Claude to compare the REAL extracted text
      const prompt = `You are a senior technical accountant. Compare the following ACTUAL text extracted directly from two SEC 10-K annual filings.

These are real filing excerpts — not summaries. Do not invent or add any information not present in the text below.

═══ ${dataA.name} (${yearA}) — ${noteSection} ═══
${textA.slice(0, 5000)}

═══ ${dataB.name} (${yearB}) — ${noteSection} ═══
${textB.slice(0, 5000)}

Compare these two disclosures and identify 8-10 key dimensions of difference or similarity. Focus on what an analyst or investment banker would find most important.

Return ONLY valid JSON, no markdown fences, no explanation before or after:
{
  "meta": {
    "companyA": "${dataA.name}",
    "yearA": "${yearA}",
    "companyB": "${dataB.name}",
    "yearB": "${yearB}",
    "note": "${noteSection}"
  },
  "rows": [
    { "dimension": "Name of key disclosure point", "a": "What Company A discloses", "b": "What Company B discloses" }
  ],
  "summary": "2-3 sentences on the most significant differences. Reference specific numbers or policy choices from the actual text.",
  "keyInsight": "Single most important finding from comparing these real filings."
}`;

      const claudeText = await callClaude(prompt, 2000);
      let parsed;
      try {
        parsed = extractJSON(claudeText);
      } catch (e) {
        return res.status(500).json({ error: "Could not parse comparison. Please try again." });
      }

      if (!parsed.rows || parsed.rows.length === 0) {
        return res.status(500).json({ error: "No comparison rows returned. Try again." });
      }

      // Attach source URLs and note any issues
      parsed.sourceA = dataA.docUrl;
      parsed.sourceB = dataB.docUrl;
      parsed.sourceNote = sourceNote;
      parsed.dataSource = "SEC EDGAR — actual 10-K filing text";

      return res.status(200).json(parsed);
    }

    // ── SENTIMENT ───────────────────────────────────────────────────────────
    if (action === "sentiment") {
      if (!tableData || !noteSection) return res.status(400).json({ error: "Missing data." });

      const tableText = tableData.rows
        .map(r => `${r.dimension}: ${tableData.meta.companyA}="${r.a}" vs ${tableData.meta.companyB}="${r.b}"`)
        .join("\n");

      const prompt = `You are a financial analyst assessing disclosure language in actual SEC 10-K filings.

Analyze the tone and sentiment of these disclosures for the "${noteSection}" note:
${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB})

Comparison data extracted from actual filings:
${tableText}

Return ONLY valid JSON, no markdown:
{
  "overallA": "Positive or Neutral or Cautious or Negative",
  "scoreA": 7,
  "summaryA": "2 sentences on the tone and language of Company A",
  "overallB": "Positive or Neutral or Cautious or Negative",
  "scoreB": 6,
  "summaryB": "2 sentences on the tone and language of Company B",
  "comparison": "2 sentences comparing both",
  "redflags": "Any concerning disclosures, or null"
}`;

      const text = await callClaude(prompt, 800);
      let sentiment;
      try { sentiment = extractJSON(text); }
      catch (e) { return res.status(500).json({ error: "Could not parse sentiment. Try again." }); }
      return res.status(200).json({ sentiment });
    }

    // ── ASK ─────────────────────────────────────────────────────────────────
    if (action === "ask") {
      if (!question || !tableData) return res.status(400).json({ error: "Missing question or data." });

      const tableText = tableData.rows
        .map(r => `${r.dimension}: ${tableData.meta.companyA}="${r.a}" | ${tableData.meta.companyB}="${r.b}"`)
        .join("\n");

      const prompt = `You are a senior financial analyst. Answer based ONLY on the actual SEC filing data below.

${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB}) — ${tableData.meta.note}
Data source: ${tableData.dataSource || "SEC EDGAR 10-K filings"}

Filing data:
${tableText}

Summary: ${tableData.summary}

Question: ${question}

Answer directly in 2-4 sentences. If the answer requires information not in the data above, say so explicitly.`;

      const answer = await callClaude(prompt, 600);
      return res.status(200).json({ answer: answer.trim() });
    }

    return res.status(400).json({ error: "Unknown action." });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error. Please try again." });
  }
}
