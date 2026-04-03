export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const secApiKey   = process.env.SEC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  if (!secApiKey)    return res.status(500).json({ error: "SEC_API_KEY not configured" });

  const { action, companyA, yearA, companyB, yearB, noteSection, tableData, question } = req.body;

  // ── Claude helper (with retry on 429) ─────────────────────────────────────
  async function callClaude(prompt, maxTokens, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
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
      if (resp.ok) {
        const data = await resp.json();
        return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      }
      if (resp.status === 429 && attempt < retries) {
        console.log(`[DEBUG] Rate limited (429), waiting 8s before retry ${attempt + 1}`);
        await new Promise(r => setTimeout(r, 8000));
        continue;
      }
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Claude API error ${resp.status}`);
    }
  }

  // ── JSON extractor ─────────────────────────────────────────────────────────
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

  // ── HTML → structured text ─────────────────────────────────────────────────
  async function fetchItem8(filingUrl) {
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
      .replace(/[ \t]{3,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!plain || plain.length < 1000) throw new Error("Could not extract filing text.");
    console.log(`[DEBUG] Full filing text length: ${plain.length}`);
    return plain;
  }

  // ── Find where notes start in Item 8 ──────────────────────────────────────
  function findNotesStart(text) {
    const markers = [
      /see accompanying notes to (?:consolidated )?financial statements/gi,
      /the accompanying notes are an integral part/gi,
      /see notes to (?:consolidated )?financial statements/gi,
    ];

    let lastIdx = -1;
    for (const re of markers) {
      let m;
      while ((m = re.exec(text)) !== null) {
        const endOfLine = text.indexOf("\n", m.index + m[0].length);
        if (endOfLine > lastIdx) lastIdx = endOfLine;
      }
    }

    if (lastIdx > 0 && lastIdx < text.length * 0.9) {
      console.log("[DEBUG] findNotesStart: found equity statement footer at char " + lastIdx);
      return lastIdx;
    }

    const fallback = Math.floor(text.length * 0.15);
    console.log("[DEBUG] findNotesStart: using fallback at char " + fallback);
    return fallback;
  }

  // ── Build note index ───────────────────────────────────────────────────────
  function buildNoteIndex(text) {
    const notes = [];

    const re1 = /(?:^|\n)\s{0,6}(?:NOTE\s+|Note\s+)(\d{1,2})[.\s\-]+([A-Z][^\n]{4,80})/gm;
    const re2 = /(?:^|\n)\s{0,4}(\d{1,2})\.\s+([A-Z][A-Z\s]{4,60})\n/gm;
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

    const seen = new Set();
    return notes
      .sort((a, b) => a.startIdx - b.startIdx)
      .filter(n => { if (seen.has(n.num)) return false; seen.add(n.num); return true; });
  }

  // ── Note question map ──────────────────────────────────────────────────────
  const NOTE_QUESTIONS = {
    "Business Combinations & Acquisitions":
      "What companies did {company} acquire during FY{year}? For each acquisition provide: target company name, acquisition date, total purchase price (cash and stock), goodwill recognized, identifiable intangibles, contingent consideration or earnouts. NOTE: ignore any note about the company going public via SPAC or reverse merger — that is not an acquisition of another company.",
    "Goodwill & Intangible Assets":
      "What is {company}'s goodwill balance as of FY{year} year-end, how did it change during the year, what are the reporting units, was any impairment recorded, and what intangible assets are on the balance sheet with carrying values and amortization periods?",
    "Long-term Debt & Credit Facilities":
      "What debt does {company} carry as of FY{year}? For each facility: type, outstanding balance, interest rate, maturity date, and key covenants.",
    "Share-Based Compensation":
      "What stock-based compensation did {company} recognize in FY{year}? Include total expense by function, award types, key assumptions, unrecognized cost, and any modifications.",
    "Income Taxes":
      "What was {company}'s income tax provision in FY{year}? Include effective tax rate, current vs deferred components, rate reconciliation items, deferred tax assets and liabilities, and valuation allowances.",
    "Leases (ASC 842)":
      "What lease obligations does {company} carry under ASC 842 as of FY{year}? Include ROU assets, lease liabilities, weighted average terms and rates, and future payment schedule.",
    "Commitments & Contingencies":
      "What material commitments and contingencies does {company} disclose as of FY{year}? Include legal proceedings, purchase obligations, and guarantees.",
    "Earnings Per Share":
      "What were {company}'s basic and diluted EPS for FY{year}? Include weighted average shares, dilutive securities, and any antidilutive items excluded.",
    "Summary of Significant Accounting Policies":
      "What are {company}'s most important accounting policies as of FY{year}? Focus on revenue recognition, consolidation, significant estimates, policy changes, and unusual policies.",
    "Revenue Recognition":
      "How does {company} recognize revenue in FY{year}? Include performance obligations, transaction price allocation, timing of recognition, contract assets and liabilities, disaggregation of revenue by type or geography, and any significant judgments.",
    "Fair Value Measurements":
      "What does {company} disclose about fair value measurements in FY{year}? Include the Level 1, 2, and 3 hierarchy breakdown, assets and liabilities measured at fair value, valuation techniques, and any transfers between levels.",
    "Segment Information":
      "What operating segments does {company} report in FY{year}? For each segment provide: revenue, operating income or loss, total assets, and any reconciling items to consolidated totals. Include the basis of segmentation.",
    "Related Party Transactions":
      "What related party transactions does {company} disclose in FY{year}? Include the nature of the relationship, transaction amounts, balances outstanding, and terms of any agreements.",
    "Restructuring Charges":
      "What restructuring charges did {company} record in FY{year}? Include the program name or description, total charges by type (severance, facilities, etc.), cash vs non-cash components, amounts paid, and remaining liability.",
    "Pension & Post-Retirement Benefits":
      "What pension and post-retirement benefit obligations does {company} carry in FY{year}? Include projected benefit obligation, plan assets, funded status, net periodic benefit cost, key actuarial assumptions, and expected future contributions.",
    "Derivative Instruments & Hedging":
      "What derivative instruments and hedging activities does {company} disclose in FY{year}? Include hedge types (cash flow, fair value, net investment), notional amounts, fair values, gains and losses recognized, and risk management objectives.",
  };

  // ── Extract note section via Claude ───────────────────────────────────────
  async function findAndExtractNote(item8Text, notesStartIdx, targetNote, companyName, year) {
    const question = (NOTE_QUESTIONS[targetNote] ||
      "What does {company} disclose about {note} in FY{year}?")
      .replace(/{company}/g, companyName)
      .replace(/{year}/g, year || "")
      .replace(/{note}/g, targetNote);

    const textToSend = item8Text.slice(notesStartIdx, notesStartIdx + 100000);

    console.log("[DEBUG] " + companyName + " sending " + textToSend.length +
      " chars (~" + Math.round(textToSend.length / 4) + " tokens) for: " + targetNote);

    const prompt =
      "You are a technical accountant reading " + companyName + "'s FY" + (year || "") + " 10-K annual report (Item 8: Financial Statements and Notes).\n\n" +
      "Answer this question:\n" +
      question + "\n\n" +
      "Full filing text (Item 8):\n" +
      textToSend + "\n\n" +
      "CRITICAL GUARDRAILS:\n" +
      "- Every single fact, figure, date, and dollar amount in your answer MUST appear verbatim in the filing text above\n" +
      "- If you cannot find specific information in the text above, say explicitly: 'Not disclosed in this filing'\n" +
      "- Do NOT use your training knowledge to fill in gaps — only use what is in the text above\n" +
      "- Do NOT say 'see Note X' — extract the actual content from the text provided\n" +
      "- If information appears in multiple places in the filing, combine it into a complete answer";

    try {
      const result = await callClaude(prompt, 2500);
      console.log("[DEBUG] " + companyName + " done, response: " + result.length + " chars");
      return { text: result.trim(), resolvedTitle: targetNote };
    } catch (e) {
      console.log("[DEBUG] " + companyName + " error: " + e.message);
      return { text: null, resolvedTitle: targetNote };
    }
  }

  // ── ACTIONS ────────────────────────────────────────────────────────────────
  try {

    if (action === "compare") {
      if (!companyA || !companyB || !noteSection)
        return res.status(400).json({ error: "Missing required fields." });

      const [filingA, filingB] = await Promise.all([
        findFiling(companyA, yearA),
        findFiling(companyB, yearB),
      ]);

      const [item8A, item8B] = await Promise.all([
        fetchItem8(filingA.url),
        fetchItem8(filingB.url),
      ]);

      const startA = findNotesStart(item8A);
      const startB = findNotesStart(item8B);

      // Sequential — small gap between calls to reduce 429 risk on large filings
      const extractedA = await findAndExtractNote(item8A, startA, noteSection, filingA.companyName, yearA);
      await new Promise(r => setTimeout(r, 2000));
      const extractedB = await findAndExtractNote(item8B, startB, noteSection, filingB.companyName, yearB);

      const trimA = extractedA.text || `[${noteSection} not found in ${filingA.companyName} FY${yearA}]`;
      const trimB = extractedB.text || `[${noteSection} not found in ${filingB.companyName} FY${yearB}]`;

      const comparePrompt = `You are a senior technical accountant comparing two SEC 10-K filings.

Company A: ${filingA.companyName} (FY${yearA})
Company B: ${filingB.companyName} (FY${yearB})
Note Section: ${noteSection}

=== ${filingA.companyName} FY${yearA} ===
${trimA.slice(0, 5000)}

=== ${filingB.companyName} FY${yearB} ===
${trimB.slice(0, 5000)}

Compare on 8-10 specific dimensions. Use ONLY information from the filing text above.
Reference specific dollar amounts, dates, and terms. Note asymmetries explicitly.

Respond with ONLY valid JSON:
{
  "rows": [{ "dimension": "Name", "a": "Company A detail", "b": "Company B detail" }],
  "summary": "2-3 sentence analyst summary",
  "keyInsight": "Single most important difference"
}`;

      const rawComparison = await callClaude(comparePrompt, 2000);
      if (!rawComparison || !rawComparison.includes("{")) {
        throw new Error("Claude did not return a valid response. Please try again.");
      }
      const parsed = extractJSON(rawComparison);
      if (!parsed.rows || parsed.rows.length === 0)
        return res.status(500).json({ error: "Could not parse comparison. Please try again." });

      parsed.meta = { companyA: filingA.companyName, companyB: filingB.companyName, yearA, yearB, note: noteSection };
      parsed.sourceA = filingA.url;
      parsed.sourceB = filingB.url;
      parsed.sourceNote = `Section names auto-resolved — ${filingA.companyName}: "${extractedA.resolvedTitle}" · ${filingB.companyName}: "${extractedB.resolvedTitle}"`;
      parsed.rawTextA = trimA.slice(0, 20000);
      parsed.rawTextB = trimB.slice(0, 20000);
      parsed.notesContextA = trimA.slice(0, 20000);
      parsed.notesContextB = trimB.slice(0, 20000);
      return res.status(200).json(parsed);
    }

    if (action === "sentiment") {
      if (!tableData) return res.status(400).json({ error: "Missing data." });
      const tableText = tableData.rows.map(r =>
        `${r.dimension}: ${tableData.meta.companyA}="${r.a}" | ${tableData.meta.companyB}="${r.b}"`
      ).join("\n");

      const sentParsed = extractJSON(await callClaude(
        `Rate disclosure tone for each filing. Respond ONLY with valid JSON:
{"overallA":"Positive|Neutral|Cautious|Negative","scoreA":7,"summaryA":"2 sentences","overallB":"Positive|Neutral|Cautious|Negative","scoreB":6,"summaryB":"2 sentences","comparison":"1 sentence","redflags":"any red flags or null"}

${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB}) — ${noteSection}
${tableText}`, 600));
      return res.status(200).json({ sentiment: sentParsed });
    }

    if (action === "ask") {
      if (!question || !tableData) return res.status(400).json({ error: "Missing question or data." });
      const tableText = tableData.rows.map(r =>
        `${r.dimension}: ${tableData.meta.companyA}="${r.a}" | ${tableData.meta.companyB}="${r.b}"`
      ).join("\n");

      const rawA = tableData.notesContextA || tableData.rawTextA || "";
      const rawB = tableData.notesContextB || tableData.rawTextB || "";

      function extractRelevantContext(fullText, q) {
        if (!fullText || fullText.length < 100) return "";
        const keywords = q.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/)
          .filter(w => w.length > 4 && !["give","what","show","tell","much","many","does","have","from","this","that","which","their","about"].includes(w));
        let bestIdx = 0, bestScore = 0;
        for (let i = 0; i < fullText.length - 500; i += 500) {
          const score = keywords.filter(kw => fullText.slice(i, i+500).toLowerCase().includes(kw)).length;
          if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
        return fullText.slice(Math.max(0, bestIdx - 200), bestIdx + 4000);
      }

      const contextA = extractRelevantContext(rawA, question);
      const contextB = extractRelevantContext(rawB, question);
      const hasContext = contextA.length > 50 || contextB.length > 50;

      const askResult = await callClaude(
        `You are a senior financial analyst answering questions about SEC 10-K filings.

${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB}) — ${tableData.meta.note}

${hasContext ? `=== FILING TEXT ===\n${tableData.meta.companyA}:\n${contextA}\n\n${tableData.meta.companyB}:\n${contextB}\n\n=== COMPARISON SUMMARY ===` : "=== COMPARISON DATA ==="}
${tableText}

Question: ${question}

Use markdown tables for structured data, bullet points for lists, **bold** for key figures.
Answer from the filing data only. Be specific with dollar amounts, dates, and terms.`, 1500);

      return res.status(200).json({ answer: askResult });
    }

    return res.status(400).json({ error: "Unknown action." });

  } catch (err) {
    console.error("[ERROR] Unhandled exception:", err.message, err.stack);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
