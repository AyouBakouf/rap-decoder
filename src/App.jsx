import { useState, useRef, useCallback, useEffect } from "react";

// ============ CACHE / SAUVEGARDE LOCALE ============
var CV = "rdc2"; // version du cache (bumpe pour inclure le contexte)
function stripCitationMarks(s) { return (s || "").replace(/\[\d+\]/g, "").replace(/\s+([.,!?])/g, "$1").trim(); }
function norm(s) { return (s || "").trim().toLowerCase(); }
// Le LLM ecrit parfois la STRING "null" au lieu de la vraie valeur JSON null — traite les deux pareil
function realVal(v) {
  if (v == null) return null;
  if (typeof v === "string" && v.trim().toLowerCase() === "null") return null;
  return v;
}
// Garde-fou mecanique: le LLM reformule parfois le theme general (la therapie, l'introspection)
// comme si c'etait une "influence" au lieu de nommer une vraie personne (ex: Eckhart Tolle).
// Si le texte contient une formule generique connue ET aucun nom propre autre que l'artiste, on le rejette.
function isGenericFillerInfluence(s, artistName) {
  if (!s) return false;
  var lower = s.toLowerCase();
  var genericPhrases = ["la therapie", "la thérapie", "l'examen de soi", "l'introspection", "le travail d'ecriture", "le travail d'écriture", "la sante mentale", "la santé mentale"];
  var hasGeneric = genericPhrases.some(function(p) { return lower.indexOf(p) !== -1; });
  if (!hasGeneric) return false;
  var names = s.match(/\b[A-ZÀ-Ý][a-zà-ÿ'-]+\s+[A-ZÀ-Ý][a-zà-ÿ'-]+\b/g) || [];
  var artistLower = (artistName || "").toLowerCase();
  var hasOtherName = names.some(function(n) { return artistLower.indexOf(n.toLowerCase()) === -1; });
  return !hasOtherName;
}
// Le modele transplante volontiers un fait VRAI de la vie de l'artiste sur le mauvais
// album — typiquement quand un autre disque du meme artiste est construit autour de cet
// evenement, ou en porte le nom (l'hospitalisation de Despo Rutti appartient a "Dr Sophie
// Said", pas a "Les Sirenes du charbon"). Rien ne sonne faux: le fait est exact, seule
// l'attribution est fausse, donc aucune regle anti-invention ne l'attrape. On fait donc
// declarer au modele a quel album la source rattache l'evenement, et on compare nous-memes.
function normAlbumTitle(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(le|la|les|l|the|a|an|un|une|de|du|des|d)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}
// Deuxieme filet, celui qui ne demande RIEN au modele. Quand il decrit le mauvais album,
// son texte se contredit tout seul: il affirme que le disque porte le nom de quelqu'un
// ("en donnant son nom a l'album") alors que le titre demande ne contient pas ce nom.
// C'est la signature exacte du cas "un autre album de l'artiste porte le nom de
// l'evenement", et elle est verifiable sans faire confiance a une declaration.
var NAMESAKE_CLAIMS = [
  "son nom a l album", "son nom au disque", "son nom a ce disque",
  "porte son nom", "porte le nom", "donne son titre", "donne son nom",
  "eponyme", "titre de l album vient", "nom de l album vient",
];
function flattenFr(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
}
function claimsForeignNamesake(text, albumTitle, artistName) {
  if (!text) return null;
  // On ne cherche le nom revendique QUE dans la phrase qui porte la revendication:
  // pris sur tout le texte, le premier nom propre est presque toujours l'artiste
  // lui-meme, et l'avertissement affiche designerait alors le mauvais coupable.
  var sentences = text.split(/(?<=[.!?])\s+/);
  var t = normAlbumTitle(albumTitle), art = normAlbumTitle(artistName);
  for (var s = 0; s < sentences.length; s++) {
    var flat = flattenFr(sentences[s]);
    if (!NAMESAKE_CLAIMS.some(function(p) { return flat.indexOf(p) !== -1; })) continue;
    var names = sentences[s].match(/\b[A-ZÀ-Ý][\wà-ÿ'’-]+(?:\s+[A-ZÀ-Ý][\wà-ÿ'’-]+)*/g) || [];
    var foreign = null;
    for (var i = 0; i < names.length; i++) {
      var n = normAlbumTitle(names[i]);
      if (!n || n.length < 4) continue;
      if (t.indexOf(n) !== -1) return null; // le titre porte bien ce nom: revendication coherente
      if (art && (n === art || art.indexOf(n) !== -1)) continue; // l'artiste n'est pas le nom revendique
      if (!foreign) foreign = names[i];
    }
    if (foreign) return foreign; // nom revendique absent du titre = contexte d'un autre disque
  }
  return null;
}
// null = attribution non verifiable (le modele n'a rien declare), on laisse passer.
// true/false = elle a ete declaree, et elle correspond ou non a l'album demande.
function backstoryMatchesAlbum(declared, requested) {
  var d = normAlbumTitle(realVal(declared)), r = normAlbumTitle(requested);
  if (!d || !r) return null;
  return d === r || d.indexOf(r) !== -1 || r.indexOf(d) !== -1;
}
function isFrenchLang(lang) {
  var n = (lang || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return n === "francais" || n === "french" || n === "fr";
}
// Force t=null quand une ligne "francaise" a ete dupliquee dans t (le LLM renvoie parfois la
// meme ligne dans o et t au lieu de laisser t vide), peu importe comment il a ecrit "lang"
// ("français" au lieu de "francais"). Ne se fie JAMAIS au champ "lang" seul pour decider de
// vider t: un "lang" mal detecte sur un morceau anglophone effacerait alors de vraies traductions
// deja produites par le modele — on ne vide que si t duplique vraiment o.
function sanitizeTranslation(r) {
  if (r && isFrenchLang(r.lang) && r.lines) {
    r.lines.forEach(function(l) { if (l.o && l.t && norm(l.t) === norm(l.o)) l.t = null; });
  }
  return r;
}
// Nombre de lignes reellement portees par la source, hors marqueurs de section.
function countSourceLines(lyrics) {
  return (lyrics || "").split("\n")
    .map(function(l) { return l.trim(); })
    .filter(function(l) { return l && !/^[\[(].*[\])]$/.test(l); })
    .length;
}
function countTranslatedLines(r) {
  if (!r || !r.lines) return 0;
  return r.lines.filter(function(l) { return l && l.o; }).length;
}

// Le modele omet parfois une partie des lignes sans que rien ne le signale: le JSON
// est valide, finishReason vaut "stop", et on affiche la moitie d'un morceau comme
// s'il etait complet. Vu sur un titre de 62 lignes rendu en une trentaine.
// On compare donc ce qui sort a ce qui est entre, on retente une fois en insistant,
// et si l'ecart persiste on le marque au lieu de le taire.
var TRANSLATION_COMPLETENESS_MIN = 0.85;
async function translateWithCheck(prompt, sourceLyrics) {
  var expected = countSourceLines(sourceLyrics);
  var r = sanitizeTranslation(await callGemini(TRANSLATE_SYSTEM, prompt, false));
  if (!expected) return r;

  var got = countTranslatedLines(r);
  if (got >= expected * TRANSLATION_COMPLETENESS_MIN) return r;

  var insist = prompt + "\n\nATTENTION: le texte fourni contient " + expected +
    " lignes de paroles. Ta reponse DOIT en contenir autant. N'en resume aucune, n'en fusionne aucune, n'en saute aucune.";
  try {
    var r2 = sanitizeTranslation(await callGemini(TRANSLATE_SYSTEM, insist, false));
    if (countTranslatedLines(r2) > got) { r = r2; got = countTranslatedLines(r2); }
  } catch (e) {}

  if (got < expected * TRANSLATION_COMPLETENESS_MIN) {
    r._incomplete = { got: got, expected: expected };
  }
  return r;
}

// Repli d'affichage quand la source a bien rendu les paroles mais que la traduction
// echoue (429 en tete). Sans ca on jetait un texte deja recupere pour afficher
// "pas de paroles", ce qui envoyait le diagnostic sur la mauvaise piste.
function rawLyricsToLines(lyrics) {
  return (lyrics || "").split("\n")
    .map(function(l) { return l.trim(); })
    .filter(Boolean)
    .map(function(l) {
      return /^[\[(].*[\])]$/.test(l) ? { s: l } : { o: l, t: "", c: 100 };
    });
}

function normWords(s) { return (s || "").toLowerCase().replace(/[^a-z0-9à-ÿ'\s]/gi, " ").split(/\s+/).filter(Boolean); }
// Un fragment annote Genius "correspond" a une ligne si au moins la moitie des mots du plus court
// se retrouvent dans l'autre — evite de coller une annotation sans rapport a la ligne analysee.
function fragmentMatchesLine(fragment, lineText) {
  var a = normWords(fragment), b = normWords(lineText);
  if (!a.length || !b.length) return false;
  var setB = {};
  b.forEach(function(w) { setB[w] = true; });
  var shared = a.filter(function(w) { return setB[w]; }).length;
  return shared / Math.min(a.length, b.length) >= 0.5;
}
// Lit une analyse de ligne en cache, avec repli sur d.lines[idx] si elle a ete sauvegardee avant le
// fix qui rattache o/t (le JSON du modele ne les contient jamais, voir DEEP_ANALYSIS_SYSTEM/BATCH).
function resolveLineAnalysis(d, idx) {
  var a = d && d.lineAnalyses && d.lineAnalyses[idx];
  if (!a) return null;
  if (a.o) return a;
  var raw = d.lines && d.lines[idx];
  return raw ? Object.assign({}, a, { o: raw.o, t: raw.t }) : a;
}
// Score mecanique (pas de jugement IA) pour trier les lignes d'un angle Video Research: une ligne
// avec arc/mirror/philo/callbacks a plus de matiere qu'une ligne avec juste "sens".
function lineRichness(a) {
  var score = 0;
  if (a.arc) score++;
  if (a.mirror) score++;
  if (a.philo && a.philo.explication) score++;
  if (a.callbacks && a.callbacks.length) score++;
  return score;
}
// Garde-fou mecanique: si aucune annotation reelle n'a ete envoyee au LLM, on retire quand meme
// toute fausse citation "annotation Genius" qu'il aurait pu inventer malgre la consigne.
function stripFakeGeniusCitation(obj) {
  var reParen = /\s*\([^)]*annotations?\s+genius[^)]*\)/gi;
  var reInline = /\s*,?\s*(d'après|d'apres|selon)\s+(une\s+|les\s+)?annotations?\s+genius\b/gi;
  var clean = function(s) { return typeof s === "string" ? s.replace(reParen, "").replace(reInline, "") : s; };
  var walk = function(v) {
    if (typeof v === "string") return clean(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      var out = {};
      Object.keys(v).forEach(function(k) { out[k] = walk(v[k]); });
      return out;
    }
    return v;
  };
  return walk(obj);
}
// --- Stockage ---------------------------------------------------------------
// localStorage plafonne a ~5 Mo par origine, ce qui ne tient pas: un seul album
// decode+analyse pese lourd (paroles, traduction ligne a ligne, analyse d'ecriture,
// analyse profonde par ligne) et une discographie remplit le quota avant la fin.
// On passe donc sur IndexedDB, dont le quota se compte en centaines de Mo.
//
// IndexedDB est asynchrone alors que le rendu lit le cache de maniere synchrone a
// des dizaines d'endroits. Plutot que de tout convertir, on garde une Map en
// memoire comme source de verite en lecture, hydratee une fois au demarrage, et on
// ecrit en differe vers IndexedDB.
var MEM = new Map();
var IDB_NAME = "rapdecoder", IDB_STORE = "kv", IDB_VERSION = 1;
var idbPromise = null;

function idbOpen() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise(function(resolve) {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      var req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = function() {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { resolve(null); };
    } catch (e) { resolve(null); }
  });
  return idbPromise;
}

function idbTx(mode, fn) {
  return idbOpen().then(function(db) {
    if (!db) return null;
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(IDB_STORE, mode);
      var store = tx.objectStore(IDB_STORE);
      var out = fn(store);
      tx.oncomplete = function() { resolve(out && out.result !== undefined ? out.result : out); };
      tx.onerror = function() { reject(tx.error); };
      tx.onabort = function() { reject(tx.error); };
    });
  });
}

// Ecritures serialisees: une file evite d'ouvrir une transaction par morceau
// pendant la disco en masse, qui ecrit en rafale.
var writeQueue = Promise.resolve();
function queueWrite(fn) {
  writeQueue = writeQueue.then(fn).catch(function(e) {
    // Le quota reste possible sur IndexedDB, juste bien plus haut. Meme signal
    // que pour localStorage, la file de disco en masse sait deja s'y arreter.
    if (e && (e.name === "QuotaExceededError" || e.name === "AbortError")) {
      try { window.dispatchEvent(new CustomEvent("rdc-quota-exceeded")); } catch (e2) {}
    }
  });
  return writeQueue;
}

function storeGet(k) { return MEM.has(k) ? MEM.get(k) : null; }
function storeSet(k, v) {
  MEM.set(k, v);
  queueWrite(function() { return idbTx("readwrite", function(s) { s.put(v, k); }); });
}
function storeDel(k) {
  MEM.delete(k);
  queueWrite(function() { return idbTx("readwrite", function(s) { s.delete(k); }); });
}
function storeKeys() { return Array.from(MEM.keys()); }

// Hydrate la memoire depuis IndexedDB, puis rapatrie ce qui trainait encore dans
// localStorage et libere la place occupee la-bas.
async function hydrateStore() {
  try {
    var db = await idbOpen();
    if (db) {
      var entries = await new Promise(function(resolve) {
        try {
          var tx = db.transaction(IDB_STORE, "readonly");
          var store = tx.objectStore(IDB_STORE);
          var kReq = store.getAllKeys(), vReq = store.getAll();
          tx.oncomplete = function() { resolve([kReq.result || [], vReq.result || []]); };
          tx.onerror = function() { resolve([[], []]); };
        } catch (e) { resolve([[], []]); }
      });
      for (var i = 0; i < entries[0].length; i++) MEM.set(entries[0][i], entries[1][i]);
    }
  } catch (e) {}

  // Migration unique depuis localStorage.
  try {
    var legacy = [];
    for (var j = 0; j < localStorage.length; j++) {
      var k = localStorage.key(j);
      if (k && k.indexOf(CV + ":") === 0) legacy.push(k);
    }
    for (var m = 0; m < legacy.length; m++) {
      var key = legacy[m];
      try {
        var parsed = JSON.parse(localStorage.getItem(key));
        if (parsed && !MEM.has(key)) { MEM.set(key, parsed); storeSet(key, parsed); }
      } catch (e) {}
    }
    await writeQueue;
    // Ne vider localStorage qu'une fois les ecritures IndexedDB confirmees:
    // c'est ce qui rend les 5 Mo a nouveau disponibles.
    for (var n = 0; n < legacy.length; n++) {
      try { localStorage.removeItem(legacy[n]); } catch (e) {}
    }
  } catch (e) {}
}

function ckey(artist, name) { return CV + ":song:" + norm(artist) + ":" + norm(name); }
function tlkey(artist, album) { return CV + ":tl:" + norm(artist) + ":" + norm(album); }
function cacheGet(artist, name) { return storeGet(ckey(artist, name)); }
function cacheSet(artist, name, payload) {
  // On estampille l'artiste et le titre d'origine dans le payload : la cle ne
  // conserve que leur version normalisee (minuscules), et la vue par artiste a
  // besoin des libelles exacts pour afficher ses cartes.
  storeSet(ckey(artist, name), Object.assign({}, payload, { _a: artist, _t: name }));
}
function cacheClear(artist, name) { storeDel(ckey(artist, name)); }
function tlGet(artist, album) { return storeGet(tlkey(artist, album)); }
function tlSet(artist, album, tracks) { storeSet(tlkey(artist, album), tracks); }
// Les best bars etaient jusqu'ici du state React pur : perdus au rechargement, et
// donc inagregeables. Les persister par album est ce qui rend l'onglet Passages de
// la vue artiste possible sans relancer un appel API a chaque fois.
function bbkey(artist, album) { return CV + ":bb:" + norm(artist) + ":" + norm(album); }
function bbGet(artist, album) { return storeGet(bbkey(artist, album)); }
function bbSet(artist, album, bars) { storeSet(bbkey(artist, album), { album: album, bars: bars }); }

// Rend les entrees dont la cle commence par prefix.
function scanCache(prefix) {
  var out = [];
  storeKeys().forEach(function(k) {
    if (k.indexOf(prefix) !== 0) return;
    var v = storeGet(k);
    if (v) out.push({ key: k, tail: k.slice(prefix.length), value: v });
  });
  return out;
}

// Toutes les lignes retenues (essentiel + notable) de tous les morceaux caches d'un
// artiste, classees par impact. Le champ impact est note par ANALYSIS_SYSTEM
// precisement pour etre comparable d'un morceau a l'autre.
function artistBestLines(artist) {
  var rows = scanCache(CV + ":song:" + norm(artist) + ":");
  var out = [];
  rows.forEach(function(r) {
    var d = r.value && r.value.d;
    var a = d && d.analysis;
    if (!a) return;
    var track = r.value._t || r.tail;
    ["essentiel", "notable"].forEach(function(bucket) {
      (a[bucket] || []).forEach(function(p) {
        if (!p || !p.o) return;
        out.push(Object.assign({}, p, { track: track, bucket: bucket, score: a.score }));
      });
    });
  });
  return out.sort(function(x, y) { return (y.impact || 0) - (x.impact || 0); });
}

// Classement des couplets. Le decoupage est gratuit: TRANSLATE_SYSTEM insere deja
// des marqueurs de section ({"s":"[Verse 1]"}) dans les lignes en cache. Le score
// est deduit des lignes du couplet que l'analyse d'ecriture a retenues, donc sur la
// meme echelle d'impact que les onglets Lignes et Passages.
//
// Limite assumee: l'analyse ne note que ~8 lignes par morceau. Un couplet
// regulierement bon mais sans ligne saillante ressort donc sous-estime — d'ou le
// nombre de lignes retenues affiche a cote du score, pour que ce soit lisible.
function artistBestVerses(artist) {
  var rows = scanCache(CV + ":song:" + norm(artist) + ":");
  var out = [];
  rows.forEach(function(r) {
    var d = r.value && r.value.d;
    if (!d || !d.lines || !d.lines.length || !d.analysis) return;
    var track = r.value._t || r.tail;

    // Impact par ligne, indexe sur le texte original.
    var scored = {};
    ["essentiel", "notable"].forEach(function(b) {
      (d.analysis[b] || []).forEach(function(p) {
        if (p && p.o) scored[norm(p.o)] = p.impact || 0;
      });
    });

    var cur = null;
    var flush = function() {
      if (!cur || cur.lines.length < 4) return;
      if (!cur.hits) return; // aucun repere de qualite: on ne classe pas au hasard
      out.push({
        track: track, section: cur.section, lines: cur.lines,
        score: cur.total, hits: cur.hits, best: cur.best,
      });
    };
    d.lines.forEach(function(l) {
      if (l.s) { flush(); cur = { section: l.s, lines: [], total: 0, hits: 0, best: 0 }; return; }
      if (!l.o || !cur) return;
      cur.lines.push(l);
      var imp = scored[norm(l.o)];
      if (imp) { cur.total += imp; cur.hits += 1; if (imp > cur.best) cur.best = imp; }
    });
    flush();
  });
  // Le total recompense un couplet qui enchaine plusieurs lignes fortes, la
  // meilleure ligne departage a total egal.
  return out.sort(function(x, y) { return (y.score - x.score) || (y.best - x.best); });
}

// Idem pour les passages de 4-8 barres, agreges depuis les albums deja extraits.
function artistBestBars(artist) {
  var rows = scanCache(CV + ":bb:" + norm(artist) + ":");
  var out = [];
  rows.forEach(function(r) {
    var album = (r.value && r.value.album) || r.tail;
    ((r.value && r.value.bars) || []).forEach(function(b) {
      if (b && b.lines && b.lines.length) out.push(Object.assign({}, b, { album: album }));
    });
  });
  return out.sort(function(x, y) { return (y.impact || 0) - (x.impact || 0); });
}

// De quoi expliquer une vue vide sans laisser l'utilisateur deviner.
function artistCacheStats(artist) {
  var songs = scanCache(CV + ":song:" + norm(artist) + ":");
  var analyzed = songs.filter(function(r) { return r.value && r.value.d && r.value.d.analysis; });
  return {
    tracks: songs.length,
    analyzed: analyzed.length,
    albumsWithBars: scanCache(CV + ":bb:" + norm(artist) + ":").length,
  };
}

function sessionSave(s) { storeSet(CV + ":session", s); }
function sessionLoad() { return storeGet(CV + ":session"); }
function sessionClear() { storeDel(CV + ":session"); }

var TRACKLIST_SYSTEM = "Tu donnes les tracklists d'albums. Reponds en JSON: {\"tracks\":[\"titre1\",\"titre2\",...]} Titres exacts, sans featurings. Si inconnu: {\"tracks\":[]}";

var TRANSLATE_SYSTEM = "Tu es un traducteur rap. On te donne les PAROLES EXACTES d'un morceau, tu retournes la traduction française ligne par ligne en JSON.\n\nREGLE NUMERO 1, ABSOLUE: pour CHAQUE ligne tu DOIS produire un objet {\"o\":\"ligne originale\",\"t\":\"TRADUCTION FRANCAISE\",\"c\":confiance}. Le champ \"t\" doit TOUJOURS contenir la traduction française complète. Ne laisse JAMAIS \"t\" vide, null, ou identique a \"o\". Si une ligne est intraduisible, mets \"t\":\"<intraduisible>\". C'est ta seule mission: TRADUIRE.\n\nAutres regles:\n- Regroupe les lignes trop courtes qui font partie de la meme phrase en UNE seule.\n- Sections: titres generiques [Intro], [Verse 1], [Chorus], [Bridge], [Outro], [Interlude]. JAMAIS le nom d'un rappeur.\n- Inclus TOUTES les lignes (interludes, skits, outros). Coupe RIEN.\n- \"c\" = confiance 0-100. 100 = trad evidente. <70 = slang rare, ref obscure, sens incertain.\n- Si tout le morceau est en francais: \"t\":null pour chaque ligne, lang=\"francais\".\n- Contexte rap: \"bitch\"=\"meuf\" (jamais pute). \"nigga\"=ne traduis pas. \"whip\"=\"caisse\". Registre rap francais, pas francais scolaire.\n- CRUCIAL: utilise des mots SIMPLES et COURANTS. Le francais de tous les jours, pas de la litterature. Si t'hesites entre un mot simple et un mot recherche, prends TOUJOURS le simple.\n  MOTS INTERDITS dans les traductions: firmament, tumulte, redemption, resilience, ephemere, inexorable, naguere, abysses, tourmente, funeste, demeurer, oeuvrer, quete, dessein, en proie a, au sein de, jadis, faucher (pour \"tuer\" → dis \"buter/descendre\"), courroux, empreint, autrui.\n  Dis \"le ciel\" pas \"le firmament\". Dis \"rester\" pas \"demeurer\". Dis \"chercher\" pas \"quete\". Dis \"bosser\" pas \"oeuvrer\". Dis \"avant\" pas \"jadis/naguere\".\n  Le test: un ado de 16 ans qui ecoute du rap doit comprendre chaque mot de ta traduction sans dictionnaire.\n\nNotes de decryptage (champ \"notes\"):\n- \"r\"=mot/expression, \"e\"=explication courte, \"t\"=type (\"slang\"/\"ref\"/\"wordplay\"/\"sample\")\n\nFormat JSON:\n{\n\"lang\":\"anglais\",\n\"lines\":[\n{\"s\":\"[Intro]\"},\n{\"o\":\"ligne originale\",\"t\":\"traduction francaise\",\"c\":95}\n],\n\"notes\":[\n{\"r\":\"mot\",\"e\":\"explication\",\"t\":\"ref\"}\n]\n}";

