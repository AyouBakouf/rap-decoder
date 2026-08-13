// Deux backends possibles, tous deux en API OpenAI-compatible :
//  - Google AI Studio en direct (GOOGLE_API_KEY) : tier gratuit, prioritaire
//  - OpenRouter (OPENROUTER_API_KEY) : payant, utilise en repli
// Google nomme ses modeles "gemini-2.5-flash", OpenRouter "google/gemini-2.5-flash".
// Defauts distincts par provider : Google ferme ses modeles 2.x aux nouveaux
// projets ("no longer available to new users"), donc un projet cree aujourd'hui
// doit viser la generation 3.x. OpenRouter continue de servir 2.5-flash.
export var GOOGLE_DEFAULT_MODEL = "gemini-3.6-flash";
export var OPENROUTER_DEFAULT_MODEL = "google/gemini-2.5-flash";

// Modele par TYPE de tache, cote OpenRouter uniquement (sur le tier gratuit Google,
// tout passe par le modele Google, il n'y a rien a arbitrer).
//
//  - decode : gros volume, sortie longue (chaque ligne sort en original + traduction),
//    donc c'est le prix de SORTIE qui domine la facture. V4 Pro est deja le second
//    decodeur du projet (api/openrouter.js) et sort a 0.87$/M contre 2.50$ pour
//    gemini-2.5-flash: sur ce poste c'est le meilleur rapport a qualite comparable.
//  - analysis : volume plus faible mais demande du jugement (reperer un vrai multi,
//    noter une ecriture). On peut y mettre plus cher sans que ca pese.
// La RECHERCHE n'est volontairement pas listee ici: ces appels imposent
// "perplexity/sonar" depuis le front, et c'est justement ce modele explicite qui
// declenche la detection de substitution ("repondu de memoire, sans recherche web")
// plus bas. Le resoudre ici a la place ferait disparaitre cet avertissement en
// silence — ne pas "simplifier" en ajoutant une entree search.
//
// Chaque valeur est surchargeable par variable d'environnement: les identifiants
// OpenRouter changent, et une valeur en dur qui ne correspond plus produit un 404.
export var TASK_MODELS = {
  decode: { env: "MODEL_DECODE", def: "deepseek/deepseek-v4-pro" },
  analysis: { env: "MODEL_ANALYSIS", def: "deepseek/deepseek-v4-pro" },
};

// Tarifs OpenRouter en dollars par million de tokens, + plafond de sortie.
// Sert a chiffrer reellement une session au lieu d'appliquer un tarif fige: le
// compteur mentait des que le modele changeait. Un modele absent de cette table
// n'est pas une erreur — son cout est simplement rendu inconnu plutot que faux.
export var MODEL_PRICING = {
  "deepseek/deepseek-v4-pro": { in: 0.43, out: 0.87, maxOut: 32000 },
  "deepseek/deepseek-v4-flash": { in: 0.07, out: 0.14, maxOut: 32000 },
  "google/gemini-2.5-flash": { in: 0.30, out: 2.50, maxOut: 60000 },
  "google/gemini-3.6-flash": { in: 1.50, out: 7.50, maxOut: 60000 },
  "perplexity/sonar": { in: 1.00, out: 1.00, maxOut: 8000 },
};
// Google nomme "gemini-3.6-flash", OpenRouter "google/gemini-3.6-flash": on accepte
// les deux ecritures pour la meme entree de tarif.
export function pricingFor(model) {
  var m = model || "";
  return MODEL_PRICING[m] || MODEL_PRICING["google/" + m] || null;
}

