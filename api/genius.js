// En dessous, ce n'est pas un morceau: un couplet de rap fait deja plusieurs centaines
// de caracteres. Sert de seuil "continue a chercher", pas de seuil de rejet — un skit
// court reellement bref est conserve, mais marque partial.
var MIN_FULL_LYRICS = 400;

export default async function handler(req, res) {
  var token = process.env.GENIUS_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'GENIUS_API_TOKEN not set' });

  // GET = test direct: /api/genius?title=...&artist=...
  if (req.method === 'GET') {
    var qt = (req.query && req.query.title) || "";
    var qa = (req.query && req.query.artist) || "";
    if (!qt || !qa) return res.status(200).json({ usage: "GET /api/genius?title=Xxx&artist=Yyy" });
    return runLookup(qt, qa, token, res);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var title = req.body.title || "";
  var artist = req.body.artist || "";
  return runLookup(title, artist, token, res);
}

async function runLookup(title, artist, token, res) {
  var cleanTitle = title
    .replace(/\s*\(feat\.?[^)]*\)/gi, "")
    .replace(/\s*\[feat\.?[^\]]*\]/gi, "")
    .replace(/\s*ft\.?\s+.*/i, "")
    .replace(/\s*\(bonus\s*(track)?\)/gi, "")
    .replace(/\s*\(deluxe\)/gi, "")
    .replace(/[.,'!?#\(\)\[\]]/g, " ")
    .replace(/\s+/g, " ").trim();
  var dbg = { steps: [] };
  try {
    var song = await searchGenius(cleanTitle + " " + artist, artist, token);
    if (!song) song = await searchGenius(cleanTitle, artist, token);
    dbg.steps.push("genius_search: " + (song ? ("found url=" + song.url) : "NOT FOUND"));
    var songTitle = song ? song.title : title;
    var songArtist = (song && song.primary_artist && song.primary_artist.name) ? song.primary_artist.name : artist;
    var geniusUrl = song ? song.url : "";
    if (!geniusUrl) {
      geniusUrl = buildGeniusUrl(artist, cleanTitle);
      dbg.steps.push("genius_url_guess: " + geniusUrl);
    }
    // Chaque source rendait la main des qu'elle renvoyait QUELQUE CHOSE, si court
    // soit-il. lrclib a des entrees tronquees a une ou deux lignes: 34 caracteres
    // suffisaient a arreter la chaine, a passer le seuil de 20 ci-dessous, et a etre
    // servis comme des paroles completes. On continue donc tant qu'on n'a pas un texte
    // de taille plausible, en gardant le plus fourni trouve en route.
    var lyrics = "";
    var keep = function(cand, step) {
      dbg.steps.push(step + ": " + (cand ? cand.length + " chars" : "empty"));
      if (cand && cand.length > lyrics.length) lyrics = cand;
      return lyrics.length >= MIN_FULL_LYRICS;
    };
    var matched = null;
    var lr = await fetchFromLrclib(songArtist, songTitle);
    var enough = keep(lr.text, "lrclib(canonical)");
    if (lr.text && lyrics === lr.text) matched = { artist: lr.artist, track: lr.track, via: "lrclib" };
    if (!enough && song) {
      var lr2 = await fetchFromLrclib(artist, title);
      enough = keep(lr2.text, "lrclib(original)");
      if (lr2.text && lyrics === lr2.text) matched = { artist: lr2.artist, track: lr2.track, via: "lrclib" };
    }
    if (!enough) enough = keep(await fetchFromLyricsOvh(songArtist, songTitle), "lyricsovh(canonical)");
    if (!enough) enough = keep(await fetchFromLyricsOvh(artist, title), "lyricsovh(original)");
    if (!enough) {
      var sr = await fetchFromGeniusHtml(geniusUrl);
      enough = keep(sr.lyrics, "genius_scrape(http=" + sr.status + " blocks=" + sr.blocks + " htmlLen=" + sr.htmlLen + ")");
    }
    // Les paroliers FR rattrapent souvent ce que lrclib tronque: on les interroge des
    // que le texte en main est court, pas seulement quand il est absent.
    var srcUrl = geniusUrl;
    if (!enough) {
      var pn = await fetchFromParolesNet(songArtist, songTitle);
      if (!pn.lyrics && (songArtist !== artist || songTitle !== title)) pn = await fetchFromParolesNet(artist, title);
      if (keep(pn.lyrics, "paroles_net(url=" + pn.url + ")")) { enough = true; srcUrl = pn.url; }
      else if (pn.lyrics && lyrics === pn.lyrics) srcUrl = pn.url;
    }
    if (!enough) {
      var pm = await fetchFromParolesMusique(songArtist, songTitle);
      if (!pm.lyrics && (songArtist !== artist || songTitle !== title)) pm = await fetchFromParolesMusique(artist, title);
      if (keep(pm.lyrics, "paroles_musique(url=" + pm.url + ")")) { enough = true; srcUrl = pm.url; }
      else if (pm.lyrics && lyrics === pm.lyrics) srcUrl = pm.url;
    }
    if (!enough) {
      var sonar = await fetchFromSonar(songArtist, songTitle, dbg.steps);
      if (!sonar && (songArtist !== artist || songTitle !== title)) sonar = await fetchFromSonar(artist, title, dbg.steps);
      if (keep(sonar, "sonar")) { enough = true; srcUrl = "sonar-search"; }
      else if (sonar && lyrics === sonar) srcUrl = "sonar-search";
    }
    if (!lyrics) return res.status(200).json({ found: false, lyrics: "", source: geniusUrl, _debug: dbg });
    // Toujours trop court apres toutes les sources: c'est peut-etre un skit ou un
    // interlude reellement bref, donc on ne le jette pas — mais on le signale, pour
    // que le client sache qu'il n'a pas un morceau complet entre les mains.
    return res.status(200).json({
      found: true, lyrics: cleanLyrics(lyrics), source: srcUrl,
      partial: !enough, chars: lyrics.length, matched: matched,
      title: songTitle, artist: songArtist, geniusId: song ? song.id : null, _debug: dbg,
    });
  } catch (e) { return res.status(500).json({ error: e.message, _debug: dbg }); }
}
function cleanLyrics(text) {
  if (!text) return text;
  return text
    .replace(/\s*\[\?]\s*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^(subtag|cf_page|cf_ad|var\s|document\.|window\.).*$/gm, "")
    .replace(/^.*adunit.*$/gim, "")
    .replace(/^.*Below Lyrics.*$/gim, "")
    .replace(/^<intraduisible>$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
// Cle de comparaison pour lrclib: on retire d'abord les mentions qui varient d'une
// base a l'autre pour le meme morceau (feat., (Remastered), [Bonus]) avant de slugifier.
function lrclibKey(s) {
  var slug = toSlug(String(s || "")
    .replace(/\(.*?\)|\[.*?]/g, " ")
    .replace(/\b(feat|ft|featuring|prod|remaster(ed)?|version|edit)\b.*/gi, " "));
  // Article initial retire des deux cotes: les catalogues hesitent entre "The Score"
  // et "Score". Le faire ici plutot que de relacher le seuil de ressemblance, qui
  // rouvrirait la porte aux rapprochements hasardeux qu'on cherche justement a fermer.
  var stripped = slug.replace(/^(the|a|an|le|la|les|un|une|los|las|el)-/, "");
  return stripped || slug;
}
// L'inclusion nue ("l'un contient l'autre") n'est un indice d'identite que si le plus
// court est assez discriminant. Sur un nom court elle ne filtre plus rien: l'artiste
// "Ka" est contenu dans des centaines de noms sans rapport (Kanye, Sakamoto, Kaytranada),
// donc tout passait, et l'heuristique "le plus long gagne" juste apres allait
// justement elire le morceau etranger le plus fourni. Vu sur Ka - "I Wish", servi avec
// les paroles d'une chanson de R&B qui n'a rien a voir.
// On exige donc que la partie commune pese vraiment dans le nom le plus long, avec un
// plancher absolu en dessous duquel seule l'egalite exacte compte.
var LOOSE_MIN_CHARS = 4;
var LOOSE_MIN_RATIO = 0.6;
function matchesLoosely(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  var shorter = a.length <= b.length ? a : b;
  var longer = a.length <= b.length ? b : a;
  if (shorter.length < LOOSE_MIN_CHARS) return false;
  if (shorter.length < longer.length * LOOSE_MIN_RATIO) return false;
  return longer.indexOf(shorter) !== -1;
}
// Les entrees synchronisees stockent le texte prefixe de timestamps [00:12.34].
function stripLrcTimestamps(s) {
  return String(s || "").split("\n").map(function(l) {
    return l.replace(/^\s*(\[\d{1,2}:\d{2}(\.\d{1,3})?]\s*)+/, "");
  }).join("\n").trim();
}
async function fetchFromLrclib(artist, title) {
  try {
    var searchUrl = "https://lrclib.net/api/search?artist_name=" + encodeURIComponent(artist) + "&track_name=" + encodeURIComponent(title);
    var r = await fetch(searchUrl);
    if (!r.ok) return "";
    var results = await r.json();
    if (!results || !results.length) return "";
    var wantArtist = lrclibKey(artist);
    var wantTitle = lrclibKey(title);
    if (!wantArtist || !wantTitle) return "";
    // On exige que l'artiste ET le titre correspondent. Filtrer sur le seul artiste
    // laissait passer un autre morceau du meme artiste, que l'heuristique "le plus
    // long gagne" ci-dessous allait justement privilegier s'il etait plus fourni.
    // Et si rien ne correspond, on abandonne: se rabattre sur l'ensemble des
    // resultats servait les paroles d'un homonyme sans que rien ne le signale.
    var candidates = results.filter(function(res) {
      if (res.instrumental) return false;
      return matchesLoosely(lrclibKey(res.artistName), wantArtist)
          && matchesLoosely(lrclibKey(res.trackName), wantTitle);
    });
    if (!candidates.length) return "";
    // lrclib a souvent plusieurs entrees dupliquees pour le meme morceau, dont des versions
    // tronquees ou mal taguees (vu sur "2007" de JID: une entree a 767 caracteres, une autre a
    // 7591 pour le meme artiste+titre). La plus courte est presque toujours tronquee/fausse —
    // on prend celle avec le plus de texte plutot que la premiere renvoyee par l'API.
    var best = "", bestOn = null;
    for (var i = 0; i < candidates.length; i++) {
      // A defaut de texte brut, la version synchronisee contient les memes paroles.
      var text = candidates[i].plainLyrics || stripLrcTimestamps(candidates[i].syncedLyrics);
      if (text && text.length > best.length) { best = text; bestOn = candidates[i]; }
    }
    // On remonte SUR QUOI on a atterri, pas seulement le texte: un mauvais
    // rapprochement ne se voyait nulle part, ni dans la reponse ni a l'ecran.
    if (best.length > 30) return { text: best, artist: bestOn.artistName, track: bestOn.trackName };
  } catch (e) {}
  return { text: "", artist: null, track: null };
}
async function fetchFromLyricsOvh(artist, title) {
  try {
    var url = "https://api.lyrics.ovh/v1/" + encodeURIComponent(artist) + "/" + encodeURIComponent(title);
    var r = await fetch(url);
    if (r.ok) {
      var data = await r.json();
      if (data.lyrics && data.lyrics.length > 30) return data.lyrics.trim();
    }
  } catch (e) {}
  return "";
}
async function fetchFromGeniusHtml(geniusUrl) {
  var out = { lyrics: "", status: 0, blocks: 0, htmlLen: 0 };
  try {
    var r = await fetch(geniusUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    out.status = r.status;
    if (!r.ok) return out;
    var html = await r.text();
    out.htmlLen = html.length;
    var blocks = html.match(/<div[^>]*data-lyrics-container="true"[^>]*>[\s\S]*?<\/div>(?=\s*(?:<div|<\/div))/g);
    if (!blocks || !blocks.length) {
      blocks = html.match(/<div[^>]*class="[^"]*Lyrics__Container[^"]*"[^>]*>[\s\S]*?<\/div>(?=\s*(?:<div|<\/div))/g);
    }
    if (!blocks || !blocks.length) {
      var jsonMatch = html.match(/"lyrics":\s*\{[^}]*"plain":\s*"((?:[^"\\]|\\.)*)"/);
      if (jsonMatch && jsonMatch[1]) {
        var plain = jsonMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        if (plain.length > 30) { out.lyrics = plain; out.blocks = -1; return out; }
      }
    }
    out.blocks = blocks ? blocks.length : 0;
    if (!blocks || !blocks.length) return out;
    var combined = blocks.map(function(b) {
      return b
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#x27;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, " ")
        .trim();
    }).filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    if (combined.length > 30) out.lyrics = combined;
    return out;
  } catch (e) { return out; }
}
function toSlug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
async function fetchFromParolesNet(artist, title) {
  try {
    var url = "https://www.paroles.net/" + toSlug(artist) + "/paroles-" + toSlug(title);
    var r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
    });
    if (!r.ok) return { lyrics: "", url: url, status: r.status };
    var html = await r.text();
    var match = html.match(/<article[^>]*class="lyrics"[^>]*>([\s\S]*?)<\/article>/);
    if (!match) return { lyrics: "", url: url, status: r.status };
    var article = match[1];
    article = article.replace(/<br\s*\/?>/gi, "\n");
    article = article.replace(/<\/div>\s*<div/gi, "\n\n<div");
    article = article.replace(/<!--[\s\S]*?-->/g, "");
    article = article.replace(/<[^>]+>/g, "");
    article = article.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#x27;/g, "'").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
    var lines = article.split("\n");
    var filtered = lines.filter(function(l) {
      var t = l.trim();
      if (!t) return true;
      if (/^Content_\d+$/.test(t)) return false;
      if (t.indexOf("Paroles de la chanson") === 0) return false;
      if (/^\/\*|^\*\/|^subtag:|^cf_page|^cf_ad|^var\s|^document\.|^window\.|^\(function|^<intraduisible>$/i.test(t)) return false;
      if (/adunit|Below Lyrics|google_ad|sponsored/i.test(t)) return false;
      if (t.indexOf("=") !== -1 && t.indexOf(";") !== -1 && t.length < 80) return false;
      return true;
    });
    var text = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return { lyrics: text.length > 50 ? text : "", url: url, status: r.status };
  } catch(e) { return { lyrics: "", url: "", status: 0 }; }
}
async function fetchFromParolesMusique(artist, title) {
  try {
    var url = "https://paroles2chansons.lemonde.fr/paroles-" + toSlug(artist) + "/paroles-" + toSlug(title) + ".html";
    var r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
    });
    if (!r.ok) return { lyrics: "", url: url, status: r.status };
    var html = await r.text();
    var jsonLd = html.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (jsonLd && jsonLd[1]) {
      var text = jsonLd[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
      if (text.length > 50) return { lyrics: text, url: url, status: r.status };
    }
    return { lyrics: "", url: url, status: r.status };
  } catch(e) { return { lyrics: "", url: "", status: 0 }; }
}
var LYRICS_URL_PROMPT_PREFIX = "Trouve une page web contenant les paroles completes de \"";
var LYRICS_URL_PROMPT_SUFFIX = "\". Donne-moi UNIQUEMENT l'URL de la page (pas les paroles). Une seule URL, rien d'autre.";