// Regles partagees par l'analyse ligne-par-ligne (clic Focus Mode) et l'analyse par lots (Analyser tout) —
// definies UNE SEULE FOIS pour que les deux chemins restent toujours coherents entre eux.
var DEEP_ANALYSIS_RULES = "CHAMP \"sens\": le sens premier, litteral, de la ligne — ce que l'artiste dit concretement. 2 phrases maximum. Pas de sur-lecture ici, juste le sens direct.\n\nCHAMP \"technique\": UNIQUEMENT ce qui est REELLEMENT present dans la ligne — rime interne, double sens, homophonie, switch je/nous (passer du \"je\" individuel a un \"nous\" collectif, ou l'inverse), un placement de mots notable sur le beat. Jamais une interpretation forcee. Si la ligne est du rap direct sans technique particuliere: la valeur JSON null. N'invente JAMAIS une technique pour remplir le champ.\n\nCHAMP \"couches\" (SENS SUPPLEMENTAIRES AU-DELA DU PREMIER DEGRE):\nMaximum 2. Uniquement si CLAIREMENT intentionnelles — pas des lectures que TOI tu plaques dessus. Chaque couche = 1 SEULE phrase. Si une couche a besoin de 3 phrases pour etre justifiee, c'est qu'elle est trop tiree par les cheveux: ne la mets pas.\nSi la ligne n'a pas de second degre reel: couches=[]. Zero couche vaut mieux qu'une couche forcee.\n\nCHAMP \"arc\" (TRAJECTOIRE DE L'ARTISTE):\nEst-ce que cette ligne illustre, marque ou contredit une evolution REELLE et identifiable de l'artiste a travers ses albums (changement de posture, de rapport a un theme, de sujet) ? Pas une generalite vague (\"il a grandi\", \"il a mûri\") — un point de comparaison precis avec un autre moment de sa discographie. Sinon: null.\n\nCHAMP \"mirror\" (PROJECTION / MIROIR):\nSi la ligne s'adresse a quelqu'un d'autre (rival, beef, critique) — est-ce que l'artiste y decrit un defaut ou une situation qu'il a LUI-MEME reconnue ou confessee ailleurs dans sa propre discographie ? Ce n'est un miroir que si tu peux pointer OU/QUAND il l'a reconnu pour lui-meme — sinon ce n'est qu'une supposition, pas un miroir. Ne force JAMAIS ce parallele: null si rien de verifiable.\n\nCHAMP \"philo\": parallele avec UN concept philosophique precis, uniquement si genuinement pertinent — sinon la valeur JSON null (pas un objet avec des champs vides).\nCOLLECTION DE L'UTILISATEUR (a prioriser a pertinence egale, il les a physiquement sous la main): les stoiciens (Marc Aurele, Epictete), Nietzsche, Platon, Aristote, Sartre, Morgan Housel. Reste \"seulement si pertinent\" — ne force JAMAIS un de ces penseurs si un autre parallele colle clairement mieux, mais entre deux paralleles aussi pertinents l'un que l'autre, choisis celui-la.\n\"ref\": la reference la PLUS PRECISE possible pour que l'utilisateur retrouve le passage LUI-MEME — oeuvre + chapitre/section/§ (prefere le §/chapitre/section, stable d'une edition a l'autre, a un numero de page qui varie selon l'edition). EXACTE uniquement: ne mets un numero de section/§ precis QUE si tu es reellement sur qu'il est correct. Si tu connais l'oeuvre mais pas le numero exact: cite juste l'oeuvre ou le chapitre general, sans inventer un numero — une reference precise mais fausse envoie l'utilisateur au mauvais endroit, c'est pire qu'une reference vague.\n\"explication\": pas le concept en general — en 1 phrase, decris ce que CE PASSAGE PRECIS dit ou argumente, pour que l'utilisateur sache a quoi s'attendre en l'ouvrant. Reste sur l'IDEE/L'ARGUMENT (le fond), jamais sur la formulation: n'ecris JAMAIS une phrase qui reprend ou imite la structure du texte original, meme courte, meme approximative — decrire precisement le contenu n'autorise pas a s'en rapprocher. La reference sert a ce que l'utilisateur aille lire le passage source lui-meme, ne le cite pas ni ne le paraphrase de trop pres a sa place.\nSi aucun parallele reel n'existe ou si tu dois forcer le lien: null.\n\nCHAMP \"callbacks\" (CONNEXIONS VERIFIABLES AVEC D'AUTRES MORCEAUX, PAS DE VAGUES THEMES):\nUniquement des callbacks VERIFIABLES: un mot/image/theme reellement reutilise ailleurs dans la discographie de l'artiste, que tu peux appuyer avec la ligne exacte de l'autre morceau. Une connexion thematique vague (\"il parle souvent d'argent\") n'est PAS un callback — ne la mets pas. Si tu n'es pas sur a 100% que la reference existe reellement: ne la mets pas.\nChaque callback = album/morceau, la ligne EXACTE citee, et le lien en 1 SEULE phrase. Pas de paragraphe explicatif.\nSi aucun callback verifiable: callbacks=[].";

var DEEP_ANALYSIS_SYSTEM = "Tu es un analyste de rap precis et rigoureux. On te donne UNE ligne d'un morceau + le contexte + les lignes autour.\n\nREGLE ABSOLUE: TOUT en FRANCAIS.\nREGLE CENTRALE: cherche ce qu'on n'aurait PAS vu sans connaitre la discographie de l'artiste en profondeur. Precision avant volume — mieux vaut 1 couche forte que 4 moyennes. Si rien de solide ne se degage pour un champ: mets null (ou tableau vide, selon le champ). Une lecture forcee est pire qu'un champ vide.\n\nReponds en JSON:\n{\n\"sens\":\"ce que l'artiste dit, sens premier, 2 phrases MAXIMUM\",\n\"technique\":\"mecanique rap reellement presente (rime interne, double sens, homophonie, switch je/nous, placement sur le beat), ou null\",\n\"couches\":[\"couche 1\", \"couche 2\"],\n\"arc\":\"comment cette ligne s'inscrit dans la trajectoire de l'artiste a travers ses albums, ou null\",\n\"mirror\":\"si la ligne vise quelqu'un d'autre, projette-t-il un truc qu'il a lui-meme confesse ailleurs dans sa discographie ? ou null\",\n\"philo\":{\"ref\":\"Oeuvre, reference precise (chapitre/section/§)\",\"explication\":\"le concept en 1-2 phrases, tes propres mots\"},\n\"callbacks\":[{\"album\":\"morceau/album reference\",\"ligne\":\"la ligne EXACTE citee de l'autre morceau\",\"lien\":\"le lien, 1 phrase\"}]\n}\n\n" + DEEP_ANALYSIS_RULES + "\n\nSI DES \"ANNOTATIONS GENIUS REELLES\" SONT FOURNIES DANS LE MESSAGE: elles ont deja ete verifiees comme correspondant a cette ligne precise (ou une ligne toute proche) — utilise-les comme source fiable en priorite dans le champ concerne (sens/technique/couches/arc selon ce qui correspond). Ne RECOPIE PAS l'annotation mot pour mot — reformule avec tes propres mots, et precise \"d'apres une annotation Genius\" UNIQUEMENT si tu t'en sers reellement.\nSI LE MESSAGE DIT QU'AUCUNE ANNOTATION NE CORRESPOND: n'ecris JAMAIS \"d'apres une annotation Genius\" ni une formule equivalente — ce serait une fausse source. Analyse alors uniquement avec tes propres connaissances.\n\nSTYLE: direct, precis, comme un vrai passionne de rap qui explique a un pote — pas academique, pas de remplissage.";

// Variante batch (bouton "Analyser tout"): plusieurs lignes d'un coup, chacune identifiee par [ligne N],
// pour limiter le nombre d'appels API au lieu d'un appel par ligne.
var DEEP_ANALYSIS_BATCH_SYSTEM = "Tu es un analyste de rap precis et rigoureux. On te donne PLUSIEURS lignes d'un morceau, chacune identifiee par un numero [ligne N], plus le contexte etendu autour pour suivre le fil.\n\nREGLE ABSOLUE: TOUT en FRANCAIS.\nREGLE CENTRALE: cherche ce qu'on n'aurait PAS vu sans connaitre la discographie de l'artiste en profondeur. Precision avant volume — mieux vaut 1 couche forte que 4 moyennes. Si rien de solide ne se degage pour un champ: mets null (ou tableau vide, selon le champ). Une lecture forcee est pire qu'un champ vide.\n\nAnalyse CHAQUE ligne listee dans \"LIGNES A ANALYSER\" independamment des autres, avec les MEMES regles que si tu analysais une seule ligne a la fois — juste plusieurs d'un coup. Les lignes listees en \"CONTEXTE\" servent uniquement a suivre le fil: NE LES ANALYSE PAS.\n\nReponds en JSON:\n{\n\"analyses\":[\n{\n\"lineIdx\":12,\n\"sens\":\"ce que l'artiste dit, sens premier, 2 phrases MAXIMUM\",\n\"technique\":\"mecanique rap reellement presente (rime interne, double sens, homophonie, switch je/nous, placement sur le beat), ou null\",\n\"couches\":[\"couche 1\", \"couche 2\"],\n\"arc\":\"comment cette ligne s'inscrit dans la trajectoire de l'artiste a travers ses albums, ou null\",\n\"mirror\":\"si la ligne vise quelqu'un d'autre, projette-t-il un truc qu'il a lui-meme confesse ailleurs dans sa discographie ? ou null\",\n\"philo\":{\"ref\":\"Oeuvre, reference precise (chapitre/section/§)\",\"explication\":\"le concept en 1-2 phrases, tes propres mots\"},\n\"callbacks\":[{\"album\":\"morceau/album reference\",\"ligne\":\"la ligne EXACTE citee de l'autre morceau\",\"lien\":\"le lien, 1 phrase\"}]\n}\n]\n}\n\nUn objet par ligne listee dans \"LIGNES A ANALYSER\", DANS LE MEME ORDRE, avec \"lineIdx\" EXACTEMENT egal au numero entre crochets [ligne N] — jamais invente, jamais approxime, jamais decale.\n\n" + DEEP_ANALYSIS_RULES + "\n\nSI DES \"ANNOTATIONS GENIUS REELLES\" SONT FOURNIES DANS LE MESSAGE (chacune associee a un numero de ligne precis): elles ont deja ete verifiees comme correspondant a CETTE ligne precise — utilise-les comme source fiable en priorite dans le champ concerne, UNIQUEMENT pour la ligne dont le numero est indique (jamais pour une autre ligne). Ne RECOPIE PAS l'annotation mot pour mot — reformule avec tes propres mots, et precise \"d'apres une annotation Genius\" UNIQUEMENT si tu t'en sers reellement pour cette ligne.\nPour une ligne SANS annotation associee: n'ecris JAMAIS \"d'apres une annotation Genius\" ni une formule equivalente pour cette ligne — ce serait une fausse source.\n\nSTYLE: direct, precis, comme un vrai passionne de rap qui explique a un pote — pas academique, pas de remplissage.";

var CONTEXT_SYSTEM = "Tu connais bien le rap. On te donne un morceau (artiste + titre, parfois l'album). Donne du VRAI contexte et une VRAIE lecture de ce morceau specifique, en parlant SIMPLE comme a un pote qui connait le sujet a fond. Pas un resume Wikipedia — une vraie analyse.\n\nJSON UNIQUEMENT:\n{\"album\":\"nom ou null\",\"year\":null,\"producer\":\"prod ou null\",\"themes\":[\"theme1\",\"theme2\"],\"role\":\"le role de CE morceau dans l'album/la discographie, ou null\",\"summary\":\"3-5 phrases: de quoi parle vraiment ce morceau, en profondeur\",\"standout\":\"1-2 phrases: ce qui est particulier ou notable dans ce morceau precis, ou null\",\"philo\":{\"ref\":\"Oeuvre, reference precise (chapitre/section/§)\",\"explication\":\"le concept, tes propres mots\"} ou null,\"sonic_dna\":{\"mood\":\"ambiance en 2-3 mots concrets, ou null\",\"energy\":\"niveau d'energie/intensite en 2-3 mots, ou null\",\"prod\":\"style de production reel de CE morceau (instrumentation, texture rythmique), ou null\",\"texture\":\"elements sonores concrets qu'on entend (samples, basse, effets vocaux...), ou null\",\"similar\":[\"Artiste - Morceau\"]}}\n\n- themes: 2-3 mots CONCRETS (\"argent facile\", \"deuil\", \"famille\"). JAMAIS abstraits (\"introspection\", \"alienation\").\n- \"role\": la fonction de CE morceau specifiquement — intro/mise en contexte, single/tube, tournant emotionnel de l'album, morceau le plus dur/vulnerable, outro/conclusion, feature marquant, sample notable, etc. Precise et concret, pas vague. Si tu sais pas: la valeur JSON null (pas le mot \"null\" entre guillemets).\n- \"summary\": va au-dela du sujet general, et surtout NE SOFTEN PAS le sujet reel du morceau. Si le morceau parle de coups, de maltraitance, de violence familiale, de deuil, de prison: DIS-LE frontalement, ne le reformule pas en histoire de perseverance/resilience feel-good. Explique CE QUE l'artiste dit vraiment, le ton, l'angle qu'il prend — pas une lecture edulcoree qui evite le sujet dur pour una morale positive. Exemple MAUVAIS (edulcore): 'un hymne a la perseverance et la force de se relever'. Exemple BON (specifique): 'il raconte les coups et les chatiments corporels recus de ses parents pendant l'enfance, et retourne cette violence en question: pourquoi le parent a le droit de frapper sans expliquer'. Langage courant, comme a un pote, pas de critique musicale pretentieuse.\n- \"standout\": qu'est-ce qui distingue CE morceau des autres du meme artiste/album — une prise de risque, un sujet rarement aborde dans le rap, un choix de production, une collab notable, un moment de vulnerabilite rare. Si rien de special: la valeur JSON null, n'invente pas un truc pour remplir le champ.\n- \"philo\": UNIQUEMENT si un vrai parallele existe, JAMAIS force. Penseurs a mobiliser quand pertinent: les stoiciens Marc Aurele et Epictete (accepter ce qui ne depend pas de nous, la vertu face a l'adversite, l'amor fati), Nietzsche (morale du maitre vs morale de l'esclave, le ressentiment, 'ce qui ne tue pas rend plus fort', la volonte de puissance, le depassement de soi, la critique de la morale conventionnelle), Platon (apparence vs realite, la justice, les trois parties de l'ame — raison/coeur/desir), Aristote (l'eudaimonia comme but de la vie, la vertu comme juste milieu entre deux exces, la catharsis — l'art qui purge une emotion en la rejouant), Sartre (la liberte radicale, la responsabilite totale, la mauvaise foi, 'on choisit qui on devient'), Morgan Housel sur la psychologie de l'argent (le rapport a l'argent est une cicatrice psychologique, pas un calcul rationnel; la difference entre richesse visible/flex et richesse reelle). CES PENSEURS SONT LA COLLECTION PHYSIQUE DE L'UTILISATEUR — a prioriser a pertinence egale (il les a sous la main). Ca reste \"seulement si pertinent\": ne force JAMAIS l'un d'eux si un autre parallele colle clairement mieux, mais entre deux paralleles aussi pertinents l'un que l'autre, choisis celui de cette liste.\n\"ref\": la reference la PLUS PRECISE possible pour que l'utilisateur retrouve le passage LUI-MEME — oeuvre + chapitre/section/§ (ex: \"Genealogie de la morale, Premiere dissertation, §10\"). Prefere le §/chapitre/section (stable d'une edition a l'autre) a un numero de page (qui varie selon l'edition). EXACTE uniquement: ne mets un numero de section/§ precis QUE si tu es reellement sur qu'il est correct — si tu connais l'oeuvre mais pas le numero exact, cite juste l'oeuvre ou le chapitre general sans inventer de numero. Une reference precise mais fausse est pire qu'une reference vague.\n\"explication\": pas le concept en general — decris en 1 phrase ce que CE PASSAGE PRECIS dit ou argumente, pour que l'utilisateur sache a quoi s'attendre en l'ouvrant. Reste sur l'IDEE/L'ARGUMENT, jamais sur la formulation: N'ECRIS JAMAIS une phrase qui reprend ou imite la structure du texte original, meme courte, meme approximative — decrire precisement le contenu n'autorise pas a s'en rapprocher (la reference sert a ca, pas l'explication).\n1-2 phrases, direct et concret, comme un pote qui a lu de la philo mais qui parle pas comme un prof.\nExemple BON: {\"ref\":\"Par-dela bien et mal, §260\",\"explication\":\"Nietzsche y oppose deux facons d'evaluer ce qui est bien: celle du fort qui part de lui-meme, et celle du faible qui part de son ressentiment envers le fort.\"}\nExemple MAUVAIS (colle trop pres du texte original): 'On observe ici une reminiscence de la dialectique nietzscheenne du maitre et de l'esclave...'\nSi aucun parallele reel n'existe ou si tu dois forcer le lien: la valeur JSON null. Un parallele plaque qui sonne intello pour rien est pire que pas de parallele.\n- \"sonic_dna\": la signature sonore de CE morceau precis. \"mood\": l'ambiance emotionnelle en 2-3 mots concrets (pas \"sombre\" tout seul — precise, ex: \"paranoia feutree\", \"euphorie tendue\"). \"energy\": le niveau d'energie/intensite en 2-3 mots (ex: \"lourd et lent\", \"nerveux, uptempo\"). \"prod\": a QUOI ressemble la production reellement (instrumentation, texture rythmique) — pas le nom du producteur, deja dans le champ 'producer'. \"texture\": les elements sonores concrets qu'on entend (type de basse, samples, effets vocaux, field recordings...). \"similar\": 2-4 morceaux d'AUTRES artistes qui sonnent vraiment pareil (meme famille de prod, meme ambiance), format \"Artiste - Morceau\" — uniquement des comparaisons precises et reelles, pas des artistes au hasard du meme genre general. Pour chaque sous-champ ou tu ne peux pas etre precis: la valeur JSON null (pour 'similar': tableau vide). Ne remplis JAMAIS un sous-champ avec une generalite pour eviter le null.\n- CRUCIAL sur year: ne mets une annee QUE si une recherche web confirme explicitement la date de sortie. Si t'hesites entre plusieurs annees ou que tu approximes: la valeur JSON null. Ne choisis jamais 'la plus probable'.\n- REGLE DE FORMAT: quand un champ est incertain, mets la vraie valeur JSON null (sans guillemets), JAMAIS la chaine de caracteres \"null\" entre guillemets — ce sont deux choses differentes et la deuxieme s'affiche comme du texte casse dans l'app.\n- CRUCIAL: ne devine JAMAIS l'album/annee/prod. Si pas SUR a 100%, cherche sur le web, sinon mets null. Une info fausse est pire que pas d'info. Meme discipline pour 'role' et 'standout': mieux vaut null qu'une affirmation en l'air.";

var ALBUM_CONTEXT_SYSTEM = "Tu es un expert rap. On te donne un ALBUM et un ARTISTE. Donne le contexte de cet album.\n\nJSON UNIQUEMENT:\n{\"year\":null,\"label\":\"nom du label ou null\",\"producers\":[\"prod1\",\"prod2\"],\"themes\":[\"theme1\",\"theme2\",\"theme3\"],\"era\":\"description courte de l'epoque/mouvement\",\"backstory\":\"l'evenement personnel reel qui a mene a cet album, ou null\",\"importance\":\"1-2 phrases: pourquoi cet album compte dans la discographie ou le genre\",\"summary\":\"3-4 phrases: de quoi parle l'album, le fil rouge, l'ambiance\",\"influences\":\"sample vocal, voix non-musicale, penseur/auteur cite qui structure l'album, ou null\",\"backstory_album\":\"le titre EXACT de l'album auquel la source rattache l'evenement de backstory, ou null si backstory est null\"}\n\n=== REGLE D'ATTRIBUTION — LA PLUS VIOLEE, LIS-LA EN PREMIER ===\nUn fait peut etre parfaitement VRAI pour l'artiste et totalement FAUX pour CET album. C'est l'erreur la plus frequente et la plus difficile a reperer, parce que rien ne sonne invente: tu prends un evenement reel et documente de la vie de l'artiste (une hospitalisation, un deuil, une incarceration) et tu le rattaches au mauvais disque de sa discographie.\nTOUT ce que tu ecris doit concerner L'ALBUM DEMANDE, precisement lui, pas un autre projet du meme artiste, pas sa carriere en general.\nDANGER MAXIMUM quand l'artiste a un AUTRE album construit autour de cet evenement, ou dont le TITRE renvoie a cet evenement (le nom d'un medecin, d'un lieu, d'une periode): l'evenement appartient alors a CET autre album, pas a celui qu'on te demande. Ne transfere JAMAIS le contexte d'un album vers un autre parce que les deux sont du meme artiste ou de la meme periode.\nTEST OBLIGATOIRE avant d'ecrire \"backstory\": est-ce que je peux citer une source qui nomme EXPLICITEMENT l'album demande a cote de cet evenement ? Si la source relie l'evenement a l'artiste mais SANS nommer cet album precis, ou en nommant un AUTRE album: backstory=null. Un contexte perso pris sur le mauvais album est une ERREUR GRAVE, pas une approximation utile.\n\"backstory_album\": recopie le titre de l'album tel que la source le rattache a l'evenement. Si c'est bien l'album demande, remets son titre. Si c'est un autre album, mets le titre de CET autre album (et alors backstory doit etre null). Ne recopie pas mecaniquement l'album demande pour faire passer le controle.\nMEME REGLE pour \"influences\", \"themes\", \"summary\" et \"importance\": decris CE disque. Si tu ne connais pas assez cet album precis pour en parler sans le confondre avec un autre, mets null plutot qu'un contexte emprunte au voisin.\n\n=== REGLE LA PLUS IMPORTANTE, s'applique a CHAQUE champ factuel (year, label, producers, backstory) ===\nPour un champ factuel precis, tu as DEUX options: (1) tu as trouve l'info via une recherche web et tu es sur a 100%, tu la donnes telle quelle. (2) tu n'es pas sur, tu mets null (ou [] pour producers). IL N'Y A PAS DE TROISIEME OPTION. Ne remplis JAMAIS un champ avec une valeur plausible, approximative ou 'probablement correcte' — une annee approximative, un nom de label invente, une date arrondie sont TOUTES des ERREURS, pas des approximations acceptables. 3 champs a null valent mieux qu'1 champ faux.\n\"year\" EN PARTICULIER: c'est le champ le plus souvent devine au pif. Ne mets une annee QUE si ta recherche web a trouve une source qui la confirme explicitement (date de sortie, article, page de l'album). Si tu n'as trouve qu'une annee approximative ou que tu hesites entre plusieurs annees possibles, mets null — ne choisis PAS la plus probable, ne fais PAS de moyenne, n'utilise PAS l'annee de debut de carriere de l'artiste comme approximation.\n\nREGLES SPECIFIQUES:\n- themes: 3-5 mots CONCRETS. 'deuil du pere', 'sortir du quartier', 'flexer sur les haters'. JAMAIS 'introspection', 'alienation'.\n- era: situe dans le temps/mouvement. Ex: 'boom du drill FR 2022', 'golden era US East Coast', 'post-JMJD Despo Rutti'.\n- label: le VRAI nom du label/maison de disque QUE SI tu es sur a 100% (confirme par une source fiable). N'INVENTE JAMAIS un nom de label, projet ou collectif qui ressemble a un label. Si le moindre doute: null. Un label errone est pire qu'un champ vide.\n- \"backstory\" (IMPORTANT, ne pas oublier): l'evenement de vie REEL et PUBLIC qui explique pourquoi l'artiste a fait cet album — hospitalisation, deuil, rupture, incarceration, maladie, episode violent, separation d'un groupe, etc.\nCette info n'est a inclure QUE si l'artiste ou la presse en a deja parle PUBLIQUEMENT (interview, article) — dans ce cas c'est un fait deja assume publiquement par l'artiste lui-meme, tu n'as AUCUNE raison de l'edulcorer ou de rester vague par exces de precaution.\nMOTS/FORMULES INTERDITS (ils cachent le fait au lieu de le dire): 'des difficultes', 'des problemes', 'des deboires', 'une epreuve', 'une periode compliquee/difficile', 'des soucis', 'des blessures', 'ce qui l'a abime'.\nSi la source utilise un terme precis, REPRENDS-LE tel quel: hospitalisation psychiatrique, crise de paranoia/delire, tentative de suicide, overdose, garde a vue, incarceration, agression, etc.\nExemple MAUVAIS (trop vague): 'une peine sentimentale et des problemes psychiatriques l'ont plonge dans une depression'.\nExemple BON (precis et factuel): 'il a ete hospitalise en psychiatrie a plusieurs reprises suite a des crises de paranoia et de delire mystique, ce qu'il detaille lui-meme dans plusieurs interviews'.\n2-3 phrases factuelles, sans sensationalisme ni jugement moral — tu rapportes un fait deja public, pas un scandale. Cite la source si possible ('selon ses declarations a X', 'd'apres Y media').\nSi rien de tel n'est documente publiquement: null. Ne SPECULE JAMAIS au-dela de ce qui est confirme publiquement — la precision s'applique UNIQUEMENT a des faits deja sourcés, jamais a une hypothese.\n- importance: pourquoi ca compte. Parle NORMAL, pas comme un critique. Ex: 'Premier album solo apres la separation du groupe, il pose son identite.'\n- summary: raconte l'album comme a un pote. De quoi ca parle en vrai.\n- \"influences\": OBLIGATOIREMENT un NOM PROPRE precis (une personne reelle: auteur, penseur, predicateur, realisateur, autre artiste) dont la voix, les mots ou l'oeuvre apparaissent VRAIMENT sur le disque ou l'ont influence de facon documentee. Cherche activement sur le web \"qui est samplee/citee sur cet album\" — ne devine pas a partir du theme general.\nINTERDIT: reformuler le theme de l'album (\"la therapie\", \"l'examen de soi\", \"l'introspection\") comme si c'etait une 'influence' — ce n'est PAS ce qui est demande, c'est deja couvert par summary/backstory. Une influence = un NOM que tu peux citer, pas une description d'ambiance.\nSi tu ne peux pas nommer une personne precise et confirmee: la valeur JSON null. Ne remplis PAS ce champ avec une phrase generique juste pour eviter null.\nEcris QUI c'est et le THEME general de son propos (identite, ego, deuil, spiritualite, etc.) — mais ne cite JAMAIS le contenu exact de ce qu'il dit, ni une phrase de ses livres/discours.\nExemple BON: 'La voix d'Eckhart Tolle revient plusieurs fois sur le disque, notamment sur un interlude, ou il parle d'identite et de victimisation.'\nExemple FAUX (pas un nom, rejete): 'Les seances de therapie structurent l'album et Kendrick parle de son travail d'ecriture.' — ca c'est le theme general, pas une influence nommee.\n- producers: les principaux. Si pas sur, mets [].\n- CRUCIAL: ne devine RIEN. Si pas sur a 100%, utilise la recherche web. Mieux vaut null que faux.\n- TOUT en francais.";

