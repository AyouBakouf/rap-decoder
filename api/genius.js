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
    if (!song && cleanTitle.split(" ").length > 3) {
      song = await searchGenius(cleanTitle.split(" ").slice(0, 3).join(" ") + " " + artist, artist, token);
    }

    if (!song) {
      return res.status(200).json({ found: false, lyrics: "", source: "" });
    }

    // Fetch lyrics page
    var pageRes = await fetch(song.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    var html = await pageRes.text();

    // Try multiple extraction strategies
    var lyrics = "";

    // Strategy 1: data-lyrics-container (classic)
    if (!lyrics || lyrics.length < 30) {
      lyrics = extractByAttribute(html, 'data-lyrics-container="true"');
    }

    // Strategy 2: Lyrics__Container class
    if (!lyrics || lyrics.length < 30) {
      lyrics = extractByClass(html, 'Lyrics__Container');
    }

    // Strategy 3: look in preloaded state JSON
    if (!lyrics || lyrics.length < 30) {
      lyrics = extractFromJSON(html);
    }

    // Strategy 4: look for lyrics between known markers
    if (!lyrics || lyrics.length < 30) {
      lyrics = extractBetweenMarkers(html);
    }

    lyrics = lyrics.trim();

    if (lyrics.length < 20) {
      return res.status(200).json({ found: false, lyrics: "", source: song.url, debug: "extraction_failed, html_length=" + html.length });
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

function cleanHTML(chunk) {
  chunk = chunk.replace(/<br\s*\/?>/gi, "\n");
  chunk = chunk.replace(/<\/p>/gi, "\n");
  chunk = chunk.replace(/<\/div>/gi, "\n");
  chunk = chunk.replace(/<[^>]+>/g, "");
  chunk = chunk.replace(/&amp;/g, "&");
  chunk = chunk.replace(/&lt;/g, "<");
  chunk = chunk.replace(/&gt;/g, ">");
  chunk = chunk.replace(/&#x27;/g, "'");
  chunk = chunk.replace(/&#27;/g, "'");
  chunk = chunk.replace(/&quot;/g, '"');
  chunk = chunk.replace(/&#39;/g, "'");
  chunk = chunk.replace(/&nbsp;/g, " ");
  chunk = chunk.replace(/&#x2019;/g, "'");
  chunk = chunk.replace(/&#x2018;/g, "'");
  chunk = chunk.replace(/&#x201C;/g, '"');
  chunk = chunk.replace(/&#x201D;/g, '"');
  // Clean excessive newlines
  chunk = chunk.replace(/\n{3,}/g, "\n\n");
  return chunk.trim();
}

function extractByAttribute(html, attr) {
  var lyrics = "";
  var regex = new RegExp(attr + '[^>]*>([\\s\\S]*?)<\\/div>', 'g');
  var match;
  while ((match = regex.exec(html)) !== null) {
    lyrics = lyrics + cleanHTML(match[1]) + "\n";
  }
  return lyrics.trim();
}

function extractByClass(html, className) {
  var lyrics = "";
  // Match divs with this class, accounting for multiple classes
  var regex = new RegExp('class="[^"]*' + className + '[^"]*"[^>]*>([\\s\\S]*?)<\\/div>', 'g');
  var match;
  while ((match = regex.exec(html)) !== null) {
    lyrics = lyrics + cleanHTML(match[1]) + "\n";
  }
  return lyrics.trim();
}

function extractFromJSON(html) {
  // Look for lyrics in embedded JSON/preloaded state
  try {
    // Pattern: "lyrics":{"plain":"..."} or similar
    var match = html.match(/"lyrics":\s*\{[^}]*"plain"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match && match[1]) {
      var text = match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      return text;
    }

    // Pattern: window.__PRELOADED_STATE__ or similar
    var stateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
    if (stateMatch && stateMatch[1]) {
      var decoded = stateMatch[1].replace(/\\'/g, "'").replace(/\\x/g, "\\u00");
      try {
        var state = JSON.parse(decoded);
        // Navigate to lyrics in the state object
        if (state && state.songPage && state.songPage.lyricsData && state.songPage.lyricsData.body) {
          return cleanHTML(state.songPage.lyricsData.body.html || "");
        }
      } catch(e) {}
    }
  } catch (e) {}
  return "";
}

function extractBetweenMarkers(html) {
  // Look for [Verse or [Intro or [Chorus patterns in the HTML which indicate lyrics
  var match = html.match(/(\[(?:Verse|Intro|Chorus|Hook|Bridge|Outro|Refrain|Pre-Chorus|Skit|Interlude)[^\]]*\][\s\S]*?)(?:<div[^>]*class="[^"]*RightSidebar|<div[^>]*class="[^"]*SongPageGrid)/i);
  if (match && match[1]) {
    return cleanHTML(match[1]);
  }
  return "";
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

  for (var j = 0; j < hits.length; j++) {
    if (hits[j].type === "song" && hits[j].result) {
      return hits[j].result;
    }
  }

  return null;
}
