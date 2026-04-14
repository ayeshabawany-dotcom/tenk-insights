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

      let url = "https://efts.sec.gov/LATEST/search-index?q=" + encodeURIComponent(keywords.trim()) + "&forms=8-K";
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

      const results = hits.map(function(hit) {
        const src = hit._source || {};
        const accNo = src.accession_no || hit._id || "";
        const entityId = src.entity_id || src.cik || "";
        const accNoClean = accNo.replace(/-/g, "");

        // Extract highlight snippets — strip <em> tags, keep surrounding text
        const hlValues = Object.values(hit.highlight || {}).flat();
        const snippets = hlValues
          .slice(0, 3)
          .map(function(s) {
            return s.replace(/<em>/g, "**").replace(/<\/em>/g, "**").replace(/<[^>]+>/g, "").trim();
          })
          .filter(function(s) { return s.length > 20; });

        const edgarLink = entityId
          ? "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + entityId + "&type=8-K&dateb=&owner=include&count=10"
          : "";

        return {
          id: hit._id || accNo || Math.random().toString(36).slice(2),
          companyName: src.entity_name || "Unknown",
          ticker: src.ticker || "",
          filedAt: src.file_date || "",
          period: src.period_of_report || "",
          formType: src.form_type || "8-K",
          accessionNo: accNo,
          cik: entityId,
          accNoClean,
          edgarLink,
          snippets,
        };
      });

      const total = (data.hits && data.hits.total) ? (data.hits.total.value || data.hits.total || 0) : 0;
      return res.status(200).json({ results, total });
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
        "You are a financial analyst summarizing an SEC 8-K filing for investors.\n\n" +
        "Company: " + (companyName || "Unknown") + "\n" +
        "Filed: " + (filedAt || "Unknown") + "\n" +
        "Search keywords that surfaced this filing: \"" + (keywords || "") + "\"\n\n" +
        "8-K Filing text:\n" +
        text.slice(0, 8000) + "\n\n" +
        "Provide a clear, structured summary:\n\n" +
        "**What happened:** (1-2 sentences on the event type and core disclosure)\n\n" +
        "**Key details:**\n" +
        "- [Specific facts, numbers, dates from the filing]\n" +
        "- [Continue for all material details]\n\n" +
        "**Why it matters:** (1-2 sentences on investor significance)\n\n" +
        "Be specific. Use exact figures and dates from the filing. If information seems missing, note it.",
        1200
      );

      return res.status(200).json({ summary, sourceUrl: fetchedFrom });
    }

    return res.status(400).json({ error: "Unknown action." });

  } catch (err) {
    console.error("[ERROR] search8k:", err.message, err.stack);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
