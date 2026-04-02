export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: "Ticker is required" });

  const sym = ticker.trim().toUpperCase();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured on server" });

  const prompt = `You are a financial analyst with deep expertise in SEC filings. Give a factual breakdown of the most recent 10-K annual report for US stock ticker: ${sym}

Respond in EXACTLY this format. Start immediately with %%META%% — no text before it:

%%META%%
name|[Full legal company name]
period|[e.g. December 31, 2023]
filed|[e.g. February 2, 2024]
cik|[10-digit CIK or UNKNOWN]
revenue|[e.g. $383.3B or N/A]
netincome|[e.g. $97.0B or -$2.7B or N/A]
opincome|[e.g. $114.3B or N/A]
assets|[e.g. $352.6B or N/A]
liabilities|[e.g. $290.0B or N/A]
equity|[e.g. $62.1B or N/A]
cash|[e.g. $29.9B or N/A]
debt|[e.g. $106.6B or N/A]
eps|[e.g. $6.13 or -$1.42 or N/A]
ocf|[e.g. $116.4B or N/A]
employees|[e.g. 150,000 or N/A]
%%END%%

%%ANALYSIS%%
##What does this company do?
[2-3 plain-English sentences. Zero jargon. Write like texting a smart friend.]

##How's the business actually doing?
[3-4 sentences. Use the real numbers. Growing? Profitable? Be direct.]

##Is the balance sheet healthy?
[3-4 sentences. Cash vs debt in plain human terms.]

##What to watch out for
- [specific data-backed risk]
- [second specific one]
- [third specific one]

##The verdict
[1-2 punchy sentences. Honest take: exciting, concerning, or steady?]
%%END%%`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
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

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err?.error?.message || `Anthropic API error ${response.status}` });
    }

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    if (!text.trim()) return res.status(500).json({ error: "Empty response from Claude" });

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
