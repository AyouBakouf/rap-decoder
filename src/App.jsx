import { useState, useRef, useCallback, useEffect } from "react";

// ============ CACHE / SAUVEGARDE LOCALE ============
var CV = "rdc2"; // version du cache (bumpe pour inclure le contexte)
function norm(s) { return (s || "").trim().toLowerCase(); }
function ckey(artist, name) { return CV + ":song:" + norm(artist) + ":" + norm(name); }
function tlkey(artist, album) { return CV + ":tl:" + norm(artist) + ":" + norm(album); }
function cacheGet(artist, name) {
  try { var r = localStorage.getItem(ckey(artist, name)); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function cacheSet(artist, name, payload) {
  try { localStorage.setItem(ckey(artist, name), JSON.stringify(payload)); } catch (e) {}
}
function tlGet(artist, album) {
  try { var r = localStorage.getItem(tlkey(artist, album)); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function tlSet(artist, album, tracks) {
  try { localStorage.setItem(tlkey(artist, album), JSON.stringify(tracks)); } catch (e) {}
}
function sessionSave(s) { try { localStorage.setItem(CV + ":session", JSON.stringify(s)); } catch (e) {} }
function sessionLoad() { try { var r = localStorage.getItem(CV + ":session"); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function sessionClear() { try { localStorage.removeItem(CV + ":session"); } catch (e) {} }

var TRACKLIST_SYSTEM = "Tu donnes les tracklists d'albums. Reponds en JSON: {\"tracks\":[\"titre1\",\"titre2\",...]} Titres exacts, sans featurings. Si inconnu: {\"tracks\":[]}";

var TRANSLATE_SYSTEM = "Tu es un traducteur rap. On te donne les PAROLES EXACTES d'un morceau, tu retournes la traduction française ligne par ligne en JSON.\n\nREGLE NUMERO 1, ABSOLUE: pour CHAQUE ligne tu DOIS produire un objet {\"o\":\"ligne originale\",\"t\":\"TRADUCTION FRANCAISE\",\"c\":confiance}. Le champ \"t\" doit TOUJOURS contenir la traduction française complète. Ne laisse JAMAIS \"t\" vide, null, ou identique a \"o\". Si une ligne est intraduisible, mets \"t\":\"<intraduisible>\". C'est ta seule mission: TRADUIRE.\n\nAutres regles:\n- Regroupe les lignes trop courtes qui font partie de la meme phrase en UNE seule.\n- Sections: titres generiques [Intro], [Verse 1], [Chorus], [Bridge], [Outro], [Interlude]. JAMAIS le nom d'un rappeur.\n- Inclus TOUTES les lignes (interludes, skits, outros). Coupe RIEN.\n- \"c\" = confiance 0-100. 100 = trad evidente. <70 = slang rare, ref obscure, sens incertain.\n- Si tout le morceau est en francais: \"t\":null pour chaque ligne, lang=\"francais\".\n- Contexte rap: \"bitch\"=\"meuf\" (jamais pute). \"nigga\"=ne traduis pas. \"whip\"=\"caisse\". Registre rap francais, pas francais scolaire.\n- CRUCIAL: utilise des mots SIMPLES et COURANTS. Le francais de tous les jours, pas de la litterature. Si t'hesites entre un mot simple et un mot recherche, prends TOUJOURS le simple.\n  MOTS INTERDITS dans les traductions: firmament, tumulte, redemption, resilience, ephemere, inexorable, naguere, abysses, tourmente, funeste, demeurer, oeuvrer, quete, dessein, en proie a, au sein de, jadis, faucher (pour \"tuer\" → dis \"buter/descendre\"), courroux, empreint, autrui.\n  Dis \"le ciel\" pas \"le firmament\". Dis \"rester\" pas \"demeurer\". Dis \"chercher\" pas \"quete\". Dis \"bosser\" pas \"oeuvrer\". Dis \"avant\" pas \"jadis/naguere\".\n  Le test: un ado de 16 ans qui ecoute du rap doit comprendre chaque mot de ta traduction sans dictionnaire.\n\nNotes de decryptage (champ \"notes\"):\n- \"r\"=mot/expression, \"e\"=explication courte, \"t\"=type (\"slang\"/\"ref\"/\"wordplay\"/\"sample\")\n\nFormat JSON:\n{\n\"lang\":\"anglais\",\n\"lines\":[\n{\"s\":\"[Intro]\"},\n{\"o\":\"ligne originale\",\"t\":\"traduction francaise\",\"c\":95}\n],\n\"notes\":[\n{\"r\":\"mot\",\"e\":\"explication\",\"t\":\"ref\"}\n]\n}";

var DEEP_ANALYSIS_SYSTEM = "Tu es un SUPER-ANALYSTE de rap obsessionnel. On te donne UNE ligne d'un morceau + le contexte + les lignes autour. Tu dois SURINTREPRETER: trouve TOUTES les couches de sens, meme les plus tirees. Mieux vaut proposer une interpretation audacieuse que rater un double sens.\n\nREGLE ABSOLUE: TOUT en FRANCAIS.\n\nReponds en JSON:\n{\n\"meaning\":\"ce que l'artiste dit, 2-3 phrases\",\n\"layers\":[\"couche de sens 1\",\"couche de sens 2\"],\n\"callbacks\":[{\"ref\":\"titre du morceau/album reference\",\"line\":\"la ligne/concept reference\",\"link\":\"comment ca se connecte\"}],\n\"refs\":[{\"r\":\"ref\",\"e\":\"explication\"}],\n\"wordplay\":\"explication si present\"\n}\n\nCHAMP \"layers\" (LE PLUS IMPORTANT — SURINTERPRETE):\nTrouve CHAQUE couche de sens possible dans la ligne:\n- Le sens litteral evident\n- Le double sens (mot qui veut dire 2 choses)\n- Le sens metaphorique (l'image renvoie a quoi)\n- Le sous-texte biographique (ca fait reference a quoi dans la vie de l'artiste)\n- La lecture politique/sociale si applicable\n- Le sens qui change quand on connait le contexte de l'album\nMets TOUTES les lectures, meme celles qui sont un peu tirees. 2 a 5 couches par ligne. Une seule couche = t'as pas assez creuse.\n\nCHAMP \"callbacks\" (CONNEXIONS AVEC D'AUTRES SONS):\nCherche si cette ligne fait echo a d'AUTRES morceaux du meme artiste:\n- Meme mot/image reutilise differemment (ex: Kendrick 'Wi-Fi' dans N95 vs 6:16 in LA)\n- Theme qui revient d'un album a l'autre\n- Reponse a un ancien morceau\n- Evolution d'une position (il disait X avant, maintenant il dit Y)\n- Reference a un beef, un featuring, un event\nSi y'a un callback, c'est de L'OR — mets-le. Si t'es pas sur a 100% mais que ca semble plausible, mets-le quand meme avec une nuance dans le 'link'.\nSi aucun callback trouve: callbacks=[]\n\nCHAMP \"refs\":\nPersonnes, marques, lieux, evenements, samples, argot. Explique chaque ref.\n\nCHAMP \"wordplay\":\nDouble sens, calembour, homophonie, multi. null si rien.\n\nSTYLE: parle comme un vrai passionne de rap qui decortique un son avec son pote. Direct, enthousiaste sur les trouvailles, pas academique.";

var CONTEXT_SYSTEM = "Tu connais bien le rap. On te donne un morceau (artiste + titre). Donne son contexte, en parlant SIMPLE comme a un pote.\n\nJSON UNIQUEMENT:\n{\"album\":\"nom\",\"year\":2020,\"producer\":\"prod\",\"themes\":[\"theme1\",\"theme2\"],\"summary\":\"2-3 phrases simples\"}\n\n- themes: 2-3 mots CONCRETS (\"argent facile\", \"deuil\", \"famille\"). JAMAIS abstraits (\"introspection\", \"alienation\").\n- summary: 2-3 phrases en francais COURANT pour dire de quoi parle vraiment le son. Comme a un pote. Pas de critique musicale pretentieuse.\n- CRUCIAL: ne devine JAMAIS l'album/annee/prod. Si pas SUR a 100%, cherche sur le web, sinon mets null. Une info fausse est pire que pas d'info.";

var BEST_BARS_SYSTEM = "Tu es un amoureux de rap qui cherche les MOMENTS qui touchent. On te donne les paroles d'un ALBUM ENTIER. Extrais les meilleurs PASSAGES (4-8 barres consecutives).\n\nJSON UNIQUEMENT:\n{\"bars\":[{\"lines\":[{\"o\":\"ligne originale\",\"t\":\"traduction claire\"}],\"sens\":\"explication simple du passage\",\"track\":\"nom du morceau\",\"why\":\"pourquoi ca touche\",\"impact\":8}]}\n\nFORMAT \"lines\":\nChaque ligne est un objet {\"o\":\"original\",\"t\":\"traduction\"}. La traduction \"t\" doit etre CLAIRE et COMPREHENSIBLE. Si l'original dit 'Black marionettes dance limp, over the pit', la trad doit dire quelque chose comme 'Des marionnettes noires dansent mollement au-dessus du gouffre' — pas de flou, pas de poesie qui rajoute du mystere. On veut COMPRENDRE.\n\nCHAMP \"sens\" (OBLIGATOIRE, LE PLUS IMPORTANT):\nExplique le passage en 2-4 phrases ULTRA SIMPLES. Comme tu raconterais a un pote qui connait RIEN au rap US.\n- Dis QUI fait QUOI. Pas de generalites.\n- Si y a des refs (Challenger, un quartier, un evenement), EXPLIQUE-LES.\n- Si y a des images poetiques, dis ce qu'elles REPRESENTENT concretement.\nEXEMPLE BON: 'Il compare sa vie d'homme noir a un astronaute qui decolle mais qui brule comme la navette Challenger. Ensuite il decrit des corps noirs brules et pendus — il fait le lien entre les lynchages et l'explosion de Challenger. Les gens bienveillants sont trop loin pour aider, comme le soleil en hiver.'\nEXEMPLE MAUVAIS: 'Un bloc d'images fortes evoquant la violence et le sacrifice.'\n\nCHAMP \"why\" (1 phrase SIMPLE):\n- Parle comme un VRAI MEC, pas comme un critique.\nEXEMPLE BON: 'En 8 lignes il connecte l'explosion de Challenger aux lynchages — personne fait ca.'\nEXEMPLE MAUVAIS: 'La juxtaposition est brutale et poignante, evoquant des themes de sacrifice.'\n- Interdit: 'puissance narrative', 'poignant', 'saisissant', 'evoquant', 'juxtaposition', 'resonance'. Parle NORMAL.\n\nSELECTION:\n- 4 a 8 passages de 4-8 barres CONSECUTIVES par album.\n- Experiences universelles: pauvrete, perte, survie, famille, rue.\n- JAMAIS de punchlines isolees ou de barres non consecutives.\n- Trie par impact decroissant.\n- TOUT en francais.";

var THEMATIC_SYSTEM = "L'utilisateur cherche des passages de rap qui illustrent un THEME precis. On te donne des paroles (un ou plusieurs albums) et un theme en francais.\n\nJSON UNIQUEMENT:\n{\"results\":[{\"lines\":[{\"o\":\"ligne originale\",\"t\":\"traduction claire\"}],\"track\":\"nom du morceau\",\"artist\":\"artiste\",\"album\":\"album\",\"link\":\"comment ce passage illustre le theme, 1 phrase\",\"pertinence\":8}]}\n\nREGLES DE SELECTION:\n- Cherche les passages (4-8 barres CONSECUTIVES) ou le rappeur ABORDE le theme de maniere CONCRETE et IMAGEE.\n- Un passage qui MONTRE le theme a travers une scene, une image, un vecu > un passage qui le NOMME.\n- Si le rappeur dit 'la trahison ca fait mal' c'est FAIBLE. S'il raconte une scene precise de trahison, c'est FORT.\n- 3 a 5 resultats tries par pertinence decroissante.\n- pertinence: 1 a 10. 10 = le passage EST le theme, incarne parfaitement.\n\nTRADUCTION:\n- Chaque ligne a sa traduction (\"t\"). Claire, comprehensible, pas poetique.\n- Si le morceau est en francais: \"t\" = null.\n\nCHAMP \"link\":\n- UNE phrase simple qui dit comment le passage illustre le theme.\n- Exemple: 'Il raconte comment son pere est parti quand il avait 6 ans et comment ca l'a forge.'\n- PAS de jargon critique. Parle normal.\n\nTOUT en francais (link, t).";

var SUGGEST_SYSTEM = "On te donne un THEME et une liste d'albums que l'utilisateur a DEJA decodes. Suggere des morceaux de rap qu'il a PAS encore decodes mais qui seraient pertinents pour ce theme.\n\nJSON UNIQUEMENT:\n{\"suggestions\":[{\"artist\":\"artiste\",\"track\":\"titre du morceau\",\"album\":\"album\",\"why\":\"pourquoi ce morceau est pertinent pour le theme, 1 phrase\",\"pertinence\":8}]}\n\nREGLES:\n- 5 a 10 suggestions, triees par pertinence decroissante.\n- Ne suggere PAS de morceaux qui sont dans les albums deja decodes.\n- Privilegier des morceaux ou le theme est CENTRAL, pas juste mentionne en passant.\n- Melange des classiques et des morceaux moins connus mais pertinents.\n- Privilegier le rap US et FR underground/lyrical (Ka, billy woods, Earl, MIKE, Navy Blue, Mach-Hommy, Veust, Limsa, Infinit, Jeanjass, GAL, Alpha Wann, Dinos, Lomepal, Nekfeu, Vald, etc.) mais pas exclusivement.\n- \"why\": 1 phrase simple, en francais. Dis concretement de quoi parle le morceau par rapport au theme.\n- pertinence: 1-10. 10 = le morceau EST le theme.\n- TOUT en francais.";

var ANALYSIS_SYSTEM = "Tu es un lecteur exigeant de rap lyrical. On te donne les paroles d'un morceau. Tu produis une analyse d'ECRITURE rigoureuse. DETECTE la langue et adapte tes references de gout et tes criteres.\n\nSI RAP ANGLOPHONE: profil RYM (gout: Ka, billy woods, MIKE, Earl, Navy Blue, Mach-Hommy, MF DOOM). Valorise l'understatement, la profondeur, le vecu, l'image qui hante autant que la technique.\n\nSI RAP FRANCAIS: profil amateur de technique et de plume (references: Veust, Limsa d'Aulnay, Infinit', Jeanjass, GAL, Alpha Wann, Nekfeu, Vald, Dinos, Lomepal cote technique). Valorise surtout: la PUNCHLINE (chute qui claque), le WORDPLAY (double sens, calembour, homophonie), les MULTISYLLABIQUES (rimes riches sur plusieurs syllabes), les RIMES INTERNES, l'image qui surprend. Le rap FR de ce niveau se juge d'abord sur la technique et la vanne. Reconnais l'argot et le verlan sans les traiter comme des fautes.\n\nJSON UNIQUEMENT:\n{\n\"score\": 74,\n\"score_breakdown\": {\"economie\": 8, \"imagery\": 7, \"rimes\": 6, \"subversion\": 5, \"profondeur\": 8},\n\"score_note\": \"1 phrase qui justifie la note\",\n\"essentiel\": [{\"o\":\"ligne exacte\",\"t\":\"trad si anglophone, sinon null\",\"why\":\"ce qui rend l'ecriture forte\",\"type\":\"craft\"}],\n\"notable\": [{\"o\":\"ligne exacte\",\"t\":\"trad ou null\",\"why\":\"...\",\"type\":\"real\"}],\n\"multis\": [{\"lines\":[\"ligne 1\",\"ligne 2\"],\"rhymed\":[\"syllabes qui riment ligne 1\",\"syllabes qui riment ligne 2\"],\"syllables\": 4, \"note\":\"pourquoi ce schema est fort\"}]\n}\n\n=== SCORE (A) ===\nNote /100 la QUALITE D'ECRITURE (pas le plaisir d'ecoute, pas la prod). breakdown: 5 axes /10.\n- economie: densite, dire beaucoup en peu\n- imagery: force et originalite des images\n- rimes: complexite et musicalite des schemas (multis, rimes internes) — AXE CENTRAL pour le rap FR technique\n- subversion: capacite a surprendre, punchline inattendue, eviter les cliches\n- profondeur: doubles lectures, double sens, sens qui s'ouvre\nECHELLE (utilise toute la gamme, sois discriminant):\n- 90-100: chef-d'oeuvre d'ecriture\n- 80-89: tres grande ecriture, dense et maitrisee\n- 70-79: bonne ecriture solide, quelques vrais moments\n- 55-69: correct mais sans relief\n- sous 55: ecriture faible, cliches, rimes paresseuses\nUn bon son technique doit pouvoir atteindre 80+. Ne bloque pas tout dans le ventre mou 60-70. Sois discriminant.\n\n=== SELECTION PAR MORCEAU (C) ===\nOn analyse UN morceau en profondeur, creuse:\n- \"essentiel\": 2 a 4 lignes. Le cream (meilleures punchlines/images/multis selon le style).\n- \"notable\": 3 a 6 lignes de qualite.\n- Copie \"o\" EXACTEMENT. \"t\": traduction SI anglophone, null si francais. \"why\": nomme CE QUI est bien ecrit (le wordplay? le multi? la chute? le detail?), langage simple.\n- types: \"craft\" (technique/structure) / \"real\" (vecu) / \"depth\" (double sens) / \"subversion\" (chute inattendue, punchline)\n- Rap FR: privilegie les vraies punchlines et les jeux de mots. Rap anglophone: l'understatement qui devaste compte autant que la punch.\n\n=== MULTIS (A) ===\nRepere les 2-4 MEILLEURS schemas multisyllabiques: plusieurs syllabes consecutives qui riment, surtout sur plusieurs lignes. TRES important pour le rap FR technique.\n- \"lines\": lignes concernees (exactes)\n- \"rhymed\": pour CHAQUE ligne, la portion EXACTE qui porte la rime multi (sous-chaine exacte de la ligne)\n- \"syllables\": nombre de syllabes qui riment\n- \"note\": pourquoi c'est technique/reussi\nSi pas de vrais multis, multis=[]. N'invente pas.\n\nQUALITE > QUANTITE partout.\n\nSTYLE: ecris tes explications (why, score_note, note) dans un francais NATUREL et fluide, comme un vrai passionne de rap qui parle. TOUJOURS en francais, MEME pour un morceau anglophone (seul le champ \"o\" garde la langue originale, et \"t\" la traduction). Phrases bien construites, pas de tournures bizarres.";

async function callGemini(system, message, search, model, _retries) {
  if (search === undefined) search = false;
  if (_retries === undefined) _retries = 0;
  var payload = { system: system, message: message, search: search };
  if (model) payload.model = model;
  var res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  var data = await res.json();
  // Rate limit: on attend le delai indique par Google et on reessaie tout seul
  if (data.rateLimited && _retries < 5) {
    var wait = Math.min((data.retryAfter || 20) + 2, 45);
    await new Promise(function(r) { setTimeout(r, wait * 1000); });
    return callGemini(system, message, search, model, _retries + 1);
  }
  if (data.error) throw new Error(data.error);
  var text = data.text || "";
  var m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response");
  return JSON.parse(m[0]);
}

async function fetchLyrics(title, artist, album) {
  var res = await fetch("/api/genius", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title, artist: artist, album: album }),
  });
  var data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export default function App() {
  var _a = useState(""), album = _a[0], setAlbum = _a[1];
  var _b = useState(""), artist = _b[0], setArtist = _b[1];
  var _s = useState(""), single = _s[0], setSingle = _s[1];
  var _mode = useState("album"), mode = _mode[0], setMode = _mode[1];
  var _c = useState([]), tracks = _c[0], setTracks = _c[1];
  var _d = useState({}), data = _d[0], setData = _d[1];
  var _e = useState(null), sel = _e[0], setSel = _e[1];
  var _f = useState("input"), view = _f[0], setView = _f[1];
  var _g = useState(0), done = _g[0], setDone = _g[1];
  var _h = useState(false), auto = _h[0], setAuto = _h[1];
  var _i = useState(""), err = _i[0], setErr = _i[1];
  var _j = useState(null), focusLine = _j[0], setFocusLine = _j[1];
  var _k = useState(null), focusData = _k[0], setFocusData = _k[1];
  var _l = useState(false), focusLoading = _l[0], setFocusLoading = _l[1];
  var _p = useState(false), plLoading = _p[0], setPlLoading = _p[1];
  var _ap = useState(false), albumPlView = _ap[0], setAlbumPlView = _ap[1];
  var _apl = useState(false), albumPlLoading = _apl[0], setAlbumPlLoading = _apl[1];
  var _bb = useState(null), bestBars = _bb[0], setBestBars = _bb[1];
  var _bbv = useState(false), bestBarsView = _bbv[0], setBestBarsView = _bbv[1];
  var _bbl = useState(false), bestBarsLoading = _bbl[0], setBestBarsLoading = _bbl[1];
  var _tv = useState(false), thematicView = _tv[0], setThematicView = _tv[1];
  var _tq = useState(""), thematicQuery = _tq[0], setThematicQuery = _tq[1];
  var _tr = useState(null), thematicResults = _tr[0], setThematicResults = _tr[1];
  var _tl = useState(false), thematicLoading = _tl[0], setThematicLoading = _tl[1];
  var _ts = useState([]), thematicSelected = _ts[0], setThematicSelected = _ts[1];
  var _tc = useState(""), thematicCopied = _tc[0], setThematicCopied = _tc[1];
  var _tsu = useState(null), thematicSuggestions = _tsu[0], setThematicSuggestions = _tsu[1];
  var _tsd = useState({}), suggestDecoding = _tsd[0], setSuggestDecoding = _tsd[1];
  var stopRef = useRef(false);
  var dRef = useRef({});
  var isMobile = window.innerWidth <= 700;

  // Reconstruit les morceaux deja decodes depuis le cache local
  var hydrate = function(art, trks) {
    var restored = {};
    var cnt = 0;
    trks.forEach(function(t) {
      var c = cacheGet(art, t);
      if (c && c.d) { restored[t] = { st: "ok", d: c.d }; cnt++; }
    });
    dRef.current = restored;
    setData(restored);
    setDone(cnt);
  };

  // Au chargement: restaure la derniere session
  useEffect(function() {
    var s = sessionLoad();
    if (s && s.tracks && s.tracks.length) {
      setMode(s.mode || "album");
      setArtist(s.artist || "");
      setAlbum(s.album || "");
      setSingle(s.single || "");
      setTracks(s.tracks);
      hydrate(s.artist, s.tracks);
      setView("list");
    }
  }, []);

  // Sauvegarde la session courante
  useEffect(function() {
    if (view === "list" && tracks.length) {
      sessionSave({ mode: mode, artist: artist, album: album, single: single, tracks: tracks });
    }
  }, [view, tracks, artist, album, single, mode]);

  var go = async function() {
    if (mode === "album") {
      if (!album.trim() || !artist.trim()) return;
      // Tracklist deja en cache -> pas de re-call API
      var tlCached = tlGet(artist, album);
      if (tlCached && tlCached.length) {
        setTracks(tlCached); hydrate(artist, tlCached); setSel(null); setView("list");
        return;
      }
      setView("loading"); setErr("");
      try {
        var r = await callGemini(TRACKLIST_SYSTEM, album + " - " + artist, true);
        if (r.tracks && r.tracks.length) {
          tlSet(artist, album, r.tracks);
          setTracks(r.tracks); hydrate(artist, r.tracks); setSel(null); setView("list");
        } else { setErr("Album introuvable"); setView("error"); }
      } catch (e) { setErr(e.message); setView("error"); }
    } else {
      // Single mode: skip tracklist, go straight to decode
      if (!single.trim() || !artist.trim()) return;
      dRef.current = {}; setData({});
      setTracks([single]); setDone(0); setSel(null); setView("list");
      // Auto-decode the single immediately
      setTimeout(function() { decode(single, false); }, 100);
    }
  };

  // Recupere le contexte (album/annee/themes/resume) en arriere-plan et le fusionne
  var fetchContext = function(name) {
    var albumCtx = mode === "single" ? "" : " (album: " + album + ")";
    callGemini(CONTEXT_SYSTEM, "Morceau: \"" + name + "\" par " + artist + albumCtx, true)
      .then(function(ctx) {
        var entry = dRef.current[name];
        if (!entry || entry.st !== "ok" || !entry.d) return;
        var merged = Object.assign({}, entry.d, { context: ctx });
        var next = Object.assign({}, dRef.current);
        next[name] = { st: "ok", d: merged };
        dRef.current = next;
        setData(Object.assign({}, dRef.current));
        cacheSet(artist, name, { d: merged });
      })
      .catch(function() {});
  };

  // Lance le decodage des morceaux suivants en arriere-plan (pendant que tu ecoutes)
  var prefetchNext = function(name) {
    if (mode !== "album") return;
    var idx = tracks.indexOf(name);
    if (idx < 0) return;
    var upcoming = tracks.slice(idx + 1, idx + 1 + 3);
    upcoming.forEach(function(t) {
      var e = dRef.current[t];
      if (!e || (e.st !== "ok" && e.st !== "load")) {
        decode(t, true);
      }
    });
  };

  var decode = useCallback(async function(name, autoMode) {
    if (dRef.current[name] && dRef.current[name].st === "ok") {
      if (!autoMode) { setSel(name); prefetchNext(name); }
      return;
    }
    var up = function(v) {
      var next = Object.assign({}, dRef.current);
      next[name] = v;
      dRef.current = next;
      setData(Object.assign({}, dRef.current));
    };
    // Cache local: si deja decode (meme dans une autre session) -> instantane, pas d'appel API
    var cached = cacheGet(artist, name);
    if (cached && cached.d) {
      up({ st: "ok", d: cached.d });
      setDone(function(p) { return p + 1; });
      if (!autoMode) { setSel(name); prefetchNext(name); }
      // si le contexte manque (vieux cache), on le recupere
      if (!cached.d.context) fetchContext(name);
      return;
    }
    up({ st: "load" });
    if (!autoMode) setSel(name);
    try {
      var albumParam = mode === "single" ? "" : album;
      var genius = await fetchLyrics(name, artist, albumParam);

      if (genius.found) {
        var prompt = "Voici les paroles EXACTES de \"" + name + "\" par " + artist + " (source: lrclib).\nCopie chaque ligne originale mot pour mot dans le champ \"o\". Ne modifie rien.\n\nPAROLES:\n\n" + genius.lyrics;
        var r = await callGemini(TRANSLATE_SYSTEM, prompt, false);
        r.found = true;
        r._source = genius.source;
        up({ st: "ok", d: r }); setDone(function(p) { return p + 1; });
        if (r.lines && r.lines.length) cacheSet(artist, name, { d: r });
        fetchContext(name);
      } else {
        var FALLBACK_SYSTEM = "Tu es un traducteur rap. Utilise web_search pour trouver les paroles EXACTES de ce morceau precis (verifie bien l'artiste ET le titre, ne confonds pas avec un autre son). Puis traduis ligne par ligne.\n\nCRUCIAL: si tu ne trouves pas les paroles de CE morceau precis, ne DEVINE JAMAIS et n'invente pas des paroles plausibles. Mieux vaut {\"found\":false} que de fausses paroles.\n\nAjoute \"c\" (0-100) pour la confiance. <70 = incertain.\n\nReponds en JSON: {\"found\":true,\"lang\":\"anglais\",\"lines\":[{\"s\":\"[Verse 1]\"},{\"o\":\"ligne\",\"t\":\"traduction\",\"c\":80}],\"notes\":[{\"r\":\"mot\",\"e\":\"explication\",\"t\":\"ref\"}]}\n\nRegroupe les lignes courtes. \"bitch\"=meuf. \"nigga\"=laisse tel quel. Si tout est en francais: t=null, lang=francais. Si introuvable ou doute serieux: {\"found\":false,\"lines\":[],\"notes\":[]}";
        var ctx = mode === "single" ? "" : ", album \"" + album + "\"";
        var r2 = await callGemini(FALLBACK_SYSTEM, "Trouve et traduis les paroles de \"" + name + "\" par " + artist + ctx + ".", true);
        r2._source = genius.source || null;
        up({ st: "ok", d: r2 }); setDone(function(p) { return p + 1; });
        if (r2.lines && r2.lines.length) cacheSet(artist, name, { d: r2 });
        if (r2.found) fetchContext(name);
      }
      if (!autoMode) prefetchNext(name);
    } catch (e) { up({ st: "err", msg: e.message }); }
  }, [artist, album, mode, tracks]);

  var decodeAll = useCallback(async function() {
    stopRef.current = false; setAuto(true);
    var i = 0;
    while (i < tracks.length && !stopRef.current) {
      var batch = [];
      for (var j = 0; j < 3 && i + j < tracks.length; j++) {
        var t = tracks[i + j];
        if (dRef.current[t] && dRef.current[t].st === "ok") { continue; }
        batch.push(decode(t, true));
      }
      if (batch.length > 0) { await Promise.all(batch); }
      i = i + 3;
    }
    setAuto(false);
  }, [tracks, decode]);

  var reset = function() {
    stopRef.current = true; setView("input"); setTracks([]); setData({});
    dRef.current = {}; setSel(null); setAuto(false); setDone(0);
    setBestBars(null); setBestBarsView(false);
    setThematicView(false); setThematicResults(null); setThematicSuggestions(null); setSuggestDecoding({});
    sessionClear();
  };

  var analyzeLine = async function(lineIdx, line) {
    setFocusLine({ idx: lineIdx, line: line });
    setFocusData(null);
    setFocusLoading(true);
    try {
      var curLines = (data[sel] && data[sel].d && data[sel].d.lines) || [];
      var contextLines = [];
      for (var i = Math.max(0, lineIdx - 3); i < Math.min(curLines.length, lineIdx + 4); i++) {
        if (curLines[i].o) contextLines.push(curLines[i].o);
      }
      var albumCtx = mode === "single" ? "" : " (album: " + album + ")";
      var prompt = "ARTISTE: " + artist + "\nMORCEAU: \"" + sel + "\"" + albumCtx + "\n\nLignes autour:\n" + contextLines.join("\n") + "\n\nLIGNE A ANALYSER: " + line.o + "\nTraduction: " + (line.t || line.o) + "\n\nCherche les callbacks vers d'autres morceaux/albums de " + artist + ". Compare les mots, images et themes avec sa discographie.";
      // Utilise search pour verifier les callbacks discographiques
      var r = await callGemini(DEEP_ANALYSIS_SYSTEM, prompt, true);
      setFocusData(r);
    } catch (e) {
      setFocusData({ error: e.message });
    }
    setFocusLoading(false);
  };

  // Scan localStorage pour trouver tous les albums decodes
  var getCachedAlbums = function() {
    var albums = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith(CV + ":tl:")) {
          var parts = k.slice((CV + ":tl:").length).split(":");
          if (parts.length >= 2) {
            var a = parts[0], al = parts.slice(1).join(":");
            var tl = tlGet(a, al);
            if (tl && tl.length) {
              // Verifie qu'au moins un son est decode
              var decoded = tl.filter(function(t) { var c = cacheGet(a, t); return c && c.d; });
              if (decoded.length > 0) albums.push({ artist: a, album: al, tracks: tl, decoded: decoded.length });
            }
          }
        }
      }
    } catch (e) {}
    return albums;
  };

  // Recherche thematique (2 appels paralleles: resultats + suggestions)
  var runThematicSearch = async function() {
    if (!thematicQuery.trim() || thematicSelected.length === 0) return;
    setThematicLoading(true);
    setThematicResults(null);
    setThematicSuggestions(null);
    try {
      // Construire les paroles
      var allLyrics = "";
      thematicSelected.forEach(function(alb) {
        allLyrics += "\n\n======= " + alb.artist + " - " + alb.album + " =======\n";
        alb.tracks.forEach(function(t) {
          var c = cacheGet(alb.artist, t);
          if (c && c.d && c.d.lines) {
            allLyrics += "\n--- " + t + " ---\n";
            c.d.lines.forEach(function(l) {
              if (l.s) allLyrics += "\n" + l.s + "\n";
              else if (l.o) allLyrics += l.o + "\n";
            });
          }
        });
      });

      // Liste des albums deja decodes (pour que les suggestions les evitent)
      var decodedList = thematicSelected.map(function(a) { return a.artist + " - " + a.album; }).join(", ");

      // 2 appels en parallele
      var searchPromise = callGemini(THEMATIC_SYSTEM, "THEME: \"" + thematicQuery + "\"\n\nPAROLES:\n" + allLyrics, false);
      var suggestPromise = callGemini(SUGGEST_SYSTEM, "THEME: \"" + thematicQuery + "\"\n\nALBUMS DEJA DECODES (ne pas suggerer de morceaux de ceux-la): " + decodedList, true);

      var results = await searchPromise.catch(function() { return { results: [] }; });
      var suggestions = await suggestPromise.catch(function() { return { suggestions: [] }; });

      setThematicResults(results.results || []);
      setThematicSuggestions(suggestions.suggestions || []);
    } catch (e) {
      setThematicResults([]);
      setThematicSuggestions([]);
    }
    setThematicLoading(false);
  };

  // Decoder un morceau suggere (artiste/titre differents de l'album courant)
  var decodeSuggestion = async function(sug) {
    var key = sug.artist + ":" + sug.track;
    setSuggestDecoding(function(p) { var n = Object.assign({}, p); n[key] = "load"; return n; });
    try {
      // Chercher les paroles via genius
      var genius = await fetchLyrics(sug.track, sug.artist, sug.album || "");
      if (genius.found && genius.lyrics) {
        var prompt = "Voici les paroles EXACTES de \"" + sug.track + "\" par " + sug.artist + ".\nCopie chaque ligne originale mot pour mot.\n\nPAROLES:\n\n" + genius.lyrics;
        var r = await callGemini(TRANSLATE_SYSTEM, prompt, false);
        r.found = true;
        r._source = genius.source;
        if (r.lines && r.lines.length) cacheSet(sug.artist, sug.track, { d: r });
        // Aussi cacher une mini-tracklist pour que l'album apparaisse dans la recherche
        var existingTl = tlGet(sug.artist, sug.album || sug.track) || [];
        if (existingTl.indexOf(sug.track) < 0) {
          existingTl.push(sug.track);
          tlSet(sug.artist, sug.album || sug.track, existingTl);
        }
        setSuggestDecoding(function(p) { var n = Object.assign({}, p); n[key] = "ok"; return n; });
      } else {
        // Fallback: essayer via Gemini search
        var FALLBACK = "Tu es un traducteur rap. Utilise web_search pour trouver les paroles EXACTES de ce morceau. Puis traduis ligne par ligne.\nReponds en JSON: {\"found\":true,\"lang\":\"anglais\",\"lines\":[{\"s\":\"[Verse 1]\"},{\"o\":\"ligne\",\"t\":\"traduction\",\"c\":80}],\"notes\":[]}\nSi introuvable: {\"found\":false,\"lines\":[],\"notes\":[]}";
        var r2 = await callGemini(FALLBACK, "Trouve et traduis: \"" + sug.track + "\" par " + sug.artist, true);
        if (r2.found && r2.lines && r2.lines.length) {
          cacheSet(sug.artist, sug.track, { d: r2 });
          var existingTl2 = tlGet(sug.artist, sug.album || sug.track) || [];
          if (existingTl2.indexOf(sug.track) < 0) { existingTl2.push(sug.track); tlSet(sug.artist, sug.album || sug.track, existingTl2); }
          setSuggestDecoding(function(p) { var n = Object.assign({}, p); n[key] = "ok"; return n; });
        } else {
          setSuggestDecoding(function(p) { var n = Object.assign({}, p); n[key] = "err"; return n; });
        }
      }
    } catch (e) {
      setSuggestDecoding(function(p) { var n = Object.assign({}, p); n[key] = "err"; return n; });
    }
  };

  // Copier pour TikTok
  var copyForTikTok = function(res) {
    var lines = res.lines || [];
    var text = "🎤 " + thematicQuery.toUpperCase() + "\n\n";
    lines.forEach(function(l) {
      text += l.o + "\n";
      if (l.t) text += l.t + "\n";
      text += "\n";
    });
    text += "🎵 " + res.track + " — " + res.artist;
    if (res.album) text += " (" + res.album + ")";
    try {
      navigator.clipboard.writeText(text);
      setThematicCopied(res.track);
      setTimeout(function() { setThematicCopied(""); }, 2000);
    } catch (e) {}
  };

  var closeFocus = function() { setFocusLine(null); setFocusData(null); };

  // Best Bars: envoie TOUTES les paroles de l'album en un seul appel
  var extractBestBars = async function() {
    setBestBarsView(true);
    if (bestBars) return; // deja fait
    setBestBarsLoading(true);
    try {
      var allLyrics = "";
      tracks.forEach(function(t) {
        var e = dRef.current[t];
        if (!e || e.st !== "ok" || !e.d || !e.d.lines) return;
        allLyrics += "\n\n=== " + t + " ===\n";
        e.d.lines.forEach(function(l) {
          if (l.s) allLyrics += "\n" + l.s + "\n";
          else if (l.o) allLyrics += l.o + "\n";
        });
      });
      var r = await callGemini(BEST_BARS_SYSTEM, "Album: \"" + album + "\" par " + artist + "\n\nPAROLES COMPLETES:\n" + allLyrics, false);
      var bars = (r.bars || []).sort(function(a, b) { return (b.impact || 0) - (a.impact || 0); });
      setBestBars(bars);
    } catch (e) {
      setBestBars([]);
    }
    setBestBarsLoading(false);
  };

  // Analyse d'ecriture pour UN son donne (score + selection + multis)
  var extractPunchlinesFor = async function(name) {
    var entry = dRef.current[name];
    if (!entry || entry.st !== "ok" || !entry.d || !entry.d.lines) return;
    if (entry.d.analysis) return; // deja fait
    try {
      var lyricsText = entry.d.lines.map(function(l) {
        if (l.s) return "\n" + l.s;
        return l.o + (l.t ? "\n(" + l.t + ")" : "");
      }).join("\n");
      var albumCtx = mode === "single" ? "" : " (album: " + album + ")";
      var r = await callGemini(ANALYSIS_SYSTEM, "Morceau: \"" + name + "\" par " + artist + albumCtx + "\n\nPAROLES (traductions entre parentheses):\n" + lyricsText, false);
      var analysis = {
        score: r.score, score_breakdown: r.score_breakdown, score_note: r.score_note,
        essentiel: r.essentiel || [], notable: r.notable || [], multis: r.multis || [],
      };
      var merged = Object.assign({}, entry.d, { analysis: analysis, lines: entry.d.lines, lang: entry.d.lang });
      var next = Object.assign({}, dRef.current);
      next[name] = { st: "ok", d: merged };
      dRef.current = next;
      setData(Object.assign({}, dRef.current));
      cacheSet(artist, name, { d: merged });
    } catch (e) {}
  };

  // Extrait les meilleures punchlines du son courant
  var extractPunchlines = async function() {
    setPlLoading(true);
    await extractPunchlinesFor(sel);
    setPlLoading(false);
  };

  // Best of album: extrait les punchlines de tous les sons decodes (2 en parallele)
  var extractAlbumPunchlines = async function() {
    setAlbumPlView(true);
    setAlbumPlLoading(true);
    var decoded = tracks.filter(function(t) {
      var e = dRef.current[t];
      return e && e.st === "ok" && e.d && e.d.lines && e.d.lines.length;
    });
    var pending = decoded.filter(function(t) { return !dRef.current[t].d.analysis; });
    for (var i = 0; i < pending.length; i += 2) {
      var batch = pending.slice(i, i + 2).map(function(t) { return extractPunchlinesFor(t); });
      await Promise.all(batch);
    }
    setAlbumPlLoading(false);
  };

  var cur = sel && data[sel];
  var curD = cur ? cur.d : null;
  var showSidebar = !isMobile || (!sel && !albumPlView && !bestBarsView && !thematicView);
  var showDetail = !isMobile || sel || albumPlView || bestBarsView || thematicView;
  var headerLabel = mode === "single" ? single : album;

  return (
    <div style={S.root}>
      <style>{CSS}</style>

      <div style={S.header}>
        <div style={S.logo}>{"翻"}</div>
        <div style={{ flex: 1 }}>
          <div style={S.title}>RAP DECODER</div>
          <div style={{ fontSize: 8, color: "#333" }}>genius + gemini 3 flash - traduction - decryptage</div>
        </div>
        {view !== "input" && <button onClick={reset} style={S.back}>{"<-"}</button>}
      </div>

      {view === "input" && (
        <div style={S.inputWrap}>
          <div style={S.modeToggle}>
            <button onClick={function() { setMode("album"); }} style={Object.assign({}, S.modeBtn, mode === "album" ? S.modeBtnActive : {})}>Album</button>
            <button onClick={function() { setMode("single"); }} style={Object.assign({}, S.modeBtn, mode === "single" ? S.modeBtnActive : {})}>Single</button>
          </div>
          <Inp label="Artiste" val={artist} set={setArtist} ph={mode === "single" ? "Vince Staples" : "Westside Gunn"} enter={go} />
          {mode === "album"
            ? <Inp label="Album" val={album} set={setAlbum} ph="FLYGOD" enter={go} />
            : <Inp label="Titre du morceau" val={single} set={setSingle} ph="Blackberry Marmalade" enter={go} />}
          <button onClick={go} style={S.goBtn}>Decoder</button>
        </div>
      )}

      {view === "loading" && <div style={S.center}><div style={S.spinner} /><div style={S.dim}>Tracklist...</div></div>}
      {view === "error" && (
        <div style={S.center}>
          <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 10 }}>{err}</div>
          <button onClick={function() { setView("input"); }} style={S.retryBtn}>Retour</button>
        </div>
      )}

      {view === "list" && (
        <div style={S.main}>
          {showSidebar && (
            <div style={Object.assign({}, S.sidebar, { width: isMobile ? "100%" : 260, minWidth: isMobile ? 0 : 260 })}>
              <div style={S.sideHeader}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.albumTitle}>{headerLabel}</div>
                  <div style={S.albumSub}>{artist + " - " + done + "/" + tracks.length}</div>
                </div>
                {mode === "album" && (
                  <button onClick={auto ? function() { stopRef.current = true; setAuto(false); } : decodeAll}
                    style={Object.assign({}, S.allBtn, { borderColor: auto ? "#ef4444" : "#222", color: auto ? "#ef4444" : "#f0c040" })}>
                    {auto ? "Stop" : "Tout"}
                  </button>
                )}
              </div>
              {mode === "album" && done > 0 && (
                <button onClick={extractAlbumPunchlines} style={{
                  background: "transparent", border: "1px solid #2a2040", borderRadius: 4,
                  color: "#a855f7", fontFamily: "inherit", fontSize: 9,
                  padding: "5px 10px", cursor: "pointer",
                  letterSpacing: 2, textTransform: "uppercase",
                  margin: "0 12px 5px", display: "block",
                }}>
                  ★ analyser l'album
                </button>
              )}
              {mode === "album" && done === tracks.length && tracks.length > 0 && (
                <button onClick={extractBestBars} style={{
                  background: "transparent", border: "1px solid #2a1a10", borderRadius: 4,
                  color: "#e05030", fontFamily: "inherit", fontSize: 9,
                  padding: "5px 10px", cursor: "pointer",
                  letterSpacing: 2, textTransform: "uppercase",
                  margin: "0 12px 5px", display: "block",
                }}>
                  ★ best bars
                </button>
              )}
              <button onClick={function() { setThematicView(true); setAlbumPlView(false); setBestBarsView(false); setSel(null); }} style={{
                background: "transparent", border: "1px solid #1a1a2a", borderRadius: 4,
                color: "#38bdf8", fontFamily: "inherit", fontSize: 9,
                padding: "5px 10px", cursor: "pointer",
                letterSpacing: 2, textTransform: "uppercase",
                margin: "0 12px 10px", display: "block",
              }}>
                ◈ recherche thematique
              </button>
              {tracks.map(function(t, i) {
                var st = (data[t] && data[t].st) || "idle";
                var isSel = sel === t;
                var colors = { idle: "#222", load: "#f0c040", ok: "#4ade80", err: "#ef4444" };
                return (
                  <div key={i} onClick={function() { setAlbumPlView(false); setBestBarsView(false); setThematicView(false); decode(t, false); }} style={Object.assign({}, S.trackRow, {
                    background: isSel ? "#131313" : "transparent",
                    borderLeft: isSel ? "2px solid #f0c040" : "2px solid transparent",
                  })}>
                    <span style={Object.assign({}, S.dot, {
                      background: colors[st] || "#222",
                      animation: st === "load" ? "pulse 1s infinite" : "none",
                    })} />
                    <span style={Object.assign({}, S.trackName, { color: isSel ? "#ccc" : "#555" })}>
                      <span style={{ color: "#2a2a2a", marginRight: 6 }}>{String(i + 1).padStart(2, "0")}</span>{t}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {showDetail && thematicView && (
            <div style={S.detail}>
              <button onClick={function() { setThematicView(false); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- retour"}</button>
              <div style={S.trackTitle}>◈ Recherche Thematique</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 4, marginBottom: 18 }}>Trouve des passages par theme dans tes albums decodes</div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 9, color: "#38bdf8", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>theme ou concept</div>
                <input
                  value={thematicQuery}
                  onChange={function(e) { setThematicQuery(e.target.value); }}
                  placeholder={"ex: grandir sans pere, la trahison, l'argent corrompt..."}
                  onKeyDown={function(e) { if (e.key === "Enter") runThematicSearch(); }}
                  style={{
                    width: "100%", padding: "10px 12px", background: "#0a0a0a",
                    color: "#ddd", border: "1px solid #222", borderRadius: 4,
                    fontFamily: "inherit", fontSize: 13, outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 9, color: "#38bdf8", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>albums a fouiller</div>
                {(function() {
                  var albums = getCachedAlbums();
                  // Ajoute l'album courant s'il est pas deja dans la liste
                  if (mode === "album" && artist && album && done > 0) {
                    var exists = albums.some(function(a) { return norm(a.artist) === norm(artist) && norm(a.album) === norm(album); });
                    if (!exists) albums.unshift({ artist: artist, album: album, tracks: tracks, decoded: done });
                  }
                  if (albums.length === 0) return <div style={{ fontSize: 11, color: "#444" }}>Aucun album decode en cache. Decode d'abord des albums.</div>;
                  return albums.map(function(alb, ai) {
                    var isSelected = thematicSelected.some(function(s) { return norm(s.artist) === norm(alb.artist) && norm(s.album) === norm(alb.album); });
                    return (
                      <div key={ai}
                        onClick={function() {
                          if (isSelected) {
                            setThematicSelected(thematicSelected.filter(function(s) { return !(norm(s.artist) === norm(alb.artist) && norm(s.album) === norm(alb.album)); }));
                          } else {
                            setThematicSelected(thematicSelected.concat([alb]));
                          }
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "8px 10px", marginBottom: 4,
                          background: isSelected ? "#0d1520" : "transparent",
                          border: "1px solid " + (isSelected ? "#1a3050" : "#1a1a1a"),
                          borderRadius: 4, cursor: "pointer",
                        }}>
                        <span style={{ color: isSelected ? "#38bdf8" : "#333", fontSize: 12 }}>{isSelected ? "■" : "□"}</span>
                        <span style={{ fontSize: 12, color: isSelected ? "#ddd" : "#888" }}>{alb.artist} — {alb.album}</span>
                        <span style={{ fontSize: 9, color: "#444", marginLeft: "auto" }}>{alb.decoded}/{alb.tracks.length}</span>
                      </div>
                    );
                  });
                })()}
              </div>

              <button
                onClick={runThematicSearch}
                disabled={thematicLoading || !thematicQuery.trim() || thematicSelected.length === 0}
                style={{
                  width: "100%", padding: "12px 0",
                  background: thematicLoading || !thematicQuery.trim() || thematicSelected.length === 0 ? "#111" : "#1a2a3a",
                  color: thematicLoading ? "#555" : "#38bdf8",
                  border: "1px solid #1a3050", borderRadius: 4,
                  fontFamily: "inherit", fontSize: 11, cursor: "pointer",
                  letterSpacing: 3, textTransform: "uppercase", marginBottom: 20,
                }}>
                {thematicLoading ? "recherche..." : "chercher"}
              </button>

              {thematicResults && thematicResults.length > 0 && thematicResults.map(function(res, ri) {
                var pertColor = res.pertinence >= 9 ? "#38bdf8" : res.pertinence >= 7 ? "#4ade80" : "#888";
                var lines = res.lines || [];
                var isCopied = thematicCopied === res.track;
                return (
                  <div key={ri} style={{ marginBottom: 28, paddingLeft: 12, borderLeft: "3px solid " + pertColor }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: pertColor, lineHeight: 1 }}>{res.pertinence}</span>
                      <div>
                        <div style={{ fontSize: 10, color: "#f0c040", letterSpacing: 1, textTransform: "uppercase" }}>{res.track}</div>
                        <div style={{ fontSize: 9, color: "#555" }}>{res.artist}{res.album ? " — " + res.album : ""}</div>
                      </div>
                    </div>
                    <div style={{ background: "#0d0d0f", border: "1px solid #1a1a22", borderRadius: 6, padding: "12px 14px", marginBottom: 8 }}>
                      {lines.map(function(ln, li) {
                        var isObj = typeof ln === "object";
                        return (
                          <div key={li} style={{ marginBottom: li < lines.length - 1 ? 8 : 0 }}>
                            <div style={{ fontSize: 13, color: "#e6e6e6", lineHeight: 1.5 }}>{isObj ? ln.o : ln}</div>
                            {isObj && ln.t && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic", lineHeight: 1.4, marginTop: 2 }}>{ln.t}</div>}
                          </div>
                        );
                      })}
                    </div>
                    {res.link && <div style={{ fontSize: 11, color: "#999", lineHeight: 1.4, marginBottom: 8 }}>{res.link}</div>}
                    <button
                      onClick={function() { copyForTikTok(res); }}
                      style={{
                        background: "transparent", border: "1px solid " + (isCopied ? "#4ade80" : "#222"),
                        borderRadius: 4, color: isCopied ? "#4ade80" : "#555",
                        fontFamily: "inherit", fontSize: 9, padding: "5px 10px",
                        cursor: "pointer", letterSpacing: 1, textTransform: "uppercase",
                      }}>
                      {isCopied ? "✓ copie" : "copier pour tiktok"}
                    </button>
                  </div>
                );
              })}

              {thematicResults && thematicResults.length === 0 && !thematicLoading && (
                <div style={{ color: "#444", fontSize: 11, textAlign: "center", padding: 20 }}>Aucun passage trouve pour ce theme dans les albums selectionnes.</div>
              )}

              {thematicSuggestions && thematicSuggestions.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 9, color: "#f0c040", letterSpacing: 3, textTransform: "uppercase", marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid #1a1a1a" }}>suggestions — morceaux pas encore decodes</div>
                  {thematicSuggestions.map(function(sug, si) {
                    var key = sug.artist + ":" + sug.track;
                    var status = suggestDecoding[key] || null;
                    var pertColor = sug.pertinence >= 9 ? "#f0c040" : sug.pertinence >= 7 ? "#888" : "#555";
                    return (
                      <div key={si} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14, padding: "10px 12px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 6 }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: pertColor, minWidth: 22, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{sug.pertinence}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: "#ddd" }}>{sug.track}</div>
                          <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{sug.artist}{sug.album ? " — " + sug.album : ""}</div>
                          {sug.why && <div style={{ fontSize: 10, color: "#888", marginTop: 4, lineHeight: 1.4 }}>{sug.why}</div>}
                        </div>
                        <button
                          onClick={function() { if (status !== "load") decodeSuggestion(sug); }}
                          disabled={status === "load" || status === "ok"}
                          style={{
                            background: "transparent", flexShrink: 0,
                            border: "1px solid " + (status === "ok" ? "#4ade80" : status === "err" ? "#e05030" : status === "load" ? "#333" : "#222"),
                            borderRadius: 4,
                            color: status === "ok" ? "#4ade80" : status === "err" ? "#e05030" : status === "load" ? "#555" : "#f0c040",
                            fontFamily: "inherit", fontSize: 9, padding: "5px 8px",
                            cursor: status === "load" || status === "ok" ? "default" : "pointer",
                            letterSpacing: 1, textTransform: "uppercase", whiteSpace: "nowrap",
                          }}>
                          {status === "ok" ? "✓ decode" : status === "load" ? "..." : status === "err" ? "✕ erreur" : "decoder"}
                        </button>
                      </div>
                    );
                  })}
                  {Object.values(suggestDecoding).some(function(v) { return v === "ok"; }) && (
                    <button onClick={runThematicSearch} style={{
                      width: "100%", padding: "10px 0", marginTop: 8,
                      background: "#0d1520", color: "#38bdf8",
                      border: "1px solid #1a3050", borderRadius: 4,
                      fontFamily: "inherit", fontSize: 10, cursor: "pointer",
                      letterSpacing: 2, textTransform: "uppercase",
                    }}>
                      ↻ relancer la recherche (inclure les nouveaux)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {showDetail && bestBarsView && !thematicView && (
            <div style={S.detail}>
              <button onClick={function() { setBestBarsView(false); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- retour"}</button>
              <div style={S.trackTitle}>★ Best Bars</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 4, marginBottom: 6 }}>{artist} — {album}</div>
              <div style={{ fontSize: 10, color: "#333", marginBottom: 22, fontStyle: "italic" }}>Les lignes qui touchent, triees par impact. La traduction doit frapper seule.</div>
              {bestBarsLoading && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><div style={Object.assign({}, S.spinner, { width: 12, height: 12, margin: 0 })} /><span style={{ fontSize: 10, color: "#555", fontStyle: "italic" }}>extraction des best bars...</span></div>}
              {bestBars && bestBars.length > 0 && bestBars.map(function(bar, i) {
                var impactColor = bar.impact >= 9 ? "#e05030" : bar.impact >= 7 ? "#f0c040" : "#888";
                var lines = bar.lines || [];
                // Support both old format (array of strings) and new format (array of {o,t})
                var isNewFormat = lines.length > 0 && typeof lines[0] === "object";
                return (
                  <div key={i} style={{ marginBottom: 32, paddingLeft: 12, borderLeft: "3px solid " + impactColor }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 22, fontWeight: 800, color: impactColor, lineHeight: 1 }}>{bar.impact}</span>
                      <span onClick={function() { setBestBarsView(false); decode(bar.track, false); }} style={{ fontSize: 9, color: "#f0c040", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>{bar.track}</span>
                    </div>
                    <div style={{ background: "#0d0d0f", border: "1px solid #1a1a22", borderRadius: 6, padding: "14px 14px", marginBottom: 10 }}>
                      {isNewFormat ? lines.map(function(ln, li) {
                        return (
                          <div key={li} style={{ marginBottom: li < lines.length - 1 ? 10 : 0 }}>
                            <div style={{ fontSize: 13, color: "#e6e6e6", lineHeight: 1.5 }}>{ln.o}</div>
                            {ln.t && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic", lineHeight: 1.4, marginTop: 2 }}>{ln.t}</div>}
                          </div>
                        );
                      }) : lines.map(function(ln, li) {
                        return <div key={li} style={{ fontSize: 13, color: "#e6e6e6", lineHeight: 1.7 }}>{ln}</div>;
                      })}
                    </div>
                    {bar.sens && (
                      <div style={{ background: "#0d0f0d", border: "1px solid #1a221a", borderRadius: 6, padding: "12px 14px", marginBottom: 10 }}>
                        <div style={{ fontSize: 9, color: "#4ade80", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>ce que ca raconte</div>
                        <div style={{ fontSize: 12, color: "#bbb", lineHeight: 1.6 }}>{bar.sens}</div>
                      </div>
                    )}
                    {bar.t && !isNewFormat && (
                      <div style={{ background: "#0f0a08", border: "1px solid #1a1510", borderRadius: 6, padding: "12px 14px", marginBottom: 10 }}>
                        <div style={{ fontSize: 9, color: "#e05030", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>traduction</div>
                        {bar.t.split("\n").map(function(tl, ti) {
                          return <div key={ti} style={{ fontSize: 12, color: "#c8846a", lineHeight: 1.7, fontStyle: "italic" }}>{tl}</div>;
                        })}
                      </div>
                    )}
                    {bar.why && <div style={{ fontSize: 11, color: "#777", lineHeight: 1.4, marginTop: 4 }}>{bar.why}</div>}
                  </div>
                );
              })}
              {bestBars && bestBars.length === 0 && !bestBarsLoading && (
                <div style={{ color: "#444", fontSize: 11 }}>Aucune barre trouvee.</div>
              )}
            </div>
          )}

          {showDetail && albumPlView && !bestBarsView && (
            <div style={S.detail}>
              <button onClick={function() { setAlbumPlView(false); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- retour"}</button>
              <div style={S.trackTitle}>★ Best of {album}</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 4, marginBottom: 18 }}>{artist} — les meilleures lignes du disque</div>
              {albumPlLoading && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><div style={Object.assign({}, S.spinner, { width: 12, height: 12, margin: 0 })} /><span style={{ fontSize: 10, color: "#555", fontStyle: "italic" }}>analyse en cours...</span></div>}
              {(function() {
                var analyzed = tracks.map(function(t, ti) {
                  var e = data[t];
                  if (!e || e.st !== "ok" || !e.d || !e.d.analysis) return null;
                  return { name: t, idx: ti, a: e.d.analysis };
                }).filter(Boolean);
                if (!albumPlLoading && analyzed.length === 0) {
                  return <div style={{ color: "#444", fontSize: 11 }}>Aucun son analyse. Decode d'abord des morceaux, puis reviens ici.</div>;
                }
                // Pool: uniquement les lignes ESSENTIELLES de chaque son (le vrai cream)
                var pool = [];
                analyzed.forEach(function(item) {
                  (item.a.essentiel || []).forEach(function(p) {
                    pool.push({ p: p, song: item.name, score: item.a.score || 0 });
                  });
                });
                // Trie par score du son (les lignes des meilleurs sons remontent), garde le top
                pool.sort(function(x, y) { return y.score - x.score; });
                var top = pool.slice(0, 12);
                if (!albumPlLoading && top.length === 0) {
                  return <div style={{ color: "#444", fontSize: 11 }}>Pas encore de lignes essentielles. Analyse plus de morceaux.</div>;
                }
                return top.map(function(item, i) {
                  var p = item.p;
                  var tc = TYPE_COLORS[p.type] || "#666";
                  return (
                    <div key={i} style={{ marginBottom: 18, paddingLeft: 10, borderLeft: "2px solid " + tc }}>
                      <div style={{ fontSize: 14, color: "#e6e6e6", lineHeight: 1.5 }}>{p.o}</div>
                      {p.t && <div style={{ fontSize: 11, color: "#777", fontStyle: "italic", marginTop: 2 }}>{p.t}</div>}
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                        {p.type && <span style={{ fontSize: 8, color: tc, border: "1px solid " + tc, padding: "1px 6px", borderRadius: 10, textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>{p.type}</span>}
                        <span onClick={function() { setAlbumPlView(false); decode(item.song, false); }} style={{ fontSize: 9, color: "#f0c040", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>{item.song}</span>
                        {p.why && <span style={{ fontSize: 11, color: "#999" }}>{p.why}</span>}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {showDetail && !albumPlView && sel && (
            <div style={S.detail}>
              {isMobile && <button onClick={function() { setSel(null); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- morceaux"}</button>}

              {cur && cur.st === "load" && <div style={S.center}><div style={S.spinner} /><div style={S.dim}>Genius + traduction...</div></div>}

              {cur && cur.st === "err" && (
                <div style={S.center}>
                  <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 8 }}>{cur.msg}</div>
                  <button onClick={function() { delete dRef.current[sel]; setData(Object.assign({}, dRef.current)); decode(sel, false); }} style={S.retryBtn}>Reessayer</button>
                </div>
              )}

              {curD && (
                <div style={{ animation: "fadeIn .2s ease" }}>
                  <div style={{ marginBottom: 16 }}>
                    <div style={S.trackTitle}>{sel}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={Object.assign({}, S.tag, { color: "#888" })}>{curD.lang}</span>
                      {curD.found
                        ? <span style={Object.assign({}, S.tag, { color: "#4ade80" })}>paroles trouvees</span>
                        : <span style={Object.assign({}, S.tag, { color: "#f0c040" })}>pas de paroles</span>}
                      {curD._source && <a href={curD._source} target="_blank" rel="noopener noreferrer" style={Object.assign({}, S.tag, { color: "#555", textDecoration: "none" })}>source</a>}
                      <span style={{ fontSize: 9, color: "#333", marginLeft: "auto" }}>Clique une ligne pour analyser</span>
                    </div>
                  </div>

                  {curD.context && (curD.context.summary || curD.context.album) && (
                    <Fold title="CONTEXTE & ANALYSE" color="#f0c040">
                      {(curD.context.album || curD.context.year || curD.context.producer) && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginBottom: 10, fontSize: 11 }}>
                          {curD.context.album && <span style={{ color: "#555" }}><span style={{ color: "#333", textTransform: "uppercase", fontSize: 9 }}>album:</span> <span style={{ color: "#999" }}>{curD.context.album}</span></span>}
                          {curD.context.year && <span style={{ color: "#555" }}><span style={{ color: "#333", textTransform: "uppercase", fontSize: 9 }}>annee:</span> <span style={{ color: "#999" }}>{curD.context.year}</span></span>}
                          {curD.context.producer && <span style={{ color: "#555" }}><span style={{ color: "#333", textTransform: "uppercase", fontSize: 9 }}>prod:</span> <span style={{ color: "#999" }}>{curD.context.producer}</span></span>}
                        </div>
                      )}
                      {curD.context.themes && curD.context.themes.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                          {curD.context.themes.map(function(th, ti) {
                            return <span key={ti} style={{ fontSize: 9, padding: "2px 8px", border: "1px solid #2a2a2a", borderRadius: 20, color: "#888", letterSpacing: 1 }}>{th}</span>;
                          })}
                        </div>
                      )}
                      {curD.context.summary && <div style={{ fontSize: 12, lineHeight: 1.6, color: "#bbb" }}>{curD.context.summary}</div>}
                    </Fold>
                  )}

                  {curD.found && !curD.context && (
                    <div style={{ fontSize: 10, color: "#444", marginBottom: 14, fontStyle: "italic", letterSpacing: 1 }}>analyse du contexte en cours...</div>
                  )}

                  {curD.lines && curD.lines.length > 0 && !curD.analysis && (
                    <button onClick={extractPunchlines} disabled={plLoading} style={{
                      background: "transparent", border: "1px solid #2a2a2a", borderRadius: 4,
                      color: plLoading ? "#555" : "#a855f7", fontFamily: "inherit", fontSize: 10,
                      padding: "6px 12px", cursor: plLoading ? "default" : "pointer",
                      letterSpacing: 2, textTransform: "uppercase", marginBottom: 14,
                    }}>
                      {plLoading ? "analyse..." : "★ analyser l'ecriture"}
                    </button>
                  )}

                  {curD.analysis && <AnalysisView a={curD.analysis} />}

                  {curD.lines && curD.lines.length > 0 && (
                    <Fold title="PAROLES + TRADUCTION" color="#4ade80">
                      {curD.lines.map(function(l, i) {
                        if (l.s) return <div key={i} style={S.section}>{l.s}</div>;
                        var conf = typeof l.c === "number" ? l.c : 100;
                        var isUncertain = conf < 70;
                        return (
                          <div key={i} style={Object.assign({}, S.linePair, { cursor: "pointer" })} onClick={function() { analyzeLine(i, l); }}>
                            <div style={S.og}>
                              {l.o}
                              {isUncertain && <span title={"Confiance: " + conf + "%"} style={S.uncertainBadge}>?</span>}
                            </div>
                            {l.t ? <div style={Object.assign({}, S.tr, isUncertain ? { color: "#8a7a4a" } : {})}>{l.t}</div> : (curD.lang === "francais" ? null : <div style={{ fontSize: 11, color: "#ff6b6b", marginTop: 4, fontStyle: "italic" }}>⚠ traduction manquante</div>)}
                          </div>
                        );
                      })}
                    </Fold>
                  )}

                  {curD.notes && curD.notes.length > 0 && (
                    <Fold title="DECRYPTAGE" color="#e05030">
                      {curD.notes.map(function(n, i) {
                        var typeColors = { slang: "#f0c040", ref: "#e05030", wordplay: "#a855f7", sample: "#4ade80" };
                        var typeColor = typeColors[n.t] || "#666";
                        return (
                          <div key={i} style={S.note}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={S.noteRef}>{n.r}</div>
                              {n.t && <span style={{ fontSize: 8, color: typeColor, border: "1px solid " + typeColor, padding: "1px 5px", borderRadius: 10, textTransform: "uppercase", letterSpacing: 1 }}>{n.t}</span>}
                            </div>
                            <div style={S.noteExp}>{n.e}</div>
                          </div>
                        );
                      })}
                    </Fold>
                  )}

                  {!curD.found && (
                    <div style={{ color: "#444", fontSize: 11, padding: 16 }}>Pas de paroles disponibles (instrumental ou morceau trop underground).</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {focusLine && (
        <div style={S.modalOverlay} onClick={closeFocus}>
          <div style={S.modal} onClick={function(e) { e.stopPropagation(); }}>
            <div style={S.modalHeader}>
              <span style={S.modalTitle}>ANALYSE APPROFONDIE</span>
              <button onClick={closeFocus} style={S.modalClose}>{"x"}</button>
            </div>
            <div style={S.modalBody}>
              <div style={S.modalLine}>
                <div style={S.og}>{focusLine.line.o}</div>
                {focusLine.line.t && <div style={S.tr}>{focusLine.line.t}</div>}
              </div>

              {focusLoading && <div style={S.center}><div style={S.spinner} /><div style={S.dim}>Analyse...</div></div>}

              {focusData && focusData.error && (
                <div style={{ color: "#ef4444", fontSize: 11, padding: 10 }}>{focusData.error}</div>
              )}

              {focusData && !focusData.error && (
                <div style={{ animation: "fadeIn .2s ease" }}>
                  {focusData.meaning && (
                    <div style={S.analysisBlock}>
                      <div style={S.analysisLabel}>CE QU'IL DIT</div>
                      <div style={S.analysisText}>{focusData.meaning}</div>
                    </div>
                  )}
                  {focusData.layers && focusData.layers.length > 0 && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#a855f7" })}>COUCHES DE SENS</div>
                      {focusData.layers.map(function(layer, i) {
                        return (
                          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                            <span style={{ fontSize: 9, color: "#a855f7", fontWeight: 700, marginTop: 2, flexShrink: 0 }}>{i + 1}.</span>
                            <div style={{ fontSize: 11, color: "#bbb", lineHeight: 1.5 }}>{layer}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {focusData.callbacks && focusData.callbacks.length > 0 && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#f0c040" })}>↩ CALLBACKS</div>
                      {focusData.callbacks.map(function(cb, i) {
                        return (
                          <div key={i} style={{ marginBottom: 10, paddingLeft: 8, borderLeft: "2px solid #f0c040" }}>
                            <div style={{ fontSize: 11, color: "#f0c040", fontWeight: 600 }}>{cb.ref}</div>
                            {cb.line && <div style={{ fontSize: 10, color: "#777", fontStyle: "italic", marginTop: 2 }}>"{cb.line}"</div>}
                            <div style={{ fontSize: 10, color: "#999", marginTop: 3, lineHeight: 1.4 }}>{cb.link}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {focusData.wordplay && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#38bdf8" })}>WORDPLAY</div>
                      <div style={S.analysisText}>{focusData.wordplay}</div>
                    </div>
                  )}
                  {focusData.refs && focusData.refs.length > 0 && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#e05030" })}>REFERENCES</div>
                      {focusData.refs.map(function(r, i) {
                        return (
                          <div key={i} style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11, color: "#f0c040", fontWeight: 500 }}>{r.r}</div>
                            <div style={{ fontSize: 10, color: "#888", lineHeight: 1.5 }}>{r.e}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ ANALYSE D'ECRITURE (score + selection + multis) ============

var TYPE_COLORS = { craft: "#a855f7", real: "#e05030", depth: "#38bdf8", subversion: "#f0c040", wordplay: "#a855f7", image: "#4ade80", flex: "#f0c040", technique: "#38bdf8" };

// Surligne une sous-chaine (portion qui rime) dans une ligne
function highlightRhyme(line, portion, color) {
  if (!portion) return line;
  var idx = line.toLowerCase().indexOf(portion.toLowerCase());
  if (idx < 0) return line;
  var before = line.slice(0, idx);
  var match = line.slice(idx, idx + portion.length);
  var after = line.slice(idx + portion.length);
  return [
    before,
    <span key="m" style={{ color: color, fontWeight: 700, textShadow: "0 0 8px " + color + "60", borderBottom: "1px solid " + color }}>{match}</span>,
    after,
  ];
}

function LineCard(props) {
  var p = props.p;
  var tc = TYPE_COLORS[p.type] || "#666";
  return (
    <div style={{ marginBottom: 16, paddingLeft: 10, borderLeft: "2px solid " + tc }}>
      <div style={{ fontSize: 13, color: "#e6e6e6", lineHeight: 1.5 }}>{p.o}</div>
      {p.t && <div style={{ fontSize: 11, color: "#777", fontStyle: "italic", marginTop: 2 }}>{p.t}</div>}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
        {p.type && <span style={{ fontSize: 8, color: tc, border: "1px solid " + tc, padding: "1px 6px", borderRadius: 10, textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>{p.type}</span>}
        {p.why && <span style={{ fontSize: 11, color: "#999" }}>{p.why}</span>}
      </div>
    </div>
  );
}

function MultiCard(props) {
  var m = props.m;
  var color = "#38bdf8";
  return (
    <div style={{ marginBottom: 16, padding: "10px 12px", background: "#0d0d0f", border: "1px solid #1a1a22", borderRadius: 6 }}>
      <div style={{ marginBottom: 6 }}>
        {(m.lines || []).map(function(ln, i) {
          var portion = (m.rhymed && m.rhymed[i]) || "";
          return <div key={i} style={{ fontSize: 13, color: "#ccc", lineHeight: 1.6, fontFamily: "inherit" }}>{highlightRhyme(ln, portion, color)}</div>;
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {m.syllables ? <span style={{ fontSize: 8, color: color, border: "1px solid " + color, padding: "1px 6px", borderRadius: 10, letterSpacing: 1, textTransform: "uppercase" }}>{m.syllables} syllabes</span> : null}
        {m.note && <span style={{ fontSize: 11, color: "#888" }}>{m.note}</span>}
      </div>
    </div>
  );
}

function ScoreBar(props) {
  var label = props.label, val = props.val;
  var pct = Math.max(0, Math.min(10, val || 0)) * 10;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
      <span style={{ fontSize: 9, color: "#666", width: 72, textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: "#a855f7" }} />
      </div>
      <span style={{ fontSize: 9, color: "#888", width: 20, textAlign: "right" }}>{val}</span>
    </div>
  );
}

function AnalysisView(props) {
  var a = props.a;
  var score = a.score;
  var scoreColor = score >= 80 ? "#4ade80" : score >= 65 ? "#f0c040" : score >= 50 ? "#e0a030" : "#e05030";
  var bd = a.score_breakdown || {};
  var essentiel = a.essentiel || [], notable = a.notable || [], multis = a.multis || [];
  return (
    <div style={{ marginBottom: 24 }}>
      {typeof score === "number" && (
        <Fold title="SCORE D'ECRITURE" color="#a855f7">
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 40, fontWeight: 800, color: scoreColor, lineHeight: 1, fontFamily: "inherit" }}>{score}<span style={{ fontSize: 14, color: "#444" }}>/100</span></div>
            {a.score_note && <div style={{ fontSize: 11, color: "#999", flex: 1, lineHeight: 1.5 }}>{a.score_note}</div>}
          </div>
          <div>
            {bd.economie != null && <ScoreBar label="economie" val={bd.economie} />}
            {bd.imagery != null && <ScoreBar label="imagery" val={bd.imagery} />}
            {bd.rimes != null && <ScoreBar label="rimes" val={bd.rimes} />}
            {bd.subversion != null && <ScoreBar label="subversion" val={bd.subversion} />}
            {bd.profondeur != null && <ScoreBar label="profondeur" val={bd.profondeur} />}
          </div>
        </Fold>
      )}

      {essentiel.length > 0 && (
        <Fold title={"ESSENTIEL (" + essentiel.length + ")"} color="#e05030">
          {essentiel.map(function(p, i) { return <LineCard key={i} p={p} />; })}
        </Fold>
      )}

      {notable.length > 0 && (
        <Fold title={"NOTABLE (" + notable.length + ")"} color="#888">
          {notable.map(function(p, i) { return <LineCard key={i} p={p} />; })}
        </Fold>
      )}

      {multis.length > 0 && (
        <Fold title={"MULTIS (" + multis.length + ")"} color="#38bdf8">
          {multis.map(function(m, i) { return <MultiCard key={i} m={m} />; })}
        </Fold>
      )}
    </div>
  );
}

function Fold(props) {
  var _a = useState(true), open = _a[0], setOpen = _a[1];
  return (
    <div style={{ marginBottom: 18 }}>
      <div onClick={function() { setOpen(!open); }} style={S.foldHeader}>
        <div style={{ width: 3, height: 11, background: props.color, borderRadius: 2 }} />
        <span style={S.foldTitle}>{props.title}</span>
        <span style={{ fontSize: 10, color: "#222", marginLeft: "auto" }}>{open ? "v" : ">"}</span>
      </div>
      {open && <div style={S.foldBody}>{props.children}</div>}
    </div>
  );
}

function Inp(props) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 9, color: "#333", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>{props.label}</div>
      <input value={props.val} onChange={function(e) { props.set(e.target.value); }} placeholder={props.ph}
        onKeyDown={function(e) { if (e.key === "Enter" && props.enter) props.enter(); }}
        style={S.input} />
    </div>
  );
}

var CSS = "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap');@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes modalIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}input::placeholder{color:#2a2a2a}*::-webkit-scrollbar{width:4px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:#1a1a1a;border-radius:2px}";

var S = {
  root: { minHeight: "100vh", background: "#0a0a0a", color: "#ddd", fontFamily: "'JetBrains Mono',monospace" },
  header: { padding: "13px 16px", borderBottom: "1px solid #141414", display: "flex", alignItems: "center", gap: 10 },
  logo: { width: 26, height: 26, borderRadius: 5, background: "linear-gradient(135deg,#f0c040,#e05030)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#0a0a0a", flexShrink: 0 },
  title: { fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#fff" },
  back: { background: "none", border: "1px solid #1a1a1a", color: "#444", padding: "3px 9px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit" },
  inputWrap: { maxWidth: 380, margin: "0 auto", padding: "50px 16px" },
  modeToggle: { display: "flex", marginBottom: 22, border: "1px solid #181818", borderRadius: 6, padding: 3, background: "#0d0d0d" },
  modeBtn: { flex: 1, padding: "8px 12px", border: "none", background: "transparent", color: "#444", fontSize: 11, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, cursor: "pointer", borderRadius: 4, textTransform: "uppercase", letterSpacing: 2 },
  modeBtnActive: { background: "#181818", color: "#f0c040" },
  input: { width: "100%", background: "#0d0d0d", border: "1px solid #181818", color: "#fff", padding: "10px 11px", borderRadius: 5, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
  goBtn: { width: "100%", padding: "11px", borderRadius: 6, border: "none", marginTop: 6, background: "linear-gradient(135deg,#f0c040,#e05030)", color: "#0a0a0a", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 2 },
  center: { textAlign: "center", padding: "60px 16px" },
  spinner: { width: 20, height: 20, border: "2px solid #222", borderTop: "2px solid #f0c040", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 12px" },
  dim: { fontSize: 10, color: "#333" },
  retryBtn: { background: "#131313", border: "1px solid #1e1e1e", color: "#666", padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", fontSize: 10 },
  main: { display: "flex", height: "calc(100vh - 51px)" },
  sidebar: { borderRight: "1px solid #131313", display: "flex", flexDirection: "column", overflowY: "auto" },
  sideHeader: { padding: "10px 14px", borderBottom: "1px solid #131313", display: "flex", alignItems: "center", gap: 6 },
  albumTitle: { fontSize: 10, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  albumSub: { fontSize: 9, color: "#333", marginTop: 1 },
  allBtn: { background: "#131313", border: "1px solid #222", padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontSize: 9, fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap" },
  trackRow: { padding: "7px 14px", cursor: "pointer", display: "flex", alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0, marginRight: 10, display: "inline-block" },
  trackName: { fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  detail: { flex: 1, overflowY: "auto", padding: "14px 18px" },
  trackTitle: { fontSize: 15, fontWeight: 700, color: "#fff" },
  tag: { fontSize: 9, background: "#0d0d0d", border: "1px solid #1a1a1a", padding: "2px 8px", borderRadius: 20 },
  foldHeader: { display: "flex", alignItems: "center", gap: 7, cursor: "pointer", marginBottom: 8, userSelect: "none" },
  foldTitle: { fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#404040" },
  foldBody: { background: "#0d0d0d", borderRadius: 7, padding: "12px 14px", border: "1px solid #151515" },
  section: { fontSize: 9, fontWeight: 700, color: "#f0c040", letterSpacing: 1, padding: "10px 0 6px" },
  linePair: { marginBottom: 5, padding: "3px 6px", marginLeft: -6, marginRight: -6, borderRadius: 4 },
  og: { fontSize: 11, color: "#b0b0b0", lineHeight: 1.5 },
  tr: { fontSize: 10, color: "#5a8a4a", lineHeight: 1.5, fontStyle: "italic" },
  uncertainBadge: { display: "inline-block", marginLeft: 6, fontSize: 9, color: "#f0c040", border: "1px solid #f0c040", borderRadius: "50%", width: 14, height: 14, lineHeight: "12px", textAlign: "center", fontStyle: "normal" },
  note: { padding: "8px 0", borderBottom: "1px solid #131313" },
  noteRef: { fontSize: 11, color: "#f0c040", fontWeight: 500 },
  noteExp: { fontSize: 10, color: "#777", lineHeight: 1.5, marginTop: 3 },
  modalOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#0d0d0d", border: "1px solid #1f1f1f", borderRadius: 8, maxWidth: 600, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", animation: "modalIn .2s ease" },
  modalHeader: { padding: "12px 16px", borderBottom: "1px solid #161616", display: "flex", alignItems: "center" },
  modalTitle: { flex: 1, fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: 2, textTransform: "uppercase" },
  modalClose: { background: "none", border: "1px solid #1f1f1f", color: "#555", width: 22, height: 22, borderRadius: 4, cursor: "pointer", fontFamily: "inherit", fontSize: 11 },
  modalBody: { padding: 18, overflowY: "auto", flex: 1 },
  modalLine: { background: "#080808", padding: "12px 14px", borderRadius: 6, marginBottom: 16, borderLeft: "2px solid #f0c040" },
  analysisBlock: { marginBottom: 18 },
  analysisLabel: { fontSize: 9, fontWeight: 700, color: "#888", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 },
  analysisText: { fontSize: 12, color: "#ccc", lineHeight: 1.6 },
};
