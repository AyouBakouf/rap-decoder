export default async function handler(req, res) {
  var apiKey = process.env.GEMINI_API_KEY;
  var model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  // GET = debug: voir quelle cle tourne et tester un appel
  if (req.method === 'GET') {
    if (!apiKey) return res.status(200).json({ status: "FAIL", reason: "GEMINI_API_KEY pas configuree" });
    try {
      var testThinkCfg = model.indexOf("2.5") >= 0 ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
      var testBody = {
        contents: [{ role: 'user', parts: [{ text: 'Reponds: {"ok":true}' }] }],
        generationConfig: { maxOutputTokens: 100, responseMimeType: 'application/json', thinkingConfig: testThinkCfg },
      };
      var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;
      var testRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(testBody) });
      var raw = await testRes.text();
      return res.status(200).json({
        status: testRes.ok ? "OK" : "FAIL",
        httpStatus: testRes.status,
        model: model,
        keyPrefix: apiKey.slice(0, 10) + "...",
        keyLength: apiKey.length,
        raw: raw.slice(0, 1500),
      });
    } catch (e) {
      return res.status(200).json({ status: "FAIL", error: e.message, model: model });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  var system = req.body.system || "";
  var message = req.body.message || "";
  var search = req.body.search || false;

  // Le param de thinking diffère entre 2.5 et 3.x
  var thinkingCfg = model.indexOf("2.5") >= 0
    ? { thinkingBudget: 0 }
    : { thinkingLevel: 'minimal' };

  var body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: message }] }],
    generationConfig: {
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
      thinkingConfig: thinkingCfg,
    },
  };

  if (search) {
    body.tools = [{ google_search: {} }];
    delete body.generationConfig.responseMimeType;
  }

  try {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;
    var response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var raw = await response.text();
    var data;
    try { data = JSON.parse(raw); } catch (e) { return res.status(500).json({ error: 'Reponse invalide', debug: raw.slice(0, 800) }); }
    if (data.error) {
      if (response.status === 429) {
        var retryAfter = 20;
        var details = data.error.details || [];
        for (var k = 0; k < details.length; k++) {
          if (details[k].retryDelay) {
            var sec = parseInt(details[k].retryDelay, 10);
            if (!isNaN(sec)) retryAfter = sec;
          }
        }
        return res.status(429).json({ rateLimited: true, retryAfter: retryAfter, error: data.error.message || 'Rate limit' });
      }
      return res.status(response.status || 500).json({ error: data.error.message || 'Gemini error' });
    }

    var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    var text = "";
    for (var i = 0; i < parts.length; i++) { if (parts[i].text) text = text + parts[i].text; }
    if (!text) {
      var fr = data.candidates && data.candidates[0] ? data.candidates[0].finishReason : "?";
      return res.status(500).json({ error: "Reponse vide (finishReason: " + fr + ")" });
    }
    var cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    res.status(200).json({ text: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
