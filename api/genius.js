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
    var lyrics = await fetchFromLrclib(songArtist, songTitle);
    dbg.steps.push("lrclib(canonical): " + (lyrics ? lyrics.length + " chars" : "empty"));
    if (!lyrics && song) {
      lyrics = await fetchFromLrclib(artist, title);
      dbg.steps.push("lrclib(original): " + (lyrics ? lyrics.length + " chars" : "empty"));
    }
    if (!lyrics) {
      lyrics = await fetchFromLyricsOvh(songArtist, songTitle);
      dbg.steps.push("lyricsovh(canonical): " + (lyrics ? lyrics.length + " chars" : "empty"));
    }
    if (!lyrics) {
      lyrics = await fetchFromLyricsOvh(artist, title);
      dbg.steps.push("lyricsovh(original): " + (lyrics ? lyrics.length + " chars" : "empty"));
    }
    if (!lyrics) {
      var sr = await fetchFromGeniusHtml(geniusUrl);
      lyrics = sr.lyrics;
      dbg.steps.push("genius_scrape: " + (lyrics ? lyrics.length + " chars" : "empty") + " | http=" + sr.status + " | blocks=" + sr.blocks + " | htmlLen=" + sr.htmlLen);
    }
    if (!lyrics || lyrics.length < 20) {
      var pn = await fetchFromParolesNet(songArtist, songTitle);
      dbg.steps.push("paroles_net(canonical): " + (pn.lyrics ? pn.lyrics.length + " chars" : "empty") + " | url=" + pn.url);
      if (!pn.lyrics && (songArtist !== artist || songTitle !== title)) {
        pn = await fetchFromParolesNet(artist, title);
        dbg.steps.push("paroles_net(original): " + (pn.lyrics ? pn.lyrics.length + " chars" : "empty") + " | url=" + pn.url);
      }
      if (!pn.lyrics) {
        var pm = await fetchFromParolesMusique(songArtist, songTitle);
        dbg.steps.push("paroles_musique(canonical): " + (pm.lyrics ? pm.lyrics.length + " chars" : "empty") + " | url=" + pm.url);
        if (!pm.lyrics && (songArtist !== artist || songTitle !== title)) {
          pm = await fetchFromParolesMusique(artist, title);
          dbg.steps.push("paroles_musique(original): " + (pm.lyrics ? pm.lyrics.length + " chars" : "empty") + " | url=" + pm.url);
        }
        if (pm.lyrics) {
          return res.status(200).json({ found: true, lyrics: cleanLyrics(pm.lyrics), source: pm.url, title: songTitle, artist: songArtist, geniusId: song ? song.id : null, _debug: dbg });
        }
      }
      if (pn.lyrics) {
        return res.status(200).json({ found: true, lyrics: cleanLyrics(pn.lyrics), source: pn.url, title: songTitle, artist: songArtist, geniusId: song ? song.id : null, _debug: dbg });
      }
      var sonar = await fetchFromSonar(songArtist, songTitle);
      dbg.steps.push("sonar: " + (sonar ? sonar.length + " chars" : "empty"));
      if (!sonar && (songArtist !== artist || songTitle !== title)) {
        sonar = await fetchFromSonar(artist, title);
        dbg.steps.push("sonar(original): " + (sonar ? sonar.length + " chars" : "empty"));
      }
      if (sonar) {
        return res.status(200).json({ found: true, lyrics: cleanLyrics(sonar), source: "sonar-search", title: songTitle, artist: songArtist, geniusId: song ? song.id : null, _debug: dbg });
      }
      return res.status(200).json({ found: false, lyrics: "", source: geniusUrl, _debug: dbg });
    }
    return res.status(200).json({ found: true, lyrics: cleanLyrics(lyrics), source: geniusUrl, title: songTitle, artist: songArtist, geniusId: song ? song.id : null, _debug: dbg });
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
async function fetchFromLrclib(artist, title) {
  try {
    var searchUrl = "https://lrclib.net/api/search?artist_name=" + encodeURIComponent(artist) + "&track_name=" + encodeURIComponent(title);
    var r = await fetch(searchUrl);
    if (!r.ok) return "";
    var results = await r.json();
    if (!results || !results.length) return "";
    var artistNorm = artist.toLowerCase().replace(/[^a-z0-9]/g, "");
    var candidates = results.filter(function(res) {
      var a = (res.artistName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return a.indexOf(artistNorm) !== -1 || artistNorm.indexOf(a) !== -1;
    });
    if (!candidates.length) candidates = results;
    // lrclib a souvent plusieurs entrees dupliquees pour le meme morceau, dont des versions
    // tronquees ou mal taguees (vu sur "2007" de JID: une entree a 767 caracteres, une autre a
    // 7591 pour le meme artiste+titre). La plus courte est presque toujours tronquee/fausse —
    // on prend celle avec le plus de texte plutot que la premiere renvoyee par l'API.
    var best = candidates.reduce(function(a, b) {
      var la = (a && a.plainLyrics) ? a.plainLyrics.length : 0;
      var lb = (b && b.plainLyrics) ? b.plainLyrics.length : 0;
      return lb > la ? b : a;
    }, null);
    if (best && best.plainLyrics && best.plainLyrics.length > 30) return best.plainLyrics;
  } catch (e) {}
  return "";
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
async function fetchFromSonar(artist, title) {
  var apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return "";
  try {
    var r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model: "perplexity/sonar",
        messages: [{ role: "user", content: "Trouve une page web contenant les paroles completes de \"" + title + "\" par " + artist + ". Donne-moi UNIQUEMENT l'URL de la page (pas les paroles). Une seule URL, rien d'autre." }],
        max_tokens: 300,
      }),
    });
    if (!r.ok) return "";
    var data = await r.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) return "";
    var text = (data.choices[0].message.content || "").trim();
    var urls = text.match(/https?:\/\/[^\s\)\]"<>]+/g);
    if (!urls || !urls.length) return "";
    for (var i = 0; i < urls.length && i < 3; i++) {
      var u = urls[i].replace(/[.,;:!?]+$/, "");
      var scraped = await scrapeGenericLyrics(u);
      if (scraped && scraped.length > 100) return scraped;
    }
  } catch(e) {}
  return "";
}
async function scrapeGenericLyrics(url) {
  try {
    var r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
      redirect: "follow",
    });
    if (!r.ok) return "";
    var html = await r.text();
    if (html.length < 500) return "";
    var text = "";
    var jsonLd = html.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (jsonLd && jsonLd[1]) {
      text = jsonLd[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
      if (text.length > 100) return text;
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
        if (text.length > 100) return text;
      }
    }
  } catch(e) {}
  return "";
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
