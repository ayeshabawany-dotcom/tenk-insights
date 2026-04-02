export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const { action, companyA, yearA, companyB, yearB, noteSection, tableData, question, conversationHistory } = req.body;

  // ── Helper: call Claude ────────────────────────────────────────────────────
  async function callClaude(prompt, messages, maxTokens = 1500) {
    const body = {
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: messages || [{ role: "user", content: prompt }],
    };
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Claude API error ${resp.status}`);
    }
    const data = await resp.json();
    return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  }

  try {

    // ── ACTION: COMPARE ───────────────────────────────────────────────────────
    if (action === "compare") {
      if (!companyA || !yearA || !companyB || !yearB || !noteSection) {
        return res.status(400).json({ error: "All fields required." });
      }

      const isSameCompany = companyA.trim().toLowerCase() === companyB.trim().toLowerCase();
      const contextLine = isSameCompany
        ? `Same company (${companyA}) in different years: ${yearA} vs ${yearB}`
        : `Two different companies: ${companyA} (${yearA}) vs ${companyB} (${yearB})`;

      const prompt = `You are a senior technical accountant and financial analyst with deep expertise in SEC 10-K filings.

Compare the "${noteSection}" note from these two 10-K annual reports:
- Company A: ${companyA}, fiscal year ${yearA}
- Company B: ${companyB}, fiscal year ${yearB}
- Context: ${contextLine}

Extract the 8-12 most important and comparable disclosure dimensions from this specific note type.
Use your knowledge of actual SEC 10-K filings for these companies and years.

Respond in EXACTLY this format — no text before %%META%%:

%%META%%
companyA|${companyA}
yearA|${yearA}
companyB|${companyB}
yearB|${yearB}
note|${noteSection}
%%END%%

%%TABLE%%
[Dimension name]|[Company A ${yearA} disclosure/value]|[Company B ${yearB} disclosure/value]
[Dimension name]|[Company A ${yearA} disclosure/value]|[Company B ${yearB} disclosure/value]
[Dimension name]|[Company A ${yearA} disclosure/value]|[Company B ${yearB} disclosure/value]
[Dimension name]|[Company A ${yearA} disclosure/value]|[Company B ${yearB} disclosure/value]
[Dimension name]|[Company A ${yearA} disclosure/value]|[Company B ${yearB} disclosure/value]
[Dimension name]|[Company A ${yearA} disclosure/value]|[Company B ${yearB} disclosure/value]
[Dimension name]|[Company A ${yearA} disclosure/value]|[Company B ${yearB} disclosure/value]
[Dimension name]|[Company A ${yearA} disclosure/value]|[Company B ${yearB} disclosure/value]
%%END%%

%%SUMMARY%%
[3-4 sentences highlighting the most significant differences and what they mean for an analyst or investor. Be specific and use real numbers where you know them.]
%%END%%

%%KEYINSIGHT%%
[One single most important takeaway from this comparison in plain English.]
%%END%%`;

      const text = await callClaude(prompt);

      // Parse META
      const metaBlock = text.match(/%%META%%([\s\S]*?)%%END%%/);
      const meta = {};
      if (metaBlock) {
        for (const line of metaBlock[1].split("\n")) {
          const pipe = line.indexOf("|");
          if (pipe === -1) continue;
          meta[line.slice(0, pipe).trim()] = line.slice(pipe + 1).trim();
        }
      }

      // Parse TABLE rows
      const tableBlock = text.match(/%%TABLE%%([\s\S]*?)%%END%%/);
      const rows = [];
      if (tableBlock) {
        for (const line of tableBlock[1].split("\n")) {
          const parts = line.split("|");
          if (parts.length >= 3 && parts[0].trim()) {
            rows.push({
              dimension: parts[0].trim(),
              a: parts[1].trim(),
              b: parts[2].trim(),
            });
          }
        }
      }

      // Parse SUMMARY
      const summaryBlock = text.match(/%%SUMMARY%%([\s\S]*?)%%END%%/);
      const summary = summaryBlock ? summaryBlock[1].trim() : "";

      // Parse KEY INSIGHT
      const insightBlock = text.match(/%%KEYINSIGHT%%([\s\S]*?)%%END%%/);
      const keyInsight = insightBlock ? insightBlock[1].trim() : "";

      if (rows.length === 0) {
        return res.status(500).json({ error: "Could not parse comparison. Try different companies or note section." });
      }

      return res.status(200).json({ meta, rows, summary, keyInsight });
    }

    // ── ACTION: SENTIMENT ─────────────────────────────────────────────────────
    if (action === "sentiment") {
      if (!tableData || !noteSection) return res.status(400).json({ error: "Missing data." });

      const tableText = tableData.rows.map(r =>
        `${r.dimension}: ${tableData.meta.companyA} = ${r.a} | ${tableData.meta.companyB} = ${r.b}`
      ).join("\n");

      const prompt = `You are a financial analyst. Analyze the sentiment of these two companies' disclosures in their "${noteSection}" note.

${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB})

