export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var token = process.env.GENIUS_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'GENIUS_API_TOKEN not set' });
  var title = req.body.title || "";
  var artist = req.body.artist || "";
  var cleanTitle = title.replace(/[.,'!?#\(\)]/g, " ").replace(/\s+/g, " ").trim();
  try {
    var song = null;
    song = await searchGenius(cleanTitle + " " + artist, artist, token);
    if (!song) song = await searchGenius(cleanTitle, artist, token);
    if (!song) return res.status(200).json({ found: false, lyrics: "", source: "" });
    var songId = song.id;
    var lyrics = await fetchLyricsFromEmbed(songId);
    if (!lyrics || lyrics.length < 30) lyrics = await fetchLyricsFromPage(song.url);
    lyrics = (lyrics || "").trim();
    if (lyrics.length < 20) return res.status(200).json({ found: false, lyrics: "", source: song.url });
    return res.status(200).json({ found: true, lyrics: lyrics, source: song.url, title: song.title, artist: (song.primary_artist && song.primary_artist.name) || artist });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
async function fetchLyricsFromEmbed(songId) {
  try {
    var r = await fetch("https://genius.com/songs/" + songId + "/embed.js", { headers: { "User-Agent": "Mozilla/5.0 Chrome/120.0.0.0" } });
    var text = await r.text();
    var htmlMatch = text.match(/document\.write\(JSON\.parse\('(.+)'\)\)/s);
    if (htmlMatch) { var decoded = htmlMatch[1].replace(/\\'/g, "'").replace(/\\n/g, "\n").replace(/\\\\/g, "\\"); return cleanHTML(decoded); }
    var bracketMatch = text.match(/(\[(?:Verse|Intro|Chorus|Hook|Outro|Bridge|Refrain)[^\]]*\][\s\S]+)/);
    if (bracketMatch) return cleanHTML(bracketMatch[1]);
  } catch (e) {}
  return "";
}
async function fetchLyricsFromPage(pageUrl) {
  try {
    var r = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Accept": "text/html" } });
    var html = await r.text();
    var lyrics = ""; var m;
    var regex1 = /data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g;
    while ((m = regex1.exec(html)) !== null) lyrics = lyrics + cleanHTML(m[1]) + "\n";
    if (lyrics.trim().length > 30) return lyrics.trim();
    lyrics = "";
    var regex2 = /class="[^"]*Lyrics__Container[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
    while ((m = regex2.exec(html)) !== null) lyrics = lyrics + cleanHTML(m[1]) + "\n";
    if (lyrics.trim().length > 30) return lyrics.trim();
  } catch (e) {}
  return "";
}
function cleanHTML(chunk) {
  chunk = chunk.replace(/\\n/g, "\n");
  chunk = chunk.replace(/<br\s*\/?>/gi, "\n");
  chunk = chunk.replace(/<\/p>/gi, "\n");
  chunk = chunk.replace(/<[^>]+>/g, "");
  chunk = chunk.replace(/&amp;/g, "&"); chunk = chunk.replace(/&lt;/g, "<"); chunk = chunk.replace(/&gt;/g, ">");
  chunk = chunk.replace(/&#x27;/g, "'"); chunk = chunk.replace(/&quot;/g, '"'); chunk = chunk.replace(/&#39;/g, "'");
  chunk = chunk.replace(/&nbsp;/g, " "); chunk = chunk.replace(/&#x2019;/g, "'"); chunk = chunk.replace(/&#x2018;/g, "'");
  chunk = chunk.replace(/\n{3,}/g, "\n\n");
  return chunk.trim();
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
