export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const secApiKey   = process.env.SEC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  if (!secApiKey)    return res.status(500).json({ error: "SEC_API_KEY not configured" });

  const { action, companyA, yearA, companyB, yearB, noteSection, tableData, question } = req.body;

  // ── Claude helper ──────────────────────────────────────────────────────────
  async function callClaude(prompt, maxTokens) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens || 1500,
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

  // ── Company resolution ─────────────────────────────────────────────────────
  function buildSearchQuery(input, year) {
    const yearInt = parseInt(year);
    const clean = input.trim();
    const upper = clean.toUpperCase();
    const isTicker = /^[A-Z]{1,5}$/.test(upper);

    if (isTicker) {
      return {
        primary:  `ticker:${upper} AND formType:"10-K" AND periodOfReport:[${year}-01-01 TO ${year}-12-31]`,
        fallback: `ticker:${upper} AND formType:"10-K" AND filedAt:[${year}-01-01 TO ${yearInt + 1}-06-30]`,
      };
    }

    const stripped = clean.replace(/\s+(Inc\.?|Corp\.?|LLC\.?|Ltd\.?|Incorporated|Corporation|Limited)$/i, "").trim();
    return {
      primary:   `companyName:"${clean}" AND formType:"10-K" AND periodOfReport:[${year}-01-01 TO ${year}-12-31]`,
      fallback1: `companyName:"${stripped}" AND formType:"10-K" AND filedAt:[${year}-01-01 TO ${yearInt + 1}-06-30]`,
      fallback2: `companyName:${stripped.split(" ")[0]} AND formType:"10-K" AND filedAt:[${year}-01-01 TO ${yearInt + 1}-06-30]`,
      fallback3: `ticker:${upper} AND formType:"10-K" AND filedAt:[${year}-01-01 TO ${yearInt + 1}-06-30]`,
    };
  }

  async function findFiling(company, year) {
    const queries = buildSearchQuery(company, year);
    const queryList = Object.values(queries).filter(Boolean);
    let lastError = null;
    for (const q of queryList) {
      try {
        const resp = await fetch(`https://api.sec-api.io?token=${secApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, from: "0", size: "3", sort: [{ filedAt: { order: "desc" } }] }),
        });
        if (!resp.ok) { lastError = `sec-api.io HTTP ${resp.status}`; continue; }
        const data = await resp.json();
        const filings = data.filings || [];
        if (filings.length > 0) {
          const f = filings[0];
          return { url: f.linkToHtmlAnnualReport || f.linkToFilingDetails, companyName: f.companyName, ticker: f.ticker, filedAt: f.filedAt, period: f.periodOfReport };
        }
        lastError = `No 10-K found: ${q}`;
      } catch (e) { lastError = e.message; }
    }
    throw new Error(`Could not find 10-K for "${company}" FY${year}. ${lastError || ""}`);
  }

  // ── HTML → structured text (preserves tables) ──────────────────────────────
  async function fetchItem8(filingUrl) {
    // Use type=text — clean, reliable, no HTML parsing fragility
    const extractUrl = `https://api.sec-api.io/extractor?url=${encodeURIComponent(filingUrl)}&item=8&type=text&token=${secApiKey}`;
    const resp = await fetch(extractUrl);
    if (resp.ok) {
      const text = await resp.text();
      if (text && text.trim().length > 5000) {
        console.log(`[DEBUG] Item 8 text length: ${text.length}`);
        return text;
      }
      console.log(`[DEBUG] Item 8 too short (${text.length} chars), fetching full filing`);
    }

    // Fallback: full filing HTML → strip to plain text
    // Used when Item 8 is a stub (e.g. financials filed as separate exhibit)
    console.log(`[DEBUG] Fetching full filing from: ${filingUrl}`);
    const fullResp = await fetch(filingUrl, {
      headers: { "User-Agent": "10KCompare research@10kcompare.app" },
    });
    if (!fullResp.ok) throw new Error(`Could not fetch filing (HTTP ${fullResp.status})`);
    const buffer = await fullResp.arrayBuffer();
    const rawHtml = new TextDecoder().decode(buffer.slice(0, 15000000));
    const plain = rawHtml
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#\d+;/g, " ")
      .replace(/[ 	]{3,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!plain || plain.length < 1000) throw new Error("Could not extract filing text.");
    console.log(`[DEBUG] Full filing text length: ${plain.length}`);
    return plain;
  }

  // ── Find where notes start in Item 8 (skip auditor report) ────────────────
  function findNotesStart(text) {
    // Strategy: find ALL occurrences of the notes header,
    // then pick the one followed by the most note content
    // (i.e. the one where Note 1, Note 2... actually follow).
    // This handles filings where the header appears in TOC,
    // at the actual notes start, AND again as a late-section label.

    // Strategy: find the notes header WITHOUT "(Continued)" — that's the real start.
    // "(Continued)" headers appear on every page and are pagination artifacts.
    // We want the FIRST clean occurrence after any table of contents reference.

    // First pass: look for clean header (no "Continued")
    const cleanRe = /(?:^|\n)[ \t]*NOTES TO (?:CONSOLIDATED )?FINANCIAL STATEMENTS[ \t]*\n/gi;
    const cleanCandidates = [];
    let cm;
    while ((cm = cleanRe.exec(text)) !== null) cleanCandidates.push(cm.index);

    if (cleanCandidates.length > 0) {
      // Skip the first one if it looks like a TOC entry (within first 5% of document)
      const tocThreshold = text.length * 0.05;
      const afterToc = cleanCandidates.filter(idx => idx > tocThreshold);
      if (afterToc.length > 0) return afterToc[0];
      return cleanCandidates[cleanCandidates.length - 1];
    }

    // Fallback: any notes header, filter last 15%, take last remaining
    const allRe = /NOTES TO (?:CONSOLIDATED )?FINANCIAL STATEMENTS/gi;
    const allCandidates = [];
    let am;
    while ((am = allRe.exec(text)) !== null) allCandidates.push(am.index);

    if (allCandidates.length === 0) return Math.floor(text.length * 0.2);

    const threshold = text.length * 0.85;
    const filtered  = allCandidates.filter(idx => idx < threshold);
    if (filtered.length > 0) {
      // Take FIRST candidate after TOC (not last — avoids "(Continued)" pages)
      const tocThreshold = text.length * 0.05;
      const afterToc = filtered.filter(idx => idx > tocThreshold);
      if (afterToc.length > 0) return afterToc[0];
      return filtered[0];
    }

    if (allCandidates.length > 1) return allCandidates[allCandidates.length - 2];
    return allCandidates[0];
  
  }

  // ── Build note index from full notes text ──────────────────────────────────
  function buildNoteIndex(text) {
    const notes = [];

    // Pattern 1: "NOTE 1 —" / "Note 2." with explicit NOTE keyword
    const re1 = /(?:^|\n)\s{0,6}(?:NOTE\s+|Note\s+)(\d{1,2})[.\s\-]+([A-Z][^\n]{4,80})/gm;
    // Pattern 2: "1. TITLE" at line start
    const re2 = /(?:^|\n)\s{0,4}(\d{1,2})\.\s+([A-Z][A-Z\s]{4,60})\n/gm;
    // Pattern 4: Microsoft-style "19 SEGMENT INFORMATION" — number space ALL-CAPS title
    const re4 = /(?:^|\n)\s{0,4}(\d{1,2})\s+([A-Z]{2,}(?:\s+[A-Z]{2,}){0,8})(?=\s+[A-Z][a-z]|\s*\n)/gm;

for (const re of [re1, re2, re4]) {
      let m;
      while ((m = re.exec(text)) !== null) {
        const num   = parseInt(m[1]);
        const title = m[2].trim().replace(/\s+/g, " ");
        if (num >= 1 && num <= 40 && title.length > 4) {
          notes.push({ num, title, startIdx: m.index });
        }
      }
    }

    // Pattern 3: Apple-style — find known section titles as uppercase headings
    if (notes.length < 3) {
      const keywords = [
        "REVENUE RECOGNITION", "SEGMENT INFORMATION", "INCOME TAXES",
        "BUSINESS COMBINATIONS", "GOODWILL", "SHARE-BASED COMPENSATION",
        "LEASES", "FAIR VALUE", "COMMITMENTS", "EARNINGS PER SHARE",
        "RESTRUCTURING", "RELATED PARTY", "GEOGRAPHIC",
        "SUMMARY OF SIGNIFICANT", "BASIS OF PRESENTATION",
      ];
      let synthetic = 1;
      for (const kw of keywords) {
        const idx = text.toUpperCase().indexOf(kw);
        if (idx > 0) {
          const lineEnd = text.indexOf("\n", idx);
          const title = text.slice(idx, lineEnd > 0 ? lineEnd : idx + 80).trim();
          notes.push({ num: synthetic++, title, startIdx: idx, synthetic: true });
        }
      }
    }

    // Deduplicate by note number, sort by position
    const seen = new Set();
    return notes
      .sort((a, b) => a.startIdx - b.startIdx)
      .filter(n => { if (seen.has(n.num)) return false; seen.add(n.num); return true; });
  }

  // ── Find and extract the relevant note section ─────────────────────────────
  // Plain-English question map — each dropdown item maps to a specific question
  // Claude answers from the full filing text rather than hunting for a specific note
  const NOTE_QUESTIONS = {
    "Business Combinations & Acquisitions":
      "What companies did {company} acquire during FY{year}? For each acquisition provide: target company name, acquisition date, total purchase price (cash and stock components), goodwill recognized, identifiable intangibles acquired, contingent consideration or earnout provisions, and how the acquisition was accounted for. NOTE: ignore any note about the company's own SPAC or reverse merger going-public transaction — that is not an acquisition.",
    "Goodwill & Intangible Assets":
      "What is {company}'s goodwill balance as of FY{year} year-end, how did it change during the year, what are the reporting units, was any impairment recorded, and what intangible assets are on the balance sheet with their carrying values and amortization periods?",
    "Long-term Debt & Credit Facilities":
      "What debt does {company} carry as of FY{year}? For each facility: type, outstanding balance, interest rate, maturity date, key covenants, and any significant changes during the year.",
    "Share-Based Compensation":
      "What stock-based compensation did {company} recognize in FY{year}? Include total expense by function (R&D, G&A, sales), types of awards (options, RSUs, PSUs), key assumptions, unrecognized compensation cost, and any modifications.",
    "Income Taxes":
      "What was {company}'s income tax provision in FY{year}? Include effective tax rate, current vs deferred components, major rate reconciliation items, deferred tax assets and liabilities, valuation allowances, and unrecognized tax benefits.",
    "Leases (ASC 842)":
      "What lease obligations does {company} carry under ASC 842 as of FY{year}? Include operating and finance lease ROU assets, lease liabilities, weighted average terms and discount rates, and future payment schedule.",
    "Commitments & Contingencies":
      "What material commitments and contingencies does {company} disclose as of FY{year}? Include legal proceedings, purchase obligations, guarantees, and how management has assessed them.",
    "Earnings Per Share":
      "What were {company}'s basic and diluted EPS for FY{year}? Show weighted average shares, dilutive securities, and any items affecting per share figures.",
    "Summary of Significant Accounting Policies":
      "What are {company}'s most important accounting policies as of FY{year}? Focus on revenue recognition, basis of consolidation, significant estimates, any policy changes, and policies that differ from common industry practice.",
  };

  async function findAndExtractNote(item8Text, notesStartIdx, targetNote, companyName, year) {
    // Get the plain-English question for this note section
    const questionTemplate = NOTE_QUESTIONS[targetNote] ||
      `What does ${companyName}'s FY${year} 10-K disclose about ${targetNote}? Provide all key facts, figures, and policy details.`;

    const question = questionTemplate
      .replace(/{company}/g, companyName)
      .replace(/{year}/g, year || "");

    // Use full Item 8 text — don't restrict by notesStartIdx
    // This ensures we find content wherever it appears in the filing
    const fullText = item8Text;
    // Send up to 12000 chars starting from notes section
    const textChunk = fullText.slice(notesStartIdx, notesStartIdx + 12000);

    console.log(`[DEBUG] ${companyName} extracting: "${targetNote}", notesStartIdx: ${notesStartIdx}`);

    const prompt = `You are a technical accountant reading ${companyName}'s FY${year || ""} 10-K annual report (Item 8: Financial Statements and Notes).

Answer this specific question from the filing text below:
${question}

Filing text:
${textChunk}

Instructions:
- Answer ONLY from what is in the text above
- If the answer spans multiple notes, include all relevant details
- Quote specific dollar amounts, dates, and terms from the filing
- If this chunk does not contain the answer, say "NOT IN THIS SECTION"

Provide your answer as a detailed paragraph or structured list.`;

    try {
      const result = await callClaude(prompt, 1500);

      if (result.includes("NOT IN THIS SECTION") && fullText.length > notesStartIdx + 12000) {
        // Try next chunk
        console.log(`[DEBUG] ${companyName} not in first chunk, trying next 12000 chars`);
        const chunk2 = fullText.slice(notesStartIdx + 8000, notesStartIdx + 24000);
        const prompt2 = prompt.replace(textChunk, chunk2);
        const result2 = await callClaude(prompt2, 1500);
        if (!result2.includes("NOT IN THIS SECTION")) {
          return { text: result2.trim(), resolvedTitle: targetNote };
        }
      }

      return { text: result.trim(), resolvedTitle: targetNote };
    } catch(e) {
      console.log(`[DEBUG] ${companyName} error: ${e.message}`);
      return { text: null, resolvedTitle: targetNote };
    }
  }

  // ── ACTIONS ────────────────────────────────────────────────────────────────
  try {

    // ── COMPARE ───────────────────────────────────────────────────────────────
    if (action === "compare") {
      if (!companyA || !yearA || !companyB || !yearB || !noteSection) {
        return res.status(400).json({ error: "All fields are required." });
      }

      let filingA, filingB, item8A, item8B;
      try {
        [filingA, filingB] = await Promise.all([findFiling(companyA, yearA), findFiling(companyB, yearB)]);
        [item8A,  item8B]  = await Promise.all([fetchItem8(filingA.url),    fetchItem8(filingB.url)]);
      } catch (e) {
        return res.status(502).json({ error: `Filing retrieval failed: ${e.message}` });
      }

      const startA = findNotesStart(item8A);
      const startB = findNotesStart(item8B);

      const [extractedA, extractedB] = await Promise.all([
        findAndExtractNote(item8A, startA, noteSection, filingA.companyName, yearA),
        findAndExtractNote(item8B, startB, noteSection, filingB.companyName, yearB),
      ]);

      const trimA = extractedA.text || `[${noteSection} not found in ${filingA.companyName} FY${yearA}]`;
      const trimB = extractedB.text || `[${noteSection} not found in ${filingB.companyName} FY${yearB}]`;
      const resolvedTitleA = extractedA.resolvedTitle;
      const resolvedTitleB = extractedB.resolvedTitle;

      const combinedPrompt = `You are a senior technical accountant comparing actual SEC 10-K filing disclosures.

DO NOT invent or add anything not present in the filing text below.

=== FILING A: ${filingA.companyName} FY${yearA} ===
Filed: ${filingA.filedAt?.slice(0, 10)} | Period: ${filingA.period}
Note as filed: "${resolvedTitleA}"
${trimA.slice(0, 5000)}

=== FILING B: ${filingB.companyName} FY${yearB} ===
Filed: ${filingB.filedAt?.slice(0, 10)} | Period: ${filingB.period}
Note as filed: "${resolvedTitleB}"
${trimB.slice(0, 5000)}

Instructions:
- Compare these two filings on 8-10 specific dimensions relevant to "${noteSection}"
- Use ONLY information present in the filing answers above — do not invent anything
- Reference specific dollar amounts, dates, company names, and terms from the actual filing text
- If one filing has information the other lacks, note that asymmetry explicitly

Respond with ONLY valid JSON, no markdown:
{
  "meta": {
    "companyA": "${filingA.companyName}",
    "yearA": "${yearA}",
    "companyB": "${filingB.companyName}",
    "yearB": "${yearB}",
    "note": "${noteSection}"
  },
  "resolvedTitleA": "${resolvedTitleA}",
  "resolvedTitleB": "${resolvedTitleB}",
  "rows": [
    { "dimension": "dimension name", "a": "Filing A disclosure", "b": "Filing B disclosure" },
    { "dimension": "dimension name", "a": "Filing A disclosure", "b": "Filing B disclosure" },
    { "dimension": "dimension name", "a": "Filing A disclosure", "b": "Filing B disclosure" },
    { "dimension": "dimension name", "a": "Filing A disclosure", "b": "Filing B disclosure" },
    { "dimension": "dimension name", "a": "Filing A disclosure", "b": "Filing B disclosure" },
    { "dimension": "dimension name", "a": "Filing A disclosure", "b": "Filing B disclosure" }
  ],
  "summary": "2-3 sentences on key differences with specific numbers.",
  "keyInsight": "Single most important finding."
}`;

      const claudeText = await callClaude(combinedPrompt, 3000);
      let parsed;
      try {
        parsed = extractJSON(claudeText);
      } catch (e) {
        const preview = claudeText.slice(0, 300).replace(/\n/g, " ");
        return res.status(500).json({ error: `JSON parse failed. Claude returned: ${preview}` });
      }

      if (!parsed.rows || parsed.rows.length === 0) {
        const preview = JSON.stringify(parsed).slice(0, 300);
        return res.status(500).json({ error: `Rows were empty. Parsed: ${preview}` });
      }

      const sourceNote = (resolvedTitleA !== noteSection || resolvedTitleB !== noteSection)
        ? `Section names auto-resolved — ${filingA.companyName}: "${resolvedTitleA}" · ${filingB.companyName}: "${resolvedTitleB}"`
        : null;

      parsed.sourceA    = filingA.url;
      parsed.sourceB    = filingB.url;
      parsed.sourceNote = sourceNote;
      parsed.dataSource = "SEC EDGAR via sec-api.io — actual 10-K filing text";
      // Store raw extracted text for Q&A (truncated to keep response size reasonable)
      // Store extracted note text for Q&A (20k chars of the specific note)
      parsed.rawTextA   = trimA.slice(0, 20000);
      parsed.rawTextB   = trimB.slice(0, 20000);
      // Store the FULL notes section for Q&A — no cap
      // Microsoft's Note 19 can be at character 80,000+ so we need everything
      parsed.notesContextA = item8A.slice(startA);
      parsed.notesContextB = item8B.slice(startB);
      return res.status(200).json(parsed);
    }

    // ── SENTIMENT ─────────────────────────────────────────────────────────────
    if (action === "sentiment") {
      if (!tableData || !noteSection) return res.status(400).json({ error: "Missing data." });
      const tableText = tableData.rows.map(r => `${r.dimension}: ${tableData.meta.companyA}="${r.a}" vs ${tableData.meta.companyB}="${r.b}"`).join("\n");
      const prompt = `Analyze disclosure tone from actual 10-K filing data.
${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB}) — ${noteSection}
${tableText}
Return ONLY valid JSON:
{
  "overallA": "Positive or Neutral or Cautious or Negative", "scoreA": 7,
  "summaryA": "2 sentences on Company A tone",
  "overallB": "Positive or Neutral or Cautious or Negative", "scoreB": 6,
  "summaryB": "2 sentences on Company B tone",
  "comparison": "2 sentences comparing both",
  "redflags": "Any red flags, or null"
}`;
      const text = await callClaude(prompt, 800);
      let sentiment;
      try { sentiment = extractJSON(text); }
      catch (e) { return res.status(500).json({ error: "Could not parse sentiment." }); }
      return res.status(200).json({ sentiment });
    }

    // ── ASK ────────────────────────────────────────────────────────────────────
    if (action === "ask") {
      if (!question || !tableData) return res.status(400).json({ error: "Missing question or data." });
      const tableText = tableData.rows.map(r => `${r.dimension}: ${tableData.meta.companyA}="${r.a}" | ${tableData.meta.companyB}="${r.b}"`).join("\n");

      // Use raw extracted filing text if available (much richer than summary table)
      // Use full notes context if available (broader search), fallback to extracted note
      const rawA = tableData.notesContextA || tableData.rawTextA || "";
      const rawB = tableData.notesContextB || tableData.rawTextB || "";

      // Smart context extraction: search for question keywords in the full notes text
      // instead of always taking the first 6000 chars (which misses late notes)
      function extractRelevantContext(fullText, q) {
        if (!fullText || fullText.length < 100) return "";
        const keywords = q.toLowerCase()
          .replace(/[^a-z\s]/g, "").split(/\s+/)
          .filter(w => w.length > 4 && !["give","what","show","tell","much","many","does","have","from","this","that","which","their","about"].includes(w));

        let bestIdx = -1;

        // First pass: look for keyword hits near tables or dollar amounts
        for (const kw of keywords) {
          let pos = 0;
          while (pos < fullText.length) {
            const found = fullText.toLowerCase().indexOf(kw, pos);
            if (found === -1) break;
            const nearby = fullText.slice(Math.max(0, found - 300), found + 300);
            const isNearData = nearby.includes(" | ") ||
              /\$[\d,]+/.test(nearby) || /\d+,\d{3}/.test(nearby);
            if (isNearData && (bestIdx === -1 || found < bestIdx)) {
              bestIdx = found;
              break;
            }
            pos = found + 1;
          }
        }

        // Second pass: look for any hit if no data-adjacent hit found
        if (bestIdx === -1) {
          for (const kw of keywords) {
            const found = fullText.toLowerCase().indexOf(kw, 500);
            if (found > 0 && (bestIdx === -1 || found < bestIdx)) bestIdx = found;
          }
        }

        if (bestIdx > 200) {
          const start = Math.max(0, bestIdx - 500);
          return fullText.slice(start, start + 8000);
        }
        return fullText.slice(0, 8000);
      }

      const contextA = extractRelevantContext(rawA, question);
      const contextB = extractRelevantContext(rawB, question);
      const hasContext = contextA.length > 100 || contextB.length > 100;

      const prompt = `You are a senior financial analyst answering a question about actual SEC 10-K filings.

${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB}) — ${tableData.meta.note}

${hasContext ? `=== FILING TEXT ===

${tableData.meta.companyA}:
${contextA}

${tableData.meta.companyB}:
${contextB}

=== COMPARISON SUMMARY ===` : "=== COMPARISON DATA ==="}
${tableText}

Question: ${question}

Formatting instructions:
- Use a markdown table (| Col | Col | headers |) when the answer has multiple transactions, companies, or structured line items — this makes the answer much easier to read
- Use bullet points (-) for lists of facts
- Use **bold** for key figures, company names, and dates
- Write in plain English — no filler phrases
- Include specific dollar amounts, dates, and terms directly from the filing
- If the data does not contain enough to answer, say so directly`
      const answer = await callClaude(prompt, 1500);
      return res.status(200).json({ answer: answer.trim() });
    }

    return res.status(400).json({ error: "Unknown action." });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error. Please try again." });
  }
}
