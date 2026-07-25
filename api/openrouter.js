export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set' });

  var model = process.env.DEEPSEEK_MODEL || "deepseek/deepseek-r1-0528";
  var system = req.body.system || "";
  var message = req.body.message || "";

  var messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: message });

  var body = {
    model: model,
    messages: messages,
    max_tokens: 16000,
  };

  try {
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 55000); // 55 sec timeout

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
        return res.status(429).json({ rateLimited: true, retryAfter: 30, error: 'Rate limit OpenRouter' });
      }
      return res.status(response.status).json({ error: 'OpenRouter ' + response.status, debug: raw.slice(0, 1000) });
    }

    var data;
    try { data = JSON.parse(raw); } catch (e) {
      return res.status(500).json({ error: 'Reponse invalide', debug: raw.slice(0, 800) });
    }

    if (data.error) {
      return res.status(500).json({ error: data.error.message || JSON.stringify(data.error).slice(0, 500) });
    }

    // DeepSeek R1 response format:
    // choices[0].message.content = the actual response
    // choices[0].message.reasoning_content = the thinking (optional, ignore)
    var text = "";
    if (data.choices && data.choices[0] && data.choices[0].message) {
      text = data.choices[0].message.content || "";
    }

    if (!text) {
      // Debug: return what we got
      return res.status(500).json({ 
        error: "Reponse vide de DeepSeek", 
        debug: JSON.stringify(data).slice(0, 2000) 
      });
    }

    // R1 can put <think>...</think> before the actual content
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Clean markdown fences
    var cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    // Extract JSON
    var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];

    res.status(200).json({ text: cleaned });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'DeepSeek a mis trop de temps (>55s). Reessaie.' });
    }
    res.status(500).json({ error: e.message });
  }
}

// Vercel: augmenter le timeout de la fonction
export const config = {
  maxDuration: 60,
};
