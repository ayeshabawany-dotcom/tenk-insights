export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: "Ticker is required" });

  const sym = ticker.trim().toUpperCase();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  // SEC EDGAR requires this exact User-Agent format: "AppName contact@email.com"
  const UA = "TenkInsights contact@tenk-insights.vercel.app";

  try {
    // ── STEP 1: Resolve ticker → CIK ─────────────────────────────────────────
    // Try data.sec.gov first, fall back to www.sec.gov
    let tickersResp = await fetch(
      "https://data.sec.gov/files/company_tickers.json",
      { headers: { "User-Agent": UA, "Accept": "application/json" } }
    );
    if (!tickersResp.ok) {
      tickersResp = await fetch(
        "https://www.sec.gov/files/company_tickers.json",
        { headers: { "User-Agent": UA, "Accept": "application/json" } }
      );
    }
    if (!tickersResp.ok) {
      return res.status(502).json({ error: `SEC EDGAR returned ${tickersResp.status}. Please try again in a moment.` });
    }
    const tickerData = await tickersResp.json();
    const entry = Object.values(tickerData).find(e => e.ticker === sym);
    if (!entry) {
      return res.status(404).json({ error: `"${sym}" not found in SEC EDGAR. Must be a US-listed public company.` });
    }

    const cik = String(entry.cik_str).padStart(10, "0");
    const companyName = entry.title;

    // ── STEP 2: Get latest 10-K filing date + period ──────────────────────────
    const subResp = await fetch(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      { headers: { "User-Agent": UA, "Accept": "application/json" } }
    );
    if (!subResp.ok) {
      return res.status(502).json({ error: `SEC EDGAR returned ${subResp.status} loading filings for ${sym}.` });
    }
    const subData = await subResp.json();
    const recent = subData.filings.recent;
    const idx = recent.form.findIndex(f => f === "10-K" || f === "10-K/A");
    if (idx === -1) {
      return res.status(404).json({ error: `No 10-K filing found for ${sym}.` });
    }
    const filingDate = recent.filingDate[idx];
    const periodEnd  = recent.reportDate?.[idx] || filingDate;

    // ── STEP 3: Fetch XBRL company facts ─────────────────────────────────────
    const factsResp = await fetch(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      { headers: { "User-Agent": UA, "Accept": "application/json" } }
    );
    if (!factsResp.ok) {
      return res.status(502).json({ error: `SEC EDGAR returned ${factsResp.status} loading XBRL data for ${sym}.` });
    }
    const factsData = await factsResp.json();
    const usgaap = factsData.facts?.["us-gaap"] || {};

    // ── STEP 4: Extract most recent annual value per concept ──────────────────
    function getLatest(gaap, ...names) {
      for (const name of names) {
        const concept = gaap[name];
        if (!concept) continue;
        const units = Object.values(concept.units || {}).flat();
        const annual = units
          .filter(u => u.form === "10-K" || u.form === "10-K/A")
          .sort((a, b) => new Date(b.end) - new Date(a.end));
        if (annual[0]) return { val: annual[0].val, period: annual[0].end };
      }
      return null;
    }

    function fmt(item) {
      if (!item) return "N/A";
      const n = Number(item.val);
      if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
      return `$${n.toFixed(2)}`;
    }

    function fmtEps(item) {
      if (!item) return "N/A";
      const n = Number(item.val);
      return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
    }

    const revenue     = getLatest(usgaap, "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax");
    const netIncome   = getLatest(usgaap, "NetIncomeLoss", "ProfitLoss");
    const opIncome    = getLatest(usgaap, "OperatingIncomeLoss");
    const assets      = getLatest(usgaap, "Assets");
    const liabilities = getLatest(usgaap, "Liabilities");
    const equity      = getLatest(usgaap, "StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest");
    const cash        = getLatest(usgaap, "CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsAndShortTermInvestments");
    const debt        = getLatest(usgaap, "LongTermDebt", "LongTermDebtNoncurrent");
    const eps         = getLatest(usgaap, "EarningsPerShareBasic", "EarningsPerShareDiluted");
    const ocf         = getLatest(usgaap, "NetCashProvidedByUsedInOperatingActivities");
    const employees   = getLatest(usgaap, "EntityNumberOfEmployees");

    const metrics = {
      revenue:     fmt(revenue),
      netincome:   fmt(netIncome),
      opincome:    fmt(opIncome),
      assets:      fmt(assets),
      liabilities: fmt(liabilities),
      equity:      fmt(equity),
      cash:        fmt(cash),
      debt:        fmt(debt),
      eps:         fmtEps(eps),
      ocf:         fmt(ocf),
      employees:   employees ? Number(employees.val).toLocaleString() : "N/A",
    };

    // ── STEP 5: Claude explains the real numbers only ─────────────────────────
    const metricsLines = Object.entries(metrics)
      .filter(([, v]) => v !== "N/A")
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

    const prompt = `You are a financial analyst explaining a company's annual report to someone with zero finance background.

The numbers below are REAL data scraped directly from SEC EDGAR XBRL filings. Do NOT invent, estimate, or change any numbers. Only use what is provided.

Company: ${companyName} (${sym})
CIK: ${cik}
10-K period ending: ${periodEnd}
Filed: ${filingDate}

Real financials from SEC EDGAR:
${metricsLines}

Respond in EXACTLY this format — start with %%META%% immediately, no text before it:

%%META%%
name|${companyName}
period|${periodEnd}
filed|${filingDate}
cik|${cik}
revenue|${metrics.revenue}
netincome|${metrics.netincome}
opincome|${metrics.opincome}
assets|${metrics.assets}
liabilities|${metrics.liabilities}
equity|${metrics.equity}
cash|${metrics.cash}
debt|${metrics.debt}
eps|${metrics.eps}
ocf|${metrics.ocf}
employees|${metrics.employees}
%%END%%

%%ANALYSIS%%
##What does this company do?
[2-3 plain-English sentences. No jargon at all.]

##How's the business actually doing?
[3-4 sentences using ONLY the real numbers above. Profitable or not? Growing or shrinking? Be direct.]

##Is the balance sheet healthy?
[3-4 sentences on assets, debt and cash using the actual numbers. What does the debt level mean for a regular person?]

##What to watch out for
- [specific concern grounded in the actual numbers above]
- [second specific one]
- [third specific one]

##The verdict
[1-2 punchy honest sentences based only on what the real numbers show.]
%%END%%`;

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
      return res.status(claudeResp.status).json({ error: err?.error?.message || `Claude API error ${claudeResp.status}` });
    }

    const claudeData = await claudeResp.json();
    const text = (claudeData.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    if (!text.trim()) return res.status(500).json({ error: "Empty response from Claude. Try again." });

    return res.status(200).json({ text, cik, filingDate, periodEnd });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected server error. Try again." });
  }
}
