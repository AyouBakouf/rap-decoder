export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  // Modele configurable. Defaut: gemini-3.5-flash
  // Pour switcher: mets GEMINI_MODEL dans Vercel (ex: gemini-3.1-pro-preview)
  var model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

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
        thinkingLevel: 'minimal',
      },
    },
  };

  if (search) {
    body.tools = [{ google_search: {} }];
    // google_search et responseMimeType json ne sont pas compatibles -> on retire le json forcé
    delete body.generationConfig.responseMimeType;
  }

  try {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;
    var response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    var raw = await response.text();
    var data;
    try { data = JSON.parse(raw); } catch (e) {
      return res.status(500).json({ error: 'Reponse invalide de Gemini', debug: raw.slice(0, 800) });
    }

    if (data.error) {
      return res.status(response.status || 500).json({ error: data.error.message || 'Gemini error' });
    }

    var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    var text = "";
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].text) text = text + parts[i].text;
    }

    if (!text) {
      var fr = data.candidates && data.candidates[0] ? data.candidates[0].finishReason : "?";
      return res.status(500).json({ error: "Reponse vide (finishReason: " + fr + ")" });
    }

    // Nettoyage au cas ou (backticks markdown quand search est actif)
    var cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    res.status(200).json({ text: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
