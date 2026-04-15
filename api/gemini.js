export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  var system = req.body.system || "";
  var message = req.body.message || "";
  var search = req.body.search || false;

  var body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: message }] }],
    generationConfig: {
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0
      }
    },
  };

  if (search) {
    body.tools = [{ google_search: {} }];
  }

  try {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=" + apiKey;
    var response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    var data = await response.json();

    if (data.error) {
      return res.status(response.status).json({ error: data.error.message || 'Gemini error' });
    }

    var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    var text = "";
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].text) text = text + parts[i].text;
    }

    res.status(200).json({ text: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
