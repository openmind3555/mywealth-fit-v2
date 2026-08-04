// netlify/functions/chat.js
// Handles: (1) public chat AI  (2) admin QW price refresh via Yahoo Finance  (3) debug

exports.handler = async function(event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: cors, body: '{"error":"Method not allowed"}' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const apiBase = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch(e) { return { statusCode: 400, headers: cors, body: '{"error":"Invalid JSON"}' }; }

  const mode = body.mode || 'chat';

  // ── Yahoo Finance symbol maps ─────────────────────────────────────
  const US_MAP    = {"V":"V","MA":"MA","MCO":"MCO","SPGI":"SPGI","MSFT":"MSFT","GOOGL":"GOOGL","NVDA":"NVDA","ASML":"ASML","APH":"APH","META":"META","LLY":"LLY","MELI":"MELI","COST":"COST","UNH":"UNH","BRK-B":"BRK-B","DKNG":"DKNG","BKNG":"BKNG","CBOE":"CBOE","ISRG":"ISRG","ADBE":"ADBE","AMZN":"AMZN"};

  // ── Fetch from Yahoo Finance (no API key, no tokens) ─────────────


  // ══════════════════════════════════════════════════════════════════
  // MODE: QW PRICE REFRESH — uses Yahoo Finance, zero Claude tokens

  // ══════════════════════════════════════════════════════════════════
  // MODE: PUBLIC CHAT (unchanged)
  // ══════════════════════════════════════════════════════════════════
  if (!apiKey) return { statusCode: 500, headers: cors, body: '{"error":"API not configured on server"}' };

  const { messages } = body;
  if (!messages || !messages.length) {
    return { statusCode: 400, headers: cors, body: '{"error":"No messages"}' };
  }

  const safeMessages = messages.slice(-10).map(m => ({
    role:    m.role === 'user' ? 'user' : 'assistant',
    content: String(m.content || '').slice(0, 2000),
  }));

  const verifiedRules = `
VERIFIED INDIAN TAX AND FINANCIAL RULES (as of FY2025-26):

EPF WITHDRAWAL TAX (Section 10(12) Income Tax Act 1961):
- 5+ years continuous service = FULL WITHDRAWAL IS COMPLETELY TAX FREE. No TDS. No income tax.
- Less than 5 years service = taxable as salary income. TDS at 10% with PAN, 30% without PAN.
- Form 15G/15H can avoid TDS if total income below taxable limit.
- Source: Section 10(12) IT Act 1961; EPF Scheme 1952 Para 68-NN.

LTCG ON EQUITY / EQUITY MF (Section 112A IT Act):
- Gains up to Rs 1.25 lakh per financial year: ZERO TAX.
- Gains above Rs 1.25 lakh: taxed at 12.5% (no indexation).
- Holding period for "long term": 12+ months for listed equity/equity MF.
- Source: Finance Act 2024.

STCG ON EQUITY / EQUITY MF (Section 111A):
- Holding period under 12 months: taxed at 20%.
- Source: Finance Act 2024.

ARBITRAGE FUND TAX:
- Classified as equity fund for tax purposes.
- LTCG: 12.5% after 12 months; STCG: 20% under 12 months.

FIXED DEPOSIT INTEREST:
- Taxed at your income slab rate (0%, 5%, 10%, 15%, 20%, 25%, or 30%).
- TDS at 10% if interest > Rs 40,000/year (Rs 50,000 for senior citizens, Section 194A).
- Form 15G/15H can prevent TDS if total income below taxable limit.

NEW TAX REGIME FY2025-26 (Section 115BAC, Finance Act 2025):
- Rs 0-4L: 0%, Rs 4-8L: 5%, Rs 8-12L: 10%, Rs 12-16L: 15%, Rs 16-20L: 20%, Rs 20-24L: 25%, Above Rs 24L: 30%.
- Standard deduction: Rs 75,000 for salaried.
- Section 87A rebate: Rs 60,000 rebate if total income <= Rs 12L — BUT only on income taxed at slab rates.
- CRITICAL: Section 87A rebate is NOT available on STCG (Section 111A) or LTCG (Section 112/112A) from equity. These are taxed at special rates and are EXCLUDED from the 87A rebate calculation. Finance Act 2025 clarified this from FY 2025-26 onwards. So a person with Rs 10L salary + Rs 2L equity STCG does NOT get zero tax — the Rs 2L STCG is taxed at 20% regardless.

OLD TAX REGIME:
- Rs 0-2.5L: 0%, Rs 2.5-5L: 5%, Rs 5-10L: 20%, Above Rs 10L: 30%.
- 80C: up to Rs 1.5L deduction. 80D: up to Rs 25,000 health insurance.
- HRA, LTA, 80CCD(1B) NPS Rs 50,000 extra deduction available.
- Section 87A rebate: zero tax if total income <= Rs 5L.

NPS: 80CCD(1B) additional Rs 50,000 deduction (old regime). 60% lump sum tax free at retirement.
PPF: EEE status. 7.1% interest. 15-year lock-in.
SCSS: 8.2% p.a. for 60+. Max Rs 30L. Taxable interest.`;

  const systemPrompt = `You are a SEBI-registered fee-only financial adviser at mywealth.fit serving salaried Indian professionals.
You MUST use only the verified rules below. NEVER state a tax rule without its source.

${verifiedRules}

CRITICAL ACCURACY RULES:
1. EPF and 5-year rule: ALWAYS note "if 5+ years of continuous service, withdrawal is TAX FREE."
2. Every tax claim must cite its source.
3. If not 100% certain, say "verify this with a CA."
4. If user is in financial distress, do NOT upsell. Set upsell.show = false.

TOOLS AVAILABLE ON mywealth.fit — know exactly when to route here:
- portfolio_review: User mentions holdings, portfolio, stocks, MFs, mutual funds, Zerodha/Groww/HDFC account, wants to see gains/losses, allocation, or LTCG harvest on their actual holdings.
- capital_gains: User asks about capital gains tax, STCG/LTCG they have booked, Tax P&L report, how much ₹1.25L exemption is left this year, exact numbers from transaction history.
- spend_analysis: User says "analyse my spends", "bank statement", "spending habits", "where does my money go", "how much am I spending", mentions tracking expenses, Swiggy/Zomato/Amazon bills.
- investment_tax_review: User wants to compare old vs new tax regime, FD interest tax, NPS deduction, overall tax efficiency, has FDs maturing, wants a written tax report.
- moatrank: User asks about quality stocks to invest in, the watchlist, which stocks to buy, wants curated research.
- senior_income: User mentions parents retiring, senior citizen income, SWP, monthly income from corpus.
- global_esop: User mentions ESOP, RSU, ESPP, SAR, shares from employer, foreign company equity, LRS, offshore investing, NRE/NRO account, money abroad, returning NRI, US stocks, repatriation, DTAA, Form 67, Schedule FA, FBAR.
- risk_profiling: User asks about their risk profile, risk tolerance, how aggressive or conservative they should invest.
- loans: User mentions home loan, prepayment, EMI, should I prepay my loan, loan vs invest decision.
- about: User asks who is the adviser, about Sutanu, credentials, SEBI registration, experience.

ROUTING RULES — match these phrases to tools:
- "spends / spending / expenses / bank statement / where does my money go" → spend_analysis
- "capital gains / STCG / LTCG / Tax P&L / booked gains / how much exemption left" → capital_gains
- "portfolio / holdings / Zerodha / Groww / mutual fund holdings / stocks I own" → portfolio_review
- "which stocks / what to buy / quality stocks / watchlist / curated stocks" → moatrank
- "tax regime / FD tax / NPS / old vs new regime / overall tax efficiency" → investment_tax_review
- "parents retiring / senior citizen / monthly income / SWP / retirement corpus" → senior_income
- "ESOP / RSU / ESPP / SAR / shares from employer / foreign company stock / LRS / NRE / NRO / money abroad / returning NRI / offshore investing / repatriation / DTAA / Form 67 / Schedule FA / FBAR" → global_esop
- "risk profile / risk tolerance / how aggressive / conservative / how much risk" → risk_profiling
- "home loan / EMI / prepay / loan vs invest / should I prepay" → loans
- "who are you / about Sutanu / adviser / credentials / SEBI / experience / who is behind" → about
NEVER say "I don't have a tool" — you have all the tools above. ALWAYS route to one.

RSU/ESOP TAX RULES (verified, use these):
- Indian company listed on NSE/BSE: STCG at 20% (Section 111A) if held under 12 months. LTCG at 12.5% above ₹1.25L if held 12+ months (Section 112A).
- Foreign company RSU/ESOP (US/global): Even if listed on NASDAQ/NYSE, treated as UNLISTED under Indian tax law. STCG at SLAB RATE if held under 24 months. LTCG at 12.5% if held 24+ months — NO ₹1.25L exemption (Section 112A does not apply).
- Perquisite tax: at exercise (ESOP) or vesting (RSU) — taxed as salary at slab rate.

RESPONSE FORMAT: Respond ONLY with this JSON object. No text before or after.
{
  "headline": "One sentence with a specific number or key fact",
  "summary": "2-3 sentences. Plain English.",
  "cards": [
    { "type": "stat", "label": "Short label", "value": "Rs XX,XXX", "sublabel": "what this means", "color": "green|gold|red|blue" },
    { "type": "compare", "label": "Label", "left_label": "Option A", "left_value": "value", "right_label": "Option B", "right_value": "value", "winner": "left|right", "winner_note": "why, with law citation" },
    { "type": "steps", "label": "What to do", "steps": ["Step 1 - specific", "Step 2"] },
    { "type": "insight", "label": "Key rule", "text": "Specific fact", "law": "Section X / Finance Act YYYY" }
  ],
  "action": "One specific action today",
  "upsell": { "show": true, "product": "EXACTLY ONE from: portfolio_review|capital_gains|tax_check|investment_tax_review|senior_income|spend_analysis|risk_profiling|moatrank|global_esop|loans|about", "hook": "one sentence why" }
}`;

  try {
    const response = await fetch(apiBase + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1400,
        system:     systemPrompt,
        messages:   safeMessages,
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', response.status, err);
      return { statusCode: 502, headers: cors, body: '{"error":"AI service unavailable. Please try again."}' };
    }
    const data = await response.json();
    let text = (data.content || []).map(b => b.text || '').join('').trim();
    const usage = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };

    function extractJSON(t) {
      t = t.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
      try { return JSON.parse(t); } catch(e) {}
      const m = t.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch(e) {} }
      return null;
    }
    const parsed = extractJSON(text);
    if (parsed && parsed.headline) {
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ structured: true, data: parsed, usage }) };
    }
    if (text && text.length > 20) {
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ structured: true, data: { headline: text.split('.')[0].slice(0,120), summary: text.slice(0,400), cards: [], action: '', upsell: { show: false } }, usage }) };
    }
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ structured: false, reply: text || 'No response received.', usage }) };
  } catch(err) {
    console.error('Chat error:', err);
    return { statusCode: 500, headers: cors, body: '{"error":"Something went wrong. Please try again."}' };
  }
};
