export default async function handler(req, res) {
  var token = process.env.GENIUS_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'GENIUS_API_TOKEN not set' });

  var songId = req.method === 'GET' ? (req.query && req.query.songId) : (req.body && req.body.songId);
  if (!songId) return res.status(200).json({ annotations: [] });

  try {
    var refUrl = "https://api.genius.com/referents?song_id=" + encodeURIComponent(songId) + "&text_format=plain&per_page=15";
    var r1 = await fetch(refUrl, { headers: { Authorization: "Bearer " + token } });
    if (!r1.ok) return res.status(200).json({ annotations: [] });
    var d1 = await r1.json();
    var referents = (d1.response && d1.response.referents) || [];

    // Pour chaque referent, prendre le corps de sa premiere annotation (la plus votee generalement)
    var picked = referents.filter(function(ref) {
      return ref.annotations && ref.annotations[0] && ref.annotations[0].body && ref.annotations[0].body.plain;
    }).slice(0, 10);

    var annotations = picked.map(function(ref) {
      var body = ref.annotations[0].body.plain;
      return {
        fragment: ref.fragment,
        annotation: body.length > 600 ? body.slice(0, 600) + "..." : body,
      };
    });

    return res.status(200).json({ annotations: annotations });
  } catch (e) {
    return res.status(200).json({ annotations: [], error: e.message });
  }
}
