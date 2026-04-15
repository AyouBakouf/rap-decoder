export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var token = process.env.GENIUS_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'GENIUS_API_TOKEN not set' });

  var title = req.body.title || "";
  var artist = req.body.artist || "";

  // Clean title for better search
  var cleanTitle = title.replace(/[.,'!?#\(\)]/g, " ").replace(/\s+/g, " ").trim();

  try {
    // Try multiple search strategies
    var song = null;

    // Strategy 1: title + artist
    song = await searchGenius(cleanTitle + " " + artist, artist, token);

    // Strategy 2: just title (sometimes artist in title causes issues)
    if (!song) {
      song = await searchGenius(cleanTitle, artist, token);
    }

    // Strategy 3: first few words of title + artist
    if (!song && cleanTitle.split(" ").length > 3) {
      var shortTitle = cleanTitle.split(" ").slice(0, 3).join(" ");
      song = await searchGenius(shortTitle + " " + artist, artist, token);
    }

    if (!song) {
      return res.status(200).json({ found: false, lyrics: "", source: "" });
    }

    // Fetch lyrics page
    var pageRes = await fetch(song.url);
    var html = await pageRes.text();

    // Extract lyrics from HTML
    var lyrics = "";
    var regex = /data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g;
    var match;
    while ((match = regex.exec(html)) !== null) {
      var chunk = match[1];
      chunk = chunk.replace(/<br\s*\/?>/gi, "\n");
      chunk = chunk.replace(/<[^>]+>/g, "");
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
      return res.status(200).json({ found: false, lyrics: "", source: song.url });
    }

    return res.status(200).json({
      found: true,
      lyrics: lyrics,
      source: song.url,
      title: song.title,
      artist: (song.primary_artist && song.primary_artist.name) || artist
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function searchGenius(query, artist, token) {
  var searchUrl = "https://api.genius.com/search?q=" + encodeURIComponent(query);
  var searchRes = await fetch(searchUrl, {
    headers: { "Authorization": "Bearer " + token }
  });
  var searchData = await searchRes.json();
  var hits = (searchData.response && searchData.response.hits) || [];

  if (hits.length === 0) return null;

  var artistLower = artist.toLowerCase().replace(/[^a-z0-9]/g, "");

  // First pass: match artist
  for (var i = 0; i < hits.length; i++) {
    var hit = hits[i];
    if (hit.type === "song" && hit.result) {
      var primaryArtist = (hit.result.primary_artist && hit.result.primary_artist.name) || "";
      var primaryLower = primaryArtist.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (primaryLower.indexOf(artistLower) !== -1 || artistLower.indexOf(primaryLower) !== -1) {
        return hit.result;
      }
    }
  }

  // Second pass: take first song result regardless of artist
  for (var j = 0; j < hits.length; j++) {
    if (hits[j].type === "song" && hits[j].result) {
      return hits[j].result;
    }
  }

  return null;
}
