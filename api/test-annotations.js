export default async function handler(req, res) {
  var token = process.env.GENIUS_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'GENIUS_API_TOKEN not set' });

  var out = { steps: [] };
  try {
    // 1. Chercher un morceau connu pour avoir un vrai song_id
    var searchUrl = "https://api.genius.com/search?q=" + encodeURIComponent("Not Like Us Kendrick Lamar");
    var r1 = await fetch(searchUrl, { headers: { Authorization: "Bearer " + token } });
    out.steps.push("search: http=" + r1.status);
    var d1 = await r1.json();
    var hit = d1.response && d1.response.hits && d1.response.hits.find(function(h) { return h.type === "song"; });
    if (!hit) return res.status(200).json(Object.assign(out, { error: "no song found" }));
    var songId = hit.result.id;
    out.songId = songId;
    out.songUrl = hit.result.url;

    // 2. Recuperer les referents (passages annotes) de ce morceau
    var refUrl = "https://api.genius.com/referents?song_id=" + songId + "&text_format=plain&per_page=5";
    var r2 = await fetch(refUrl, { headers: { Authorization: "Bearer " + token } });
    out.steps.push("referents: http=" + r2.status);
    var d2 = await r2.json();
    var referents = (d2.response && d2.response.referents) || [];
    out.referentsCount = referents.length;
    out.referentsSample = referents.slice(0, 2).map(function(ref) {
      return {
        fragment: ref.fragment,
        annotationsCount: (ref.annotations || []).length,
        firstAnnotationId: ref.annotations && ref.annotations[0] && ref.annotations[0].id,
      };
    });

    // 3. Recuperer le corps d'une annotation precise si on en a une
    var firstRef = referents[0];
    var annId = firstRef && firstRef.annotations && firstRef.annotations[0] && firstRef.annotations[0].id;
    if (annId) {
      var annUrl = "https://api.genius.com/annotations/" + annId + "?text_format=plain";
      var r3 = await fetch(annUrl, { headers: { Authorization: "Bearer " + token } });
      out.steps.push("annotation detail: http=" + r3.status);
      var d3 = await r3.json();
      out.annotationBodySample = d3.response && d3.response.annotation && d3.response.annotation.body && d3.response.annotation.body.plain;
    }

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json(Object.assign(out, { error: e.message }));
  }
}
