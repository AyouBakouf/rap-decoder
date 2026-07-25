export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set' });

  var model = process.env.DEEPSEEK_MODEL || "deepseek/deepseek-r1-0528";
  var system = req.body.system || "";
  var message = req.body.message || "";

  // R1 prefere tout dans le user message plutot qu'un system separe
  var fullMessage = system ? system + "\n\n---\n\n" + message : message;

  var body = {
    model: model,
    messages: [{ role: "user", content: fullMessage }],
    max_tokens: 12000,
  };

  try {
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 55000);

    var response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://rap-decoder.vercel.app',
        'X-Title': 'Rap Decoder',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    var raw = await response.text();

    if (!response.ok) {
      if (response.status === 429) {
        return res.status(429).json({ rateLimited: true, retryAfter: 30, error: 'Rate limit' });
      }
      // Inclure le detail de l'erreur
      var detail = "";
      try { var parsed = JSON.parse(raw); detail = parsed.error && parsed.error.message ? parsed.error.message : raw.slice(0, 500); } catch(e) { detail = raw.slice(0, 500); }
      return res.status(response.status).json({ error: 'OpenRouter ' + response.status + ': ' + detail });
    }

    var data;
    try { data = JSON.parse(raw); } catch (e) {
      return res.status(500).json({ error: 'Reponse invalide: ' + raw.slice(0, 300) });
    }

    if (data.error) {
      return res.status(500).json({ error: data.error.message || JSON.stringify(data.error).slice(0, 300) });
    }

    var text = "";
    if (data.choices && data.choices[0] && data.choices[0].message) {
      text = data.choices[0].message.content || "";
    }

    if (!text) {
      return res.status(500).json({ error: "Reponse vide. Debug: " + JSON.stringify(data).slice(0, 500) });
    }

    // Virer les tags <think> de R1
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Nettoyer markdown
    var cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    // Extraire le JSON
    var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];

    res.status(200).json({ text: cleaned });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout (>55s). DeepSeek R1 met du temps a reflechir, reessaie.' });
    }
    res.status(500).json({ error: e.message });
  }
}

export const config = {
  maxDuration: 60,
};
