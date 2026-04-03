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
  // Convert HTML table to readable markdown-style text
  // Preserves all numbers and labels that would be lost in plain text extraction
  function htmlTableToText(html) {
    let result = "";
    // Find all tables
    const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tMatch;
    while ((tMatch = tableRe.exec(html)) !== null) {
      const tableHtml = tMatch[1];
      const rows = [];
      // Find all rows
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rMatch;
      while ((rMatch = rowRe.exec(tableHtml)) !== null) {
        const cells = [];
        // Find all cells (th or td)
        const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let cMatch;
        while ((cMatch = cellRe.exec(rMatch[1])) !== null) {
          // Strip HTML from cell content, decode entities, trim
          const cellText = cMatch[1]
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&#\d+;/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (cellText) cells.push(cellText);
        }
        if (cells.length > 0) rows.push(cells.join(" | "));
      }
      if (rows.length > 0) result += rows.join("\n") + "\n\n";
    }
    return result;
  }

  // Convert full HTML to mixed text — preserves table data as structured rows
  // while keeping surrounding prose intact
  function htmlToMixedText(html) {
    // Step 1: Replace tables with structured text representation
    const withTables = html.replace(
      /<table[^>]*>[\s\S]*?<\/table>/gi,
      (tableHtml) => "\n[TABLE]\n" + htmlTableToText(tableHtml) + "[/TABLE]\n"
    );
    // Step 2: Strip remaining HTML tags
    return withTables
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#\d+;/g, " ")
      .replace(/[ 	]{3,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function fetchItem8(filingUrl) {
    // Request HTML (not text) so we preserve table structure
    const extractUrl = `https://api.sec-api.io/extractor?url=${encodeURIComponent(filingUrl)}&item=8&type=html&token=${secApiKey}`;
    const resp = await fetch(extractUrl);
    if (resp.ok) {
      const html = await resp.text();
      if (html && html.trim().length > 5000) {
        const mixed = htmlToMixedText(html);
        console.log(`[DEBUG] Item 8 HTML converted, length: ${mixed.length}`);
        return mixed;
      }
      console.log(`[DEBUG] Item 8 HTML too short (${html.length} chars), falling back to full filing`);
    }

    // Fallback: fetch the full filing HTML directly
    // Used when Item 8 is a stub pointing to separate exhibit (e.g. Synaptics)
    console.log(`[DEBUG] Fetching full filing HTML from: ${filingUrl}`);
    const fullResp = await fetch(filingUrl, {
      headers: { "User-Agent": "10KCompare research@10kcompare.app" },
    });
    if (!fullResp.ok) throw new Error(`Could not fetch filing document (HTTP ${fullResp.status})`);

    const buffer = await fullResp.arrayBuffer();
    const rawHtml = new TextDecoder().decode(buffer.slice(0, 15_000_000));
    const mixed = htmlToMixedText(rawHtml);

    if (!mixed || mixed.length < 1000) {
      throw new Error("Could not extract filing text. The document may be in an unsupported format.");
    }

    console.log(`[DEBUG] Full filing HTML converted, length: ${mixed.length}`);
    return mixed;
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

        // Pattern 1: "NOTE 1 —", "Note 2.", "NOTE 3 " (explicit NOTE keyword)
        const re1 = /(?:^|
)\s{0,6}(?:NOTE\s+|Note\s+)(\d{1,2})[.\s\-—–]+([A-Z][^
]{4,80})/gm;
        // Pattern 2: "1. TITLE" or "1 TITLE" at line start (numbered without NOTE keyword)
        const re2 = /(?:^|
)\s{0,4}(\d{1,2})\.\s+([A-Z][A-Z\s]{4,60})
/gm;
        // Pattern 3: Apple-style — uppercase title alone on a line (no number)
        // We assign synthetic numbers based on order found
        const re3 = /(?:^|
)((?:REVENUE RECOGNITION|SEGMENT INFORMATION|INCOME TAXES|BUSINESS COMBINATIONS|GOODWILL|SHARE-BASED COMPENSATION|LEASES|FAIR VALUE|COMMITMENTS|EARNINGS PER SHARE|RESTRUCTURING|RELATED PARTY|GEOGRAPHIC)[^
]{0,60})
/gm;

        for (const re of [re1, re2]) {
          let m;
          while ((m = re.exec(text)) !== null) {
            const num   = parseInt(m[1]);
            const title = m[2].trim().replace(/\s+/g, " ");
            if (num >= 1 && num <= 40 && title.length > 4) {
              notes.push({ num, title, startIdx: m.index });
            }
          }
        }

        // If very few numbered notes found, try Apple-style uppercase headers
        if (notes.length < 3) {
          let syntheticNum = 1;
          let m;
          while ((m = re3.exec(text)) !== null) {
            const title = m[1].trim().replace(/\s+/g, " ");
            notes.push({ num: syntheticNum++, title, startIdx: m.index, synthetic: true });
          }
        }

        // Deduplicate by note number (keep first occurrence)
        const seen = new Set();
        return notes
          .sort((a, b) => a.startIdx - b.startIdx)
          .filter(n => {
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
          const matchPrompt = `You are a technical accountant. From this list of note titles in ${companyName}'s 10-K, identify ALL notes that contain information about: "${targetNote}"

${companyName} note list:
${titleList}

Important context:
- Some companies have a standalone note titled exactly "${targetNote}" — use it as primary
- BUT: that standalone note sometimes contains ONLY tables (e.g. deferred revenue schedule) with no policy language
- In that case, also include "Summary of Significant Accounting Policies" or "Basis of Presentation" as a related note — because that is where Apple, Google and others embed their actual recognition policies
- The actual revenue BREAKDOWN by product/segment/geography is often in a SEPARATE note (e.g. "Segment Information", "Disaggregation of Revenue", "Geographic Information")
- Always return the primary note AND any related notes that contain either (a) the actual policy text or (b) revenue breakdown tables
- "Business Combinations" might be "Acquisitions" or "Business Acquisitions and Divestitures"
- "Share-Based Compensation" might be "Stock-Based Compensation" or "Equity Awards"
- If "${targetNote}" is not a standalone note at all, look inside "Summary of Significant Accounting Policies"

Return ONLY JSON:
{
  "primaryNote": { "noteNumber": 3, "noteTitle": "exact title" },
  "relatedNotes": [{ "noteNumber": 15, "noteTitle": "exact title", "reason": "contains revenue breakdown tables" }],
  "confidence": "high/medium/low"
}
If nothing matches: { "primaryNote": null, "relatedNotes": [], "confidence": "low" }`;

          try {
            const matchResult = await callClaude(matchPrompt, 300);
            const matchParsed = extractJSON(matchResult);

            // Support both old format {noteNumber} and new format {primaryNote, relatedNotes}
            const primaryNum = matchParsed.primaryNote?.noteNumber ?? matchParsed.noteNumber ?? null;
            const relatedNums = (matchParsed.relatedNotes || []).map(n => n.noteNumber).filter(Boolean);

            if (primaryNum) {
              const matched = index.find(n => n.num === Number(primaryNum));
              if (matched) {
                resolvedTitle = matched.title;
                noteStart = matched.startIdx;
                const nextNote = index.find(n => n.num > matched.num);
                noteEnd = nextNote ? nextNote.startIdx : matched.startIdx + 10000;

                // Collect related note texts separately (e.g. segment note with revenue tables)
                // Store them for concatenation after primary extraction
                const relatedTexts = [];
                for (const relNum of relatedNums) {
                  const rel = index.find(n => n.num === Number(relNum));
                  if (rel && rel.num !== matched.num) {
                    const relNext = index.find(n => n.num > rel.num);
                    const relEnd = relNext ? relNext.startIdx : rel.startIdx + 8000;
                    const relText = fullNotes.slice(rel.startIdx, Math.min(relEnd, rel.startIdx + 6000));
                    resolvedTitle += ` + Note ${rel.num}: ${rel.title.slice(0, 60)}`;
                    relatedTexts.push(`\n\n=== Related: Note ${rel.num} — ${rel.title} ===\n${relText}`);
                  }
                }
                // Store related texts for use after extraction
                if (relatedTexts.length > 0) {
                  noteEnd = noteEnd; // keep primary note end as-is
                  // Attach related texts to be appended after primary extraction
                  return {
                    text: fullNotes.slice(noteStart, Math.min(noteEnd, noteStart + 6000)) + relatedTexts.join(""),
                    resolvedTitle
                  };
                }
              } else {
                console.log(`[DEBUG] ${companyName} index:`, index.map(n => `${n.num}:${n.title}`).join(' | '));
              }
            }
          } catch (e) {
            // Fall through to keyword search below
          }
        }

        // Fallback: keyword search across full notes text
        // Also used when note index is small (< 3 notes) — Apple, Google style filings
        if (noteStart === -1 || index.length < 3) {
          // Search for the most specific keywords from the target note name
          const kwList = targetNote.toLowerCase()
            .replace(/[^a-z\s]/g, "").split(/\s+/)
            .filter(w => w.length > 4 && !["notes","financial","statements","information"].includes(w));

          let bestIdx = -1;
          for (const kw of kwList) {
            const idx = fullNotes.toLowerCase().indexOf(kw);
            if (idx > 100 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
          }

          if (bestIdx > 0 && noteStart === -1) {
            noteStart = Math.max(0, bestIdx - 500);
            noteEnd   = noteStart + 8000;
          } else if (index.length < 3 && bestIdx > 0) {
            // Supplement existing extraction with direct keyword hit if it's in a different area
            const kwStart = Math.max(0, bestIdx - 500);
            if (Math.abs(kwStart - noteStart) > 2000) {
              const kwText = fullNotes.slice(kwStart, kwStart + 5000);
              return {
                text: (noteStart >= 0 ? fullNotes.slice(noteStart, Math.min(noteEnd, noteStart + 4000)) : "") + "

=== Direct keyword match ===
" + kwText,
                resolvedTitle
              };
            }
          } else if (noteStart === -1) {
            noteStart = 0;
            noteEnd   = 8000;
          }
        }

        let extracted = fullNotes.slice(noteStart, Math.min(noteEnd, noteStart + 6000));

        // Debug: log extraction stats
        const tableStripped = extracted.replace(/\[TABLE\][\s\S]*?\[\/TABLE\]/g, "").trim();
        console.log(`[DEBUG] ${companyName} extracted length: ${extracted.length}, prose length: ${tableStripped.length}, noteStart: ${noteStart}, noteEnd: ${noteEnd}`);

        // Safeguard: if extracted text is short or table-heavy with no prose,
        // also append Note 1 (Summary of Significant Accounting Policies)
        // because many large companies embed recognition policies there
        const hasProseContent = extracted.replace(/\[TABLE\][\s\S]*?\[\/TABLE\]/g, "").trim().length > 500;
        if (!hasProseContent && index.length > 0) {
          const note1 = index.find(n => n.num === 1);
          if (note1 && note1.startIdx !== noteStart) {
            const note1Next = index.find(n => n.num > 1);
            const note1End = note1Next ? note1Next.startIdx : note1.startIdx + 8000;
            const note1Text = fullNotes.slice(note1.startIdx, Math.min(note1End, note1.startIdx + 6000));
            resolvedTitle += " + Note 1: Summary of Significant Accounting Policies";
            extracted = extracted + "\n\n=== Note 1: Summary of Significant Accounting Policies ===\n" + note1Text;
          }
        }

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
- Find the relevant note section in each filing (note titles may differ between companies)
- Compare them on 8-10 specific dimensions
- Use ONLY information present in the text above — do not invent anything
- Tables appear between [TABLE] and [/TABLE] markers with columns separated by " | " — READ THESE carefully
- REQUIRED: If there are revenue breakdown tables (by product, segment, geography, customer type), extract ALL figures and include them as dedicated comparison rows
- REQUIRED: Show actual dollar amounts and percentages from tables, not just policy language
- Reference specific dollar amounts, percentages, and policy language from the actual filing text
- Separate rows for: (1) accounting policy, (2) revenue by product/type, (3) revenue by geography, (4) revenue by customer, (5) timing of recognition — wherever data exists

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