var BEST_BARS_SYSTEM = "Tu es un amoureux de rap qui cherche les MOMENTS qui touchent. On te donne les paroles d'un ALBUM ENTIER. Extrais les meilleurs PASSAGES (4-8 barres consecutives).\n\nJSON UNIQUEMENT:\n{\"bars\":[{\"lines\":[{\"o\":\"ligne originale\",\"t\":\"traduction claire\"}],\"sens\":\"explication courte\",\"track\":\"nom du morceau\",\"why\":\"pourquoi ca touche\",\"type\":\"vecu\",\"impact\":8}]}\n\nFORMAT \"lines\":\nChaque ligne est un objet {\"o\":\"original\",\"t\":\"traduction\"}. Traduction CLAIRE. Si francais: t=null.\n\nCHAMP \"type\" (OBLIGATOIRE):\n- \"vecu\": experience personnelle, douleur, famille, rue\n- \"technique\": passage avec des multisyllabiques, rimes internes, ou flow technique dingue\n- \"punchline\": chute qui claque, image qui tue\n- \"storytelling\": narration, scene concrete\n\nCHAMP \"sens\" (1-2 phrases MAX):\nExplique le passage SIMPLEMENT. Comme a un pote. Dis QUI fait QUOI. Si y a des refs, explique-les.\nPas de pavé. 1-2 phrases precises > 4 phrases vagues.\n\nCHAMP \"why\" (1 phrase COURTE):\nParle comme un VRAI MEC. Interdit: 'puissance narrative', 'poignant', 'saisissant', 'evoquant', 'juxtaposition', 'resonance'.\n\nSELECTION:\n- 6 a 10 passages de 4-8 barres CONSECUTIVES par album.\n- VARIER les types: inclure au moins 1-2 passages TECHNIQUES (multis, schemas de rimes fous) si l'album en a.\n- Experiences universelles + prouesses techniques. Les deux comptent.\n- JAMAIS de punchlines isolees ou de barres non consecutives.\n- Trie par impact decroissant (impact 1-10).\n- TOUT en francais.";

var THEMATIC_SYSTEM = "L'utilisateur donne un THEME. Tu dois:\n1. DECOMPOSER ce theme en 3 a 5 ANGLES complementaires ou opposes\n2. Pour CHAQUE angle, chercher des passages pertinents dans les paroles fournies\n\nJSON UNIQUEMENT:\n{\n\"theme_complet\":\"reformulation enrichie du theme en 1 phrase\",\n\"angles\":[\n{\n\"name\":\"nom court de l'angle (ex: 'Porter un masque')\",\n\"description\":\"1 phrase qui explique cet angle du theme\",\n\"passages\":[{\"lines\":[{\"o\":\"ligne 1\",\"t\":\"trad 1\"},{\"o\":\"ligne 2\",\"t\":\"trad 2\"},{\"o\":\"ligne 3\",\"t\":\"trad 3\"},{\"o\":\"ligne 4\",\"t\":\"trad 4\"},{\"o\":\"ligne 5\",\"t\":\"trad 5\"},{\"o\":\"ligne 6\",\"t\":\"trad 6\"}],\"track\":\"morceau\",\"artist\":\"artiste\",\"album\":\"album\",\"link\":\"comment ca illustre cet angle, 1 phrase\",\"pertinence\":8}]\n}\n]\n}\n\nDECOMPOSITION DU THEME:\n- Trouve les FACES du concept: le pour/le contre, l'interieur/l'exterieur, celui qui agit/celui qui subit, la cause/la consequence.\n- Exemple pour 'assumer ses faiblesses': 'exposer ses vulnerabilites volontairement' / 'porter un masque pour cacher' / 'la vulnerabilite comme arme' / 'se faire exposer par quelqu'un' / 'la confession, l'aveu'\n- Exemple pour 'la trahison': 'se faire trahir par un proche' / 'trahir quelqu'un soi-meme' / 'le moment ou tu decouvres la trahison' / 'vivre apres la trahison' / 'la paranoia avant la preuve'\n- Les angles doivent etre CONCRETS et DIFFERENTS entre eux, pas des synonymes.\n\nPASSAGES:\n- MINIMUM 4, idealement 6-8 barres CONSECUTIVES du meme morceau pour chaque passage. JAMAIS 1-2 lignes isolees — un passage doit etre un BLOC qui a du sens seul.\n- Un passage qui MONTRE le theme a travers une scene > un passage qui le NOMME.\n- 1 a 3 passages par angle. Certains angles peuvent avoir 0 passages si rien de pertinent dans les paroles — c'est OK, garde l'angle quand meme (passages vide) pour que l'utilisateur voie qu'il existe.\n- Traduction ligne par ligne: {\"o\":\"original\",\"t\":\"traduction claire\"}. Si francais: t=null.\n- pertinence: 1-10.\n\nSTYLE:\n- Noms d'angles courts et percutants (3-5 mots).\n- \"link\": 1 phrase simple, comme a un pote.\n- TOUT en francais.";

var SUGGEST_SYSTEM = "On te donne un THEME et une liste d'albums que l'utilisateur a DEJA decodes. Suggere des morceaux de rap qu'il a PAS encore decodes mais qui seraient pertinents pour ce theme.\n\nJSON UNIQUEMENT:\n{\"suggestions\":[{\"artist\":\"artiste\",\"track\":\"titre du morceau\",\"album\":\"album\",\"why\":\"pourquoi ce morceau est pertinent pour le theme, 1 phrase\",\"pertinence\":8}]}\n\nREGLES:\n- 5 a 10 suggestions, triees par pertinence decroissante.\n- Ne suggere PAS de morceaux qui sont dans les albums deja decodes.\n- Privilegier des morceaux ou le theme est CENTRAL, pas juste mentionne en passant.\n- Melange des classiques et des morceaux moins connus mais pertinents.\n- Privilegier le rap US et FR underground/lyrical (Ka, billy woods, Earl, MIKE, Navy Blue, Mach-Hommy, Veust, Limsa, Infinit, Jeanjass, GAL, Alpha Wann, Dinos, Lomepal, Nekfeu, Vald, etc.) mais pas exclusivement.\n- \"why\": 1 phrase simple, en francais. Dis concretement de quoi parle le morceau par rapport au theme.\n- pertinence: 1-10. 10 = le morceau EST le theme.\n- TOUT en francais.";

// Utilise par decode() ET decodeTrackToCache() (disco en masse) — hoiste ici pour ne pas dupliquer
// ce texte entre les deux, meme si l'orchestration autour differe (UI live vs ecriture cache seule).
var LLM_FALLBACK_SYSTEM = "Tu es un traducteur rap. Utilise IMPERATIVEMENT web_search pour trouver les paroles EXACTES et VERIFIEES de ce morceau (site parolier fiable, genius, azlyrics...). N'ecris JAMAIS de paroles de memoire sans les avoir verifiees par la recherche.\n\nSi la recherche ne trouve PAS de source fiable et complete pour CE morceau precis: reponds {\"found\":false,\"lines\":[],\"notes\":[]}. N'invente RIEN pour combler les trous — mieux vaut ne rien trouver que d'inventer des paroles qui n'existent pas.\n\nFormat JSON si trouve:\n{\"found\":true,\"lang\":\"francais\",\"lines\":[{\"s\":\"[Couplet 1]\"},{\"o\":\"ligne originale\",\"t\":null,\"c\":80}],\"notes\":[{\"r\":\"mot\",\"e\":\"explication\",\"t\":\"slang\"}]}\n\nSi le morceau est en francais: t=null pour chaque ligne. Si anglophone: t=traduction francaise.";

var DISCOGRAPHY_SYSTEM = "Tu connais bien le rap. On te donne un nom d'artiste. Liste ses ALBUMS STUDIO uniquement — pas les singles isoles, pas les mixtapes sauf si l'artiste/l'industrie les considere comme un album a part entiere de sa discographie officielle, pas les compilations/greatest hits, pas les doublons (deluxe/edition speciale/re-issue d'un album deja liste — garde uniquement l'edition la plus complete de chaque album, une seule fois).\n\nJSON UNIQUEMENT:\n{\"albums\":[{\"titre\":\"nom exact de l'album\",\"annee\":2022}]}\n\nTrie par annee croissante (le plus ancien en premier).\nCRUCIAL: ne devine JAMAIS un album qui n'existe pas et ne mets pas d'annee approximative. Si tu n'es pas sur qu'un titre fait vraiment partie de sa discographie: ne le mets pas. Si tu ne connais pas bien cet artiste ou sa discographie: albums=[] plutot que d'inventer une liste plausible. Mieux vaut une liste incomplete ou vide qu'une liste fausse.\n\nTOUT en francais pour le JSON (mais garde les titres d'albums dans leur langue/orthographe originale, ne les traduis pas).";

var VIDEO_SCAN_SYSTEM = "Tu recois un BRIEF de video et une liste de lignes de rap DEJA ANALYSEES (chaque ligne a deja son sens, sa technique, ses couches, son arc, son miroir, son parallele philo, ses callbacks — deja verifies, tu n'as PAS a les re-analyser ni les re-ecrire).\n\nTON SEUL JOB: regrouper les lignes PERTINENTES pour ce brief par angle/theme. Tu ne choisis PAS les 'meilleures' lignes, tu ne les classes PAS par qualite, tu n'imposes AUCUN ordre narratif — tu regroupes tout ce qui est potentiellement pertinent, point. Le montage et l'ordre sont le travail de l'utilisateur, pas le tien.\n\nREGLE D'INCLUSION: sois MAXIMALEMENT inclusif. Si une ligne pourrait raisonnablement servir ce brief (meme indirectement, meme comme contre-exemple ou nuance), inclus-la. N'exclus une ligne QUE si elle n'a vraiment aucun rapport avec le brief. Ce n'est pas a toi de deviner ce que l'utilisateur va trouver 'le meilleur' — c'est son travail. Mieux vaut trop de matiere que pas assez: une ligne en trop, l'utilisateur la decoche en 1 clic. Une ligne manquante, il ne saura jamais qu'elle existait.\n\nReponds en JSON:\n{\n\"angles\":[\n{\n\"titre\":\"nom court de l'angle/theme (3-6 mots)\",\n\"lignes\":[{\"artist\":\"artiste EXACT tel que fourni\",\"track\":\"titre EXACT tel que fourni\",\"lineIdx\":12,\"pourquoi\":\"1 phrase: pourquoi cette ligne sert cet angle DE CE BRIEF precis\"}]\n}\n]\n}\n\n- \"artist\" et \"track\": copie EXACTEMENT (meme orthographe) un des morceaux fournis dans le message — n'improvise rien, ne traduis rien, ne corrige rien.\n- \"lineIdx\": EXACTEMENT le numero entre crochets [ligne N] associe a cette ligne dans le message — jamais invente, jamais approxime. Si tu n'es pas sur du numero exact: n'inclus PAS cette ligne plutot que de deviner.\n- \"pourquoi\": le lien avec CE brief precis, pas un resume de l'analyse deja fournie (qui sera affichee telle quelle a cote).\n- Une meme ligne peut apparaitre dans plusieurs angles si elle sert plusieurs facettes du brief.\n- 3 a 6 angles. Autant de lignes que necessaire par angle, PAS de maximum arbitraire.\n- Si AUCUNE ligne fournie ne sert vraiment le brief: angles=[]. N'invente pas un angle vide ou hors-sujet pour avoir l'air complet — mieux vaut peu d'angles pertinents que beaucoup de bruit.\n- N'ECRIS TOI-MEME NI sens, ni technique, ni analyse, ni traduction — ces champs existent deja pour chaque ligne et seront affiches automatiquement. Ton seul travail: regrouper par angle + expliquer le lien avec ce brief.\n\nTOUT en francais.";

// Etape 2 du Video Research (apres le scan): curation finale. Le scan etale tout sans trier ni
// choisir (voir VIDEO_SCAN_SYSTEM) — ici au contraire, l'IA identifie ce qui merite vraiment la video,
// pour que l'utilisateur n'ait pas a fouiller toute la matiere brute lui-meme.
var VIDEO_CURATE_SYSTEM = "Tu recois un BRIEF de video et une liste de lignes de rap DEJA ANALYSEES ET DEJA GROUPEES PAR ANGLE par un scan precedent (chaque ligne a son sens/technique/arc/mirror/philo/callbacks, deja verifies — tu n'as PAS a les re-analyser).\n\nTON JOB: la curation finale. Le scan precedent a etale toute la matiere potentiellement pertinente sans trier. C'est maintenant TOI qui identifies ce qui merite vraiment d'etre dans la video, pour que l'utilisateur n'ait pas a tout lire.\n\nReponds en JSON:\n{\n\"trouvailles\":[{\"artist\":\"...\",\"track\":\"...\",\"lineIdx\":12,\"pourquoi_fort\":\"1 phrase: qu'est-ce qui rend cette ligne/connexion remarquable\",\"lien_brief\":\"1 phrase: comment ca sert precisement CE brief\"}],\n\"essentielles\":[{\"artist\":\"...\",\"track\":\"...\",\"lineIdx\":12}]\n}\n\nREGLE DE TRI LA PLUS IMPORTANTE: trie par PERTINENCE AU BRIEF, jamais par impact/punchline en soi. Une ligne qui repond EXACTEMENT au sujet du brief passe AVANT une punchline plus percutante mais hors-sujet — meme si la punchline est plus \"forte\" au sens generique (plus quotable, plus violente, plus drole). Exemple: si le brief parle de therapie et qu'une ligne parle de briser un schema psychologique herite de la famille, elle passe AVANT une punchline de clash qui n'a rien a voir, meme si la punchline claque plus fort a l'oreille. Le brief est le FILTRE, la force de la ligne ne sert qu'a departager DEUX lignes deja pertinentes entre elles — jamais a repecher une ligne hors-sujet parce qu'elle est marquante.\n\nCHAMP \"trouvailles\": les 3 A 5 connexions les PLUS FORTES *parmi celles qui repondent vraiment au brief* — celles que l'utilisateur doit voir en premier. \"Forte\" = un arc qui montre une vraie evolution SUR LE SUJET DU BRIEF, un miroir qui retourne une accusation contre son auteur EN LIEN AVEC LE BRIEF, un callback qui boucle une idee entre deux morceaux SUR LE BRIEF, un parallele philo qui eclaire vraiment le propos DU BRIEF. Une ligne non pertinente au brief n'est JAMAIS une trouvaille, aussi marquante soit-elle en dehors de ce contexte. Si rien n'est vraiment fort ET pertinent dans la matiere fournie: mets-en moins de 5, voire aucune — n'en invente pas pour remplir le quota, et ne repeche pas une punchline hors-sujet pour combler.\n\nCHAMP \"essentielles\": les 10 A 15 lignes que l'utilisateur devrait garder pour sa video. INCLUS les trouvailles dedans (ce sont les meilleures, donc essentielles aussi), plus les autres lignes solides ET pertinentes au brief. Triees par PERTINENCE POUR LE BRIEF (pas par impact), PAS regroupees par morceau ni par angle. Sois VRAIMENT selectif: si tu en mets 15 qui se valent toutes vaguement, l'utilisateur n'est pas plus avance qu'avec la matiere brute — vise les meilleures sur le sujet demande, pas \"toutes celles qui pourraient marcher a la rigueur\" ni les plus quotables en general.\n\nREGLE: \"artist\", \"track\" et \"lineIdx\" doivent correspondre EXACTEMENT (meme orthographe, meme numero) a une ligne fournie dans le message — n'invente rien, ne modifie rien, ne devine pas un numero approximatif.\nSi la matiere fournie est globalement faible (rien de fort, rien qui se distingue vraiment): choisis quand meme ce qu'il y a de MOINS FAIBLE pour \"essentielles\" plutot que de forcer une fausse qualite dans \"trouvailles\" — mais ne mets jamais moins de 3 essentielles s'il y a au moins 3 lignes fournies.\n\nTOUT en francais.";

var ANALYSIS_SYSTEM = "Tu es un lecteur exigeant de rap lyrical. On te donne les paroles d'un morceau. Tu produis une analyse d'ECRITURE rigoureuse. DETECTE la langue et adapte tes references de gout et tes criteres.\n\nSI RAP ANGLOPHONE: profil RYM (gout: Ka, billy woods, MIKE, Earl, Navy Blue, Mach-Hommy, MF DOOM). Valorise l'understatement, la profondeur, le vecu, l'image qui hante autant que la technique.\n\nSI RAP FRANCAIS: profil amateur de technique et de plume (references: Veust, Limsa d'Aulnay, Infinit', Jeanjass, GAL, Alpha Wann, Nekfeu, Vald, Dinos, Lomepal cote technique). Valorise surtout: la PUNCHLINE (chute qui claque), le WORDPLAY (double sens, calembour, homophonie), les MULTISYLLABIQUES (rimes riches sur plusieurs syllabes), les RIMES INTERNES, l'image qui surprend. Le rap FR de ce niveau se juge d'abord sur la technique et la vanne. Reconnais l'argot et le verlan sans les traiter comme des fautes.\n\nJSON UNIQUEMENT:\n{\n\"score\": 74,\n\"score_breakdown\": {\"economie\": 8, \"imagery\": 7, \"rimes\": 6, \"subversion\": 5, \"profondeur\": 8},\n\"score_note\": \"1 phrase qui justifie la note\",\n\"essentiel\": [{\"o\":\"ligne exacte\",\"t\":\"trad si anglophone, sinon null\",\"why\":\"ce qui rend l'ecriture forte\",\"type\":\"craft\",\"impact\":9}],\n\"notable\": [{\"o\":\"ligne exacte\",\"t\":\"trad ou null\",\"why\":\"...\",\"type\":\"real\",\"impact\":6}],\n\"multis\": [{\"lines\":[\"ligne 1\",\"ligne 2\"],\"rhymed\":[\"syllabes qui riment ligne 1\",\"syllabes qui riment ligne 2\"],\"syllables\": 4, \"note\":\"pourquoi ce schema est fort\",\"impact\":8}]\n}\n\n=== SCORE (A) ===\nNote /100 la QUALITE D'ECRITURE (pas le plaisir d'ecoute, pas la prod). breakdown: 5 axes /10.\n- economie: densite, dire beaucoup en peu\n- imagery: force et originalite des images\n- rimes: complexite et musicalite des schemas (multis, rimes internes) — AXE CENTRAL pour le rap FR technique\n- subversion: capacite a surprendre, punchline inattendue, eviter les cliches\n- profondeur: doubles lectures, double sens, sens qui s'ouvre\nECHELLE (utilise toute la gamme, sois discriminant):\n- 90-100: chef-d'oeuvre d'ecriture\n- 80-89: tres grande ecriture, dense et maitrisee\n- 70-79: bonne ecriture solide, quelques vrais moments\n- 55-69: correct mais sans relief\n- sous 55: ecriture faible, cliches, rimes paresseuses\nUn bon son technique doit pouvoir atteindre 80+. Ne bloque pas tout dans le ventre mou 60-70. Sois discriminant.\n\n=== SELECTION PAR MORCEAU (C) ===\nOn analyse UN morceau en profondeur. Selectionne les lignes INSTAGRAMMABLES: celles qu'on peut poster hors contexte et qui frappent SEULES.\n- \"essentiel\": 2 a 4 lignes. Le cream absolu.\n- \"notable\": 3 a 6 lignes de qualite.\n\nTEST INSTAGRAM: si tu postes cette ligne sur Insta SANS dire de quel son c'est, est-ce que quelqu'un qui l'a jamais entendu va trouver ca fort? Si oui = bonne selection. Si la ligne a besoin du contexte du morceau pour etre impressionnante = NE LA METS PAS.\nEXEMPLE BON a selectionner: 'J'pete un plomb, l'seul noir proche qui me vengera c'est mon flingue' — le double sens frappe seul.\nEXEMPLE MAUVAIS a selectionner: 'Cinq policiers viennent me voir pour me dire: Monsieur vous avez eu raison' — c'est du storytelling, ca marche que dans le morceau. Hors contexte c'est rien.\n\n- Copie \"o\" EXACTEMENT. \"t\": traduction SI anglophone, null si francais.\n- \"why\": 1 phrase COURTE (15 mots max). Dis ce qui claque: le double sens? le wordplay? la chute?\n- types: \"craft\" / \"real\" / \"depth\" / \"subversion\"\n- \"impact\": note 1-10 la force de CETTE LIGNE PRECISE (pas le morceau entier). Ca sert a comparer des lignes de morceaux DIFFERENTS entre elles, donc sois HONNETE et discriminant: 9-10 = ligne qui marquerait meme dans un album d'un autre artiste, 7-8 = tres solide, 5-6 = correct. N'attribue pas 8+ a tout, la plupart des lignes sont 5-7.\n- Rap FR: punchlines et jeux de mots d'abord. Rap US: l'understatement compte autant.\n- INTERDIT: une ligne deja mise dans \"essentiel\" ne doit PAS reapparaitre dans \"notable\", et une ligne/paire de lignes deja utilisee dans \"multis\" ne doit PAS aussi etre copiee dans \"essentiel\" ou \"notable\". Chaque ligne du morceau n'apparait qu'UNE SEULE FOIS dans toute ta reponse, meme si elle merite plusieurs categories — choisis la categorie ou elle est la plus forte.\n\n=== MULTIS (A) ===\nRepere les 2-4 MEILLEURS schemas multisyllabiques: plusieurs syllabes consecutives qui riment entre les lignes. TRES important pour le rap FR technique.\n- \"lines\": lignes concernees (exactes, copiees mot pour mot)\n- \"rhymed\": pour CHAQUE ligne, la SOUS-CHAINE EXACTE qui porte la rime multi. Ce DOIT etre un extrait MOT POUR MOT de la ligne correspondante.\n\nREGLES STRICTES:\nMETHODE: ecris la TRANSCRIPTION PHONETIQUE des deux portions. Si les sons finaux ne matchent PAS, c'est PAS un multi. Dans le doute, NE METS PAS.\n\n1. Les 2+ dernieres syllabes des portions doivent sonner PAREIL. Pas 'similaire', PAREIL.\n2. INTERDIT: meme famille/racine ('soumis'/'soumission', 'sentiments'/'desensibilisation').\n3. INTERDIT: une ligne dans plus d'UN multi.\n4. Chaque \"rhymed\" = 2+ mots consecutifs, pas un mot seul.\n5. EXEMPLES FAUX (NE FAIS PAS CA):\n   'vers les interdits'/'dites-nous pourquoi' → -di/-kwa = RIME PAS\n   'fais manger'/'en argent' → -je/-an = RIME PAS\n   'etre blessant'/'respecte leur vie' → -an/-i = RIME PAS\n   'de nouveau'/'es possedee' → -vo/-de = RIME PAS\n6. EXEMPLES VRAIS:\n   'bouts d'chaines'/'propre budget' → -en/-e = sons proches, OK\n   'mon or'/'lion mort' → -on or/-on or = IDENTIQUE, OK\n   'en cavale'/'festival' → -val/-val = IDENTIQUE, OK\n- \"syllables\": nombre de syllabes qui riment\n- \"note\": pourquoi c'est technique/reussi\n- \"impact\": note 1-10 la force de CE schema precis, meme echelle que essentiel (9-10 rare, la plupart 5-7). Sert a comparer avec des lignes d'autres morceaux.\nSi pas de vrais multis, multis=[]. N'INVENTE PAS de fausses rimes. Mieux vaut 0 multi que 4 faux.\n\nQUALITE > QUANTITE partout.\n\nSTYLE: ecris tes explications (why, score_note, note) dans un francais NATUREL et fluide, comme un vrai passionne de rap qui parle. TOUJOURS en francais, MEME pour un morceau anglophone (seul le champ \"o\" garde la langue originale, et \"t\" la traduction). Phrases bien construites, pas de tournures bizarres.";

