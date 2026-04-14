export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { action, keywords, startDate, endDate, ticker, cik, accessionNo, companyName, filedAt } = req.body;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function stripHtml(html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#\d+;/g, " ")
      .replace(/[ \t]{3,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function callClaude(prompt, maxTokens) {
    for (let attempt = 0; attempt <= 1; attempt++) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: maxTokens || 1200,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      }
      if (resp.status === 429 && attempt === 0) {
        await new Promise(r => setTimeout(r, 8000));
        continue;
      }
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || "Claude API error " + resp.status);
    }
  }

  // ── ACTIONS ────────────────────────────────────────────────────────────────
  try {

    // ── SEARCH ──────────────────────────────────────────────────────────────
    if (action === "search") {
      if (!keywords || !keywords.trim())
        return res.status(400).json({ error: "Keywords required." });

      // ── Claude query rewriter ────────────────────────────────────────────
      // If input looks like natural language, rewrite to EDGAR phrase syntax
      let searchQuery = keywords.trim();
      let queryRewritten = false;
      const looksNatural = !keywords.includes('"') && !keywords.includes(" AND ") && !keywords.includes(" OR ") && keywords.trim().split(/\s+/).length > 2;

      if (looksNatural) {
        try {
          const rewritePrompt =
            "You are a CPA and SEC filing expert with deep knowledge of US GAAP and SEC disclosure rules.\n\n" +
            "Convert the user search intent into an EDGAR 8-K full-text search query.\n\n" +
            "EDGAR uses Lucene-style syntax: quoted phrases for exact matches, space = AND.\n\n" +
            "CRITICAL ACCOUNTING DISTINCTIONS you must apply:\n" +
            "- ASSET ACQUISITION (ASC 805-50): Company buys specific assets (IP, contracts, customer lists, equipment). \n" +
            "  NO goodwill. NO subsidiary formed. Language: \"asset purchase agreement\", \"acquired certain assets\", \"does not constitute a business\"\n" +
            "- BUSINESS COMBINATION (ASC 805-10): Company acquires another entity or business. \n" +
            "  Goodwill recognized. Language: \"merger agreement\", \"acquisition of all outstanding shares\", \"acquired [Company Name]\", \"subsidiary\"\n" +
            "- These are MUTUALLY EXCLUSIVE. Never mix phrases from both categories.\n\n" +
            "More distinctions:\n" +
            "- LICENSE AGREEMENT: Company licenses IP/technology, does not own it. Language: \"license agreement\", \"royalty\", \"sublicense\"\n" +
            "- ASSET SALE (divestiture): Company is the seller. Language: \"sold certain assets\", \"divestiture\", \"purchase and sale agreement\"\n\n" +
            "Rules:\n" +
            "- Use 2-4 quoted phrases that ONLY appear when the specific event actually happened\n" +
            "- Pick phrases from the narrative/announcement section of 8-Ks, not boilerplate\n" +
            "- Output ONLY the query string, nothing else, no explanation\n\n" +
            "Examples:\n" +
            "Input: company acquired customer relationships as an asset\n" +
            "Output: \"asset purchase agreement\" \"customer relationships\" \"does not constitute a business\"\n\n" +
            "Input: company acquired customer contracts\n" +
            "Output: \"asset purchase agreement\" \"customer contracts\" \"assumed liabilities\"\n\n" +
            "Input: company acquired another company\n" +
            "Output: \"merger agreement\" \"aggregate consideration\" \"outstanding shares\"\n\n" +
            "Input: company licensed technology\n" +
            "Output: \"license agreement\" \"royalty\" \"intellectual property\"\n\n" +
            "Input: CEO resigned suddenly\n" +
            "Output: \"resigned\" \"effective\" \"chief executive\"\n\n" +
            "Input: company raised debt financing\n" +
            "Output: \"credit facility\" \"aggregate principal\" \"borrowings\"\n\n" +
            "Input: data breach affecting customers\n" +
            "Output: \"unauthorized access\" \"personal information\" \"cybersecurity incident\"\n\n" +
            "Now convert this input (apply the correct accounting category):\n" +
            keywords.trim();

          const rewritten = await callClaude(rewritePrompt, 120);
          const cleaned = rewritten.trim().replace(/^["`]|["`]$/g, "").trim();
          if (cleaned && cleaned.length > 3 && cleaned.length < 300) {
            console.log("[DEBUG] Query rewrite: \"" + keywords.trim() + "\" → " + cleaned);
            searchQuery = cleaned;
            queryRewritten = true;
          }
        } catch (e) {
          console.log("[DEBUG] Query rewrite failed, using original:", e.message);
        }
      }

      let url = "https://efts.sec.gov/LATEST/search-index?q=" + encodeURIComponent(searchQuery) + "&forms=8-K";
      if (startDate || endDate) {
        url += "&dateRange=custom";
        if (startDate) url += "&startdt=" + startDate;
        if (endDate)   url += "&enddt="   + endDate;
      }
      if (ticker && ticker.trim()) {
        url += "&entity=" + encodeURIComponent(ticker.trim());
      }

      console.log("[DEBUG] EDGAR EFTS search:", url);

      const searchResp = await fetch(url, {
        headers: {
          "User-Agent": "10KCompare research@10kcompare.app",
          "Accept": "application/json",
        },
      });

      if (!searchResp.ok) {
        throw new Error("EDGAR search returned HTTP " + searchResp.status + ". Try narrowing your date range or keywords.");
      }

      const raw = await searchResp.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.log("[DEBUG] EDGAR response (first 300):", raw.slice(0, 300));
        throw new Error("EDGAR returned unexpected response. Try again or narrow your search.");
      }

      const hits = (data.hits && data.hits.hits) ? data.hits.hits.slice(0, 20) : [];

      // Log first hit _source to see actual EDGAR field names
      if (hits.length > 0) console.log("[DEBUG] EDGAR _source:", JSON.stringify(hits[0]._source || {}));

      const results = hits.map(function(hit) {
        const src = hit._source || {};

        // Accession number: prefer _source field, fall back to _id (EDGAR uses _id as accession no)
        const accNo = src.accession_no || hit._id || "";
        const accNoClean = accNo.replace(/-/g, "");

        // CIK: try _source fields first, then derive from accession number prefix
        // Accession numbers are formatted 0001234567-YY-NNNNNN — first segment is zero-padded CIK
        let entityId = src.entity_id || src.cik || "";
        if (!entityId && accNo) {
          const firstSegment = accNo.split("-")[0];
          if (firstSegment) entityId = String(parseInt(firstSegment, 10));
        }

        // Extract highlight snippets — strip <em> tags, keep surrounding text
        const hlValues = Object.values(hit.highlight || {}).flat();
        const snippets = hlValues
          .slice(0, 3)
          .map(function(s) {
            return s.replace(/<em>/g, "**").replace(/<\/em>/g, "**").replace(/<[^>]+>/g, "").trim();
          })
          .filter(function(s) { return s.length > 20; });

        // Direct link to this specific filing index page
        const filingLink = entityId && accNoClean && accNo
          ? "https://www.sec.gov/Archives/edgar/data/" + entityId + "/" + accNoClean + "/" + accNo + "-index.htm"
          : "";

        // Fallback: company filing list (less useful but always works)
        const edgarLink = entityId
          ? "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + entityId + "&type=8-K&dateb=&owner=include&count=10"
          : "";

        return {
          id: hit._id || accNo || Math.random().toString(36).slice(2),
          companyName: src.entity_name || src.company_name || src.name || src.display_names || (src.displayNames && src.displayNames[0]) || "Unknown",
          ticker: src.ticker || "",
          filedAt: src.file_date || "",
          period: src.period_of_report || "",
          formType: src.form_type || "8-K",
          accessionNo: accNo,
          cik: entityId,
          accNoClean,
          filingLink,
          edgarLink,
          snippets,
        };
      });

      const total = (data.hits && data.hits.total) ? (data.hits.total.value || data.hits.total || 0) : 0;

      // ── Relevance filter using real filing text ───────────────────────────
      // Snippets are too short to determine transaction type reliably.
      // Instead: fetch first 3000 chars of actual filing for each candidate
      // in parallel, then run ONE Claude call to filter with real text.
      // Cap at 8 candidates to keep parallel fetches fast (<5s total).
      let filteredResults = results;
      const candidates = results.slice(0, 8);

      async function fetchFilingPreview(r) {
        try {
          if (!r.cik || !r.accNoClean || !r.accessionNo) return { r, preview: "" };
          const indexUrl = "https://www.sec.gov/Archives/edgar/data/" + r.cik + "/" + r.accNoClean + "/" + r.accessionNo + "-index.htm";
          const indexResp = await fetch(indexUrl, { headers: { "User-Agent": "10KCompare research@10kcompare.app" } });
          if (!indexResp.ok) return { r, preview: "" };
          const indexHtml = await indexResp.text();
          const linkMatches = indexHtml.matchAll(/href="(\/Archives\/edgar\/data\/[^"]+\.htm)"/gi);
          const links = [];
          for (const m of linkMatches) {
            if (!m[1].includes("-index")) links.push("https://www.sec.gov" + m[1]);
          }
          if (links.length === 0) return { r, preview: "" };
          const docResp = await fetch(links[0], { headers: { "User-Agent": "10KCompare research@10kcompare.app" } });
          if (!docResp.ok) return { r, preview: "" };
          const buf = await docResp.arrayBuffer();
          const raw = new TextDecoder().decode(buf.slice ? buf.slice(0, 500000) : buf);
          const plain = stripHtml(raw).slice(0, 3000);
          return { r, preview: plain };
        } catch (e) {
          return { r, preview: "" };
        }
      }

      try {
        const previews = await Promise.all(candidates.map(fetchFilingPreview));

        const filingBlock = previews.map(function(p, i) {
          return (i + 1) + ". Company: " + p.r.companyName + " | Filed: " + p.r.filedAt + "\n" +
            "Text: " + (p.preview || p.r.snippets.join(" … ") || "(unavailable)");
        }).join("\n\n---\n\n");

        const filterPrompt =
          "You are a CPA with deep knowledge of US GAAP (ASC 805) and SEC 8-K disclosure rules.\n\n" +
          "The user searched for: \"" + keywords.trim() + "\"\n\n" +
          "Below are " + candidates.length + " 8-K filings. Read the text of each and decide if it actually matches what the user was looking for.\n\n" +
          "Apply these STRICT accounting distinctions:\n" +
          "- ASSET ACQUISITION (ASC 805-50): buys specific named assets (IP, contracts, customer lists, equipment). No goodwill. No entity acquired. Filing says things like \"asset purchase agreement\", \"acquired certain assets\", \"does not constitute a business\".\n" +
          "- BUSINESS COMBINATION (ASC 805-10): acquires another company or entity. Goodwill likely. Filing says \"merger agreement\", \"acquired [Company Name]\", \"all outstanding shares\", \"subsidiary\".\n" +
          "- LICENSE: rights to use, not ownership. Filing says \"license agreement\", \"royalty\", \"sublicense\".\n" +
          "- DIVESTITURE: company is the seller not buyer.\n\n" +
          "If the filing is a different transaction type than searched, return NO.\n" +
          "If genuinely ambiguous, return YES.\n" +
          "If text is unavailable, return YES.\n\n" +
          "Return ONLY a JSON array of the 1-based indexes of RELEVANT filings. Example: [1, 3, 4]\n\n" +
          filingBlock;

        const filterResp = await callClaude(filterPrompt, 400);
        const cleaned = filterResp.replace(/```json|```/g, "").trim();
        const start = cleaned.indexOf("[");
        const end = cleaned.lastIndexOf("]");
        if (start !== -1 && end !== -1) {
          const keepIndexes = JSON.parse(cleaned.slice(start, end + 1));
          if (Array.isArray(keepIndexes) && keepIndexes.length > 0) {
            filteredResults = keepIndexes
              .filter(function(i) { return typeof i === "number" && i >= 1 && i <= candidates.length; })
              .map(function(i) { return candidates[i - 1]; });
            console.log("[DEBUG] Relevance filter: kept " + filteredResults.length + " of " + candidates.length);
          } else {
            filteredResults = candidates;
          }
        } else {
          filteredResults = candidates;
        }
      } catch (e) {
        console.log("[DEBUG] Relevance filter failed, using candidates:", e.message);
        filteredResults = candidates;
      }

      return res.status(200).json({ results: filteredResults, total, searchQuery, queryRewritten });
    }

    // ── SUMMARIZE ────────────────────────────────────────────────────────────
    if (action === "summarize") {
      if (!cik || !accessionNo)
        return res.status(400).json({ error: "CIK and accession number required." });

      const accNoClean = accessionNo.replace(/-/g, "");
      let text = "";
      let fetchedFrom = "";

      // Step 1: fetch filing index page to find primary document
      const indexUrl = "https://www.sec.gov/Archives/edgar/data/" + cik + "/" + accNoClean + "/" + accessionNo + "-index.htm";
      console.log("[DEBUG] Fetching index:", indexUrl);

      try {
        const indexResp = await fetch(indexUrl, {
          headers: { "User-Agent": "10KCompare research@10kcompare.app" },
        });
        if (indexResp.ok) {
          const indexHtml = await indexResp.text();
          // Find all .htm links in the filing index, excluding the index itself
          const linkMatches = indexHtml.matchAll(/href="(\/Archives\/edgar\/data\/[^"]+\.htm)"/gi);
          const links = [];
          for (const m of linkMatches) {
            const href = "https://www.sec.gov" + m[1];
            if (!href.includes("-index")) links.push(href);
          }

          if (links.length > 0) {
            console.log("[DEBUG] Found primary doc:", links[0]);
            const docResp = await fetch(links[0], {
              headers: { "User-Agent": "10KCompare research@10kcompare.app" },
            });
            if (docResp.ok) {
              const html = await docResp.arrayBuffer();
              const decoded = new TextDecoder().decode(html.slice ? html.slice(0, 5000000) : html);
              text = stripHtml(decoded);
              fetchedFrom = links[0];
            }
          }
        }
      } catch (e) {
        console.log("[DEBUG] Index fetch error:", e.message);
      }

      // Step 2: fallback — try direct accession URL
      if (!text || text.length < 200) {
        const directUrl = "https://www.sec.gov/Archives/edgar/data/" + cik + "/" + accNoClean + "/" + accessionNo + ".htm";
        console.log("[DEBUG] Trying direct URL:", directUrl);
        try {
          const directResp = await fetch(directUrl, {
            headers: { "User-Agent": "10KCompare research@10kcompare.app" },
          });
          if (directResp.ok) {
            text = stripHtml(await directResp.text());
            fetchedFrom = directUrl;
          }
        } catch (e) {
          console.log("[DEBUG] Direct fetch error:", e.message);
        }
      }

      if (!text || text.length < 100) {
        throw new Error(
          "Could not retrieve this 8-K filing text from SEC EDGAR. " +
          "You can view it directly at: https://www.sec.gov/Archives/edgar/data/" + cik + "/" + accNoClean + "/"
        );
      }

      console.log("[DEBUG] Fetched 8-K for", companyName, ":", text.length, "chars from", fetchedFrom);

      const summary = await callClaude(
        "You are a CPA and senior financial analyst summarizing an SEC 8-K filing. You have deep knowledge of US GAAP, ASC 805, and SEC disclosure requirements.\n\n" +
        "Company: " + (companyName || "Unknown") + "\n" +
        "Filed: " + (filedAt || "Unknown") + "\n" +
        "User was searching for: \"" + (keywords || "") + "\"\n\n" +
        "8-K Filing text:\n" +
        text.slice(0, 8000) + "\n\n" +
        "Provide a structured summary using ONLY facts from the filing text above:\n\n" +
        "**Transaction type:** State exactly what kind of event this is. Apply these GAAP distinctions precisely:\n" +
        "- Asset Acquisition (ASC 805-50): acquires specific assets, no goodwill, no entity acquired\n" +
        "- Business Combination (ASC 805): acquires a business or entity, goodwill likely, subsidiary formed\n" +
        "- License Agreement: rights to use IP/technology, no ownership transfer\n" +
        "- Divestiture/Asset Sale: company is selling, not buying\n" +
        "- Other (specify): financing, executive change, legal matter, etc.\n\n" +
        "**Relevance to search:** Does this filing actually match what the user searched for (\"" + (keywords || "") + "\")? \n" +
        "State YES or NO clearly, and explain why in one sentence. Flag if it is a different transaction type than what was searched.\n\n" +
        "**What happened:** 1-2 sentences stating the core event using precise accounting/legal language.\n\n" +
        "**Key details:**\n" +
        "- [Specific assets, entities, dollar amounts, dates from the filing]\n" +
        "- [Any consideration paid: cash, stock, earnouts]\n" +
        "- [Material terms or conditions]\n\n" +
        "**Why it matters:** 1-2 sentences on investor/accounting significance.\n\n" +
        "Be precise. Never infer transaction type from company name or context — only from the filing text. If the filing text is ambiguous, say so.",
        1400
      );

      return res.status(200).json({ summary, sourceUrl: fetchedFrom });
    }

    return res.status(400).json({ error: "Unknown action." });

  } catch (err) {
    console.error("[ERROR] search8k:", err.message, err.stack);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
