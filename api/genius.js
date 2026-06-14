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
    if (!lyrics && geniusUrl) {
      var sr = await fetchFromGeniusHtml(geniusUrl);
      lyrics = sr.lyrics;
      dbg.steps.push("genius_scrape: " + (lyrics ? lyrics.length + " chars" : "empty") + " | http=" + sr.status + " | blocks=" + sr.blocks + " | htmlLen=" + sr.htmlLen);
    }
    if (!lyrics || lyrics.length < 20) {
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
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" },
    });
    out.status = r.status;
    if (!r.ok) return out;
    var html = await r.text();
    out.htmlLen = html.length;
    var blocks = html.match(/<div[^>]*data-lyrics-container="true"[^>]*>[\s\S]*?<\/div>(?=\s*(?:<div|<\/div))/g);
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
async function searchGenius(query, artist, token) {
  var r = await fetch("https://api.genius.com/search?q=" + encodeURIComponent(query), { headers: { "Authorization": "Bearer " + token } });
  var data = await r.json();
  var hits = (data.response && data.response.hits) || [];
  if (hits.length === 0) return null;
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
