export default async function handler(req, res) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  var baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  var model = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";

  // GET = quick health check
  if (req.method === 'GET') {
    if (!apiKey) return res.status(200).json({ status: "FAIL", reason: "ANTHROPIC_API_KEY not set" });
    try {
      var testRes = await fetch(baseUrl + "/v1/messages", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: model, max_tokens: 100, messages: [{ role: "user", content: 'Reponds: {"ok":true}' }] }),
      });
      var raw = await testRes.text();
      var p = null; try { p = JSON.parse(raw); } catch (e) {}
      return res.status(200).json({
        status: testRes.ok ? "OK" : "FAIL",
        httpStatus: testRes.status,
        baseUrl: baseUrl,
        model: model,
        maxOutputTokens: p && p.usage ? p.usage.output_tokens : null,
        raw: p ? undefined : raw.slice(0, 1000),
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
    max_tokens: 16000,
    system: system + "\n\nReponds UNIQUEMENT avec un objet JSON valide. Pas de markdown, pas de backticks, pas de texte avant ou apres.",
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
    if (dataP.stop_reason === "max_tokens") {
      return res.status(500).json({ error: "Morceau trop long (sortie coupee). Reessaie ou raccourcis." });
    }
    var cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    var jm = cleaned.match(/\{[\s\S]*\}/);
    if (!jm) {
      return res.status(500).json({ error: "Pas de JSON. Le modele a repondu: " + cleaned.slice(0, 300) });
    }
    cleaned = jm[0];
    res.status(200).json({ text: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
