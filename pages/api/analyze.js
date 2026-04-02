export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: "Ticker is required" });

  const sym = ticker.trim().toUpperCase();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  // Direct link to this company's 10-K filings on SEC EDGAR — always works, no scraping needed
  const edgarUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sym}&type=10-K&dateb=&owner=include&count=10`;

  const prompt = `You are a financial analyst explaining a company's annual report to someone with zero finance background — like a smart friend who doesn't follow markets.

Give a factual breakdown of the most recent 10-K annual report for US stock ticker: ${sym}

Use your knowledge of this company's SEC filings. Be specific and accurate with numbers. State clearly what fiscal year the data is from. If this is not a US-listed public company, say so.

Respond in EXACTLY this format — start with %%META%% immediately, no text before it:

%%META%%
name|[Full legal company name]
period|[Fiscal year end date e.g. December 31, 2024]
filed|[10-K filing date e.g. February 26, 2025]
cik|[SEC CIK number if known, else UNKNOWN]
revenue|[e.g. $88.9M or N/A]
netincome|[e.g. -$112.3M or $4.2B or N/A]
opincome|[e.g. -$98.4M or N/A]
assets|[e.g. $242.1M or N/A]
liabilities|[e.g. $198.3M or N/A]
equity|[e.g. $43.8M or N/A]
cash|[e.g. $67.2M or N/A]
debt|[e.g. $85.1M or N/A]
eps|[e.g. -$0.42 or $6.11 or N/A]
ocf|[e.g. -$54.2M or N/A]
employees|[e.g. 800 or N/A]
%%END%%

%%ANALYSIS%%
##What does this company do?
[2-3 plain-English sentences. Zero jargon.]

##How's the business actually doing?
[3-4 sentences using the real numbers. Profitable? Growing? Be direct and specific.]

##Is the balance sheet healthy?
[3-4 sentences on assets, debt and cash. Explain what the numbers mean for a regular person.]

##What to watch out for
- [specific risk grounded in the actual numbers]
- [second specific one]
- [third specific one]

##The verdict
[1-2 punchy honest sentences. Good, cautious, or neutral right now?]
%%END%%`;

  try {
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.json().catch(() => ({}));
      return res.status(claudeResp.status).json({ error: err?.error?.message || `API error ${claudeResp.status}` });
    }

    const data = await claudeResp.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    if (!text.trim()) return res.status(500).json({ error: "Empty response. Please try again." });

    return res.status(200).json({ text, edgarUrl });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error. Please try again." });
  }
}
