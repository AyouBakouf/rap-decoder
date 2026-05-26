export default async function handler(req, res) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  var baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  var model = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";

  // GET = debug test
  if (req.method === 'GET') {
    if (!apiKey) return res.status(200).json({ status: "FAIL", reason: "ANTHROPIC_API_KEY not set" });

    try {
      var testBody = {
        model: model,
        max_tokens: 200,
        messages: [{ role: "user", content: 'Réponds juste: {"test":"ok"}' }],
      };

      var testRes = await fetch(baseUrl + "/v1/messages", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(testBody),
      });

      var raw = await testRes.text();
      return res.status(200).json({
        status: testRes.ok ? "OK" : "FAIL",
        httpStatus: testRes.status,
        baseUrl: baseUrl,
        model: model,
        keyPrefix: apiKey.slice(0, 10) + "...",
        raw: raw.slice(0, 3000),
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
    max_tokens: 16384,
    thinking: {
      type: "enabled",
      budget_tokens: 10000,
    },
    system: system + "\n\nTu DOIS répondre UNIQUEMENT avec un objet JSON valide. Pas de markdown, pas de backticks, pas de texte avant ou après le JSON.",
    messages: [{ role: "user", content: message }],
  };

  if (search) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  try {
    var response = await fetch(baseUrl + "/v1/messages", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    var raw = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({ error: 'API error ' + response.status, debug: raw.slice(0, 2000) });
    }

    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return res.status(500).json({ error: 'Invalid JSON from API', debug: raw.slice(0, 2000) });
    }

    if (data.error) {
      return res.status(500).json({ error: data.error.message, debug: JSON.stringify(data.error).slice(0, 2000) });
    }

    var text = "";
    var content = data.content || [];
    for (var i = 0; i < content.length; i++) {
      if (content[i].type === "text" && content[i].text) {
        text = text + content[i].text;
      }
    }

    if (!text) {
      var types = content.map(function(c) { return c.type; });
      return res.status(200).json({ text: "", error: "No text in response", debug: "types: " + types.join(",") + " | " + JSON.stringify(content).slice(0, 2000) });
    }

    var cleaned = text.trim();
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];

    res.status(200).json({ text: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
