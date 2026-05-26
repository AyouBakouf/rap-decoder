export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  var baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  var model = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";

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

    var data = await response.json();

    if (data.error) {
      return res.status(response.status || 500).json({ error: data.error.message || 'Claude error' });
    }

    // Extract only text blocks (skip thinking blocks)
    var text = "";
    var content = data.content || [];
    for (var i = 0; i < content.length; i++) {
      if (content[i].type === "text" && content[i].text) {
        text = text + content[i].text;
      }
    }

    // Clean up: strip markdown fences and surrounding text to find JSON
    var cleaned = text.trim();
    // Remove ```json ... ``` wrapping
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    // Try to extract JSON object if there's text around it
    var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    res.status(200).json({ text: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