function lyricsUrlPrompt(artist, title) {
  return LYRICS_URL_PROMPT_PREFIX + title + "\" par " + artist + LYRICS_URL_PROMPT_SUFFIX;
}

// Demande a un moteur de recherche LLM l'URL d'une page de paroles, puis la scrape.
// Sonar (via OpenRouter) si dispo, sinon Gemini + Google Search grounding sur le
// tier gratuit AI Studio. Sans aucune cle, on degrade silencieusement.
async function fetchFromSonar(artist, title, dbg) {
  var urls = [];
  if (process.env.OPENROUTER_API_KEY) {
    urls = await askSonarForUrls(artist, title, dbg);
  } else if (process.env.GOOGLE_API_KEY) {
    urls = await askGeminiForUrls(artist, title, dbg);
  } else {
    if (dbg) dbg.push("sonar_ask: aucune cle (OPENROUTER_API_KEY / GOOGLE_API_KEY)");
    return "";
  }
  if (!urls.length) { if (dbg) dbg.push("sonar_ask: pas d'URL trouvee"); return ""; }
  for (var i = 0; i < urls.length && i < 3; i++) {
    var u = urls[i].replace(/[.,;:!?]+$/, "");
    var scraped = await scrapeGenericLyrics(u);
    if (dbg) dbg.push("sonar_scrape[" + u + "]: http=" + scraped.status + " | htmlLen=" + scraped.htmlLen + " | method=" + scraped.method + " | textLen=" + scraped.text.length);
    if (scraped.text && scraped.text.length > 100) return scraped.text;
  }
  return "";
}