// Une variable definie mais vide, ou remplie d'espaces, est traitee comme absente :
// une cle blanche doit faire basculer sur l'autre provider, pas produire un 401.
function cleanEnv(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function resolveProvider(rawEnv) {
  var env = {
    GOOGLE_API_KEY: cleanEnv(rawEnv.GOOGLE_API_KEY),
    OPENROUTER_API_KEY: cleanEnv(rawEnv.OPENROUTER_API_KEY),
    GEMINI_MODEL: cleanEnv(rawEnv.GEMINI_MODEL),
  };
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
  // Mode rapide: l'appelant demande explicitement OpenRouter pour cette requete,
  // pour ne pas subir les 20 req/min du tier gratuit Google. Choix manuel et
  // ponctuel — surtout pas un repli automatique sur 429, qui reviendrait a tout
  // payer puisque le quota gratuit est sature en continu pendant une disco en masse.
  var wantsOpenRouter = req.body && req.body.viaOpenRouter && cleanEnv(process.env.OPENROUTER_API_KEY);
  var provider = wantsOpenRouter
    ? resolveProvider({ OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL })
    : resolveProvider(process.env);
  var defaultModel = provider ? provider.model : (process.env.GEMINI_MODEL || "google/gemini-2.5-flash");

  if (req.method === 'GET') {
    if (!provider) return res.status(200).json({ status: "FAIL", reason: "Aucune cle configuree (GOOGLE_API_KEY ou OPENROUTER_API_KEY)" });
    try {
      var testRes = await fetch(provider.url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + provider.apiKey }, provider.headers),
        body: JSON.stringify({ model: defaultModel, messages: [{ role: "user", content: "Reponds: {\"ok\":true}" }], max_tokens: 50 }),
      });
      var raw = await testRes.text();
      return res.status(200).json({ status: testRes.ok ? "OK" : "FAIL", httpStatus: testRes.status, provider: provider.name, model: defaultModel, raw: raw.slice(0, 600) });
    } catch (e) {
      return res.status(200).json({ status: "FAIL", error: e.message, provider: provider.name, model: defaultModel });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!provider) return res.status(500).json({ error: 'Aucune cle API configuree (GOOGLE_API_KEY ou OPENROUTER_API_KEY)' });

  var system = req.body.system || "";
  var message = req.body.message || "";
  // Le modele explicite du front reste prioritaire (appels de recherche). Sinon on
  // resout par type de tache, et seulement chez OpenRouter: le tier gratuit Google
  // n'a qu'un modele, arbitrer par tache n'y voudrait rien dire.
  var task = req.body.task || "decode";
  var taskModel = null;
  if (!req.body.model && provider.name === "openrouter" && TASK_MODELS[task]) {
    taskModel = cleanEnv(process.env[TASK_MODELS[task].env]) || TASK_MODELS[task].def;
  }
  var model = req.body.model || taskModel || defaultModel;

  // Le front impose "perplexity/sonar" sur les appels qui demandent une recherche
  // web (tracklists, discographies, contexte d'album). Google ne sert que ses
  // propres modeles : tout identifiant garde un namespace apres retrait de
  // "google/" lui est etranger et provoquait un 404.
  //
  // On substitue alors le modele Google, en signalant que la reponse est produite
  // de memoire et non sourcee — l'appelant doit pouvoir le montrer a l'ecran.
  //
  // Si tu recredites OpenRouter, pose SEARCH_VIA_OPENROUTER=1 : ces appels
  // repartiront chez lui et retrouveront une vraie recherche web, pendant que le
  // decodage continue de passer par Google gratuitement. Sans ce drapeau, la
  // substitution reste silencieuse meme avec du credit disponible.
  var substitution = null;
  if (provider.name === "google") {
    model = model.replace(/^google\//, "");
    if (model.indexOf("/") !== -1) {
      var orKey = cleanEnv(process.env.OPENROUTER_API_KEY);
      if (orKey && cleanEnv(process.env.SEARCH_VIA_OPENROUTER)) {
        provider = {
          name: "openrouter",
          apiKey: orKey,
          url: "https://openrouter.ai/api/v1/chat/completions",
          model: model,
          headers: { 'HTTP-Referer': 'https://rap-decoder.vercel.app', 'X-Title': 'Rap Decoder' },
        };
      } else {
        substitution = {
          demande: model,
          utilise: provider.model,
          raison: "recherche web indisponible (pas de credit OpenRouter, quota google_search nul sur le tier gratuit)",
        };
        model = provider.model;
      }
    }
  }

  var messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: message });

  // 60000 etait taille pour Gemini. Un modele qui plafonne plus bas rejette la
  // requete ou tronque, et la troncature ressort en "Reponse tronquee" cote client
  // sans qu'on sache que c'est le plafond demande qui etait irrealiste.
  var priced = pricingFor(model);
  var body = {
    model: model,
    messages: messages,
    max_tokens: (priced && priced.maxOut) || 32000,
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
        // Google indique le delai exact a respecter ("Please retry in 47.6s.") et
        // peut demander bien plus que les 20s qu'on supposait. Reessayer trop tot
        // garantit un nouveau 429 et brule les tentatives pour rien.
        var retryAfter = 20;
        var mSec = raw.match(/retry in ([\d.]+)\s*s/i);
        if (mSec) retryAfter = Math.ceil(parseFloat(mSec[1]));
        // Le quota epuise est distinct d'un simple pic de debit : le signaler permet
        // a l'appelant de ne pas s'acharner.
        var quotaMatch = raw.match(/Quota exceeded for metric: ([^\s,]+)[^\n]*limit: (\d+)/i);
        return res.status(429).json({
          rateLimited: true,
          retryAfter: retryAfter,
          quotaMetric: quotaMatch ? quotaMatch[1] : null,
          quotaLimit: quotaMatch ? Number(quotaMatch[2]) : null,
          error: 'Rate limit (reessai dans ' + retryAfter + 's)',
        });
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
    // Compteurs de tokens remontes tels quels: ils permettent de chiffrer le cout
    // reel d'un album au lieu de l'estimer.
    var usage = data.usage ? {
      in: data.usage.prompt_tokens || 0,
      out: data.usage.completion_tokens || 0,
    } : null;
    // Le tarif part avec la reponse: c'est le seul endroit qui sait quel modele a
    // reellement servi. Le client ne peut plus appliquer un prix qui n'est pas le bon.
    res.status(200).json({
      text: cleaned, citations: data.citations || null, finishReason: finishReason,
      substitution: substitution, provider: provider.name, model: model,
      task: task, pricing: priced ? { in: priced.in, out: priced.out } : null,
      usage: usage,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export const config = {
  maxDuration: 60,
};
