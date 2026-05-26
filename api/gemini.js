export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  var system = req.body.system || "";
  var message = req.body.message || "";
  var search = req.body.search || false;

  var body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 16384,
    system: system + "\n\nRéponds UNIQUEMENT en JSON valide, sans markdown, sans backticks, sans texte avant ou après.",
    messages: [{ role: "user", content: message }],
  };

  if (search) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  try {
    var response = await fetch("https://api.anthropic.com/v1/messages", {
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

    var text = "";
    var content = data.content || [];
    for (var i = 0; i < content.length; i++) {
      if (content[i].type === "text" && content[i].text) {
        text = text + content[i].text;
      }
    }

    res.status(200).json({ text: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