function extractUrls(text) {
  return (text || "").match(/https?:\/\/[^\s\)\]"<>]+/g) || [];
}

async function askSonarForUrls(artist, title, dbg) {
  try {
    var r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + process.env.OPENROUTER_API_KEY },
      body: JSON.stringify({
        model: "perplexity/sonar",
        messages: [{ role: "user", content: lyricsUrlPrompt(artist, title) }],
        max_tokens: 300,
      }),
    });
    if (!r.ok) { if (dbg) dbg.push("sonar_ask: http=" + r.status); return []; }
    var data = await r.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) { if (dbg) dbg.push("sonar_ask: reponse vide"); return []; }
    return extractUrls(data.choices[0].message.content);
  } catch(e) { if (dbg) dbg.push("sonar_ask: exception " + e.message); return []; }
}

// Gemini natif (pas l'endpoint OpenAI-compat) : seul lui expose l'outil google_search,
// et les URL sources remontent dans groundingMetadata en plus du texte.
//
// ATTENTION : google_search a un quota distinct de celui du modele, et il est nul
// sur le tier gratuit AI Studio (verifie le 2026-08-10 : le meme modele repond 200
// sans l'outil et 429 avec). Ce chemin ne rend donc service que sur un projet
// facture. Sans quota il renvoie [] et le scraping direct reste seul en lice.
// Garder le defaut aligne sur GOOGLE_DEFAULT_MODEL dans api/gemini.js.
async function askGeminiForUrls(artist, title, dbg) {
  var model = (process.env.GEMINI_MODEL || "gemini-3.6-flash").replace(/^google\//, "");
  try {
    var r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GOOGLE_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: lyricsUrlPrompt(artist, title) }] }],
        tools: [{ google_search: {} }],
      }),
    });
    if (!r.ok) {
      if (dbg) dbg.push("gemini_ask: http=" + r.status + (r.status === 429 ? " (quota google_search epuise — normal sur le tier gratuit)" : ""));
      return [];
    }
    var data = await r.json();
    var cand = data.candidates && data.candidates[0];
    if (!cand) { if (dbg) dbg.push("gemini_ask: reponse vide"); return []; }
    var text = "";
    var parts = cand.content && cand.content.parts ? cand.content.parts : [];
    for (var i = 0; i < parts.length; i++) text += parts[i].text || "";
    var urls = extractUrls(text);
    // Les liens de grounding sont des redirections vertexaisearch : utiles en secours seulement.
    var chunks = cand.groundingMetadata && cand.groundingMetadata.groundingChunks ? cand.groundingMetadata.groundingChunks : [];
    for (var j = 0; j < chunks.length; j++) {
      if (chunks[j].web && chunks[j].web.uri) urls.push(chunks[j].web.uri);
    }
    if (dbg) dbg.push("gemini_ask: " + urls.length + " URL(s)");
    return urls;
  } catch(e) { if (dbg) dbg.push("gemini_ask: exception " + e.message); return []; }
}
async function scrapeGenericLyrics(url) {
  var out = { text: "", status: 0, htmlLen: 0, method: "none" };
  try {
    var r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
      redirect: "follow",
    });
    out.status = r.status;
    if (!r.ok) return out;
    var html = await r.text();
    out.htmlLen = html.length;
    if (html.length < 500) return out;
    var text = "";
    var jsonLd = html.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (jsonLd && jsonLd[1]) {
      text = jsonLd[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
      if (text.length > 100) { out.text = text; out.method = "json-ld"; return out; }
    }
    var containers = [
      /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g,
      /<div[^>]*class="[^"]*(?:lyrics|paroles|song-text|lyric-body)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
      /<article[^>]*class="[^"]*lyrics[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
      /<pre[^>]*class="[^"]*lyric[^"]*"[^>]*>([\s\S]*?)<\/pre>/gi,
    ];
    for (var c = 0; c < containers.length; c++) {
      var matches = [];
      var m;
      var re = containers[c];
      while ((m = re.exec(html)) !== null) matches.push(m[1]);
      if (matches.length) {
        text = matches.join("\n\n")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/p>/gi, "\n")
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&#x27;/g, "'").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
          .replace(/\n{3,}/g, "\n\n").trim();
        if (text.length > 100) { out.text = text; out.method = "container[" + c + "]"; return out; }
      }
    }
    // Dernier recours: certains sites (surtout les vieux/artisanaux) mettent les paroles dans un
    // conteneur generique (une classe de framework CSS type "w3-content", "blog", etc.) sans aucun
    // indice semantique dans le nom de classe/id — impossible a cibler par selecteur. On detecte
    // plutot la STRUCTURE: un bloc de nombreuses lignes courtes consecutives (le decoupage ligne
    // par ligne typique des paroles/poemes), peu importe ce qui l'entoure dans le HTML.
    var verse = extractVerseBlock(html);
    if (verse.length > 100) { out.text = verse; out.method = "verse-block"; return out; }
  } catch(e) {}
  return out;
}
// Detecte un bloc de paroles par la FORME du texte (beaucoup de lignes courtes consecutives),
// pas par le nom d'une classe/id CSS — utile pour les sites qui rangent les paroles dans un
// conteneur generique de framework (ex: "w3-content", "blog") sans aucun indice semantique.
function extractVerseBlock(html) {
  // Seules les balises de BLOC inserent un saut de ligne — les balises inline (span/a/b/i/strong...)
  // sont juste retirees sans casser la ligne, sinon des fragments internes (un mot en gras, un lien)
  // fragmentent chaque ligne en plusieurs lignes courtes separees de "blancs", et aucun run ne peut
  // plus atteindre le seuil minimal meme quand le vrai bloc de paroles est bien la.
  var plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  var lines = plain.split("\n").map(function(l) { return l.trim(); });
  // true = ligne "vers" (courte, style parole/poeme), false = ligne "prose"/non pertinente, null = vide
  var classify = function(l) {
    if (!l) return null;
    var words = l.split(/\s+/).length;
    return words <= 16 && l.length <= 100;
  };
  var runs = [];
  var start = -1, blanksInRow = 0;
  for (var i = 0; i <= lines.length; i++) {
    var v = i < lines.length ? classify(lines[i]) : false;
    if (v === true) {
      if (start < 0) start = i;
      blanksInRow = 0;
    } else if (v === null && start >= 0 && blanksInRow < 1) {
      blanksInRow++;
    } else {
      if (start >= 0) runs.push({ start: start, end: i - 1 - blanksInRow });
      start = -1; blanksInRow = 0;
    }
  }
  if (!runs.length) return "";
  runs.sort(function(a, b) { return (b.end - b.start) - (a.end - a.start); });
  var best = runs[0];
  if (best.end - best.start + 1 < 20) return "";
  return lines.slice(best.start, best.end + 1).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function buildGeniusUrl(artist, title) {
  var slug = (artist + " " + title)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[''’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return "https://genius.com/" + slug + "-lyrics";
}
function matchHits(hits, artist) {
  var artistLower = artist.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (var i = 0; i < hits.length; i++) {
    if (hits[i].type === "song" && hits[i].result) {
      var pa = (hits[i].result.primary_artist && hits[i].result.primary_artist.name) || "";
      var paLower = pa.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (paLower.indexOf(artistLower) !== -1 || artistLower.indexOf(paLower) !== -1) return hits[i].result;
    }
  }
  return null;
}
async function searchGenius(query, artist, token) {
  try {
    var r = await fetch("https://api.genius.com/search?q=" + encodeURIComponent(query), { headers: { "Authorization": "Bearer " + token } });
    var data = await r.json();
    var found = matchHits((data.response && data.response.hits) || [], artist);
    if (found) return found;
  } catch(e) {}
  try {
    var r2 = await fetch("https://genius.com/api/search/song?per_page=5&q=" + encodeURIComponent(query), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
    });
    var data2 = await r2.json();
    var sections = (data2.response && data2.response.sections) || [];
    for (var s = 0; s < sections.length; s++) {
      if (sections[s].type === "song") {
        var found2 = matchHits(sections[s].hits || [], artist);
        if (found2) return found2;
        break;
      }
    }
  } catch(e) {}
  return null;
}

export const config = {
  maxDuration: 60,
};
