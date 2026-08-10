// Deux backends possibles, tous deux en API OpenAI-compatible :
//  - Google AI Studio en direct (GOOGLE_API_KEY) : tier gratuit, prioritaire
//  - OpenRouter (OPENROUTER_API_KEY) : payant, utilise en repli
// Google nomme ses modeles "gemini-2.5-flash", OpenRouter "google/gemini-2.5-flash".
// Defauts distincts par provider : Google ferme ses modeles 2.x aux nouveaux
// projets ("no longer available to new users"), donc un projet cree aujourd'hui
// doit viser la generation 3.x. OpenRouter continue de servir 2.5-flash.
export var GOOGLE_DEFAULT_MODEL = "gemini-3.6-flash";
export var OPENROUTER_DEFAULT_MODEL = "google/gemini-2.5-flash";

export function resolveProvider(env) {
  if (env.GOOGLE_API_KEY) {
    return {
      name: "google",
      apiKey: env.GOOGLE_API_KEY,
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: (env.GEMINI_MODEL || GOOGLE_DEFAULT_MODEL).replace(/^google\//, ""),
      headers: {},
    };
  }
  if (env.OPENROUTER_API_KEY) {
    return {
      name: "openrouter",
      apiKey: env.OPENROUTER_API_KEY,
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: env.GEMINI_MODEL || OPENROUTER_DEFAULT_MODEL,
      headers: { 'HTTP-Referer': 'https://rap-decoder.vercel.app', 'X-Title': 'Rap Decoder' },
    };
  }
  return null;
}

export default async function handler(req, res) {
  var provider = resolveProvider(process.env);
  var defaultModel = provider ? provider.model : (process.env.GEMINI_MODEL || "google/gemini-2.5-flash");

  if (req.method === 'GET') {
    // Presence et longueur seulement : de quoi distinguer "absente", "mal scopee"
    // et "collee tronquee" sans jamais renvoyer un secret dans la reponse HTTP.
    var envSeen = {};
    ["GOOGLE_API_KEY", "OPENROUTER_API_KEY", "GENIUS_API_TOKEN", "GEMINI_MODEL"].forEach(function (k) {
      var v = process.env[k];
      envSeen[k] = v ? "presente (" + v.length + " car.)" : "ABSENTE";
    });
    // Un nom mal orthographie ou mal scope est la cause la plus frequente :
    // lister les variables qui ressemblent a une cle permet de le voir tout de suite.
    var lookalikes = Object.keys(process.env).filter(function (k) {
      return /GOOGLE|GEMINI|OPENROUTER|GENIUS/i.test(k);
    });
    var envInfo = { env: envSeen, clesDetectees: lookalikes, vercelEnv: process.env.VERCEL_ENV || null };

    if (!provider) return res.status(200).json(Object.assign({ status: "FAIL", reason: "Aucune cle configuree (GOOGLE_API_KEY ou OPENROUTER_API_KEY)" }, envInfo));
    try {
      var testRes = await fetch(provider.url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + provider.apiKey }, provider.headers),
        body: JSON.stringify({ model: defaultModel, messages: [{ role: "user", content: "Reponds: {\"ok\":true}" }], max_tokens: 50 }),
      });
      var raw = await testRes.text();
      return res.status(200).json(Object.assign({ status: testRes.ok ? "OK" : "FAIL", httpStatus: testRes.status, provider: provider.name, model: defaultModel }, envInfo, { raw: raw.slice(0, 600) }));
    } catch (e) {
      return res.status(200).json(Object.assign({ status: "FAIL", error: e.message, provider: provider.name, model: defaultModel }, envInfo));
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!provider) return res.status(500).json({ error: 'Aucune cle API configuree (GOOGLE_API_KEY ou OPENROUTER_API_KEY)' });

  var system = req.body.system || "";
  var message = req.body.message || "";
  // Le front peut imposer un modele au format OpenRouter : le renormaliser pour Google.
  var model = req.body.model || defaultModel;
  if (provider.name === "google") model = model.replace(/^google\//, "");

  var messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: message });

  var body = {
    model: model,
    messages: messages,
    max_tokens: 60000,
  };

  try {
    var response = await fetch(provider.url, {
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + provider.apiKey,
      }, provider.headers),
      body: JSON.stringify(body),
    });

    var raw = await response.text();

    if (!response.ok) {
      if (response.status === 429) {
        return res.status(429).json({ rateLimited: true, retryAfter: 20, error: 'Rate limit' });
      }
      var detail = "";
      try { var parsed = JSON.parse(raw); detail = parsed.error && parsed.error.message ? parsed.error.message : raw.slice(0, 500); } catch (e) { detail = raw.slice(0, 500); }
      return res.status(response.status).json({ error: provider.name + ' ' + response.status + ': ' + detail });
    }

    var data;
    try { data = JSON.parse(raw); } catch (e) {
      return res.status(500).json({ error: 'Reponse invalide: ' + raw.slice(0, 300) });
    }

    if (data.error) {
      return res.status(500).json({ error: data.error.message || JSON.stringify(data.error).slice(0, 300) });
    }

    var text = "", finishReason = null;
    if (data.choices && data.choices[0] && data.choices[0].message) {
      text = data.choices[0].message.content || "";
      finishReason = data.choices[0].finish_reason || null;
    }

    if (!text) {
      return res.status(500).json({ error: "Reponse vide. Debug: " + JSON.stringify(data).slice(0, 500) });
    }

    var cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    res.status(200).json({ text: cleaned, citations: data.citations || null, finishReason: finishReason });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export const config = {
  maxDuration: 60,
};