Comparison data:
${tableText}

Respond in EXACTLY this format:

%%SENTIMENT%%
overallA|[Positive/Neutral/Cautious/Negative]
scoreA|[1-10 where 10 is most positive]
summaryA|[2 sentences on tone and language of Company A's disclosures]
overallB|[Positive/Neutral/Cautious/Negative]
scoreB|[1-10 where 10 is most positive]
summaryB|[2 sentences on tone and language of Company B's disclosures]
comparison|[2 sentences comparing the sentiment of both]
redflags|[Any concerning language or disclosures, or "None identified"]
%%END%%`;

      const text = await callClaude(prompt);
      const block = text.match(/%%SENTIMENT%%([\s\S]*?)%%END%%/);
      const sentiment = {};
      if (block) {
        for (const line of block[1].split("\n")) {
          const pipe = line.indexOf("|");
          if (pipe === -1) continue;
          sentiment[line.slice(0, pipe).trim()] = line.slice(pipe + 1).trim();
        }
      }
      return res.status(200).json({ sentiment });
    }

    // ── ACTION: ASK ───────────────────────────────────────────────────────────
    if (action === "ask") {
      if (!question || !tableData) return res.status(400).json({ error: "Missing question or data." });

      const tableText = tableData.rows.map(r =>
        `${r.dimension}: ${tableData.meta.companyA} = ${r.a} | ${tableData.meta.companyB} = ${r.b}`
      ).join("\n");

      const systemContext = `You are a senior financial analyst helping analyze 10-K filings. You have the following comparison data for the "${tableData.meta.note}" note:

${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB})

${tableText}

Summary: ${tableData.summary}

Answer questions about this data concisely and accurately. If asked something outside this data, say so clearly.`;

      // Build messages with history
      const messages = [
        { role: "user", content: systemContext + "\n\nUser question: " + question },
        ...(conversationHistory || []),
      ];

      // For Q&A, use a simpler message structure
      const qaMessages = [
        {
          role: "user",
          content: `Context - ${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB}), ${tableData.meta.note} note comparison:\n\n${tableText}\n\nSummary: ${tableData.summary}\n\nQuestion: ${question}`
        },
        ...(conversationHistory || []),
        { role: "user", content: question }
      ];

      // Keep it simple - single turn with full context
      const singlePrompt = `You are a senior financial analyst. Based on this 10-K comparison data, answer the question.

Comparing: ${tableData.meta.companyA} (${tableData.meta.yearA}) vs ${tableData.meta.companyB} (${tableData.meta.yearB})
Note section: ${tableData.meta.note}

Data:
${tableText}

Summary: ${tableData.summary}

Question: ${question}

Give a direct, specific answer. Use the data provided. If you need to make reasonable inferences beyond the data, say so.`;

      const answer = await callClaude(singlePrompt, null, 800);
      return res.status(200).json({ answer });
    }

    return res.status(400).json({ error: "Unknown action." });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error. Please try again." });
  }
}
