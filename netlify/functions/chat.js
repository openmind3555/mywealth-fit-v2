// netlify/functions/chat.js — mywealth.fit v2
// Enhanced from old build: verified tax rules, structured JSON responses,
// routing logic, CLOOD_KEY fallback, clean error handling

exports.handler = async function(event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: cors, body: '{"error":"Method not allowed"}' };

  // Supports ANTHROPIC_API_KEY or CLOOD_KEY (both work)
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLOOD_KEY;
  const apiBase = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch(e) { return { statusCode: 400, headers: cors, body: '{"error":"Invalid JSON"}' }; }

  if (!apiKey) return { statusCode: 500, headers: cors, body: '{"error":"API not configured"}' };

  const { messages, system } = body;
  if (!messages || !messages.length) {
    return { statusCode: 400, headers: cors, body: '{"error":"No messages"}' };
  }

  // Keep last 10 messages, cap each at 2000 chars
  const safeMessages = messages.slice(-10).map(m => ({
    role:    m.role === 'user' ? 'user' : 'assistant',
    content: String(m.content || '').slice(0, 2000),
  }));

  // Verified Indian tax rules — sourced and accurate as of FY2025-26
  const verifiedRules = `
VERIFIED INDIAN TAX AND FINANCIAL RULES (FY2025-26):

EPF WITHDRAWAL (Section 10(12) IT Act 1961):
- 5+ years continuous service = FULLY TAX FREE. No TDS. No income tax.
- Under 5 years = taxable as salary. TDS 10% with PAN, 30% without PAN.
- Form 15G/15H can avoid TDS if total income below taxable limit.

LTCG ON EQUITY/EQUITY MF (Section 112A):
- Gains up to ₹1.25 lakh/year: ZERO TAX.
- Above ₹1.25 lakh: 12.5% (no indexation). Holding 12+ months = long term.
- Finance Act 2024.

STCG ON EQUITY/EQUITY MF (Section 111A):
- Under 12 months: taxed at 20%. Finance Act 2024.

NEW TAX REGIME FY2025-26 (Section 115BAC):
- ₹0-4L: 0%, ₹4-8L: 5%, ₹8-12L: 10%, ₹12-16L: 15%, ₹16-20L: 20%, ₹20-24L: 25%, Above ₹24L: 30%.
- Standard deduction: ₹75,000 for salaried.
- Section 87A rebate: ₹60,000 if income ≤ ₹12L — NOT available on STCG (111A) or LTCG (112A).
- CRITICAL: ₹10L salary + ₹2L equity STCG → the ₹2L STCG taxed at 20% regardless of 87A.

OLD TAX REGIME:
- ₹0-2.5L: 0%, ₹2.5-5L: 5%, ₹5-10L: 20%, Above ₹10L: 30%.
- 80C: ₹1.5L deduction. 80D: ₹25,000 health insurance. 87A: zero tax if income ≤ ₹5L.

FD INTEREST: Taxed at slab rate. TDS 10% if interest > ₹40,000/year (₹50,000 for seniors, Section 194A).
NPS: 80CCD(1B) ₹50,000 extra deduction (old regime). 60% lump sum tax free at retirement.
PPF: EEE. 7.1% interest. 15-year lock-in.

RSU/ESOP TAX:
- Indian listed company: STCG 20% under 12M; LTCG 12.5% over ₹1.25L above 12M.
- Foreign company (US/global RSU): treated as UNLISTED under Indian law. STCG at SLAB rate under 24M; LTCG 12.5% over 24M — NO ₹1.25L exemption.
- Perquisite (vesting/exercise): taxed as salary at slab.`;

  // Use passed system prompt if provided, otherwise use default
  const systemPrompt = system || `You are a knowledgeable financial assistant at mywealth.fit, Bangalore.
You help Indian investors with practical, honest guidance.

${verifiedRules}

RULES:
- Always focus on India — Indian markets, tax laws, investment instruments
- Be concise — mobile users need short clear answers
- Cite tax rule sources when making tax claims
- If uncertain, say "verify with a CA"
- Never recommend specific stocks as "buy now" without caveats
- Suggest the portfolio review tool for holdings analysis
- Keep responses under 200 words unless detail is essential

TOOLS on mywealth.fit you can route users to:
- /review — portfolio review, holdings analysis
- /risk — risk profiling
- /retire — retirement planning calculator
- /picks — curated stock and MF picks
- /chat — general questions (here)

RESPONSE FORMAT: Respond with clean JSON like this:
{
  "headline": "One sentence with a key fact or number",
  "summary": "2-3 sentences plain English explanation",
  "cards": [
    { "type": "stat", "label": "Label", "value": "₹XX,XXX", "sublabel": "context", "color": "green|gold|red|blue" },
    { "type": "steps", "label": "What to do", "steps": ["Step 1", "Step 2"] },
    { "type": "insight", "label": "Key rule", "text": "Specific fact", "law": "Section X / Finance Act YYYY" }
  ],
  "action": "One specific action to take today",
  "upsell": { "show": true, "product": "review|risk|retire|picks", "hook": "one sentence why" }
}`;

  try {
    const response = await fetch(apiBase + '/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
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

    // Try to parse structured JSON response
    function extractJSON(t) {
      t = t.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
      try { return JSON.parse(t); } catch(e) {}
      const m = t.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch(e) {} }
      return null;
    }

    const parsed = extractJSON(text);
    // Return structured:true for ANY valid JSON object from the model
    // (tool routing returns {type:'tool',...} without a headline field)
    if (parsed && typeof parsed === 'object') {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structured: true, data: parsed, usage })
      };
    }

    // Fallback: return as plain text wrapped in structure
    if (text && text.length > 20) {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structured: false,
          reply: text,
          usage
        })
      };
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ structured: false, reply: 'No response received. Please try again.', usage })
    };

  } catch(err) {
    console.error('Chat handler error:', err.message);
    return { statusCode: 500, headers: cors, body: '{"error":"Something went wrong. Please try again."}' };
  }
};
