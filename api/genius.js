export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var token = process.env.GENIUS_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'GENIUS_API_TOKEN not set' });

  var title = req.body.title || "";
  var artist = req.body.artist || "";

  try {
    // Step 1: Search Genius
    var searchUrl = "https://api.genius.com/search?q=" + encodeURIComponent(title + " " + artist);
    var searchRes = await fetch(searchUrl, {
      headers: { "Authorization": "Bearer " + token }
    });
    var searchData = await searchRes.json();
    var hits = (searchData.response && searchData.response.hits) || [];

    if (hits.length === 0) {
      return res.status(200).json({ found: false, lyrics: "", source: "" });
    }

    // Find best match
    var song = null;
    var artistLower = artist.toLowerCase();
    for (var i = 0; i < hits.length; i++) {
      var hit = hits[i];
      if (hit.type === "song" && hit.result) {
        var primaryArtist = (hit.result.primary_artist && hit.result.primary_artist.name) || "";
        if (primaryArtist.toLowerCase().indexOf(artistLower) !== -1 || artistLower.indexOf(primaryArtist.toLowerCase()) !== -1) {
          song = hit.result;
          break;
        }
      }
    }
    if (!song && hits[0] && hits[0].result) {
      song = hits[0].result;
    }
    if (!song) {
      return res.status(200).json({ found: false, lyrics: "", source: "" });
    }

    // Step 2: Fetch lyrics page
    var pageUrl = song.url;
    var pageRes = await fetch(pageUrl);
    var html = await pageRes.text();

    // Step 3: Extract lyrics from HTML
    // Genius puts lyrics in data-lyrics-container divs
    var lyrics = "";
    var regex = /data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g;
    var match;
    while ((match = regex.exec(html)) !== null) {
      var chunk = match[1];
      // Replace <br/> with newlines
      chunk = chunk.replace(/<br\s*\/?>/gi, "\n");
      // Remove HTML tags
      chunk = chunk.replace(/<[^>]+>/g, "");
      // Decode HTML entities
      chunk = chunk.replace(/&amp;/g, "&");
      chunk = chunk.replace(/&lt;/g, "<");
      chunk = chunk.replace(/&gt;/g, ">");
      chunk = chunk.replace(/&#x27;/g, "'");
      chunk = chunk.replace(/&quot;/g, '"');
      chunk = chunk.replace(/&#39;/g, "'");
      chunk = chunk.replace(/&nbsp;/g, " ");
      lyrics = lyrics + chunk + "\n";
    }

    lyrics = lyrics.trim();

    if (lyrics.length < 20) {
      return res.status(200).json({ found: false, lyrics: "", source: pageUrl });
    }

    return res.status(200).json({
      found: true,
      lyrics: lyrics,
      source: pageUrl,
      title: song.title,
      artist: (song.primary_artist && song.primary_artist.name) || artist
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
