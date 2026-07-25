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
  var cleanTitle = title.replace(/[.,'!?#\(\)]/g, " ").replace(/\s+/g, " ").trim();
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
      var pn = await fetchFromParolesNet(artist, title);
      dbg.steps.push("paroles_net: " + (pn.lyrics ? pn.lyrics.length + " chars" : "empty") + " | http=" + pn.status + " | url=" + pn.url);
      if (pn.lyrics) {
        return res.status(200).json({ found: true, lyrics: pn.lyrics, source: pn.url, title: title, artist: artist, _debug: dbg });
      }
      return res.status(200).json({ found: false, lyrics: "", source: geniusUrl, _debug: dbg });
    }
    return res.status(200).json({ found: true, lyrics: lyrics, source: geniusUrl, title: songTitle, artist: songArtist, _debug: dbg });
  } catch (e) { return res.status(500).json({ error: e.message, _debug: dbg }); }
}
async function fetchFromLrclib(artist, title) {
  try {
    // Try exact match first
    var url = "https://lrclib.net/api/get?artist_name=" + encodeURIComponent(artist) + "&track_name=" + encodeURIComponent(title);
    var r = await fetch(url);
    if (r.ok) {
      var data = await r.json();
      var lyrics = data.plainLyrics || "";
      if (lyrics.length > 30) return lyrics;
    }
    // Try search
    var searchUrl = "https://lrclib.net/api/search?artist_name=" + encodeURIComponent(artist) + "&track_name=" + encodeURIComponent(title);
    var r2 = await fetch(searchUrl);
    if (r2.ok) {
      var results = await r2.json();
      if (results && results.length > 0) {
        var best = results[0];
        var lyrics2 = best.plainLyrics || "";
        if (lyrics2.length > 30) return lyrics2;
      }
    }
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
async function fetchFromParolesNet(artist, title) {
  try {
    var toSlug = function(s) {
      return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    };
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
      return true;
    });
    var text = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return { lyrics: text.length > 50 ? text : "", url: url, status: r.status };
  } catch(e) { return { lyrics: "", url: "", status: 0 }; }
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
  for (var j = 0; j < hits.length; j++) { if (hits[j].type === "song" && hits[j].result) return hits[j].result; }
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
