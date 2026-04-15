export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var token = process.env.GENIUS_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'GENIUS_API_TOKEN not set' });
  var title = req.body.title || "";
  var artist = req.body.artist || "";
  var cleanTitle = title.replace(/[.,'!?#\(\)]/g, " ").replace(/\s+/g, " ").trim();
  try {
    // Step 1: Use Genius to find correct song name and artist
    var song = await searchGenius(cleanTitle + " " + artist, artist, token);
    if (!song) song = await searchGenius(cleanTitle, artist, token);
    var songTitle = song ? song.title : title;
    var songArtist = (song && song.primary_artist && song.primary_artist.name) ? song.primary_artist.name : artist;
    var geniusUrl = song ? song.url : "";
    // Step 2: Get lyrics from lrclib (direct API, no scraping)
    var lyrics = await fetchFromLrclib(songArtist, songTitle);
    // Step 3: Fallback - try with original title/artist
    if (!lyrics && song) lyrics = await fetchFromLrclib(artist, title);
    // Step 4: Fallback - try lyrics.ovh
    if (!lyrics) lyrics = await fetchFromLyricsOvh(songArtist, songTitle);
    if (!lyrics) lyrics = await fetchFromLyricsOvh(artist, title);
    if (!lyrics || lyrics.length < 20) {
      return res.status(200).json({ found: false, lyrics: "", source: geniusUrl });
    }
    return res.status(200).json({ found: true, lyrics: lyrics, source: geniusUrl, title: songTitle, artist: songArtist });
  } catch (e) { return res.status(500).json({ error: e.message }); }
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
