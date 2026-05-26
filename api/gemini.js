export default async function handler(req, res) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  var baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  var model = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";

  // GET = debug test reproducing the translation path (thinking ON, no search, provided lyrics)
  if (req.method === 'GET') {
    if (!apiKey) return res.status(200).json({ status: "FAIL", reason: "ANTHROPIC_API_KEY not set" });
    try {
      var fakeLyrics = "Yeah, I been on my grind\nMoney on my mind\nLeft them all behind\nNow I'm one of a kind";
      var testBody = {
        model: model,
        max_tokens: 32000,
        thinking: { type: "enabled", budget_tokens: 8000 },
        system: 'Traduis ce rap ligne par ligne. Reponds UNIQUEMENT en JSON: {"lang":"anglais","lines":[{"o":"ligne","t":"trad","c":90}]}',
        messages: [{ role: "user", content: "Paroles:\n\n" + fakeLyrics }],
      };
      var testRes = await fetch(baseUrl + "/v1/messages", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(testBody),
      });
      var raw = await testRes.text();
      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) {}
      var info = {};
      if (parsed) {
        info.stop_reason = parsed.stop_reason;
        info.usage = parsed.usage;
        info.block_types = (parsed.content || []).map(function(c){ return c.type; });
        var t = "";
        (parsed.content || []).forEach(function(c){ if (c.type === "text") t += c.text; });
        info.text_preview = t.slice(0, 500);
        info.text_length = t.length;
      }
      return res.status(200).json({
        status: testRes.ok ? "OK" : "FAIL",
        httpStatus: testRes.status,
        baseUrl: baseUrl,
        model: model,
        info: info,
        raw: parsed ? undefined : raw.slice(0, 2000),
      });
    } catch (e) {
      return res.status(200).json({ status: "FAIL", error: e.message, baseUrl: baseUrl, model: model });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  var system = req.body.system || "";
  var message = req.body.message || "";
  var search = req.body.search || false;

  var body = {
    model: model,
    max_tokens: 32000,
    thinking: { type: "enabled", budget_tokens: 8000 },
    system: system + "\n\nReponds UNIQUEMENT avec un objet JSON valide. Pas de markdown, pas de backticks.",
    messages: [{ role: "user", content: message }],
  };
  if (search) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  try {
    var response = await fetch(baseUrl + "/v1/messages", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    var rawP = await response.text();
    if (!response.ok) return res.status(response.status).json({ error: 'API ' + response.status, debug: rawP.slice(0, 1500) });
    var dataP;
    try { dataP = JSON.parse(rawP); } catch (e) { return res.status(500).json({ error: 'Bad JSON from API', debug: rawP.slice(0, 1500) }); }
    if (dataP.error) return res.status(500).json({ error: dataP.error.message });

    var text = "";
    (dataP.content || []).forEach(function(c){ if (c.type === "text" && c.text) text += c.text; });
    if (!text) {
      var types = (dataP.content || []).map(function(c){ return c.type; });
      return res.status(500).json({ error: "Reponse vide (stop: " + dataP.stop_reason + ", blocs: " + types.join(",") + ")" });
    }
    var cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    var jm = cleaned.match(/\{[\s\S]*\}/);
    if (jm) cleaned = jm[0];
    res.status(200).json({ text: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
