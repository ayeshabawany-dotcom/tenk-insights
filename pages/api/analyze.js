export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const { action, companyA, yearA, companyB, yearB, noteSection, tableData, question } = req.body;

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
    // Strip markdown code fences if present
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    // Find first { and last }
    const start = cleaned.indexOf("{");
    const end   = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON found in response");
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  try {

    // ── COMPARE ───────────────────────────────────────────────────────────────
    if (action === "compare") {
      if (!companyA || !yearA || !companyB || !yearB || !noteSection) {
        return res.status(400).json({ error: "All fields are required." });
      }

      const prompt = `You are a senior technical accountant comparing SEC 10-K filings.

Compare the "${noteSection}" note from:
- Company A: ${companyA}, fiscal year ${yearA}
- Company B: ${companyB}, fiscal year ${yearB}

Use your knowledge of actual SEC 10-K filings. Extract 8 to 12 key disclosure dimensions specific to this note type.

Return ONLY a valid JSON object — no markdown, no explanation, nothing else before or after the JSON:

{
  "meta": {
    "companyA": "${companyA}",
    "yearA": "${yearA}",
    "companyB": "${companyB}",
    "yearB": "${yearB}",
    "note": "${noteSection}"
  },
  "rows": [
    {
      "dimension": "Name of disclosure dimension",
      "a": "Company A value or disclosure text",
      "b": "Company B value or disclosure text"
    }
  ],
  "summary": "2-3 sentences on the most important differences. Be specific with numbers.",
  "keyInsight": "Single most important takeaway in plain English."
}`;

      const text = await callClaude(prompt, 1800);
      let parsed;
      try {
        parsed = extractJSON(text);
      } catch (e) {
        console.error("JSON parse failed:", text.slice(0, 500));
        return res.status(500).json({ error: "Could not parse comparison response. Please try again." });
      }

      if (!parsed.rows || parsed.rows.length === 0) {
        return res.status(500).json({ error: "No comparison rows returned. Try different inputs." });
      }

      return res.status(200).json(parsed);
    }

    // ── SENTIMENT ─────────────────────────────────────────────────────────────
    if (action === "sentiment") {
      if (!tableData || !noteSection) return res.status(400).json({ error: "Missing data." });

      const tableText = tableData.rows
        .map(r => `${r.dimension}: ${tableData.meta.companyA}="${r.a}" vs ${tableData.meta.companyB}="${r.b}"`)
        .join("\n");

      const prompt = `You are a financial analyst assessing disclosure sentiment in 10-K filings.

Analyze the tone and sentiment of these two companies' "${noteSection}" disclosures:
${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB})

Data:
${tableText}

Return ONLY valid JSON, no markdown or extra text:

{
  "overallA": "Positive or Neutral or Cautious or Negative",
  "scoreA": 7,
  "summaryA": "2 sentences on tone and language of Company A disclosures",
  "overallB": "Positive or Neutral or Cautious or Negative",
  "scoreB": 6,
  "summaryB": "2 sentences on tone and language of Company B disclosures",
  "comparison": "2 sentences comparing the sentiment of both companies",
  "redflags": "Description of any red flags, or null if none"
}`;

      const text = await callClaude(prompt, 800);
      let sentiment;
      try {
        sentiment = extractJSON(text);
      } catch (e) {
        return res.status(500).json({ error: "Could not parse sentiment. Try again." });
      }
      return res.status(200).json({ sentiment });
    }

    // ── ASK ───────────────────────────────────────────────────────────────────
    if (action === "ask") {
      if (!question || !tableData) return res.status(400).json({ error: "Missing question or data." });

      const tableText = tableData.rows
        .map(r => `${r.dimension}: ${tableData.meta.companyA}="${r.a}" | ${tableData.meta.companyB}="${r.b}"`)
        .join("\n");

      const prompt = `You are a senior financial analyst. Answer the question below using ONLY the comparison data provided.

Comparison: ${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB})
Note section: ${tableData.meta.note}

Data:
${tableText}

Summary: ${tableData.summary}

Question: ${question}

Give a direct, specific answer in 2-4 sentences. If you go beyond the data provided, say so explicitly.`;

      const answer = await callClaude(prompt, 600);
      return res.status(200).json({ answer: answer.trim() });
    }

    return res.status(400).json({ error: "Unknown action." });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error. Please try again." });
  }
}
