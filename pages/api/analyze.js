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
      // Skip the audit report — notes start AFTER the financial statements
      // Strategy: find "NOTES TO" or "NOTE 1" which marks the start of the notes section
      function findNotesStart(text) {
        const markers = [
          /NOTES TO CONSOLIDATED FINANCIAL STATEMENTS/i,
          /NOTES TO FINANCIAL STATEMENTS/i,
          /NOTE 1[\s\W]/i,
          /Note 1[\s\W]/i,
          /Notes to the Consolidated/i,
        ];
        for (const m of markers) {
          const idx = text.search(m);
          if (idx !== -1) return idx;
        }
        // Fallback: skip first 3000 chars (audit report area)
        return Math.min(3000, Math.floor(text.length * 0.2));
      }

      const startA = findNotesStart(item8A);
      const startB = findNotesStart(item8B);

      // ── Note index approach — works for Meta, Google, any large filing ──────
      // Strategy:
      //   1. Scan full Item 8 for note headers ("NOTE 1", "Note 2 —" etc)
      //   2. Build an index: [{num, title, startIdx}]
      //   3. Ask Claude which note title best matches the target topic (tiny call, titles only)
      //   4. Extract just that note's text (not the whole Item 8)
      // This handles non-standard titles and scales to 500k-char filings.

      function buildNoteIndex(text) {
        const notes = [];
        // Match patterns like: NOTE 1, Note 2 —, NOTE 3., 4. TITLE, NOTE FOUR
        const headerRe = /(?:^|\n)\s{0,6}(?:NOTE\s+|Note\s+)?(\d{1,2})[.\s\-—–]+([A-Z][^\n]{4,80})/gm;
        let m;
        while ((m = headerRe.exec(text)) !== null) {
          const num   = parseInt(m[1]);
          const title = m[2].trim().replace(/\s+/g, " ");
          if (num >= 1 && num <= 40 && title.length > 4) {
            notes.push({ num, title, startIdx: m.index });
          }
        }
        // Deduplicate by note number (keep first occurrence)
        const seen = new Set();
        return notes.filter(n => {
          if (seen.has(n.num)) return false;
          seen.add(n.num);
          return true;
        });
      }

      async function findAndExtractNote(item8Text, notesStartIdx, targetNote, companyName) {
        const fullNotes = item8Text.slice(notesStartIdx);

        // Build note index from full notes text
        const index = buildNoteIndex(fullNotes);

        let resolvedTitle = targetNote;
        let noteStart = -1;
        let noteEnd = -1;

        console.log(`[DEBUG] ${companyName} note index size: ${index.length}, notesStartIdx: ${notesStartIdx}, item8 length: ${item8Text.length}`);
        if (index.length > 0) {
          // Ask Claude to pick the right note from the title list only (very small call)
          const titleList = index.map(n => `Note ${n.num}: ${n.title}`).join("\n");
          const matchPrompt = `Which note from this list best covers the topic: "${targetNote}"?

${companyName} note list:
${titleList}

Rules:
- The note may NOT use the exact same words as "${targetNote}"
- "Revenue Recognition" might be in "Segment, Customers, and Geographic Information" or "Summary of Significant Accounting Policies"  
- "Business Combinations" might be "Acquisitions" or "Business Acquisitions and Divestitures"
- If multiple notes are relevant, pick the most specific one

Return ONLY JSON: { "noteNumber": 15, "noteTitle": "exact title from list", "confidence": "high/medium/low" }
If nothing matches: { "noteNumber": null, "noteTitle": null, "confidence": "low" }`;

          try {
            const matchResult = await callClaude(matchPrompt, 150);
            const matchParsed = extractJSON(matchResult);
            if (matchParsed.noteNumber) {
              const matched = index.find(n => n.num === matchParsed.noteNumber);
              if (matched) {
                resolvedTitle = matched.title;
                noteStart = matched.startIdx;
                // Find where next note starts to bound our extraction
                const nextNote = index.find(n => n.num > matched.num);
                noteEnd = nextNote ? nextNote.startIdx : matched.startIdx + 10000;
              } else {
                // Debug: log what was found and what Claude picked
                console.log(`[DEBUG] ${companyName} index (${index.length} notes):`, index.map(n => `${n.num}:${n.title}`).join(' | '));
                console.log(`[DEBUG] Claude picked note number:`, matchParsed.noteNumber, matchParsed.noteTitle);
              }
            }
          } catch (e) {
            // Fall through to keyword search below
          }
        }

        // Fallback: keyword search across full notes text
        if (noteStart === -1) {
          const kw = targetNote.toLowerCase().split(/[\s&,]+/).filter(w => w.length > 4)[0] || targetNote.toLowerCase();
          const kwIdx = fullNotes.toLowerCase().indexOf(kw);
          noteStart = kwIdx > 0 ? Math.max(0, kwIdx - 300) : 0;
          noteEnd   = noteStart + 8000;
        }

        const extracted = fullNotes.slice(noteStart, Math.min(noteEnd, noteStart + 8000));
        return { text: extracted, resolvedTitle };
      }

      // Run both note extractions in parallel
      const [extractedA, extractedB] = await Promise.all([
        findAndExtractNote(item8A, startA, noteSection, filingA.companyName),
        findAndExtractNote(item8B, startB, noteSection, filingB.companyName),
      ]);

      const trimA = extractedA.text || `[${noteSection} not found in ${filingA.companyName} FY${yearA}]`;
      const trimB = extractedB.text || `[${noteSection} not found in ${filingB.companyName} FY${yearB}]`;
      const resolvedTitleA = extractedA.resolvedTitle;
      const resolvedTitleB = extractedB.resolvedTitle;

      const combinedPrompt = `You are a senior technical accountant. Analyze two SEC 10-K filings.

TASK: Find the note section about "${noteSection}" in each filing, then compare them.

Note: Companies name notes differently. "Revenue Recognition" may be in "Segment and Revenue Information" or "Revenue from Contracts". "Business Combinations" may be "Acquisitions". Find the best match.

=== FILING A: ${filingA.companyName} FY${yearA} ===
${trimA}

=== FILING B: ${filingB.companyName} FY${yearB} ===
${trimB}

Instructions:
- Find the relevant note section in each filing
- Compare them on 6-8 specific dimensions
- Use ONLY information present in the text above
- Reference actual numbers and specific language from the filings

Respond with ONLY this JSON structure (no markdown, no text before or after):
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
        // Surface raw response for debugging
        const preview = claudeText.slice(0, 300).replace(/\n/g, " ");
        return res.status(500).json({ error: `JSON parse failed. Claude returned: ${preview}` });
      }

      if (!parsed.rows || parsed.rows.length === 0) {
        const preview = JSON.stringify(parsed).slice(0, 300);
        return res.status(500).json({ error: `Rows were empty. Parsed object: ${preview}` });
      }

      const sourceNote = (resolvedTitleA !== noteSection || resolvedTitleB !== noteSection)
        ? `Section names auto-resolved — ${filingA.companyName}: "${resolvedTitleA}" · ${filingB.companyName}: "${resolvedTitleB}"`
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