// Mode rapide: choix MANUEL et ponctuel d'envoyer les appels chez OpenRouter pour
// echapper aux 20 requetes/minute du tier gratuit Google. Volontairement pas un
// repli automatique sur 429 — pendant une disco en masse le quota gratuit est
// sature en continu, donc un repli automatique reviendrait a tout payer.
var TURBO = false;
function setTurbo(v) { TURBO = !!v; }

// Compteur de tokens cumules, pour chiffrer un album au lieu de l'estimer.
// On separe les tokens factures de ceux passes par le tier gratuit: seuls les
// premiers coutent quelque chose.
var TOKENS = { in: 0, out: 0, calls: 0, paidIn: 0, paidOut: 0 };
function tokensSnapshot() { return Object.assign({}, TOKENS); }
function tokensReset() { TOKENS = { in: 0, out: 0, calls: 0, paidIn: 0, paidOut: 0 }; }
// Tarif OpenRouter de google/gemini-2.5-flash, releve sur leur API.
function paidCostUsd(t) { return (t.paidIn / 1e6) * 0.30 + (t.paidOut / 1e6) * 2.50; }

async function callGemini(system, message, search, model, _retries) {
  if (search === undefined) search = false;
  if (_retries === undefined) _retries = 0;
  var payload = { system: system, message: message, search: search };
  if (TURBO) payload.viaOpenRouter = true;
  if (model) payload.model = model;
  var res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  var data = await res.json();
  // Rate limit: on attend le delai indique par Google et on reessaie tout seul
  if (data.rateLimited && _retries < 5) {
    // Le plafond etait a 45s alors que le tier gratuit demande couramment ~48s:
    // on attendait donc toujours un peu moins que necessaire, ce qui garantissait
    // un nouveau 429 a chaque tentative jusqu'a epuisement. On suit le delai
    // annonce par l'API, avec une marge, et un plafond assez haut pour le couvrir.
    var wait = Math.min((data.retryAfter || 20) + 3, 120);
    await new Promise(function(r) { setTimeout(r, wait * 1000); });
    return callGemini(system, message, search, model, _retries + 1);
  }
  if (data.error) throw new Error(data.error);
  if (data.usage) {
    TOKENS.in += data.usage.in || 0;
    TOKENS.out += data.usage.out || 0;
    TOKENS.calls += 1;
    if (data.provider === "openrouter") {
      TOKENS.paidIn += data.usage.in || 0;
      TOKENS.paidOut += data.usage.out || 0;
    }
  }
  var text = data.text || "";
  var m = text.match(/\{[\s\S]*\}/);
  // finishReason "length" = le modele a ete coupe par la limite de tokens avant la fin du JSON —
  // sans ce garde-fou, le regex ci-dessus matche quand meme jusqu'au dernier "}" complet trouve
  // (souvent une ligne au milieu de la chanson) et affiche une traduction tronquee sans avertir.
  if (data.finishReason === "length" && _retries < 1) {
    return callGemini(system, message, search, model, (_retries || 0) + 1);
  }
  if (!m || data.finishReason === "length") throw new Error("Reponse tronquee (chanson trop longue pour un seul appel).");
  var attachCitations = function(obj) {
    if (data.citations && data.citations.length) obj._citations = data.citations;
    // Le backend a du remplacer le modele de recherche web par Gemini : la reponse
    // vient de sa memoire, pas d'une recherche. A signaler, une tracklist inventee
    // ressemble trait pour trait a une vraie.
    if (data.substitution) obj._ungrounded = data.substitution.raison;
    return obj;
  };
  try {
    return attachCitations(JSON.parse(m[0]));
  } catch(jsonErr) {
    var fixed = m[0]
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x1f]/g, function(c) { return c === "\n" || c === "\r" || c === "\t" ? c : ""; });
    try { return attachCitations(JSON.parse(fixed)); } catch(e2) {}
    if (_retries < 2) return callGemini(system, message, search, model, (_retries || 0) + 1);
    throw jsonErr;
  }
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
  var _dsr = useState(false), deepScanRunning = _dsr[0], setDeepScanRunning = _dsr[1];
  var _dsp = useState({ done: 0, total: 0 }), deepScanProgress = _dsp[0], setDeepScanProgress = _dsp[1];
  var _p = useState(false), plLoading = _p[0], setPlLoading = _p[1];
  // Panneau actif dans le detail (null = vue morceau normale via `sel`, sinon un des 4 panneaux speciaux).
  // Remplace 4 booleans independants qu'il fallait reset a la main a chaque site d'appel.
  var _panel = useState(null), activePanel = _panel[0], setActivePanel = _panel[1];
  var _apl = useState(false), albumPlLoading = _apl[0], setAlbumPlLoading = _apl[1];
  // Avancement du best of album. Sans ca le panneau n'affiche qu'un spinner muet
  // pendant plusieurs minutes (12 morceaux x un appel chacun, ralentis par le 429
  // du tier gratuit) et on ne peut pas distinguer "ca avance" de "c'est plante".
  var _aplp = useState(null), albumPlProg = _aplp[0], setAlbumPlProg = _aplp[1];
  var _aplf = useState([]), albumPlFails = _aplf[0], setAlbumPlFails = _aplf[1];
  var _bb = useState(null), bestBars = _bb[0], setBestBars = _bb[1];
  var _bbl = useState(false), bestBarsLoading = _bbl[0], setBestBarsLoading = _bbl[1];
  var _tq = useState(""), thematicQuery = _tq[0], setThematicQuery = _tq[1];
  var _tr = useState(null), thematicResults = _tr[0], setThematicResults = _tr[1];
  var _tl = useState(false), thematicLoading = _tl[0], setThematicLoading = _tl[1];
  var _ts = useState([]), thematicSelected = _ts[0], setThematicSelected = _ts[1];
  var _tc = useState(""), thematicCopied = _tc[0], setThematicCopied = _tc[1];
  var _tsu = useState(null), thematicSuggestions = _tsu[0], setThematicSuggestions = _tsu[1];
  var _tsd = useState({}), suggestDecoding = _tsd[0], setSuggestDecoding = _tsd[1];
  var _vq = useState(""), videoBrief = _vq[0], setVideoBrief = _vq[1];
  var _vr = useState(null), videoResults = _vr[0], setVideoResults = _vr[1];
  var _vl = useState(false), videoLoading = _vl[0], setVideoLoading = _vl[1];
  var _vsel = useState({}), videoSelected = _vsel[0], setVideoSelected = _vsel[1];
  var _vord = useState([]), videoOrder = _vord[0], setVideoOrder = _vord[1];
  var _vsc = useState(false), videoSelCopied = _vsc[0], setVideoSelCopied = _vsc[1];
  var _vae = useState({}), videoAngleExpanded = _vae[0], setVideoAngleExpanded = _vae[1];
  var _vas = useState({}), videoAngleShowAll = _vas[0], setVideoAngleShowAll = _vas[1];
  var _vcu = useState(null), videoCuration = _vcu[0], setVideoCuration = _vcu[1];
  var _vcl = useState(false), videoCurating = _vcl[0], setVideoCurating = _vcl[1];
  var _vbe = useState(false), videoBruteExpanded = _vbe[0], setVideoBruteExpanded = _vbe[1];
  // Disco en masse
  // Vue "best of artiste" : pure lecture du cache local, aucun appel API.
  var _ba = useState(""), bestArtist = _ba[0], setBestArtist = _ba[1];
  var _bd = useState(null), bestData = _bd[0], setBestData = _bd[1];
  var _bt = useState("lignes"), bestTab = _bt[0], setBestTab = _bt[1];
  var _bc = useState(""), bestCopied = _bc[0], setBestCopied = _bc[1];

  // Tant que le cache IndexedDB n'est pas charge en memoire, toute lecture
  // repondrait "rien en cache" et declencherait des redecodages inutiles.
  var _bo = useState(false), booted = _bo[0], setBooted = _bo[1];

  var _da = useState(""), discoArtist = _da[0], setDiscoArtist = _da[1];
  var _dal = useState(false), discoAlbumsLoading = _dal[0], setDiscoAlbumsLoading = _dal[1];
  var _dab = useState(null), discoAlbums = _dab[0], setDiscoAlbums = _dab[1];
  var _dsel = useState({}), discoSelected = _dsel[0], setDiscoSelected = _dsel[1];
  // Sonar rate des projets peu references, et sa reponse varie d'un appel a l'autre :
  // l'ajout manuel est le seul moyen fiable de completer une discographie.
  var _dman = useState(""), discoManual = _dman[0], setDiscoManual = _dman[1];
  var _tb = useState(false), turbo = _tb[0], _setTurbo = _tb[1];
  var _tk = useState(null), tokenStats = _tk[0], setTokenStats = _tk[1];
  var _drun = useState(false), discoRunning = _drun[0], setDiscoRunning = _drun[1];
  var _dprog = useState(null), discoProgress = _dprog[0], setDiscoProgress = _dprog[1];
  var _dlog = useState([]), discoLog = _dlog[0], setDiscoLog = _dlog[1];
  var discoStopRef = useRef(false);
  var _qwarn = useState(""), quotaWarning = _qwarn[0], setQuotaWarning = _qwarn[1];
  var _ac = useState(null), albumCtx = _ac[0], setAlbumCtx = _ac[1];
  var _acl = useState(false), albumCtxLoading = _acl[0], setAlbumCtxLoading = _acl[1];
  var stopRef = useRef(false);
  var dRef = useRef({});
  var videoDragRef = useRef(null);
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

  // Au chargement: hydrate le cache depuis IndexedDB AVANT de restaurer la session.
  // Sans cette attente, sessionLoad et hydrate liraient une memoire encore vide et
  // l'app croirait n'avoir aucun morceau en cache — donc les redecoderait tous.
  useEffect(function() {
    var cancelled = false;
    hydrateStore().then(function() {
      if (cancelled) return;
      setBooted(true);
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
    });
    return function() { cancelled = true; };
  }, []);

  // Sauvegarde la session courante
  useEffect(function() {
    if (view === "list" && tracks.length) {
      sessionSave({ mode: mode, artist: artist, album: album, single: single, tracks: tracks });
    }
  }, [view, tracks, artist, album, single, mode]);

  // localStorage plein: cacheSet le detecte et previent via un event DOM (voir plus haut) au lieu
  // d'avaler l'echec en silence — surtout utile pendant la disco en masse qui ecrit beaucoup.
  useEffect(function() {
    var handler = function() {
      setQuotaWarning("Stockage local plein — certaines analyses ne sont plus sauvegardees. Libere de la place (vide le cache d'anciens artistes dans les reglages du navigateur) pour ne pas perdre les prochaines.");
      // Continuer la disco en masse une fois le quota depasse ferait payer des appels API pour des
      // analyses qui ne se sauvegarderont plus — on arrete la file plutot que de gaspiller en silence.
      // (Ecrit sur le ref directement: cet effet ne se re-abonne jamais, discoRunning y serait fige.)
      discoStopRef.current = true;
    };
    window.addEventListener("rdc-quota-exceeded", handler);
    return function() { window.removeEventListener("rdc-quota-exceeded", handler); };
  }, []);

  // On passe la VRAIE tracklist au modele: c'est la seule chose que l'app connaisse
  // de facon certaine sur ce disque, et c'est ce qui l'empeche de decrire un autre
  // album de l'artiste a la place (il peut confondre deux titres, pas deux tracklists).
  var fetchAlbumContext = function(art, alb, trackList) {
    setAlbumCtxLoading(true);
    var tl = (trackList && trackList.length)
      ? "\n\nVOICI LA TRACKLIST REELLE ET VERIFIEE DE CET ALBUM (" + trackList.length + " titres):\n" +
        trackList.map(function(t, i) { return (i + 1) + ". " + t; }).join("\n") +
        "\n\nC'est ta source de verite sur l'identite du disque. AVANT d'ecrire quoi que ce soit, verifie que l'album auquel tu penses est bien celui-la. Si ce que tu crois savoir concerne un disque dont la tracklist ne ressemble pas a celle-ci, c'est que tu confonds avec un autre projet de " + art + ": mets alors backstory=null et reste sur ce que ces titres te montrent reellement."
      : "";
    callGemini(ALBUM_CONTEXT_SYSTEM, "Album: \"" + alb + "\" par " + art + "." + tl + "\n\nCherche activement les interviews ou articles ou " + art + " parle de sa vie personnelle, de sa sante, ou des evenements precis qui l'ont mene a faire cet album. Si tu trouves ce genre d'info, sois FACTUEL ET PRECIS dans le champ backstory — ne la resume pas en formule vague.\n\nATTENTION: ne retiens un evenement QUE si la source le rattache explicitement a l'album \"" + alb + "\". Si elle le rattache a un AUTRE projet de " + art + " (meme si c'est le meme artiste et la meme periode), mets backstory=null et indique le vrai album dans backstory_album.", false, "perplexity/sonar")
      .then(function(ctx) { setAlbumCtx(ctx); })
      .catch(function() {})
      .finally(function() { setAlbumCtxLoading(false); });
  };

  var go = async function() {
    if (mode === "album") {
      if (!album.trim() || !artist.trim()) return;
      var tlCached = tlGet(artist, album);
      if (tlCached && tlCached.length) {
        setTracks(tlCached); hydrate(artist, tlCached); setSel(null); setView("list");
        if (!albumCtx) fetchAlbumContext(artist, album, tlCached);
        return;
      }
      setView("loading"); setErr("");
      try {
        var r = await callGemini(TRACKLIST_SYSTEM, album + " - " + artist, false, "perplexity/sonar");
        if (r.tracks && r.tracks.length) {
          tlSet(artist, album, r.tracks);
          setTracks(r.tracks); hydrate(artist, r.tracks); setSel(null); setView("list");
          fetchAlbumContext(artist, album, r.tracks);
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
    var albumCtxStr = mode === "single" ? "" : " (album: " + album + ")";
    callGemini(CONTEXT_SYSTEM, "Morceau: \"" + name + "\" par " + artist + albumCtxStr, true)
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

  // Version cache-seule de fetchContext, parametree (artist/name explicites) pour la disco en
  // masse — ne touche jamais dRef/data, qui reflete le morceau actuellement affiche a l'ecran.
  var fetchContextToCache = async function(artist, name, albumParam) {
    try {
      var albumCtxStr = albumParam ? " (album: " + albumParam + ")" : "";
      var ctx = await callGemini(CONTEXT_SYSTEM, "Morceau: \"" + name + "\" par " + artist + albumCtxStr, true);
      var cached = cacheGet(artist, name);
      if (!cached || !cached.d) return;
      cacheSet(artist, name, { d: Object.assign({}, cached.d, { context: ctx }) });
    } catch (e) {}
  };

  // Version cache-seule de decode(), parametree, pour la disco en masse. Meme logique
  // (traduction directe si les paroles sont trouvees, sinon fallback recherche web),
  // mais n'ecrit jamais dans dRef/data ni ne touche sel/artist/mode/album.
  var decodeTrackToCache = async function(artist, name, albumParam) {
    var cached = cacheGet(artist, name);
    if (cached && cached.d && cached.d.lines && cached.d.lines.length) return { ok: true, skipped: true };
    try {
      var genius = await fetchLyrics(name, artist, albumParam || "");
      var decoded = false, r = null, transErr = null, fallbackErr = null;
      if (genius.found) {
        try {
          var prompt = "Voici les paroles EXACTES de \"" + name + "\" par " + artist + " (source: lrclib).\nCopie chaque ligne originale mot pour mot dans le champ \"o\". Ne modifie rien.\n\nPAROLES:\n\n" + genius.lyrics;
          r = await translateWithCheck(prompt, genius.lyrics);
          r.found = true;
          r._source = genius.source;
          r._geniusId = genius.geniusId || null;
          decoded = !!(r.lines && r.lines.length);
        } catch (e2) { transErr = e2 && e2.message ? e2.message : String(e2); }
      }
      // Meme regle que dans decode(): pas de reconstruction LLM quand une source a
      // deja rendu les vraies paroles — on prefere signaler l'echec de traduction.
      if (!decoded && !(genius.found && genius.lyrics)) {
        try {
          var r2 = await callGemini(LLM_FALLBACK_SYSTEM, "Trouve et traduis les paroles de \"" + name + "\" par " + artist + ".", false, "perplexity/sonar");
          if (r2.found && r2.lines && r2.lines.length > 3) { r = r2; r._source = "llm-recall"; decoded = true; }
        } catch (e3) { fallbackErr = e3 && e3.message ? e3.message : String(e3); }
      }
      if (!decoded || !r) {
        // Ces erreurs etaient avalees par des catch vides, si bien qu'un echec de
        // TRADUCTION (limite de debit en tete) etait rapporte comme des "paroles
        // introuvables". Le diagnostic partait alors sur la mauvaise piste alors
        // que les paroles avaient bel et bien ete recuperees.
        if (genius.found) {
          return { ok: false, error: "paroles OK (" + (genius.lyrics || "").length + " car.) mais traduction echouee : " + (transErr || fallbackErr || "raison inconnue") };
        }
        return { ok: false, error: "paroles introuvables" + (fallbackErr ? " (repli: " + fallbackErr + ")" : "") };
      }
      cacheSet(artist, name, { d: r });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  // Disco en masse: liste des albums studio d'un artiste (recherche web, jamais invente).
  var fetchDiscography = async function(artistName) {
    try {
      var r = await callGemini(DISCOGRAPHY_SYSTEM, artistName, false, "perplexity/sonar");
      return (r && r.albums) || [];
    } catch (e) {
      return [];
    }
  };

  var stopDiscoQueue = function() { discoStopRef.current = true; };

  var fetchDiscoAlbums = async function() {
    if (!discoArtist.trim()) return;
    setDiscoAlbumsLoading(true);
    var albums = await fetchDiscography(discoArtist.trim());
    setDiscoAlbumsLoading(false);
    setDiscoAlbums(albums);
    var sel = {};
    albums.forEach(function(a) { sel[a.titre] = true; });
    setDiscoSelected(sel);
  };

  var toggleDiscoAlbum = function(titre) {
    setDiscoSelected(function(p) { var n = Object.assign({}, p); n[titre] = !n[titre]; return n; });
  };

  // Ajout manuel d'un projet manquant. Coche d'office: si l'utilisateur prend la
  // peine de le taper, c'est qu'il le veut dans la file.
  var addDiscoAlbum = function() {
    var t = discoManual.trim();
    if (!t) return;
    var existing = discoAlbums || [];
    if (!existing.some(function(a) { return norm(a.titre) === norm(t); })) {
      setDiscoAlbums(existing.concat([{ titre: t, annee: null, manual: true }]));
    }
    setDiscoSelected(function(p) { var n = Object.assign({}, p); n[t] = true; return n; });
    setDiscoManual("");
  };

  var resetDisco = function() {
    setDiscoAlbums(null); setDiscoSelected({}); setDiscoProgress(null); setDiscoLog([]); setDiscoRunning(false);
    setDiscoManual("");
  };

  // Disco en masse: pour chaque album coche, recupere sa tracklist puis decode + "analyser tout"
  // chaque morceau, un par un. Un morceau/lot qui echoue est journalise et saute — jamais fatal
  // pour le reste de la file. Les morceaux deja decodes+analyses sont deja sautes par
  // decodeTrackToCache/analyzeTrackAllLinesToCache elles-memes (rien a refaire ici).
  var runDiscoQueue = async function() {
    var albums = (discoAlbums || []).filter(function(a) { return discoSelected[a.titre]; });
    if (!albums.length) return;
    discoStopRef.current = false;
    setDiscoRunning(true);
    setDiscoLog([]);
    setDiscoProgress({ albumIdx: 0, albumTotal: albums.length, albumName: "", songIdx: 0, songTotal: 0, songName: "", lineDone: 0, lineTotal: 0 });

    var addLog = function(msg) { setDiscoLog(function(p) { return p.concat([msg]); }); };

    for (var ai = 0; ai < albums.length; ai++) {
      if (discoStopRef.current) break;
      var alb = albums[ai];
      setDiscoProgress(function(p) { return Object.assign({}, p, { albumIdx: ai + 1, albumName: alb.titre, songIdx: 0, songTotal: 0, songName: "", lineDone: 0, lineTotal: 0 }); });

      var tracks = tlGet(discoArtist, alb.titre);
      if (!tracks || !tracks.length) {
        try {
          var tr = await callGemini(TRACKLIST_SYSTEM, alb.titre + " - " + discoArtist, false, "perplexity/sonar");
          tracks = (tr && tr.tracks) || [];
          if (tracks.length) tlSet(discoArtist, alb.titre, tracks);
        } catch (e) { tracks = []; }
      }
      if (!tracks.length) { addLog("⚠ " + alb.titre + " : tracklist introuvable, album saute"); continue; }

      setDiscoProgress(function(p) { return Object.assign({}, p, { songTotal: tracks.length }); });

      for (var ti = 0; ti < tracks.length; ti++) {
        if (discoStopRef.current) break;
        var track = tracks[ti];
        setDiscoProgress(function(p) { return Object.assign({}, p, { songIdx: ti + 1, songName: track, lineDone: 0, lineTotal: 0 }); });

        var dres = await decodeTrackToCache(discoArtist, track, alb.titre);
        if (!dres.ok) { addLog("⚠ " + alb.titre + " — " + track + " : " + (dres.error || "echec")); continue; }
        if (!dres.skipped) { await fetchContextToCache(discoArtist, track, alb.titre); }
        // L'analyse profonde ligne par ligne n'est PAS lancee ici. Par lots de 5 et en
        // sequentiel, elle representait a elle seule ~85% des appels: un morceau de 80
        // lignes coutait 16 appels d'analyse pour 3 de decodage, soit ~800 appels pour
        // une discographie de trois albums. Elle reste disponible a la demande sur un
        // morceau precis, la ou on la lit vraiment.
        setTokenStats(tokensSnapshot());
      }
    }
    setDiscoRunning(false);
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

  var decode = useCallback(async function(name, autoMode, force) {
    if (dRef.current[name] && dRef.current[name].st === "ok" && !force) {
      if (!autoMode) { setSel(name); prefetchNext(name); }
      return;
    }
    var up = function(v) {
      var next = Object.assign({}, dRef.current);
      next[name] = v;
      dRef.current = next;
      setData(Object.assign({}, dRef.current));
    };
    // Relance forcee (ex: resultat "reconstruction IA" suspect): on jette le cache local
    // au lieu de rejouer le meme resultat fige, potentiellement invente.
    if (force) cacheClear(artist, name);
    // Cache local: si deja decode (meme dans une autre session) -> instantane, pas d'appel API
    var cached = force ? null : cacheGet(artist, name);
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

      var decoded = false, transErr = null, fallbackErr = null;
      // Echec terminal: on ne confond plus "aucune source n'a les paroles" avec
      // "les paroles sont la mais la traduction a casse". Dans le second cas on
      // affiche le texte original brut plutot que de le perdre, et on dit pourquoi.
      var giveUp = function() {
        if (genius.found && genius.lyrics) {
          up({ st: "ok", d: {
            found: true,
            lang: "inconnu",
            lines: rawLyricsToLines(genius.lyrics),
            notes: [],
            _source: genius.source || null,
            _untranslated: { reason: transErr || fallbackErr || "raison inconnue", chars: genius.lyrics.length },
          } });
        } else {
          up({ st: "ok", d: { found: false, lines: [], notes: [], _source: genius.source || null } });
        }
        setDone(function(p) { return p + 1; });
      };
      if (genius.found) {
        try {
          var prompt = "Voici les paroles EXACTES de \"" + name + "\" par " + artist + " (source: lrclib).\nCopie chaque ligne originale mot pour mot dans le champ \"o\". Ne modifie rien.\n\nPAROLES:\n\n" + genius.lyrics;
          var r = await translateWithCheck(prompt, genius.lyrics);
          r.found = true;
          r._source = genius.source;
          r._geniusId = genius.geniusId || null;
          up({ st: "ok", d: r }); setDone(function(p) { return p + 1; });
          if (r.lines && r.lines.length) {
            cacheSet(artist, name, { d: r });
            // Mode Single: sans tracklist, getCachedAlbums() (donc Video Research) ne decouvre jamais
            // ce morceau, meme si son cache est bien present et lisible directement par cle.
            if (mode === "single") tlSet(artist, name, [name]);
          }
          fetchContext(name);
          decoded = true;
        } catch(e2) { transErr = e2 && e2.message ? e2.message : String(e2); }
      }
      // Le repli LLM reconstruit les paroles de memoire: il tronque et rend parfois
      // la traduction a la place du texte original. Il ne doit servir QUE si aucune
      // source n'a rendu de paroles — sinon on remplace du texte authentique par une
      // reconstruction plus courte, ce qui est toujours perdant.
      if (!decoded && genius.found && genius.lyrics) {
        giveUp();
      } else if (!decoded) {
        try {
          var r2 = await callGemini(LLM_FALLBACK_SYSTEM, "Trouve et traduis les paroles de \"" + name + "\" par " + artist + ".", false, "perplexity/sonar");
          if (r2.found && r2.lines && r2.lines.length > 3) {
            r2._source = "llm-recall";
            up({ st: "ok", d: r2 }); setDone(function(p) { return p + 1; });
            cacheSet(artist, name, { d: r2 });
            if (mode === "single") tlSet(artist, name, [name]);
            fetchContext(name);
          } else {
            fallbackErr = fallbackErr || "le repli n'a rien rendu d'exploitable";
            giveUp();
          }
        } catch(e3) {
          fallbackErr = e3 && e3.message ? e3.message : String(e3);
          giveUp();
        }
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
    setActivePanel(null);
    setBestBars(null);
    setAlbumCtx(null); setAlbumCtxLoading(false);
    setThematicResults(null); setThematicSuggestions(null); setSuggestDecoding({});
    setVideoResults(null); setVideoSelected({}); setVideoOrder([]);
    sessionClear();
  };

  var analyzeLine = async function(lineIdx, line) {
    setFocusLine({ idx: lineIdx, line: line });
    setFocusData(null);
    setFocusLoading(true);
    try {
      // Analyse deja en cache pour cette ligne precise -> instantane, pas de nouvel appel API.
      // Garde le resultat stable au fil des reclics au lieu de le regenerer (et potentiellement varier) a chaque fois.
      var cachedAnalysis = data[sel] && data[sel].d && data[sel].d.lineAnalyses && data[sel].d.lineAnalyses[lineIdx];
      if (cachedAnalysis) {
        setFocusData(cachedAnalysis);
        setFocusLoading(false);
        return;
      }
      var curLines = (data[sel] && data[sel].d && data[sel].d.lines) || [];
      var contextLines = [];
      for (var i = Math.max(0, lineIdx - 3); i < Math.min(curLines.length, lineIdx + 4); i++) {
        if (curLines[i].o) contextLines.push(curLines[i].o);
      }
      var albumCtxStr = mode === "single" ? "" : " (album: " + album + ")";
      var geniusId = data[sel] && data[sel].d && data[sel].d._geniusId;
      var annotationsBlock = "";
      var matchedAnnotations = [];
      if (geniusId) {
        try {
          var annRes = await fetch("/api/annotations?songId=" + encodeURIComponent(geniusId));
          var annData = await annRes.json();
          // Ne garde que les annotations dont le passage cite chevauche reellement la ligne (ou une ligne proche)
          // analysee — sinon le LLM a tendance a citer "d'apres une annotation Genius" pour habiller sa propre
          // interpretation d'une fausse source, meme quand aucune annotation ne parle vraiment de cette ligne.
          matchedAnnotations = (annData.annotations || []).filter(function(a) {
            return contextLines.some(function(cl) { return fragmentMatchesLine(a.fragment, cl); });
          });
          if (matchedAnnotations.length) {
            annotationsBlock = "\n\nANNOTATIONS GENIUS REELLES CORRESPONDANT A CETTE LIGNE (ecrites par la communaute, deja verifiees comme pertinentes pour la ligne analysee):\n" +
              matchedAnnotations.map(function(a) { return "- passage annote: \"" + a.fragment + "\"\n  explication: " + a.annotation; }).join("\n");
          } else {
            annotationsBlock = "\n\nAucune annotation Genius ne correspond a cette ligne precise. N'ecris JAMAIS \"d'apres une annotation Genius\" ou equivalent — analyse uniquement par toi-meme.";
          }
        } catch (e) {}
      }
      var prompt = "ARTISTE: " + artist + "\nMORCEAU: \"" + sel + "\"" + albumCtxStr + "\n\nLignes autour:\n" + contextLines.join("\n") + "\n\nLIGNE A ANALYSER: " + line.o + "\nTraduction: " + (line.t || line.o) + "\n\nCherche les callbacks vers d'autres morceaux/albums de " + artist + ". Compare les mots, images et themes avec sa discographie." + annotationsBlock;
      // Utilise search pour verifier les callbacks discographiques
      var r = await callGemini(DEEP_ANALYSIS_SYSTEM, prompt, true);
      if (!matchedAnnotations.length) r = stripFakeGeniusCitation(r);
      if (r.couches && r.couches.length > 2) r.couches = r.couches.slice(0, 2);
      // Persiste l'analyse a cote des paroles (cache local + etat en memoire), au lieu de la
      // regenerer perdue a chaque clic — au fil du temps les morceaux explores accumulent des
      // analyses riches (arc/mirror/callbacks/philo) qui deviennent relisibles/interrogeables.
      var entry = dRef.current[sel];
      if (entry && entry.st === "ok" && entry.d) {
        var existingAnalyses = entry.d.lineAnalyses || {};
        var nextAnalyses = Object.assign({}, existingAnalyses);
        // La ligne originale/traduction ne fait PAS partie du JSON que le modele renvoie (voir
        // DEEP_ANALYSIS_SYSTEM) — on la rattache nous-memes depuis `line`, sinon les lectures qui
        // dependent uniquement du cache (Video Research) n'ont jamais le texte de la ligne.
        nextAnalyses[lineIdx] = Object.assign({}, r, { o: line.o, t: line.t });
        var mergedD = Object.assign({}, entry.d, { lineAnalyses: nextAnalyses });
        var nextData = Object.assign({}, dRef.current);
        nextData[sel] = { st: "ok", d: mergedD };
        dRef.current = nextData;
        setData(Object.assign({}, dRef.current));
        cacheSet(artist, sel, { d: mergedD });
      }
      setFocusData(r);
    } catch (e) {
      setFocusData({ error: e.message });
    }
    setFocusLoading(false);
  };

  var ANALYSIS_BATCH_SIZE = 5;

  // "Analyser tout": lance DEEP_ANALYSIS sur toutes les lignes pas encore en cache, par lots de
  // ANALYSIS_BATCH_SIZE (au lieu d'un appel par ligne) pour limiter le nombre d'appels API.
  // Version parametree (artist/name/album explicites + callback de progres) de l'analyse par lots —
  // utilisee par le bouton "analyser tout" (wrapper ci-dessous) ET par la disco en masse. Ecrit
  // toujours dans le cache; ne touche dRef/data QUE si ce morceau est celui actuellement affiche,
  // pour garder l'UI live synchronisee sans interferer avec un autre morceau en cours de traitement.
  var analyzeTrackAllLinesToCache = async function(artist, name, albumParam, onProgress) {
    var entry = cacheGet(artist, name);
    if (!entry || !entry.d || !entry.d.lines) return { done: 0, total: 0 };
    var curLines = entry.d.lines;
    var existingAnalyses = entry.d.lineAnalyses || {};

    var lineEntries = [];
    curLines.forEach(function(l, idx) { if (l.o) lineEntries.push({ idx: idx, o: l.o, t: l.t }); });

    var chunks = [];
    for (var ci = 0; ci < lineEntries.length; ci += ANALYSIS_BATCH_SIZE) {
      var windowEntries = lineEntries.slice(ci, ci + ANALYSIS_BATCH_SIZE);
      var targets = windowEntries.filter(function(e) { return !existingAnalyses[e.idx]; });
      if (targets.length) chunks.push(targets);
    }
    if (!chunks.length) return { done: 0, total: 0 };

    var totalTargets = chunks.reduce(function(s, c) { return s + c.length; }, 0);
    var doneCount = 0;
    if (onProgress) onProgress(0, totalTargets);

    var geniusId = entry.d._geniusId;
    var allAnnotations = [];
    if (geniusId) {
      try {
        var annRes = await fetch("/api/annotations?songId=" + encodeURIComponent(geniusId));
        var annData = await annRes.json();
        allAnnotations = annData.annotations || [];
      } catch (e) {}
    }

    var albumCtxStr = albumParam ? " (album: " + albumParam + ")" : "";

    var processChunk = async function(targets) {
      var firstIdx = targets[0].idx, lastIdx = targets[targets.length - 1].idx;
      var ctxStart = Math.max(0, firstIdx - 3);
      var ctxEnd = Math.min(curLines.length - 1, lastIdx + 3);
      var contextBlock = "";
      for (var cci = ctxStart; cci <= ctxEnd; cci++) {
        if (curLines[cci].o) contextBlock += cci + ": " + curLines[cci].o + "\n";
      }
      var targetsBlock = targets.map(function(e) {
        return "[ligne " + e.idx + "] " + e.o + (e.t ? "\nTraduction: " + e.t : "");
      }).join("\n\n");

      var matchedByIdx = {};
      var annotationsBlock = "";
      targets.forEach(function(e) {
        var matches = allAnnotations.filter(function(a) { return fragmentMatchesLine(a.fragment, e.o); });
        if (matches.length) {
          matchedByIdx[e.idx] = true;
          annotationsBlock += "\n[ligne " + e.idx + "] annotation(s) Genius reelle(s):\n" +
            matches.map(function(a) { return "- passage annote: \"" + a.fragment + "\"\n  explication: " + a.annotation; }).join("\n");
        }
      });
      annotationsBlock = annotationsBlock
        ? "\n\nANNOTATIONS GENIUS REELLES (par ligne):" + annotationsBlock
        : "\n\nAucune annotation Genius ne correspond a aucune de ces lignes. N'ecris JAMAIS \"d'apres une annotation Genius\" ou equivalent.";

      var prompt = "ARTISTE: " + artist + "\nMORCEAU: \"" + name + "\"" + albumCtxStr +
        "\n\nCONTEXTE (ne pas analyser, juste pour suivre le fil):\n" + contextBlock +
        "\n\nLIGNES A ANALYSER:\n" + targetsBlock +
        "\n\nCherche les callbacks vers d'autres morceaux/albums de " + artist + "." + annotationsBlock;

      try {
        var res = await callGemini(DEEP_ANALYSIS_BATCH_SYSTEM, prompt, true);
        var targetByIdx = {};
        targets.forEach(function(e) { targetByIdx[e.idx] = e; });
        var byIdx = {};
        (res.analyses || []).forEach(function(a) {
          if (typeof a.lineIdx !== "number") return;
          var clean = matchedByIdx[a.lineIdx] ? a : stripFakeGeniusCitation(a);
          if (clean.couches && clean.couches.length > 2) clean.couches = clean.couches.slice(0, 2);
          // Meme raison que analyzeLine: le modele ne renvoie pas la ligne elle-meme, on la rattache
          // depuis `targets` (deja connue) plutot que de lui faire re-ecrire un texte qu'il pourrait alterer.
          var src = targetByIdx[a.lineIdx];
          byIdx[a.lineIdx] = src ? Object.assign({}, clean, { o: src.o, t: src.t }) : clean;
        });
        // Persiste ce lot tout de suite: le progres n'est jamais perdu si un lot suivant echoue.
        var curEntry = cacheGet(artist, name);
        if (curEntry && curEntry.d) {
          var nextAnalyses = Object.assign({}, curEntry.d.lineAnalyses || {}, byIdx);
          var mergedD = Object.assign({}, curEntry.d, { lineAnalyses: nextAnalyses });
          cacheSet(artist, name, { d: mergedD });
          if (dRef.current[name] && dRef.current[name].st === "ok") {
            var nextData = Object.assign({}, dRef.current);
            nextData[name] = { st: "ok", d: mergedD };
            dRef.current = nextData;
            setData(Object.assign({}, dRef.current));
          }
        }
      } catch (e) {}
      doneCount += targets.length;
      if (onProgress) onProgress(doneCount, totalTargets);
    };

    var i = 0;
    while (i < chunks.length) {
      var batch = [];
      for (var j = 0; j < 3 && i + j < chunks.length; j++) batch.push(processChunk(chunks[i + j]));
      await Promise.all(batch);
      i += 3;
    }
    return { done: doneCount, total: totalTargets };
  };

  // Bouton "analyser tout" sur le morceau actuellement affiche — fine couche au-dessus de la
  // version parametree, juste pour brancher l'etat d'UI live (spinner/progres/disabled du bouton).
  var analyzeAllLines = async function() {
    if (!sel) return;
    var albumParam = mode === "single" ? "" : album;
    setDeepScanRunning(true);
    setDeepScanProgress({ done: 0, total: 0 });
    await analyzeTrackAllLinesToCache(artist, sel, albumParam, function(done, total) {
      setDeepScanProgress({ done: done, total: total });
    });
    setDeepScanRunning(false);
  };

  // Parcourt le cache (memoire, alimentee par IndexedDB) pour trouver tous les albums decodes
  var getCachedAlbums = function() {
    var albums = [];
    var covered = {};
    try {
      var keys = storeKeys();
      keys.forEach(function(k) {
        if (k.indexOf(CV + ":tl:") !== 0) return;
        var parts = k.slice((CV + ":tl:").length).split(":");
        if (parts.length < 2) return;
        var a = parts[0], al = parts.slice(1).join(":");
        var tl = tlGet(a, al);
        if (!tl || !tl.length) return;
        // Verifie qu'au moins un son est decode
        var decoded = tl.filter(function(t) { var c = cacheGet(a, t); return c && c.d; });
        if (decoded.length > 0) albums.push({ artist: a, album: al, tracks: tl, decoded: decoded.length });
        tl.forEach(function(t) { covered[norm(a) + "|" + norm(t)] = true; });
      });
      // Morceaux decodes en mode Single (pas de tracklist, cf. le fix mode==="single" dans decode()):
      // sans ca, ils restent invisibles pour getCachedAlbums() malgre un cache valide, meme ceux
      // decodes/analyses avant ce fix — chacun devient son propre pseudo-album pour rester
      // decouvrable (Video Research notamment).
      keys.forEach(function(k2) {
        if (k2.indexOf(CV + ":song:") !== 0) return;
        var sparts = k2.slice((CV + ":song:").length).split(":");
        if (sparts.length < 2) return;
        var sa = sparts[0], sn = sparts.slice(1).join(":");
        if (covered[sa + "|" + sn]) return;
        var sc = cacheGet(sa, sn);
        if (sc && sc.d) { albums.push({ artist: sa, album: sn, tracks: [sn], decoded: 1 }); covered[sa + "|" + sn] = true; }
      });
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

      var allCachedAlbums = getCachedAlbums();
      var decodedList = allCachedAlbums.map(function(a) { return a.artist + " - " + a.album; }).join(", ");

      // 2 appels en parallele
      var searchPromise = callGemini(THEMATIC_SYSTEM, "THEME: \"" + thematicQuery + "\"\n\nPAROLES:\n" + allLyrics, false);
      var suggestPromise = callGemini(SUGGEST_SYSTEM, "THEME: \"" + thematicQuery + "\"\n\nALBUMS DEJA DECODES (ne pas suggerer de morceaux de ceux-la): " + decodedList, false, "perplexity/sonar");

      var results = await searchPromise.catch(function() { return { angles: [] }; });
      var suggestions = await suggestPromise.catch(function() { return { suggestions: [] }; });

      setThematicResults(results);
      var filteredSugs = (suggestions.suggestions || []).filter(function(s) {
        return !cacheGet(s.artist, s.track);
      });
      setThematicSuggestions(filteredSugs);
    } catch (e) {
      setThematicResults([]);
      setThematicSuggestions([]);
    }
    setThematicLoading(false);
  };

  // Decoder un morceau suggere (artiste/titre differents de l'album courant)
  // Cherche/traduit/cache un morceau suggere (par recherche thematique ou video research).
  // Partagee entre les deux appelants - seul le setter de statut differe.
  var decodeSuggestionWith = async function(sug, setStatus) {
    var key = sug.artist + ":" + sug.track;
    setStatus(function(p) { var n = Object.assign({}, p); n[key] = "load"; return n; });
    try {
      var genius = await fetchLyrics(sug.track, sug.artist, sug.album || "");
      if (genius.found && genius.lyrics) {
        var prompt = "Voici les paroles EXACTES de \"" + sug.track + "\" par " + sug.artist + ".\nCopie chaque ligne originale mot pour mot.\n\nPAROLES:\n\n" + genius.lyrics;
        var r = await translateWithCheck(prompt, genius.lyrics);
        r.found = true;
        r._source = genius.source;
        if (r.lines && r.lines.length) cacheSet(sug.artist, sug.track, { d: r });
        // Aussi cacher une mini-tracklist pour que l'album apparaisse dans la recherche
        var existingTl = tlGet(sug.artist, sug.album || sug.track) || [];
        if (existingTl.indexOf(sug.track) < 0) {
          existingTl.push(sug.track);
          tlSet(sug.artist, sug.album || sug.track, existingTl);
        }
        setStatus(function(p) { var n = Object.assign({}, p); n[key] = "ok"; return n; });
      } else {
        // Fallback: essayer via Gemini search
        var FALLBACK = "Tu es un traducteur rap. Utilise web_search pour trouver les paroles EXACTES de ce morceau. N'invente RIEN et ne complete JAMAIS de memoire si la recherche ne donne rien de fiable pour CE morceau precis — mieux vaut echouer que d'inventer des paroles. Puis traduis ligne par ligne.\nReponds en JSON: {\"found\":true,\"lang\":\"anglais\",\"lines\":[{\"s\":\"[Verse 1]\"},{\"o\":\"ligne\",\"t\":\"traduction\",\"c\":80}],\"notes\":[]}\nSi introuvable: {\"found\":false,\"lines\":[],\"notes\":[]}";
        var r2 = await callGemini(FALLBACK, "Trouve et traduis: \"" + sug.track + "\" par " + sug.artist, false, "perplexity/sonar");
        if (r2.found && r2.lines && r2.lines.length) {
          cacheSet(sug.artist, sug.track, { d: r2 });
          var existingTl2 = tlGet(sug.artist, sug.album || sug.track) || [];
          if (existingTl2.indexOf(sug.track) < 0) { existingTl2.push(sug.track); tlSet(sug.artist, sug.album || sug.track, existingTl2); }
          setStatus(function(p) { var n = Object.assign({}, p); n[key] = "ok"; return n; });
        } else {
          setStatus(function(p) { var n = Object.assign({}, p); n[key] = "err"; return n; });
        }
      }
    } catch (e) {
      setStatus(function(p) { var n = Object.assign({}, p); n[key] = "err"; return n; });
    }
  };
  var decodeSuggestion = function(sug) { return decodeSuggestionWith(sug, setSuggestDecoding); };

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

  var MAX_VIDEO_CHARS = 80000;

  // Rassemble toutes les analyses de lignes deja en cache (accumulees au fil des clics Focus Mode),
  // formatees avec un numero de ligne explicite pour que le LLM puisse re-citer un artist/track/lineIdx
  // EXACT sans jamais avoir a re-ecrire ou re-inventer l'analyse elle-meme.
  var gatherLineAnalyses = function() {
    var albums = getCachedAlbums();
    var blocks = [];
    var count = 0;
    albums.forEach(function(alb) {
      alb.tracks.forEach(function(t) {
        var c = cacheGet(alb.artist, t);
        if (!c || !c.d || !c.d.lineAnalyses) return;
        var keys = Object.keys(c.d.lineAnalyses);
        if (!keys.length) return;
        var block = "\n=== " + alb.artist + " - " + t + " ===\n";
        keys.forEach(function(k) {
          var a = resolveLineAnalysis(c.d, k);
          if (!a) return;
          block += "[ligne " + k + "] \"" + (a.o || "") + "\"" + (a.t ? " (trad: " + a.t + ")" : "") + "\n";
          if (a.sens) block += "  sens: " + a.sens + "\n";
          if (a.technique) block += "  technique: " + a.technique + "\n";
          if (a.couches && a.couches.length) block += "  couches: " + a.couches.join(" / ") + "\n";
          if (a.arc) block += "  arc: " + a.arc + "\n";
          if (a.mirror) block += "  mirror: " + a.mirror + "\n";
          if (a.philo && a.philo.explication) block += "  philo: " + a.philo.explication + "\n";
          if (a.callbacks && a.callbacks.length) {
            block += "  callbacks: " + a.callbacks.map(function(cb) { return cb.album + " (\"" + cb.ligne + "\")"; }).join("; ") + "\n";
          }
          count++;
        });
        blocks.push(block);
      });
    });
    return { blocks: blocks, count: count };
  };

  // Video Research etape 1 (scan): regroupe les lignes DEJA ANALYSEES par angle/theme.
  // Ne choisit rien, n'ordonne rien — l'utilisateur fait ca lui-meme a l'etape 2.
  var runVideoScan = async function() {
    if (!videoBrief.trim()) return;
    setVideoLoading(true);
    setVideoResults(null);
    setVideoSelected({});
    setVideoOrder([]);
    try {
      var gathered = gatherLineAnalyses();
      if (!gathered.count) {
        setVideoResults({ angles: [], empty: true });
        setVideoLoading(false);
        return;
      }
      var allText = gathered.blocks.join("");
      if (allText.length <= MAX_VIDEO_CHARS) {
        var r = await callGemini(VIDEO_SCAN_SYSTEM, "BRIEF VIDEO:\n" + videoBrief + "\n\nLIGNES DEJA ANALYSEES:\n" + allText, false);
        setVideoResults(r);
        runVideoCurate(r.angles);
      } else {
        var batches = [];
        var curBatch = [];
        var curLen = 0;
        for (var bi = 0; bi < gathered.blocks.length; bi++) {
          if (curLen + gathered.blocks[bi].length > MAX_VIDEO_CHARS && curBatch.length > 0) {
            batches.push(curBatch.join(""));
            curBatch = [];
            curLen = 0;
          }
          curBatch.push(gathered.blocks[bi]);
          curLen += gathered.blocks[bi].length;
        }
        if (curBatch.length > 0) batches.push(curBatch.join(""));

        var results = await Promise.all(batches.map(function(batchText) {
          return callGemini(VIDEO_SCAN_SYSTEM, "BRIEF VIDEO:\n" + videoBrief + "\n\nLIGNES DEJA ANALYSEES:\n" + batchText, false)
            .catch(function() { return { angles: [] }; });
        }));
        var merged = { angles: [] };
        results.forEach(function(r) { if (r.angles) merged.angles = merged.angles.concat(r.angles); });
        setVideoResults(merged);
        runVideoCurate(merged.angles);
      }
    } catch (e) {
      setVideoResults({ angles: [], error: e.message });
    }
    setVideoLoading(false);
  };

  // Etape 1.5 (automatique apres le scan): curation. Contrairement au scan qui n'exclut presque
  // rien, ici l'IA choisit vraiment — "trouvailles" + "essentielles" pre-cochees. L'utilisateur
  // valide/ajuste plutot que de partir de zero; la matiere brute du scan reste dispo en dessous.
  var runVideoCurate = async function(angles) {
    setVideoCurating(true);
    setVideoCuration(null);
    try {
      var allItems = [];
      (angles || []).forEach(function(angle) {
        (angle.lignes || []).forEach(function(ligne) {
          var cached = cacheGet(ligne.artist, ligne.track);
          var a = cached && cached.d && resolveLineAnalysis(cached.d, ligne.lineIdx);
          if (a) allItems.push({ ligne: ligne, angleTitre: angle.titre, a: a });
        });
      });
      if (!allItems.length) { setVideoCurating(false); return; }
      // Priorite mecanique aux lignes les plus riches si tout ne tient pas dans un seul appel —
      // la curation doit voir l'ensemble pour comparer, donc pas de multi-lots ici, juste une coupe.
      allItems.sort(function(x, y) { return lineRichness(y.a) - lineRichness(x.a); });

      var MAX_CURATE_CHARS = 60000;
      var blocks = [];
      var total = 0;
      for (var i = 0; i < allItems.length; i++) {
        var it = allItems[i];
        var block = "[" + it.ligne.artist + " | " + it.ligne.track + " | ligne " + it.ligne.lineIdx + "] \"" + it.a.o + "\"\n" +
          "  angle: " + it.angleTitre + "\n" +
          (it.ligne.pourquoi ? "  pourquoi (scan): " + it.ligne.pourquoi + "\n" : "") +
          (it.a.sens ? "  sens: " + it.a.sens + "\n" : "") +
          (it.a.arc ? "  arc: " + it.a.arc + "\n" : "") +
          (it.a.mirror ? "  mirror: " + it.a.mirror + "\n" : "") +
          (it.a.philo && it.a.philo.explication ? "  philo: " + it.a.philo.explication + "\n" : "") +
          (it.a.callbacks && it.a.callbacks.length ? "  callbacks: " + it.a.callbacks.map(function(cb) { return cb.album; }).join(", ") + "\n" : "");
        if (total + block.length > MAX_CURATE_CHARS && blocks.length > 0) break;
        blocks.push(block);
        total += block.length;
      }

      var r = await callGemini(VIDEO_CURATE_SYSTEM, "BRIEF VIDEO:\n" + videoBrief + "\n\nLIGNES (deja groupees par angle par un scan precedent):\n" + blocks.join("\n"), false);
      setVideoCuration(r);
      // L'IA propose les essentielles precochees, l'utilisateur ajuste — pas de depart de zero.
      var ess = (r && r.essentielles) || [];
      var newSelected = {};
      var newOrder = [];
      ess.forEach(function(it) {
        var key = videoLineKey(it.artist, it.track, it.lineIdx);
        if (!newSelected[key]) {
          newSelected[key] = true;
          newOrder.push({ artist: it.artist, track: it.track, lineIdx: it.lineIdx });
        }
      });
      setVideoSelected(newSelected);
      setVideoOrder(newOrder);
    } catch (e) {}
    setVideoCurating(false);
  };

  var videoLineKey = function(artist, track, lineIdx) { return artist + "|||" + track + "|||" + lineIdx; };

  // Etape 2: coche/decoche une ligne. L'IA n'intervient plus a partir d'ici.
  var toggleVideoLine = function(artist, track, lineIdx) {
    var key = videoLineKey(artist, track, lineIdx);
    setVideoSelected(function(p) {
      var n = Object.assign({}, p);
      if (n[key]) delete n[key]; else n[key] = true;
      return n;
    });
    setVideoOrder(function(p) {
      var exists = p.some(function(it) { return videoLineKey(it.artist, it.track, it.lineIdx) === key; });
      if (exists) return p.filter(function(it) { return videoLineKey(it.artist, it.track, it.lineIdx) !== key; });
      return p.concat([{ artist: artist, track: track, lineIdx: lineIdx }]);
    });
  };

  // Reordonne la selection par drag-and-drop (index dans videoOrder, choisi entierement par l'utilisateur).
  var reorderVideoLine = function(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    setVideoOrder(function(p) {
      var next = p.slice();
      var moved = next.splice(fromIdx, 1)[0];
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  var copyVideoSelection = function() {
    var text = "🎬 " + videoBrief + "\n\n";
    videoOrder.forEach(function(it, i) {
      var cached = cacheGet(it.artist, it.track);
      var a = cached && cached.d && resolveLineAnalysis(cached.d, it.lineIdx);
      if (!a) return;
      text += (i + 1) + ". " + a.o + "\n";
      if (a.t) text += "   " + a.t + "\n";
      text += "   (" + it.artist + " — " + it.track + ")\n\n";
    });
    try {
      navigator.clipboard.writeText(text);
      setVideoSelCopied(true);
      setTimeout(function() { setVideoSelCopied(false); }, 2000);
    } catch (e) {}
  };

  // Best Bars: envoie TOUTES les paroles de l'album en un seul appel
  var extractBestBars = async function() {
    setActivePanel('bestBars');
    if (bestBars) return; // deja fait dans cette session
    // Relire le cache avant de repayer l'appel : l'extraction persiste desormais,
    // donc un album deja traite dans une session precedente revient gratuitement.
    var cachedBars = bbGet(artist, album);
    if (cachedBars && cachedBars.bars && cachedBars.bars.length) {
      setBestBars(cachedBars.bars);
      return;
    }
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
      if (bars.length) bbSet(artist, album, bars);
    } catch (e) {
      setBestBars([]);
    }
    setBestBarsLoading(false);
  };

  // Best of artiste: agregation du cache, instantanee et gratuite.
  var loadBestOfArtist = function(name) {
    var who = (name || bestArtist).trim();
    if (!who) return;
    setBestData({
      artist: who,
      lines: artistBestLines(who),
      bars: artistBestBars(who),
      verses: artistBestVerses(who),
      stats: artistCacheStats(who),
    });
  };

  var copyBestLine = function(id, text) {
    try {
      navigator.clipboard.writeText(text);
      setBestCopied(id);
      setTimeout(function() { setBestCopied(""); }, 2000);
    } catch (e) {}
  };

  // Analyse d'ecriture pour UN son donne (score + selection + multis)
  // Retourne true si le morceau a bien ete analyse, false sinon — l'appelant en a
  // besoin pour dire lesquels ont echoue au lieu de les perdre en silence.
  var extractPunchlinesFor = async function(name) {
    var entry = dRef.current[name];
    if (!entry || entry.st !== "ok" || !entry.d || !entry.d.lines) return false;
    if (entry.d.analysis) return true; // deja fait
    try {
      var lyricsText = entry.d.lines.map(function(l) {
        if (l.s) return "\n" + l.s;
        return l.o + (l.t ? "\n(" + l.t + ")" : "");
      }).join("\n");
      var albumCtxStr = mode === "single" ? "" : " (album: " + album + ")";
      var r = await callGemini(ANALYSIS_SYSTEM, "Morceau: \"" + name + "\" par " + artist + albumCtxStr + "\n\nPAROLES (traductions entre parentheses):\n" + lyricsText, false);
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
      return true;
    } catch (e) { return false; }
  };

  // Extrait les meilleures punchlines du son courant
  var extractPunchlines = async function() {
    setPlLoading(true);
    await extractPunchlinesFor(sel);
    setPlLoading(false);
  };

  // Best of album: extrait les punchlines de tous les sons decodes (2 en parallele)
  var extractAlbumPunchlines = async function() {
    setActivePanel('albumPl');
    // Re-cliquer sur le bouton pendant que ca tourne relancait une seconde passe en
    // parallele de la premiere: deux fois plus d'appels sur un quota deja sature,
    // donc deux fois plus de 429 et une analyse encore plus lente.
    if (albumPlLoading) return;
    setAlbumPlLoading(true);
    setAlbumPlFails([]);
    var decoded = tracks.filter(function(t) {
      var e = dRef.current[t];
      return e && e.st === "ok" && e.d && e.d.lines && e.d.lines.length;
    });
    var pending = decoded.filter(function(t) { return !dRef.current[t].d.analysis; });
    var fails = [], finished = 0;
    setAlbumPlProg({ done: 0, total: pending.length });
    for (var i = 0; i < pending.length; i += 2) {
      var slice = pending.slice(i, i + 2);
      await Promise.all(slice.map(function(t) {
        return extractPunchlinesFor(t).then(function(ok) {
          if (!ok) fails.push(t);
          finished += 1;
          setAlbumPlProg({ done: finished, total: pending.length });
        });
      }));
    }
    setAlbumPlFails(fails);
    setAlbumPlProg(null);
    setAlbumPlLoading(false);
  };

  var cur = sel && data[sel];
  var curD = cur ? cur.d : null;
  var showSidebar = !isMobile || (!sel && !activePanel);
  var showDetail = !isMobile || sel || activePanel;
  var headerLabel = mode === "single" ? single : album;
  // 3e zone: le contenu annexe (contexte d'album). Sur mobile il n'y a pas la
  // place pour une colonne de plus, le contexte y reste dans le flux principal.
  var showAnnex = !isMobile && mode === "album" && !!(albumCtx || albumCtxLoading);

  if (!booted) {
    return (
      <div style={S.root}>
        <style>{CSS}</style>
        <div style={S.center}><div style={S.spinner} /><div style={S.dim}>Chargement du cache...</div></div>
      </div>
    );
  }

  return (
    <div style={S.root}>
      <style>{CSS}</style>

      <div style={S.header}>
        <div style={S.logo}>{"翻"}</div>
        <div style={{ flex: 1 }}>
          <div style={S.title}>RAP DECODER</div>
          <div style={{ fontSize: 8, color: "#333" }}>genius + gemini flash - traduction - decryptage</div>
        </div>
        {view !== "input" && <button onClick={reset} style={S.back}>{"<-"}</button>}
      </div>

      {quotaWarning && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 16px", background: "#1a0f08", borderBottom: "1px solid #3a2010", fontSize: 11, color: "#f0c040", lineHeight: 1.5 }}>
          <span style={{ flex: 1 }}>⚠ {quotaWarning}</span>
          <span onClick={function() { setQuotaWarning(""); }} style={{ cursor: "pointer", color: "#a08030", flexShrink: 0 }}>{"✕"}</span>
        </div>
      )}

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

          <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid #1a1a1a" }}>
            <div style={{ fontSize: 8, color: "#333", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>ou directement, sans charger d'album</div>
            <button onClick={function() { setActivePanel('thematic'); setView("list"); }} style={{
              background: "transparent", border: "1px solid #1a1a2a", borderRadius: 4,
              color: "#38bdf8", fontFamily: "inherit", fontSize: 9,
              padding: "6px 12px", cursor: "pointer",
              letterSpacing: 2, textTransform: "uppercase",
              marginRight: 8, marginBottom: 8,
            }}>
              ◈ recherche thematique
            </button>
            <button onClick={function() { setActivePanel('video'); setView("list"); }} style={{
              background: "transparent", border: "1px solid #2a1a2a", borderRadius: 4,
              color: "#c084fc", fontFamily: "inherit", fontSize: 9,
              padding: "6px 12px", cursor: "pointer",
              letterSpacing: 2, textTransform: "uppercase",
              marginBottom: 8,
            }}>
              ▶ video research
            </button>
            <button onClick={function() { setActivePanel('disco'); setView("list"); }} style={{
              background: "transparent", border: "1px solid #1a2a1a", borderRadius: 4,
              color: "#4ade80", fontFamily: "inherit", fontSize: 9,
              padding: "6px 12px", cursor: "pointer",
              letterSpacing: 2, textTransform: "uppercase",
              marginRight: 8, marginBottom: 8,
            }}>
              ⏣ disco en masse
            </button>
            <button onClick={function() { setActivePanel('bestOf'); setView("list"); }} style={{
              background: "transparent", border: "1px solid #3a2a10", borderRadius: 4,
              color: "#f0c040", fontFamily: "inherit", fontSize: 9,
              padding: "6px 12px", cursor: "pointer",
              letterSpacing: 2, textTransform: "uppercase",
              marginBottom: 8,
            }}>
              ★ best of artiste
            </button>
          </div>
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
              {tracks.map(function(t, i) {
                var st = (data[t] && data[t].st) || "idle";
                var isSel = sel === t;
                var colors = { idle: "#222", load: "#f0c040", ok: "#4ade80", err: "#ef4444" };
                return (
                  <div key={i} onClick={function() { setActivePanel(null); decode(t, false); }} style={Object.assign({}, S.trackRow, {
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
              {mode === "album" && (
                <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid #1a1a1a" }}>
                  <div style={{ fontSize: 8, color: "#333", letterSpacing: 2, textTransform: "uppercase", margin: "0 12px 8px" }}>pour aller plus loin</div>
                  {done > 0 && (
                    <button onClick={extractAlbumPunchlines} style={{
                      background: "transparent", border: "1px solid #2a2040", borderRadius: 4,
                      color: "#a855f7", fontFamily: "inherit", fontSize: 9,
                      padding: "5px 10px", cursor: "pointer",
                      letterSpacing: 2, textTransform: "uppercase",
                      margin: "0 12px 5px", display: "block",
                    }}>
                      ★ best bars
                    </button>
                  )}
                  <button onClick={function() { setActivePanel('thematic'); setSel(null); }} style={{
                    background: "transparent", border: "1px solid #1a1a2a", borderRadius: 4,
                    color: "#38bdf8", fontFamily: "inherit", fontSize: 9,
                    padding: "5px 10px", cursor: "pointer",
                    letterSpacing: 2, textTransform: "uppercase",
                    margin: "0 12px 5px", display: "block",
                  }}>
                    ◈ recherche thematique
                  </button>
                  <button onClick={function() { setActivePanel('video'); setSel(null); }} style={{
                    background: "transparent", border: "1px solid #2a1a2a", borderRadius: 4,
                    color: "#c084fc", fontFamily: "inherit", fontSize: 9,
                    padding: "5px 10px", cursor: "pointer",
                    letterSpacing: 2, textTransform: "uppercase",
                    margin: "0 12px 10px", display: "block",
                  }}>
                    ▶ video research
                  </button>
                </div>
              )}
            </div>
          )}

          {showDetail && activePanel === 'bestOf' && (
            <div style={S.detail}>
              <button onClick={function() { setActivePanel(null); if (!tracks.length) setView("input"); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- retour"}</button>
              <div style={S.trackTitle}>★ Best of artiste</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 4, marginBottom: 18 }}>Les meilleures lignes et passages de tout ce que tu as deja decode, classes par impact.</div>

              <Inp label="Artiste" val={bestArtist} set={setBestArtist} ph="billy woods" enter={function() { loadBestOfArtist(); }} />
              <button onClick={function() { loadBestOfArtist(); }} disabled={!bestArtist.trim()} style={{
                width: "100%", padding: "12px 0", marginTop: 4,
                background: !bestArtist.trim() ? "#111" : "#1a1408",
                color: !bestArtist.trim() ? "#555" : "#f0c040",
                border: "1px solid #3a2a10", borderRadius: 4,
                fontFamily: "inherit", fontSize: 11, cursor: "pointer",
                letterSpacing: 3, textTransform: "uppercase",
              }}>
                sortir le best of
              </button>

              {bestData && (function() {
                var items = bestTab === "lignes" ? bestData.lines
                  : bestTab === "passages" ? bestData.bars
                  : (bestData.verses || []);
                var st = bestData.stats;
                return (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                      {[["lignes", "lignes", bestData.lines.length], ["passages", "passages", bestData.bars.length], ["couplets", "couplets", (bestData.verses || []).length]].map(function(t) {
                        var on = bestTab === t[0];
                        return (
                          <button key={t[0]} onClick={function() { setBestTab(t[0]); }} style={{
                            flex: 1, padding: "7px 0",
                            background: on ? "#1a1408" : "transparent",
                            color: on ? "#f0c040" : "#555",
                            border: "1px solid " + (on ? "#3a2a10" : "#1a1a1a"), borderRadius: 4,
                            fontFamily: "inherit", fontSize: 9, cursor: "pointer",
                            letterSpacing: 2, textTransform: "uppercase",
                          }}>
                            {t[1]} ({t[2]})
                          </button>
                        );
                      })}
                    </div>

                    {items.length === 0 && (
                      <div style={{ padding: "18px 0", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#777", lineHeight: 1.6, marginBottom: 4 }}>
                          {bestTab === "passages"
                            ? (st.albumsWithBars === 0
                                ? "Aucun album de " + bestData.artist + " n'a encore eu son extraction de passages."
                                : "Extractions presentes mais vides.")
                            : (st.tracks === 0
                                ? "Rien en cache pour " + bestData.artist + "."
                                : st.tracks + " morceau(x) en cache, mais " + st.analyzed + " analyse(s).")}
                        </div>
                        <div style={{ fontSize: 9, color: "#444", lineHeight: 1.6, marginBottom: 14 }}>
                          {bestTab === "lignes"
                            ? "Les lignes viennent de l'analyse d'ecriture, lancee par morceau ou via Best of album."
                            : bestTab === "passages"
                            ? "Les passages viennent du bouton Best bars, a lancer une fois par album."
                            : "Les couplets sont decoupes sur les marqueurs de section et notes d'apres les lignes retenues par l'analyse d'ecriture. Il en faut donc au moins une par couplet."}
                        </div>
                        <button onClick={function() { setBestArtist(""); setDiscoArtist(bestData.artist); setActivePanel('disco'); }} style={{
                          background: "transparent", border: "1px solid #1a2a1a", borderRadius: 4,
                          color: "#4ade80", fontFamily: "inherit", fontSize: 9,
                          padding: "6px 12px", cursor: "pointer",
                          letterSpacing: 2, textTransform: "uppercase",
                        }}>
                          ⏣ lancer disco en masse
                        </button>
                      </div>
                    )}

                    {items.length > 0 && bestTab === "lignes" && items.map(function(p, i) {
                      var id = "l" + i;
                      var txt = p.o + (p.t ? "\n" + p.t : "") + "\n\n(" + bestData.artist + " — " + p.track + ")";
                      return (
                        <div key={id} style={{ border: "1px solid #1a1a1a", borderRadius: 4, padding: 10, marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                            <span style={{ fontSize: 8, color: "#555", letterSpacing: 1, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.track}</span>
                            <span style={{ fontSize: 8, color: TYPE_COLORS[p.type] || "#777", letterSpacing: 1, flexShrink: 0 }}>{p.type} · {p.impact}/10</span>
                          </div>
                          <div style={{ fontSize: 12, color: "#ddd", lineHeight: 1.5 }}>{p.o}</div>
                          {p.t && <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5, marginTop: 3 }}>{p.t}</div>}
                          {p.why && <div style={{ fontSize: 9, color: "#666", fontStyle: "italic", marginTop: 6 }}>{p.why}</div>}
                          <button onClick={function() { copyBestLine(id, txt); }} style={{
                            background: "transparent", border: "none", color: bestCopied === id ? "#4ade80" : "#444",
                            fontFamily: "inherit", fontSize: 8, cursor: "pointer", padding: "6px 0 0",
                            letterSpacing: 1, textTransform: "uppercase",
                          }}>
                            {bestCopied === id ? "✓ copie" : "copier"}
                          </button>
                        </div>
                      );
                    })}

                    {items.length > 0 && bestTab === "passages" && items.map(function(b, i) {
                      var id = "b" + i;
                      var txt = b.lines.map(function(l) { return l.o + (l.t ? "\n" + l.t : ""); }).join("\n")
                        + "\n\n(" + bestData.artist + " — " + (b.track || "?") + ", " + b.album + ")";
                      return (
                        <div key={id} style={{ border: "1px solid #1a1a1a", borderRadius: 4, padding: 10, marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                            <span style={{ fontSize: 8, color: "#555", letterSpacing: 1, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.track} · {b.album}</span>
                            <span style={{ fontSize: 8, color: TYPE_COLORS[b.type] || "#777", letterSpacing: 1, flexShrink: 0 }}>{b.type} · {b.impact}/10</span>
                          </div>
                          {b.lines.map(function(l, li) {
                            return (
                              <div key={li} style={{ marginBottom: 3 }}>
                                <div style={{ fontSize: 12, color: "#ddd", lineHeight: 1.5 }}>{l.o}</div>
                                {l.t && <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>{l.t}</div>}
                              </div>
                            );
                          })}
                          {b.why && <div style={{ fontSize: 9, color: "#666", fontStyle: "italic", marginTop: 6 }}>{b.why}</div>}
                          <button onClick={function() { copyBestLine(id, txt); }} style={{
                            background: "transparent", border: "none", color: bestCopied === id ? "#4ade80" : "#444",
                            fontFamily: "inherit", fontSize: 8, cursor: "pointer", padding: "6px 0 0",
                            letterSpacing: 1, textTransform: "uppercase",
                          }}>
                            {bestCopied === id ? "✓ copie" : "copier"}
                          </button>
                        </div>
                      );
                    })}

                    {items.length > 0 && bestTab === "couplets" && items.map(function(v, i) {
                      var id = "v" + i;
                      return (
                        <div key={id} style={{ border: "1px solid #1a1a1a", borderRadius: 4, padding: 10, marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                            <span style={{ fontSize: 8, color: "#555", letterSpacing: 1, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {v.track} · {v.section}
                            </span>
                            <span style={{ fontSize: 8, color: "#f0c040", letterSpacing: 1, flexShrink: 0 }}>
                              {v.score} pts · {v.hits} ligne{v.hits > 1 ? "s" : ""} retenue{v.hits > 1 ? "s" : ""}
                            </span>
                          </div>
                          <div style={{ fontSize: 9, color: "#444", marginBottom: 6 }}>{v.lines.length} lignes</div>
                          <div style={{ maxHeight: 260, overflowY: "auto" }}>
                            {v.lines.map(function(l, li) {
                              return (
                                <div key={li} style={{ marginBottom: 3 }}>
                                  <div style={{ fontSize: 12, color: "#ddd", lineHeight: 1.5 }}>{l.o}</div>
                                  {l.t && <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>{l.t}</div>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {showDetail && activePanel === 'disco' && (
            <div style={S.detail}>
              <button onClick={function() { setActivePanel(null); if (!tracks.length) setView("input"); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- retour"}</button>
              <div style={S.trackTitle}>⏣ Disco en masse</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 4, marginBottom: 18 }}>Decode et traduit toute la discographie d'un artiste, album par album. L'analyse ligne par ligne se lance ensuite a la demande, sur le morceau que tu ouvres.</div>

              {!discoAlbums && (
                <div>
                  <Inp label="Artiste" val={discoArtist} set={setDiscoArtist} ph="Kendrick Lamar" enter={fetchDiscoAlbums} />
                  <button onClick={fetchDiscoAlbums} disabled={discoAlbumsLoading || !discoArtist.trim()} style={{
                    width: "100%", padding: "12px 0", marginTop: 4,
                    background: discoAlbumsLoading || !discoArtist.trim() ? "#111" : "#0d1a10",
                    color: discoAlbumsLoading ? "#555" : "#4ade80",
                    border: "1px solid #1a3a20", borderRadius: 4,
                    fontFamily: "inherit", fontSize: 11, cursor: "pointer",
                    letterSpacing: 3, textTransform: "uppercase",
                  }}>
                    {discoAlbumsLoading ? "recherche..." : "chercher la discographie"}
                  </button>
                </div>
              )}

              {discoAlbums && !discoProgress && (
                <div>
                  {discoAlbums.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#999", padding: 12, background: "#0d0d0f", border: "1px solid #1a1a1a", borderRadius: 6, marginBottom: 12 }}>
                      Discographie introuvable pour "{discoArtist}". Verifie l'orthographe ou reessaie.
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 9, color: "#666", marginBottom: 12 }}>{discoAlbums.length} albums trouves — decoche ceux a exclure</div>
                      {discoAlbums.map(function(a, ai) {
                        return (
                          <label key={ai} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 4, background: "#0a0a0a", border: "1px solid " + (a.manual ? "#3a2a10" : "#1a1a1a"), borderRadius: 4, cursor: "pointer" }}>
                            <input type="checkbox" checked={!!discoSelected[a.titre]} onChange={function() { toggleDiscoAlbum(a.titre); }} />
                            <span style={{ fontSize: 12, color: "#ddd", flex: 1 }}>{a.titre}</span>
                            {a.manual && <span style={{ fontSize: 8, color: "#f0c040", letterSpacing: 1 }}>AJOUTE</span>}
                            {a.annee && <span style={{ fontSize: 10, color: "#555" }}>{a.annee}</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14, padding: "9px 10px", background: turbo ? "#1a1408" : "#0a0a0a", border: "1px solid " + (turbo ? "#3a2a10" : "#1a1a1a"), borderRadius: 4, cursor: "pointer" }}>
                    <input type="checkbox" checked={turbo} onChange={function(e) { _setTurbo(e.target.checked); setTurbo(e.target.checked); }} style={{ marginTop: 2 }} />
                    <span style={{ flex: 1 }}>
                      <span style={{ fontSize: 11, color: turbo ? "#f0c040" : "#999" }}>Mode rapide (payant)</span>
                      <span style={{ display: "block", fontSize: 9, color: "#555", lineHeight: 1.5, marginTop: 3 }}>
                        Passe par OpenRouter au lieu du gratuit Google, qui plafonne a 20 requetes/minute
                        et impose ~48s d'attente des qu'il sature. Compte ~0,10 a 0,15 $ l'album.
                        Laisse decoche si tu n'es pas presse.
                      </span>
                    </span>
                  </label>

                  {/* La recherche rate les projets peu references — et rate aussi, par
                      intermittence, des projets qu'elle avait trouves a l'appel precedent. */}
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #1a1a1a" }}>
                    <div style={{ fontSize: 9, color: "#555", marginBottom: 6 }}>Un projet manque ? Ajoute-le a la main.</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        value={discoManual}
                        onChange={function(e) { setDiscoManual(e.target.value); }}
                        onKeyDown={function(e) { if (e.key === "Enter") addDiscoAlbum(); }}
                        placeholder="Dr. Sophie Said"
                        style={{
                          flex: 1, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 4,
                          color: "#ddd", fontFamily: "inherit", fontSize: 11, padding: "8px 10px", outline: "none",
                        }}
                      />
                      <button onClick={addDiscoAlbum} disabled={!discoManual.trim()} style={{
                        background: "transparent", border: "1px solid #3a2a10", borderRadius: 4,
                        color: discoManual.trim() ? "#f0c040" : "#444", fontFamily: "inherit", fontSize: 9,
                        padding: "0 14px", cursor: discoManual.trim() ? "pointer" : "default",
                        letterSpacing: 2, textTransform: "uppercase",
                      }}>
                        ajouter
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <button onClick={resetDisco} style={{
                      background: "transparent", border: "1px solid #2a2a2a", color: "#666",
                      fontFamily: "inherit", fontSize: 10, padding: "10px 14px", borderRadius: 4,
                      cursor: "pointer", letterSpacing: 1, textTransform: "uppercase",
                    }}>
                      nouvelle recherche
                    </button>
                    {discoAlbums.length > 0 && (
                      <button onClick={runDiscoQueue} disabled={!Object.values(discoSelected).some(Boolean)} style={{
                        flex: 1, padding: "10px 0",
                        background: "#0d1a10", color: "#4ade80",
                        border: "1px solid #1a3a20", borderRadius: 4,
                        fontFamily: "inherit", fontSize: 11, cursor: "pointer",
                        letterSpacing: 3, textTransform: "uppercase",
                      }}>
                        lancer
                      </button>
                    )}
                  </div>
                </div>
              )}

              {discoProgress && (
                <div>
                  <div style={{ padding: "14px 16px", background: "#0d0a10", border: "1px solid #1a3a20", borderRadius: 6, marginBottom: 16 }}>
                    <div style={{ fontSize: 10, color: "#4ade80", marginBottom: 8 }}>
                      album {discoProgress.albumIdx}/{discoProgress.albumTotal} — {discoProgress.albumName}
                    </div>
                    {discoProgress.songTotal > 0 && (
                      <div style={{ fontSize: 10, color: "#999", marginBottom: 6 }}>
                        morceau {discoProgress.songIdx}/{discoProgress.songTotal} — {discoProgress.songName}
                      </div>
                    )}
                    {discoProgress.lineTotal > 0 && (
                      <div style={{ fontSize: 9, color: "#666" }}>
                        lignes analysees {discoProgress.lineDone}/{discoProgress.lineTotal}
                      </div>
                    )}
                    {tokenStats && tokenStats.calls > 0 && (
                      <div style={{ fontSize: 9, color: "#555", marginTop: 6, paddingTop: 6, borderTop: "1px solid #1a1a1a" }}>
                        {tokenStats.calls} appels · {Math.round((tokenStats.in + tokenStats.out) / 1000)}k tokens
                        {tokenStats.paidOut > 0
                          ? <span style={{ color: "#f0c040" }}> · facture ~{paidCostUsd(tokenStats).toFixed(3)} $</span>
                          : <span style={{ color: "#4ade80" }}> · gratuit</span>}
                      </div>
                    )}
                  </div>
                  {discoRunning
                    ? <button onClick={stopDiscoQueue} style={{
                        background: "transparent", border: "1px solid #3a1a1a", color: "#e05030",
                        fontFamily: "inherit", fontSize: 10, padding: "8px 14px", borderRadius: 4,
                        cursor: "pointer", letterSpacing: 1, textTransform: "uppercase", marginBottom: 16,
                      }}>
                        arreter
                      </button>
                    : <div style={{ fontSize: 11, color: "#4ade80", marginBottom: 16 }}>✓ termine.</div>}
                  {discoLog.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, color: "#666", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>morceaux/albums sautes ({discoLog.length})</div>
                      {discoLog.map(function(l, li) {
                        return <div key={li} style={{ fontSize: 10, color: "#f0c040", marginBottom: 4, lineHeight: 1.4 }}>{l}</div>;
                      })}
                    </div>
                  )}
                  {!discoRunning && (
                    <button onClick={resetDisco} style={{
                      background: "transparent", border: "1px solid #2a2a2a", color: "#666",
                      fontFamily: "inherit", fontSize: 10, padding: "10px 14px", borderRadius: 4,
                      cursor: "pointer", letterSpacing: 1, textTransform: "uppercase", marginTop: 8,
                    }}>
                      nouvel artiste
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {showDetail && activePanel === 'video' && (
            <div style={S.detail}>
              <button onClick={function() { setActivePanel(null); if (!tracks.length) setView("input"); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- retour"}</button>
              <div style={S.trackTitle}>▶ Video Research</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 4, marginBottom: 18 }}>Etape 1: scanne les lignes deja analysees (Focus Mode) qui servent ton brief. Etape 2: toi, tu coches et tu ordonnes.</div>

              <textarea
                value={videoBrief}
                onChange={function(e) { setVideoBrief(e.target.value); }}
                placeholder={"Decris ta video...\n\nEx: Kendrick a gagne le clash parce qu'il a fait une therapie"}
                style={{
                  width: "100%", minHeight: 100, padding: "12px", background: "#0a0a0a",
                  color: "#ddd", border: "1px solid #222", borderRadius: 6,
                  fontFamily: "inherit", fontSize: 12, lineHeight: 1.6, outline: "none",
                  boxSizing: "border-box", resize: "vertical",
                }}
              />

              <button
                onClick={runVideoScan}
                disabled={videoLoading || !videoBrief.trim()}
                style={{
                  width: "100%", padding: "12px 0", marginTop: 10,
                  background: videoLoading || !videoBrief.trim() ? "#111" : "#1a1020",
                  color: videoLoading ? "#555" : "#c084fc",
                  border: "1px solid #2a1a3a", borderRadius: 4,
                  fontFamily: "inherit", fontSize: 11, cursor: "pointer",
                  letterSpacing: 3, textTransform: "uppercase", marginBottom: 20,
                }}>
                {videoLoading ? "scan..." : "scanner"}
              </button>

              {videoCurating && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 10, color: "#666", fontStyle: "italic" }}>
                  <div style={S.spinner} /> curation en cours — l'IA trie la matiere du scan...
                </div>
              )}

              {videoCuration && videoCuration.trouvailles && videoCuration.trouvailles.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 9, color: "#f0c040", letterSpacing: 3, textTransform: "uppercase", marginBottom: 4, paddingBottom: 6, borderBottom: "1px solid #1a1a1a" }}>trouvailles</div>
                  <div style={{ fontSize: 9, color: "#444", marginBottom: 12, fontStyle: "italic" }}>les connexions les plus fortes trouvees dans toute la matiere</div>
                  {videoCuration.trouvailles.map(function(tr, ti) {
                    var cached = cacheGet(tr.artist, tr.track);
                    var a = cached && cached.d && resolveLineAnalysis(cached.d, tr.lineIdx);
                    if (!a) return null;
                    return (
                      <div key={ti} style={{ marginBottom: 10, padding: "12px 14px", background: "#150f08", border: "1px solid #2a2010", borderRadius: 6 }}>
                        <div style={{ fontSize: 9, color: "#666", textTransform: "lowercase" }}>{tr.artist} — {tr.track}</div>
                        <div style={{ fontSize: 13, color: "#eee", lineHeight: 1.5, marginTop: 4 }}>"{a.o}"</div>
                        {a.t && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic", marginTop: 2 }}>{a.t}</div>}
                        {tr.pourquoi_fort && <div style={{ fontSize: 11, color: "#f0c040", lineHeight: 1.4, marginTop: 6 }}>{stripCitationMarks(tr.pourquoi_fort)}</div>}
                        {tr.lien_brief && <div style={{ fontSize: 10, color: "#999", lineHeight: 1.4, marginTop: 4 }}>{stripCitationMarks(tr.lien_brief)}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {videoOrder.length > 0 && (
                <div style={{
                  position: "sticky", top: 0, zIndex: 10, marginBottom: 20,
                  background: "#0d0a10", border: "1px solid #2a1a3a", borderRadius: 6, padding: "12px 14px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontSize: 9, color: "#c084fc", letterSpacing: 2, textTransform: "uppercase" }}>selection ({videoOrder.length}) — glisse pour reordonner</div>
                    <button onClick={copyVideoSelection} style={{
                      background: "transparent", border: "1px solid #2a1a3a", color: "#c084fc",
                      fontFamily: "inherit", fontSize: 9, padding: "4px 10px", borderRadius: 4,
                      cursor: "pointer", letterSpacing: 1, textTransform: "uppercase",
                    }}>
                      {videoSelCopied ? "copie !" : "copier"}
                    </button>
                  </div>
                  {videoOrder.map(function(it, oi) {
                    var cached = cacheGet(it.artist, it.track);
                    var a = cached && cached.d && resolveLineAnalysis(cached.d, it.lineIdx);
                    if (!a) return null;
                    return (
                      <div key={it.artist + it.track + it.lineIdx}
                        draggable
                        onDragStart={function() { videoDragRef.current = oi; }}
                        onDragOver={function(e) { e.preventDefault(); }}
                        onDrop={function(e) { e.preventDefault(); if (videoDragRef.current != null) reorderVideoLine(videoDragRef.current, oi); videoDragRef.current = null; }}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 6px",
                          borderBottom: oi < videoOrder.length - 1 ? "1px solid #1a1420" : "none",
                          cursor: "grab",
                        }}>
                        <span style={{ fontSize: 9, color: "#555", flexShrink: 0, marginTop: 2 }}>{"::"} {oi + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: "#e6e6e6", lineHeight: 1.4 }}>{a.o}</div>
                          <div style={{ fontSize: 9, color: "#666", marginTop: 2 }}>{it.artist} — {it.track}</div>
                        </div>
                        <button onClick={function() { toggleVideoLine(it.artist, it.track, it.lineIdx); }} style={{
                          background: "transparent", border: "none", color: "#555", fontSize: 13,
                          cursor: "pointer", padding: "0 4px", flexShrink: 0,
                        }}>{"×"}</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {videoResults && (
                <div>
                  {videoResults.error && (
                    <div style={{ padding: "12px", background: "#1a0a0a", border: "1px solid #2a1010", borderRadius: 6, marginBottom: 16, fontSize: 12, color: "#e05030" }}>
                      Erreur: {videoResults.error}
                    </div>
                  )}
                  {videoResults.empty && (
                    <div style={{ padding: "12px", background: "#0d0d0f", border: "1px solid #1a1a1a", borderRadius: 6, marginBottom: 16, fontSize: 11, color: "#999", lineHeight: 1.6 }}>
                      Aucune ligne analysee pour l'instant. Va cliquer quelques lignes en Focus Mode dans les morceaux qui t'interessent — chaque analyse s'accumule, et c'est cette matiere que le scan explore.
                    </div>
                  )}
                  {videoResults.angles && videoResults.angles.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <div onClick={function() { setVideoBruteExpanded(function(p) { return !p; }); }}
                        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", paddingBottom: 6, marginBottom: videoBruteExpanded ? 16 : 0, borderBottom: "1px solid #1a1a1a" }}>
                        <span style={{ fontSize: 10, color: "#666" }}>{videoBruteExpanded ? "▾" : "▸"}</span>
                        <span style={{ fontSize: 9, color: "#666", letterSpacing: 3, textTransform: "uppercase" }}>matiere brute</span>
                        <span style={{ fontSize: 9, color: "#444", fontStyle: "italic" }}>tout ce que le scan a trouve, pour fouiller au-dela des essentielles</span>
                      </div>
                      {videoBruteExpanded && videoResults.angles.map(function(angle, ai) {
                        var angleColors = ["#38bdf8", "#4ade80", "#f0c040", "#e05030", "#c084fc"];
                        var ac = angleColors[ai % angleColors.length];
                        var validLignes = (angle.lignes || []).map(function(ligne) {
                          var cached = cacheGet(ligne.artist, ligne.track);
                          var a = cached && cached.d && resolveLineAnalysis(cached.d, ligne.lineIdx);
                          return a ? { ligne: ligne, a: a } : null;
                        }).filter(Boolean);
                        // Tri mecanique (pas de jugement IA): plus une ligne a de matiere (arc/mirror/
                        // philo/callbacks), plus haut elle remonte — pas un ordre invente par le modele.
                        validLignes.sort(function(x, y) { return lineRichness(y.a) - lineRichness(x.a); });
                        var isExpanded = !!videoAngleExpanded[ai];
                        var showAll = !!videoAngleShowAll[ai];
                        var visible = showAll ? validLignes : validLignes.slice(0, 5);
                        var hiddenCount = validLignes.length - visible.length;
                        return (
                          <div key={ai} style={{ marginBottom: 12, paddingLeft: 12, borderLeft: "3px solid " + ac }}>
                            <div onClick={function() { setVideoAngleExpanded(function(p) { var n = Object.assign({}, p); n[ai] = !n[ai]; return n; }); }}
                              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "6px 0" }}>
                              <span style={{ fontSize: 10, color: ac }}>{isExpanded ? "▾" : "▸"}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: ac }}>{angle.titre}</span>
                              <span style={{ fontSize: 10, color: "#555" }}>({validLignes.length} ligne{validLignes.length > 1 ? "s" : ""})</span>
                            </div>
                            {isExpanded && (
                              <div style={{ marginTop: 4 }}>
                                {visible.map(function(item, li) {
                                  var ligne = item.ligne, a = item.a;
                                  var key = videoLineKey(ligne.artist, ligne.track, ligne.lineIdx);
                                  var isChecked = !!videoSelected[key];
                                  return (
                                    <label key={li} style={{
                                      display: "flex", gap: 10, marginBottom: 10, padding: "10px 12px",
                                      background: isChecked ? "#12101a" : "#0a0a0a",
                                      border: "1px solid " + (isChecked ? "#3a2a4a" : "#1a1a1a"),
                                      borderRadius: 6, cursor: "pointer",
                                    }}>
                                      <input type="checkbox" checked={isChecked}
                                        onChange={function() { toggleVideoLine(ligne.artist, ligne.track, ligne.lineIdx); }}
                                        style={{ marginTop: 3, flexShrink: 0 }} />
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 9, color: "#666", textTransform: "lowercase" }}>{ligne.artist} — {ligne.track}</div>
                                        <div style={{ fontSize: 13, color: "#eee", lineHeight: 1.5, marginTop: 4 }}>"{a.o}"</div>
                                        {a.t && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic", marginTop: 2 }}>{a.t}</div>}
                                        {ligne.pourquoi && <div style={{ fontSize: 10, color: ac, lineHeight: 1.4, marginTop: 6 }}>{stripCitationMarks(ligne.pourquoi)}</div>}
                                        {a.sens && <div style={{ fontSize: 10, color: "#bbb", lineHeight: 1.4, marginTop: 4 }}><b>sens</b> {a.sens}</div>}
                                        {a.arc && <div style={{ fontSize: 10, color: "#4ade80", lineHeight: 1.4, marginTop: 4 }}><b>arc</b> {a.arc}</div>}
                                        {a.mirror && <div style={{ fontSize: 10, color: "#e05030", lineHeight: 1.4, marginTop: 4 }}><b>miroir</b> {a.mirror}</div>}
                                        {a.philo && a.philo.explication && <div style={{ fontSize: 10, color: "#38bdf8", lineHeight: 1.4, marginTop: 4 }}><b>philo ({a.philo.ref})</b> {a.philo.explication}</div>}
                                      </div>
                                    </label>
                                  );
                                })}
                                {hiddenCount > 0 && (
                                  <button onClick={function() { setVideoAngleShowAll(function(p) { var n = Object.assign({}, p); n[ai] = true; return n; }); }}
                                    style={{ background: "transparent", border: "none", color: "#666", fontSize: 10, cursor: "pointer", padding: "4px 0 10px", textDecoration: "underline" }}>
                                    voir les {hiddenCount} autres
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {showDetail && activePanel === 'thematic' && (
            <div style={S.detail}>
              <button onClick={function() { setActivePanel(null); if (!tracks.length) setView("input"); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- retour"}</button>
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

              {thematicResults && thematicResults.angles && thematicResults.angles.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {thematicResults.theme_complet && (
                    <div style={{ fontSize: 12, color: "#999", fontStyle: "italic", marginBottom: 16, paddingBottom: 10, borderBottom: "1px solid #1a1a1a" }}>
                      {thematicResults.theme_complet}
                    </div>
                  )}
                  {thematicResults.angles.map(function(angle, ai) {
                    var hasPassages = angle.passages && angle.passages.length > 0;
                    return (
                      <div key={ai} style={{ marginBottom: 28 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "#38bdf8" }}>{angle.name}</span>
                        </div>
                        {angle.description && <div style={{ fontSize: 10, color: "#666", marginBottom: 12 }}>{angle.description}</div>}
                        {!hasPassages && (
                          <div style={{ fontSize: 10, color: "#333", fontStyle: "italic", padding: "8px 0" }}>Aucun passage trouve pour cet angle dans tes albums.</div>
                        )}
                        {hasPassages && angle.passages.map(function(pas, pi) {
                          var pertColor = pas.pertinence >= 9 ? "#38bdf8" : pas.pertinence >= 7 ? "#4ade80" : "#888";
                          var lines = pas.lines || [];
                          var isCopied = thematicCopied === (pas.track + ai + pi);
                          return (
                            <div key={pi} style={{ marginBottom: 18, paddingLeft: 12, borderLeft: "3px solid " + pertColor }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                <span style={{ fontSize: 16, fontWeight: 700, color: pertColor, lineHeight: 1 }}>{pas.pertinence}</span>
                                <div>
                                  <div style={{ fontSize: 10, color: "#f0c040", letterSpacing: 1, textTransform: "uppercase" }}>{pas.track}</div>
                                  <div style={{ fontSize: 9, color: "#555" }}>{pas.artist}{pas.album ? " — " + pas.album : ""}</div>
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
                              {pas.link && <div style={{ fontSize: 11, color: "#999", lineHeight: 1.4, marginBottom: 6 }}>{pas.link}</div>}
                              <button
                                onClick={function() {
                                  var text = "🎤 " + thematicQuery.toUpperCase() + " — " + angle.name + "\n\n";
                                  lines.forEach(function(l) { var o = typeof l === "object" ? l.o : l; var t = typeof l === "object" ? l.t : null; text += o + "\n"; if (t) text += t + "\n"; text += "\n"; });
                                  text += "🎵 " + pas.track + " — " + pas.artist;
                                  try { navigator.clipboard.writeText(text); setThematicCopied(pas.track + ai + pi); setTimeout(function() { setThematicCopied(""); }, 2000); } catch(e) {}
                                }}
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
                      </div>
                    );
                  })}
                </div>
              )}

              {thematicResults && (!thematicResults.angles || thematicResults.angles.length === 0) && !thematicLoading && (
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

          {showDetail && activePanel === 'bestBars' && (
            <div style={S.detail}>
              <button onClick={function() { setActivePanel(null); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- retour"}</button>
              <div style={S.trackTitle}>★ Best Bars</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 4, marginBottom: 6 }}>{artist} — {album}</div>
              <div style={{ fontSize: 10, color: "#333", marginBottom: 22, fontStyle: "italic" }}>Les meilleurs passages de l'album, classes par impact.</div>
              {bestBarsLoading && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><div style={Object.assign({}, S.spinner, { width: 12, height: 12, margin: 0 })} /><span style={{ fontSize: 10, color: "#555", fontStyle: "italic" }}>extraction des best bars...</span></div>}
              {bestBars && bestBars.length > 0 && bestBars.map(function(bar, i) {
                var rank = i + 1;
                var impactColor = rank <= 3 ? "#e05030" : rank <= 6 ? "#f0c040" : "#888";
                var lines = bar.lines || [];
                var isNewFormat = lines.length > 0 && typeof lines[0] === "object";
                var barType = bar.type || "";
                var barTypeColor = TYPE_COLORS[barType] || "#666";
                return (
                  <div key={i} style={{ marginBottom: 32, paddingLeft: 12, borderLeft: "3px solid " + impactColor }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 22, fontWeight: 800, color: impactColor, lineHeight: 1 }}>{"#" + rank}</span>
                      {barType && <span style={{ fontSize: 8, color: barTypeColor, border: "1px solid " + barTypeColor, padding: "1px 6px", borderRadius: 10, textTransform: "uppercase", letterSpacing: 1 }}>{barType}</span>}
                      <span onClick={function() { setActivePanel(null); decode(bar.track, false); }} style={{ fontSize: 9, color: "#f0c040", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>{bar.track}</span>
                      <span style={{ fontSize: 10, color: "#555", marginLeft: "auto" }}>{bar.impact + "/10"}</span>
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

          {showDetail && activePanel === 'albumPl' && (
            <div style={S.detail}>
              <button onClick={function() { setActivePanel(null); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- retour"}</button>
              <div style={S.trackTitle}>★ Best of {album}</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 4, marginBottom: 18 }}>{artist} — les meilleures lignes du disque</div>
              {albumPlLoading && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <div style={Object.assign({}, S.spinner, { width: 12, height: 12, margin: 0 })} />
                  <span style={{ fontSize: 10, color: "#555", fontStyle: "italic" }}>
                    analyse en cours{albumPlProg ? " — " + albumPlProg.done + "/" + albumPlProg.total + " morceaux" : ""}...
                    {albumPlProg && albumPlProg.total > 3 ? " (le quota gratuit limite a ~20 appels/min, compte plusieurs minutes)" : ""}
                  </span>
                </div>
              )}
              {!albumPlLoading && albumPlFails.length > 0 && (
                <div style={{ margin: "0 0 16px", padding: "9px 11px", background: "#1a1408", border: "1px solid #3a2a10", borderRadius: 5, fontSize: 10, color: "#c08040", lineHeight: 1.5 }}>
                  ⚠ {albumPlFails.length} morceau{albumPlFails.length > 1 ? "x" : ""} non analyse{albumPlFails.length > 1 ? "s" : ""} ({albumPlFails.join(", ")}) — quota API ou reponse invalide.{" "}
                  <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={extractAlbumPunchlines}>Relancer</span>
                </div>
              )}
              {(function() {
                var analyzed = tracks.map(function(t, ti) {
                  var e = data[t];
                  if (!e || e.st !== "ok" || !e.d || !e.d.analysis) return null;
                  return { name: t, idx: ti, a: e.d.analysis };
                }).filter(Boolean);
                if (!albumPlLoading && analyzed.length === 0) {
                  return <div style={{ color: "#444", fontSize: 11 }}>Aucun son analyse. Decode d'abord des morceaux, puis reviens ici.</div>;
                }
                var norm = function(s) { return (s || "").toLowerCase().replace(/[^a-z0-9à-ÿ\s]/g, "").replace(/\s+/g, " ").trim(); };
                var usedTexts = [];
                var isDup = function(text) {
                  var nt = norm(text);
                  if (nt.length < 15) return false;
                  for (var i = 0; i < usedTexts.length; i++) {
                    var ut = usedTexts[i];
                    if (nt === ut || nt.indexOf(ut) !== -1 || ut.indexOf(nt) !== -1) return true;
                  }
                  return false;
                };
                var pool = [];
                analyzed.forEach(function(item) {
                  (item.a.essentiel || []).forEach(function(p) {
                    if (isDup(p.o)) return;
                    usedTexts.push(norm(p.o));
                    pool.push({ p: p, song: item.name, score: item.a.score || 0 });
                  });
                  (item.a.multis || []).forEach(function(m) {
                    if (m.syllables >= 3) {
                      var lines = m.lines || [];
                      if (lines.some(isDup)) return;
                      lines.forEach(function(ln) { usedTexts.push(norm(ln)); });
                      pool.push({
                        p: { o: lines.join("\n"), t: null, why: m.note, type: "technique", rhymed: m.rhymed, syllables: m.syllables, impact: m.impact },
                        song: item.name, score: item.a.score || 0, isTech: true
                      });
                    }
                  });
                });
                pool.sort(function(x, y) {
                  var xi = (x.p.impact != null) ? x.p.impact : x.score;
                  var yi = (y.p.impact != null) ? y.p.impact : y.score;
                  return yi - xi;
                });
                var top = [];
                var songCount = {};
                pool.forEach(function(item) {
                  var c = songCount[item.song] || 0;
                  if (c < 4) {
                    top.push(item);
                    songCount[item.song] = c + 1;
                  }
                });
                top = top.slice(0, 15);
                if (!albumPlLoading && top.length === 0) {
                  return <div style={{ color: "#444", fontSize: 11 }}>Pas encore de lignes essentielles. Analyse plus de morceaux.</div>;
                }
                return top.map(function(item, i) {
                  var p = item.p;
                  var tc = TYPE_COLORS[p.type] || "#666";
                  var rank = i + 1;
                  var rankColor = rank <= 3 ? "#e05030" : rank <= 6 ? "#f0c040" : "#555";
                  return (
                    <div key={i} style={{ marginBottom: 22, paddingLeft: 10, borderLeft: "2px solid " + tc, position: "relative" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 18, fontWeight: 800, color: rankColor, lineHeight: 1.2, minWidth: 24, flexShrink: 0 }}>{"#" + rank}</span>
                        <div style={{ flex: 1 }}>
                          {item.isTech && p.rhymed ? (
                            <div>
                              {(p.o || "").split("\n").map(function(ln, li) {
                                var rh = p.rhymed && p.rhymed[li] ? p.rhymed[li] : "";
                                if (rh && ln.indexOf(rh) !== -1) {
                                  var idx = ln.indexOf(rh);
                                  return (
                                    <div key={li} style={{ fontSize: 14, color: "#e6e6e6", lineHeight: 1.6 }}>
                                      {ln.slice(0, idx)}
                                      <span style={{ color: "#a855f7", fontWeight: 700, textDecoration: "underline", textDecorationColor: "#a855f740" }}>{rh}</span>
                                      {ln.slice(idx + rh.length)}
                                    </div>
                                  );
                                }
                                return <div key={li} style={{ fontSize: 14, color: "#e6e6e6", lineHeight: 1.6 }}>{ln}</div>;
                              })}
                              {p.syllables && <span style={{ fontSize: 9, color: "#a855f7", marginTop: 4, display: "inline-block" }}>{p.syllables} syllabes</span>}
                            </div>
                          ) : (
                            <div>
                              <div style={{ fontSize: 14, color: "#e6e6e6", lineHeight: 1.5 }}>{p.o}</div>
                              {p.t && <div style={{ fontSize: 11, color: "#777", fontStyle: "italic", marginTop: 2 }}>{p.t}</div>}
                            </div>
                          )}
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                            {p.type && <span style={{ fontSize: 8, color: tc, border: "1px solid " + tc, padding: "1px 6px", borderRadius: 10, textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>{p.type}</span>}
                            <span onClick={function() { setActivePanel(null); decode(item.song, false); }} style={{ fontSize: 9, color: "#f0c040", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>{item.song}</span>
                          </div>
                          {p.why && <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>{p.why}</div>}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {showDetail && !activePanel && sel && (
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
                        ? (curD._untranslated
                            ? <span style={Object.assign({}, S.tag, { color: "#e07070" })} title="Les paroles ont ete recuperees mais la traduction a echoue.">paroles non traduites</span>
                            : <span style={Object.assign({}, S.tag, { color: "#4ade80" })}>paroles trouvees</span>)
                        : <span style={Object.assign({}, S.tag, { color: "#f0c040" })}>pas de paroles</span>}
                      {curD._source && (curD._source === "llm-recall" || curD._source === "sonar-search")
                        ? <>
                            <span style={Object.assign({}, S.tag, { color: "#f0c040" })} title="Paroles trouvees par l'IA via recherche web, pas depuis une base de paroles classique — verifie si un doute, de petites imprecisions restent possibles.">reconstruction IA</span>
                            <span style={Object.assign({}, S.tag, { color: "#666", cursor: "pointer", textDecoration: "underline" })} title="Rejoue la recherche a partir de zero (ignore le resultat en cache)" onClick={function() { decode(sel, false, true); }}>relancer</span>
                          </>
                        : curD._source && <a href={curD._source} target="_blank" rel="noopener noreferrer" style={Object.assign({}, S.tag, { color: "#555", textDecoration: "none" })}>source</a>}
                      <span style={{ fontSize: 9, color: "#333", marginLeft: "auto" }}>Clique une ligne pour analyser</span>
                    </div>
                    {curD.lines && curD.lines.some(function(l) { return l.o; }) && (function() {
                      var totalLyricLines = curD.lines.filter(function(l) { return l.o; }).length;
                      var analyzedCount = Object.keys(curD.lineAnalyses || {}).length;
                      var allDone = analyzedCount >= totalLyricLines;
                      return (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                          <button onClick={analyzeAllLines} disabled={deepScanRunning || allDone} style={{
                            background: "transparent", border: "1px solid " + (allDone ? "#1a2a20" : "#2a2a2a"), borderRadius: 4,
                            color: deepScanRunning ? "#555" : allDone ? "#4ade80" : "#4ade80",
                            fontFamily: "inherit", fontSize: 10, padding: "6px 12px",
                            cursor: deepScanRunning || allDone ? "default" : "pointer",
                            letterSpacing: 2, textTransform: "uppercase",
                          }}>
                            {deepScanRunning ? "analyse... " + deepScanProgress.done + "/" + deepScanProgress.total : allDone ? "✓ tout analyse" : "analyser tout"}
                          </button>
                          {!deepScanRunning && <span style={{ fontSize: 9, color: "#555" }}>{analyzedCount}/{totalLyricLines} lignes analysees</span>}
                        </div>
                      );
                    })()}
                  </div>

                  {curD.context && (realVal(curD.context.summary) || realVal(curD.context.album)) && (function() {
                    var ctx = curD.context;
                    var cAlbum = realVal(ctx.album), cYear = realVal(ctx.year), cProd = realVal(ctx.producer);
                    var cRole = realVal(ctx.role), cSummary = realVal(ctx.summary), cStandout = realVal(ctx.standout);
                    var cPhilo = realVal(ctx.philo);
                    var sd = ctx.sonic_dna || {};
                    var sdMood = realVal(sd.mood), sdEnergy = realVal(sd.energy), sdProd = realVal(sd.prod), sdTexture = realVal(sd.texture);
                    var sdSimilar = (sd.similar || []).filter(function(s) { return realVal(s); });
                    var hasSonic = sdMood || sdEnergy || sdProd || sdTexture || sdSimilar.length > 0;
                    return (
                      <Fold title="CONTEXTE & ANALYSE" color="#f0c040">
                        {(cAlbum || cYear || cProd) && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginBottom: 10, fontSize: 11 }}>
                            {cAlbum && <span style={{ color: "#555" }}><span style={{ color: "#333", textTransform: "uppercase", fontSize: 9 }}>album:</span> <span style={{ color: "#999" }}>{cAlbum}</span></span>}
                            {cYear && <span style={{ color: "#555" }}><span style={{ color: "#333", textTransform: "uppercase", fontSize: 9 }}>annee:</span> <span style={{ color: "#999" }}>{cYear}</span></span>}
                            {cProd && <span style={{ color: "#555" }}><span style={{ color: "#333", textTransform: "uppercase", fontSize: 9 }}>prod:</span> <span style={{ color: "#999" }}>{cProd}</span></span>}
                          </div>
                        )}
                        {cRole && (
                          <div style={{ fontSize: 10, color: "#f0c040", marginBottom: 10, fontStyle: "italic" }}>{cRole}</div>
                        )}
                        {ctx.themes && ctx.themes.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                            {ctx.themes.map(function(th, ti) {
                              return <span key={ti} style={{ fontSize: 9, padding: "2px 8px", border: "1px solid #2a2a2a", borderRadius: 20, color: "#888", letterSpacing: 1 }}>{th}</span>;
                            })}
                          </div>
                        )}
                        {cSummary && <div style={{ fontSize: 12, lineHeight: 1.6, color: "#bbb", marginBottom: cStandout ? 10 : 0 }}>{cSummary}</div>}
                        {cStandout && (
                          <div style={{ borderLeft: "2px solid #a855f7", paddingLeft: 8, marginTop: 4, marginBottom: cPhilo ? 10 : 0 }}>
                            <div style={{ fontSize: 8, color: "#a855f7", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>ce qui distingue ce morceau</div>
                            <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5 }}>{cStandout}</div>
                          </div>
                        )}
                        {cPhilo && cPhilo.explication && (
                          <div style={{ borderLeft: "2px solid #38bdf8", paddingLeft: 8, marginTop: 4, marginBottom: hasSonic ? 10 : 0 }}>
                            <div style={{ fontSize: 8, color: "#38bdf8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>parallele philo</div>
                            {cPhilo.ref && <div style={{ fontSize: 10, color: "#38bdf8", fontStyle: "italic", marginBottom: 3 }}>{cPhilo.ref}</div>}
                            <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5 }}>{cPhilo.explication}</div>
                          </div>
                        )}
                        {hasSonic && (
                          <div style={{ borderLeft: "2px solid #4ade80", paddingLeft: 8, marginTop: 4 }}>
                            <div style={{ fontSize: 8, color: "#4ade80", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>sonic dna</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: sdSimilar.length ? 6 : 0, fontSize: 11 }}>
                              {sdMood && <span style={{ color: "#999" }}><span style={{ color: "#555" }}>mood:</span> {sdMood}</span>}
                              {sdEnergy && <span style={{ color: "#999" }}><span style={{ color: "#555" }}>energie:</span> {sdEnergy}</span>}
                              {sdProd && <span style={{ color: "#999" }}><span style={{ color: "#555" }}>prod:</span> {sdProd}</span>}
                              {sdTexture && <span style={{ color: "#999" }}><span style={{ color: "#555" }}>texture:</span> {sdTexture}</span>}
                            </div>
                            {sdSimilar.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {sdSimilar.map(function(s, si) {
                                  return <span key={si} style={{ fontSize: 9, padding: "2px 8px", border: "1px solid #2a2a2a", borderRadius: 20, color: "#888" }}>{s}</span>;
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </Fold>
                    );
                  })()}

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
                      {plLoading ? "analyse..." : "★ meilleures barres"}
                    </button>
                  )}

                  {curD.analysis && <AnalysisView a={curD.analysis} />}

                  {curD._incomplete && (
                    <div style={{ margin: "0 0 10px", padding: "9px 11px", background: "#1a1408", border: "1px solid #3a2a10", borderRadius: 5, fontSize: 10, color: "#c08040", lineHeight: 1.5 }}>
                      ⚠ Texte incomplet : {curD._incomplete.got} lignes rendues sur {curD._incomplete.expected} recuperees a la source.
                      Le modele en a saute une partie malgre une relance. Relance le decodage pour reessayer.
                    </div>
                  )}

                  {curD._untranslated && (
                    <div style={{ margin: "0 0 10px", padding: "9px 11px", background: "#1a0e0e", border: "1px solid #3a1a1a", borderRadius: 5, fontSize: 10, color: "#e07070", lineHeight: 1.5 }}>
                      ⚠ Paroles bien recuperees ({curD._untranslated.chars} caracteres) mais la traduction a echoue : {curD._untranslated.reason}.
                      Le texte original est affiche non traduit.{" "}
                      <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={function() { decode(sel, false, true); }}>Reessayer la traduction</span>
                    </div>
                  )}

                  {curD.lines && curD.lines.length > 0 && (
                    <Fold title={isFrenchLang(curD.lang) ? "PAROLES" : "PAROLES + TRADUCTION"} color="#4ade80">
                      {curD.lines.map(function(l, i) {
                        if (l.s) return <div key={i} style={S.section}>{l.s}</div>;
                        var conf = typeof l.c === "number" ? l.c : 100;
                        var isUncertain = conf < 70;
                        var lineNotes = (curD.notes || []).filter(function(n) {
                          return l.o && n.r && l.o.toLowerCase().indexOf(n.r.toLowerCase()) !== -1;
                        });
                        return (
                          <div key={i} style={Object.assign({}, S.linePair, { cursor: "pointer" })} onClick={function() { analyzeLine(i, l); }}>
                            <div style={S.og}>
                              {l.o}
                              {isUncertain && <span title={"Confiance: " + conf + "%"} style={S.uncertainBadge}>?</span>}
                            </div>
                            {l.t && l.t !== l.o && !isFrenchLang(curD.lang) ? <div style={Object.assign({}, S.tr, isUncertain ? { color: "#8a7a4a" } : {})}>{l.t}</div> : null}
                            {lineNotes.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                                {lineNotes.map(function(n, ni) {
                                  var typeColors = { slang: "#f0c040", ref: "#e05030", wordplay: "#a855f7", sample: "#4ade80" };
                                  var tc = typeColors[n.t] || "#555";
                                  return <span key={ni} style={{ fontSize: 9, color: tc, background: tc + "12", padding: "2px 6px", borderRadius: 3, lineHeight: 1.3 }}>{n.r}: {n.e}</span>;
                                })}
                              </div>
                            )}
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
          {showAnnex && (
            <div style={S.annex}>
              {mode === "album" && (albumCtx || albumCtxLoading) && (
                <div style={{ margin: "0 12px 10px", padding: "10px 12px", background: "#0a0a0f", border: "1px solid #1a1a2a", borderRadius: 6 }}>
                  {albumCtxLoading && !albumCtx && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={Object.assign({}, S.spinner, { width: 10, height: 10, margin: 0 })} />
                      <span style={{ fontSize: 9, color: "#555" }}>contexte album...</span>
                    </div>
                  )}
                  {albumCtx && (function() {
                    var aYear = realVal(albumCtx.year), aLabel = realVal(albumCtx.label), aEra = realVal(albumCtx.era);
                    var aSummary = realVal(albumCtx.summary), aBackstory = realVal(albumCtx.backstory), aImportance = realVal(albumCtx.importance);
                    var aInfluencesRaw = realVal(albumCtx.influences);
                    var aInfluences = isGenericFillerInfluence(aInfluencesRaw, artist) ? null : aInfluencesRaw;
                    // Contexte perso rattache par le modele lui-meme a un AUTRE album:
                    // on ne l'affiche pas sous celui-ci, on dit d'ou il vient vraiment.
                    var ctxMatch = backstoryMatchesAlbum(albumCtx.backstory_album, album);
                    var aMisattributed = null;
                    // Le modele recopie parfois mecaniquement l'album demande dans
                    // backstory_album: on ne se contente donc pas de sa declaration, on
                    // relit aussi ce qu'il raconte (backstory ET summary, la revendication
                    // de titre pouvant tomber dans l'un ou l'autre).
                    var namesake = claimsForeignNamesake(aBackstory, album, artist) || claimsForeignNamesake(aSummary, album, artist);
                    if (aBackstory && (ctxMatch === false || namesake)) {
                      aMisattributed = (ctxMatch === false && realVal(albumCtx.backstory_album)) ||
                        (namesake ? "un autre disque, celui qui porte le nom de " + namesake : null);
                      aBackstory = null;
                      // L'influence sort du meme raisonnement quand elle ne fait que
                      // renommer l'evenement mal attribue (ici: la psychiatre elle-meme).
                      if (aInfluences && aMisattributed && normAlbumTitle(aInfluences).indexOf(normAlbumTitle(aMisattributed)) !== -1) aInfluences = null;
                      // Une revendication de titre erronee ne salit pas que le backstory:
                      // le resume et l'influence decrivent alors le meme mauvais disque.
                      if (namesake) {
                        if (claimsForeignNamesake(aSummary, album, artist)) aSummary = null;
                        if (aInfluences && aInfluences.indexOf(namesake) !== -1) aInfluences = null;
                      }
                    }
                    return (
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginBottom: 6, fontSize: 10 }}>
                        {aYear && <span style={{ color: "#f0c040" }}>{aYear}</span>}
                        {aLabel && <span style={{ color: "#555" }}>{aLabel}</span>}
                        {aEra && <span style={{ color: "#38bdf8" }}>{aEra}</span>}
                      </div>
                      {albumCtx.themes && albumCtx.themes.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                          {albumCtx.themes.map(function(th, ti) {
                            return <span key={ti} style={{ fontSize: 9, color: "#a855f7", background: "#a855f712", padding: "2px 6px", borderRadius: 3 }}>{th}</span>;
                          })}
                        </div>
                      )}
                      {aSummary && <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5, marginBottom: 6 }}>{stripCitationMarks(aSummary)}</div>}
                      {aBackstory && (
                        <div style={{ borderLeft: "2px solid #e05030", paddingLeft: 8, marginBottom: 8 }}>
                          <div style={{ fontSize: 8, color: "#e05030", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>contexte perso</div>
                          <div style={{ fontSize: 11, color: "#bbb", lineHeight: 1.5 }}>{stripCitationMarks(aBackstory)}</div>
                        </div>
                      )}
                      {aMisattributed && (
                        <div style={{ borderLeft: "2px solid #c08040", paddingLeft: 8, marginBottom: 8 }}>
                          <div style={{ fontSize: 8, color: "#c08040", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>contexte perso ecarte</div>
                          <div style={{ fontSize: 10, color: "#8a7050", lineHeight: 1.5 }}>
                            L'evenement trouve se rattache a « {aMisattributed} », pas a cet album. Non affiche ici pour ne pas le recoller au mauvais disque.
                          </div>
                        </div>
                      )}
                      {aInfluences && (
                        <div style={{ borderLeft: "2px solid #4ade80", paddingLeft: 8, marginBottom: 8 }}>
                          <div style={{ fontSize: 8, color: "#4ade80", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>influence notable</div>
                          <div style={{ fontSize: 11, color: "#bbb", lineHeight: 1.5 }}>{stripCitationMarks(aInfluences)}</div>
                        </div>
                      )}
                      {aImportance && <div style={{ fontSize: 10, color: "#777", lineHeight: 1.4, fontStyle: "italic" }}>{stripCitationMarks(aImportance)}</div>}
                      {albumCtx.producers && albumCtx.producers.length > 0 && (
                        <div style={{ fontSize: 9, color: "#444", marginTop: 6 }}>prod: {albumCtx.producers.join(", ")}</div>
                      )}
                      {albumCtx._citations && albumCtx._citations.length > 0 && (
                        <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid #1a1a2a", display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {albumCtx._citations.map(function(url, ci) {
                            return <a key={ci} href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 8, color: "#444", textDecoration: "none" }}>[{ci + 1}]</a>;
                          })}
                        </div>
                      )}
                      {albumCtx._ungrounded && (
                        <div title={albumCtx._ungrounded} style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid #3a2a1a", fontSize: 9, color: "#c08040", lineHeight: 1.4 }}>
                          ⚠ non verifie — repondu de memoire, sans recherche web. A recouper.
                        </div>
                      )}
                    </div>
                    );
                  })()}
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
                  {focusData.sens && (
                    <div style={S.analysisBlock}>
                      <div style={S.analysisLabel}>CE QU'IL DIT</div>
                      <div style={S.analysisText}>{focusData.sens}</div>
                    </div>
                  )}
                  {focusData.technique && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#38bdf8" })}>TECHNIQUE</div>
                      <div style={S.analysisText}>{focusData.technique}</div>
                    </div>
                  )}
                  {focusData.couches && focusData.couches.length > 0 && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#a855f7" })}>COUCHES</div>
                      {focusData.couches.map(function(couche, i) {
                        return (
                          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                            <span style={{ fontSize: 9, color: "#a855f7", fontWeight: 700, marginTop: 2, flexShrink: 0 }}>{i + 1}.</span>
                            <div style={{ fontSize: 11, color: "#bbb", lineHeight: 1.5 }}>{couche}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {focusData.arc && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#4ade80" })}>ARC</div>
                      <div style={S.analysisText}>{focusData.arc}</div>
                    </div>
                  )}
                  {focusData.mirror && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#e05030" })}>MIROIR</div>
                      <div style={S.analysisText}>{focusData.mirror}</div>
                    </div>
                  )}
                  {focusData.philo && focusData.philo.explication && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#38bdf8" })}>PARALLELE PHILO</div>
                      {focusData.philo.ref && <div style={{ fontSize: 10, color: "#38bdf8", fontStyle: "italic", marginBottom: 4 }}>{focusData.philo.ref}</div>}
                      <div style={S.analysisText}>{focusData.philo.explication}</div>
                    </div>
                  )}
                  {focusData.callbacks && focusData.callbacks.length > 0 && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#f0c040" })}>↩ CALLBACKS</div>
                      {focusData.callbacks.map(function(cb, i) {
                        return (
                          <div key={i} style={{ fontSize: 11, color: "#ccc", lineHeight: 1.6, marginBottom: 8 }}>
                            <span style={{ color: "#f0c040", fontWeight: 600 }}>{cb.album}</span>
                            {cb.ligne && <span style={{ color: "#777" }}>{" → "}<span style={{ fontStyle: "italic" }}>"{cb.ligne}"</span></span>}
                            <span style={{ color: "#999" }}>{" → "}{cb.lien}</span>
                          </div>
                        );
                      })}
                    </div>
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

var TYPE_COLORS = { craft: "#a855f7", real: "#e05030", depth: "#38bdf8", subversion: "#f0c040", wordplay: "#a855f7", image: "#4ade80", flex: "#f0c040", technique: "#a855f7", vecu: "#e05030", punchline: "#f0c040", storytelling: "#4ade80" };

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
  var essentiel = a.essentiel || [], notable = a.notable || [], multis = a.multis || [];
  return (
    <div style={{ marginBottom: 24 }}>
      {essentiel.length > 0 && (
        <Fold title={"MEILLEURES BARRES (" + essentiel.length + ")"} color="#e05030">
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
  // Colonne annexe: largeur fixe, elle ne doit jamais manger la zone de lecture.
  annex: { width: 300, minWidth: 300, overflowY: "auto", borderLeft: "1px solid #141414", padding: "14px 0" },
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
