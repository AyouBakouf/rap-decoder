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
function isFrenchLang(lang) {
  var n = (lang || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return n === "francais" || n === "french" || n === "fr";
}
// Force t=null sur toutes les lignes francaises, peu importe comment le LLM a ecrit "lang"
// (evite la duplication texte/traduction quand le LLM renvoie "français" au lieu de "francais")
function sanitizeTranslation(r) {
  if (r && isFrenchLang(r.lang) && r.lines) {
    r.lines.forEach(function(l) { if (l.o) l.t = null; });
  }
  return r;
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
// Garde-fou mecanique: signature d'un LLM qui part en boucle degenerative faute de vraie source
// (invention) plutot que de vraies paroles — soit la MEME ligne repetee mot pour mot, soit un meme
// debut de ligne reutilise en masse (anaphore artificielle du style "I am the X, I am the Y...").
// Rejette le resultat entier plutot que d'afficher ce genre de remplissage comme si c'etait du reel.
function looksDegenerate(lines) {
  if (!lines || lines.length < 6) return false;
  var texts = lines.filter(function(l) { return l.o; }).map(function(l) { return norm(l.o); });
  if (texts.length < 6) return false;
  var counts = {};
  texts.forEach(function(t) { counts[t] = (counts[t] || 0) + 1; });
  var maxCount = Math.max.apply(null, Object.keys(counts).map(function(k) { return counts[k]; }));
  if (maxCount >= 4) return true;
  var prefixes = {};
  texts.forEach(function(t) {
    var p = t.split(/\s+/).slice(0, 3).join(" ");
    if (p.length >= 4) prefixes[p] = (prefixes[p] || 0) + 1;
  });
  var prefixCounts = Object.keys(prefixes).map(function(k) { return prefixes[k]; });
  var maxPrefix = prefixCounts.length ? Math.max.apply(null, prefixCounts) : 0;
  return maxPrefix >= 8 && maxPrefix / texts.length >= 0.3;
}
function ckey(artist, name) { return CV + ":song:" + norm(artist) + ":" + norm(name); }
function tlkey(artist, album) { return CV + ":tl:" + norm(artist) + ":" + norm(album); }
function cacheGet(artist, name) {
  try { var r = localStorage.getItem(ckey(artist, name)); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function cacheSet(artist, name, payload) {
  try { localStorage.setItem(ckey(artist, name), JSON.stringify(payload)); } catch (e) {}
}
function cacheClear(artist, name) {
  try { localStorage.removeItem(ckey(artist, name)); } catch (e) {}
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

var DEEP_ANALYSIS_SYSTEM = "Tu es un SUPER-ANALYSTE de rap obsessionnel. On te donne UNE ligne d'un morceau + le contexte + les lignes autour. Tu dois SURINTREPRETER: trouve TOUTES les couches de sens, meme les plus tirees. Mieux vaut proposer une interpretation audacieuse que rater un double sens.\n\nREGLE ABSOLUE: TOUT en FRANCAIS.\n\nReponds en JSON:\n{\n\"meaning\":\"ce que l'artiste dit, 2-3 phrases\",\n\"layers\":[\"couche de sens 1\",\"couche de sens 2\"],\n\"callbacks\":[{\"ref\":\"titre du morceau/album reference\",\"line\":\"la ligne/concept reference\",\"link\":\"comment ca se connecte\"}],\n\"refs\":[{\"r\":\"ref\",\"e\":\"explication\"}],\n\"wordplay\":\"explication si present\"\n}\n\nCHAMP \"layers\" (LE PLUS IMPORTANT — SURINTERPRETE):\nTrouve CHAQUE couche de sens possible dans la ligne:\n- Le sens litteral evident\n- Le double sens (mot qui veut dire 2 choses)\n- Le sens metaphorique (l'image renvoie a quoi)\n- Le sous-texte biographique (ca fait reference a quoi dans la vie de l'artiste)\n- La lecture politique/sociale si applicable\n- Le sens qui change quand on connait le contexte de l'album\nMets TOUTES les lectures, meme celles qui sont un peu tirees. 2 a 5 couches par ligne. Une seule couche = t'as pas assez creuse.\n\nCHAMP \"callbacks\" (CONNEXIONS AVEC D'AUTRES SONS):\nCherche si cette ligne fait echo a d'AUTRES morceaux du meme artiste:\n- Meme mot/image reutilise differemment (ex: Kendrick 'Wi-Fi' dans N95 vs 6:16 in LA)\n- Theme qui revient d'un album a l'autre\n- Reponse a un ancien morceau\n- Evolution d'une position (il disait X avant, maintenant il dit Y)\n- Reference a un beef, un featuring, un event\nSi y'a un callback, c'est de L'OR — mets-le. Si t'es pas sur a 100% mais que ca semble plausible, mets-le quand meme avec une nuance dans le 'link'.\nSi aucun callback trouve: callbacks=[]\n\nCHAMP \"refs\":\nPersonnes, marques, lieux, evenements, samples, argot. Explique chaque ref.\n\nCHAMP \"wordplay\":\nDouble sens, calembour, homophonie, multi. null si rien.\n\nSI DES \"ANNOTATIONS GENIUS REELLES\" SONT FOURNIES DANS LE MESSAGE: elles ont deja ete verifiees comme correspondant a cette ligne precise (ou une ligne toute proche) — utilise-les comme source fiable en priorite. Ne RECOPIE PAS l'annotation mot pour mot — reformule l'info avec tes propres mots dans le champ concerne (refs/layers/callbacks selon ce qui correspond), et precise \"d'apres une annotation Genius\" UNIQUEMENT si tu t'en sers reellement.\nSI LE MESSAGE DIT QU'AUCUNE ANNOTATION NE CORRESPOND: n'ecris JAMAIS \"d'apres une annotation Genius\" ni une formule equivalente — ce serait une fausse source. Analyse alors uniquement avec tes propres connaissances.\n\nSTYLE: parle comme un vrai passionne de rap qui decortique un son avec son pote. Direct, enthousiaste sur les trouvailles, pas academique.";

var CONTEXT_SYSTEM = "Tu connais bien le rap. On te donne un morceau (artiste + titre, parfois l'album). Donne du VRAI contexte et une VRAIE lecture de ce morceau specifique, en parlant SIMPLE comme a un pote qui connait le sujet a fond. Pas un resume Wikipedia — une vraie analyse.\n\nJSON UNIQUEMENT:\n{\"album\":\"nom ou null\",\"year\":null,\"producer\":\"prod ou null\",\"themes\":[\"theme1\",\"theme2\"],\"role\":\"le role de CE morceau dans l'album/la discographie, ou null\",\"summary\":\"3-5 phrases: de quoi parle vraiment ce morceau, en profondeur\",\"standout\":\"1-2 phrases: ce qui est particulier ou notable dans ce morceau precis, ou null\",\"philo\":\"parallele avec un penseur si genuinement pertinent, sinon null\"}\n\n- themes: 2-3 mots CONCRETS (\"argent facile\", \"deuil\", \"famille\"). JAMAIS abstraits (\"introspection\", \"alienation\").\n- \"role\": la fonction de CE morceau specifiquement — intro/mise en contexte, single/tube, tournant emotionnel de l'album, morceau le plus dur/vulnerable, outro/conclusion, feature marquant, sample notable, etc. Precise et concret, pas vague. Si tu sais pas: la valeur JSON null (pas le mot \"null\" entre guillemets).\n- \"summary\": va au-dela du sujet general, et surtout NE SOFTEN PAS le sujet reel du morceau. Si le morceau parle de coups, de maltraitance, de violence familiale, de deuil, de prison: DIS-LE frontalement, ne le reformule pas en histoire de perseverance/resilience feel-good. Explique CE QUE l'artiste dit vraiment, le ton, l'angle qu'il prend — pas une lecture edulcoree qui evite le sujet dur pour una morale positive. Exemple MAUVAIS (edulcore): 'un hymne a la perseverance et la force de se relever'. Exemple BON (specifique): 'il raconte les coups et les chatiments corporels recus de ses parents pendant l'enfance, et retourne cette violence en question: pourquoi le parent a le droit de frapper sans expliquer'. Langage courant, comme a un pote, pas de critique musicale pretentieuse.\n- \"standout\": qu'est-ce qui distingue CE morceau des autres du meme artiste/album — une prise de risque, un sujet rarement aborde dans le rap, un choix de production, une collab notable, un moment de vulnerabilite rare. Si rien de special: la valeur JSON null, n'invente pas un truc pour remplir le champ.\n- \"philo\": UNIQUEMENT si un vrai parallele existe, JAMAIS force. Penseurs a mobiliser quand pertinent: les stoiciens Marc Aurele et Epictete (accepter ce qui ne depend pas de nous, la vertu face a l'adversite, l'amor fati), Nietzsche (morale du maitre vs morale de l'esclave, le ressentiment, 'ce qui ne tue pas rend plus fort', la volonte de puissance, le depassement de soi, la critique de la morale conventionnelle), Platon (apparence vs realite, la justice, les trois parties de l'ame — raison/coeur/desir), Aristote (l'eudaimonia comme but de la vie, la vertu comme juste milieu entre deux exces, la catharsis — l'art qui purge une emotion en la rejouant), Sartre (la liberte radicale, la responsabilite totale, la mauvaise foi, 'on choisit qui on devient'), Morgan Housel sur la psychologie de l'argent (le rapport a l'argent est une cicatrice psychologique, pas un calcul rationnel; la difference entre richesse visible/flex et richesse reelle).\nECRIS LA CONNEXION AVEC TES PROPRES MOTS. N'ECRIS JAMAIS de citation extraite d'un de ces livres, meme courte, meme approximative — explique le CONCEPT, ne cite pas le TEXTE.\n1-2 phrases, direct et concret, comme un pote qui a lu de la philo mais qui parle pas comme un prof.\nExemple BON: 'Nietzsche appellerait ca la morale du maitre — il refuse la pitie et transforme la douleur en force au lieu de se poser en victime.'\nExemple MAUVAIS (trop academique / cite le texte): 'On observe ici une reminiscence de la dialectique nietzscheenne telle que developpee dans Par-dela bien et mal...'\nSi aucun parallele reel n'existe ou si tu dois forcer le lien: la valeur JSON null. Un parallele plaque qui sonne intello pour rien est pire que pas de parallele.\n- CRUCIAL sur year: ne mets une annee QUE si une recherche web confirme explicitement la date de sortie. Si t'hesites entre plusieurs annees ou que tu approximes: la valeur JSON null. Ne choisis jamais 'la plus probable'.\n- REGLE DE FORMAT: quand un champ est incertain, mets la vraie valeur JSON null (sans guillemets), JAMAIS la chaine de caracteres \"null\" entre guillemets — ce sont deux choses differentes et la deuxieme s'affiche comme du texte casse dans l'app.\n- CRUCIAL: ne devine JAMAIS l'album/annee/prod. Si pas SUR a 100%, cherche sur le web, sinon mets null. Une info fausse est pire que pas d'info. Meme discipline pour 'role' et 'standout': mieux vaut null qu'une affirmation en l'air.";

var ALBUM_CONTEXT_SYSTEM = "Tu es un expert rap. On te donne un ALBUM et un ARTISTE. Donne le contexte de cet album.\n\nJSON UNIQUEMENT:\n{\"year\":null,\"label\":\"nom du label ou null\",\"producers\":[\"prod1\",\"prod2\"],\"themes\":[\"theme1\",\"theme2\",\"theme3\"],\"era\":\"description courte de l'epoque/mouvement\",\"backstory\":\"l'evenement personnel reel qui a mene a cet album, ou null\",\"importance\":\"1-2 phrases: pourquoi cet album compte dans la discographie ou le genre\",\"summary\":\"3-4 phrases: de quoi parle l'album, le fil rouge, l'ambiance\",\"influences\":\"sample vocal, voix non-musicale, penseur/auteur cite qui structure l'album, ou null\"}\n\n=== REGLE LA PLUS IMPORTANTE, s'applique a CHAQUE champ factuel (year, label, producers, backstory) ===\nPour un champ factuel precis, tu as DEUX options: (1) tu as trouve l'info via une recherche web et tu es sur a 100%, tu la donnes telle quelle. (2) tu n'es pas sur, tu mets null (ou [] pour producers). IL N'Y A PAS DE TROISIEME OPTION. Ne remplis JAMAIS un champ avec une valeur plausible, approximative ou 'probablement correcte' — une annee approximative, un nom de label invente, une date arrondie sont TOUTES des ERREURS, pas des approximations acceptables. 3 champs a null valent mieux qu'1 champ faux.\n\"year\" EN PARTICULIER: c'est le champ le plus souvent devine au pif. Ne mets une annee QUE si ta recherche web a trouve une source qui la confirme explicitement (date de sortie, article, page de l'album). Si tu n'as trouve qu'une annee approximative ou que tu hesites entre plusieurs annees possibles, mets null — ne choisis PAS la plus probable, ne fais PAS de moyenne, n'utilise PAS l'annee de debut de carriere de l'artiste comme approximation.\n\nREGLES SPECIFIQUES:\n- themes: 3-5 mots CONCRETS. 'deuil du pere', 'sortir du quartier', 'flexer sur les haters'. JAMAIS 'introspection', 'alienation'.\n- era: situe dans le temps/mouvement. Ex: 'boom du drill FR 2022', 'golden era US East Coast', 'post-JMJD Despo Rutti'.\n- label: le VRAI nom du label/maison de disque QUE SI tu es sur a 100% (confirme par une source fiable). N'INVENTE JAMAIS un nom de label, projet ou collectif qui ressemble a un label. Si le moindre doute: null. Un label errone est pire qu'un champ vide.\n- \"backstory\" (IMPORTANT, ne pas oublier): l'evenement de vie REEL et PUBLIC qui explique pourquoi l'artiste a fait cet album — hospitalisation, deuil, rupture, incarceration, maladie, episode violent, separation d'un groupe, etc.\nCette info n'est a inclure QUE si l'artiste ou la presse en a deja parle PUBLIQUEMENT (interview, article) — dans ce cas c'est un fait deja assume publiquement par l'artiste lui-meme, tu n'as AUCUNE raison de l'edulcorer ou de rester vague par exces de precaution.\nMOTS/FORMULES INTERDITS (ils cachent le fait au lieu de le dire): 'des difficultes', 'des problemes', 'des deboires', 'une epreuve', 'une periode compliquee/difficile', 'des soucis', 'des blessures', 'ce qui l'a abime'.\nSi la source utilise un terme precis, REPRENDS-LE tel quel: hospitalisation psychiatrique, crise de paranoia/delire, tentative de suicide, overdose, garde a vue, incarceration, agression, etc.\nExemple MAUVAIS (trop vague): 'une peine sentimentale et des problemes psychiatriques l'ont plonge dans une depression'.\nExemple BON (precis et factuel): 'il a ete hospitalise en psychiatrie a plusieurs reprises suite a des crises de paranoia et de delire mystique, ce qu'il detaille lui-meme dans plusieurs interviews'.\n2-3 phrases factuelles, sans sensationalisme ni jugement moral — tu rapportes un fait deja public, pas un scandale. Cite la source si possible ('selon ses declarations a X', 'd'apres Y media').\nSi rien de tel n'est documente publiquement: null. Ne SPECULE JAMAIS au-dela de ce qui est confirme publiquement — la precision s'applique UNIQUEMENT a des faits deja sourcés, jamais a une hypothese.\n- importance: pourquoi ca compte. Parle NORMAL, pas comme un critique. Ex: 'Premier album solo apres la separation du groupe, il pose son identite.'\n- summary: raconte l'album comme a un pote. De quoi ca parle en vrai.\n- \"influences\": OBLIGATOIREMENT un NOM PROPRE precis (une personne reelle: auteur, penseur, predicateur, realisateur, autre artiste) dont la voix, les mots ou l'oeuvre apparaissent VRAIMENT sur le disque ou l'ont influence de facon documentee. Cherche activement sur le web \"qui est samplee/citee sur cet album\" — ne devine pas a partir du theme general.\nINTERDIT: reformuler le theme de l'album (\"la therapie\", \"l'examen de soi\", \"l'introspection\") comme si c'etait une 'influence' — ce n'est PAS ce qui est demande, c'est deja couvert par summary/backstory. Une influence = un NOM que tu peux citer, pas une description d'ambiance.\nSi tu ne peux pas nommer une personne precise et confirmee: la valeur JSON null. Ne remplis PAS ce champ avec une phrase generique juste pour eviter null.\nEcris QUI c'est et le THEME general de son propos (identite, ego, deuil, spiritualite, etc.) — mais ne cite JAMAIS le contenu exact de ce qu'il dit, ni une phrase de ses livres/discours.\nExemple BON: 'La voix d'Eckhart Tolle revient plusieurs fois sur le disque, notamment sur un interlude, ou il parle d'identite et de victimisation.'\nExemple FAUX (pas un nom, rejete): 'Les seances de therapie structurent l'album et Kendrick parle de son travail d'ecriture.' — ca c'est le theme general, pas une influence nommee.\n- producers: les principaux. Si pas sur, mets [].\n- CRUCIAL: ne devine RIEN. Si pas sur a 100%, utilise la recherche web. Mieux vaut null que faux.\n- TOUT en francais.";

var BEST_BARS_SYSTEM = "Tu es un amoureux de rap qui cherche les MOMENTS qui touchent. On te donne les paroles d'un ALBUM ENTIER. Extrais les meilleurs PASSAGES (4-8 barres consecutives).\n\nJSON UNIQUEMENT:\n{\"bars\":[{\"lines\":[{\"o\":\"ligne originale\",\"t\":\"traduction claire\"}],\"sens\":\"explication courte\",\"track\":\"nom du morceau\",\"why\":\"pourquoi ca touche\",\"type\":\"vecu\",\"impact\":8}]}\n\nFORMAT \"lines\":\nChaque ligne est un objet {\"o\":\"original\",\"t\":\"traduction\"}. Traduction CLAIRE. Si francais: t=null.\n\nCHAMP \"type\" (OBLIGATOIRE):\n- \"vecu\": experience personnelle, douleur, famille, rue\n- \"technique\": passage avec des multisyllabiques, rimes internes, ou flow technique dingue\n- \"punchline\": chute qui claque, image qui tue\n- \"storytelling\": narration, scene concrete\n\nCHAMP \"sens\" (1-2 phrases MAX):\nExplique le passage SIMPLEMENT. Comme a un pote. Dis QUI fait QUOI. Si y a des refs, explique-les.\nPas de pavé. 1-2 phrases precises > 4 phrases vagues.\n\nCHAMP \"why\" (1 phrase COURTE):\nParle comme un VRAI MEC. Interdit: 'puissance narrative', 'poignant', 'saisissant', 'evoquant', 'juxtaposition', 'resonance'.\n\nSELECTION:\n- 6 a 10 passages de 4-8 barres CONSECUTIVES par album.\n- VARIER les types: inclure au moins 1-2 passages TECHNIQUES (multis, schemas de rimes fous) si l'album en a.\n- Experiences universelles + prouesses techniques. Les deux comptent.\n- JAMAIS de punchlines isolees ou de barres non consecutives.\n- Trie par impact decroissant (impact 1-10).\n- TOUT en francais.";

var THEMATIC_SYSTEM = "L'utilisateur donne un THEME. Tu dois:\n1. DECOMPOSER ce theme en 3 a 5 ANGLES complementaires ou opposes\n2. Pour CHAQUE angle, chercher des passages pertinents dans les paroles fournies\n\nJSON UNIQUEMENT:\n{\n\"theme_complet\":\"reformulation enrichie du theme en 1 phrase\",\n\"angles\":[\n{\n\"name\":\"nom court de l'angle (ex: 'Porter un masque')\",\n\"description\":\"1 phrase qui explique cet angle du theme\",\n\"passages\":[{\"lines\":[{\"o\":\"ligne 1\",\"t\":\"trad 1\"},{\"o\":\"ligne 2\",\"t\":\"trad 2\"},{\"o\":\"ligne 3\",\"t\":\"trad 3\"},{\"o\":\"ligne 4\",\"t\":\"trad 4\"},{\"o\":\"ligne 5\",\"t\":\"trad 5\"},{\"o\":\"ligne 6\",\"t\":\"trad 6\"}],\"track\":\"morceau\",\"artist\":\"artiste\",\"album\":\"album\",\"link\":\"comment ca illustre cet angle, 1 phrase\",\"pertinence\":8}]\n}\n]\n}\n\nDECOMPOSITION DU THEME:\n- Trouve les FACES du concept: le pour/le contre, l'interieur/l'exterieur, celui qui agit/celui qui subit, la cause/la consequence.\n- Exemple pour 'assumer ses faiblesses': 'exposer ses vulnerabilites volontairement' / 'porter un masque pour cacher' / 'la vulnerabilite comme arme' / 'se faire exposer par quelqu'un' / 'la confession, l'aveu'\n- Exemple pour 'la trahison': 'se faire trahir par un proche' / 'trahir quelqu'un soi-meme' / 'le moment ou tu decouvres la trahison' / 'vivre apres la trahison' / 'la paranoia avant la preuve'\n- Les angles doivent etre CONCRETS et DIFFERENTS entre eux, pas des synonymes.\n\nPASSAGES:\n- MINIMUM 4, idealement 6-8 barres CONSECUTIVES du meme morceau pour chaque passage. JAMAIS 1-2 lignes isolees — un passage doit etre un BLOC qui a du sens seul.\n- Un passage qui MONTRE le theme a travers une scene > un passage qui le NOMME.\n- 1 a 3 passages par angle. Certains angles peuvent avoir 0 passages si rien de pertinent dans les paroles — c'est OK, garde l'angle quand meme (passages vide) pour que l'utilisateur voie qu'il existe.\n- Traduction ligne par ligne: {\"o\":\"original\",\"t\":\"traduction claire\"}. Si francais: t=null.\n- pertinence: 1-10.\n\nSTYLE:\n- Noms d'angles courts et percutants (3-5 mots).\n- \"link\": 1 phrase simple, comme a un pote.\n- TOUT en francais.";

var SUGGEST_SYSTEM = "On te donne un THEME et une liste d'albums que l'utilisateur a DEJA decodes. Suggere des morceaux de rap qu'il a PAS encore decodes mais qui seraient pertinents pour ce theme.\n\nJSON UNIQUEMENT:\n{\"suggestions\":[{\"artist\":\"artiste\",\"track\":\"titre du morceau\",\"album\":\"album\",\"why\":\"pourquoi ce morceau est pertinent pour le theme, 1 phrase\",\"pertinence\":8}]}\n\nREGLES:\n- 5 a 10 suggestions, triees par pertinence decroissante.\n- Ne suggere PAS de morceaux qui sont dans les albums deja decodes.\n- Privilegier des morceaux ou le theme est CENTRAL, pas juste mentionne en passant.\n- Melange des classiques et des morceaux moins connus mais pertinents.\n- Privilegier le rap US et FR underground/lyrical (Ka, billy woods, Earl, MIKE, Navy Blue, Mach-Hommy, Veust, Limsa, Infinit, Jeanjass, GAL, Alpha Wann, Dinos, Lomepal, Nekfeu, Vald, etc.) mais pas exclusivement.\n- \"why\": 1 phrase simple, en francais. Dis concretement de quoi parle le morceau par rapport au theme.\n- pertinence: 1-10. 10 = le morceau EST le theme.\n- TOUT en francais.";

var VIDRESEARCH_SYSTEM = "L'utilisateur prepare une VIDEO. Il decrit un ARGUMENT avec des artistes et moments precis.\n\nTON JOB: donner une VISION GLOBALE du terrain disponible, PAS ecrire le script de sa video a sa place. Tu n'imposes AUCUN ordre, AUCUNE structure narrative lineaire (pas de 'etape 1, 2, 3'). Tu fournis une CARTE de plusieurs angles/facettes explorables, avec les vrais morceaux qui servent chacun — l'utilisateur choisit lui-meme lesquels garder et dans quel ordre les monter. C'est LUI le realisateur, toi tu es un chercheur qui etale la matiere sur la table.\n\nJSON UNIQUEMENT:\n{\n\"argument_resume\":\"2-3 phrases\",\n\"angles\":[{\"titre\":\"nom court de l'angle/facette\",\"description\":\"1-2 phrases: ce que cet angle montre et comment il sert l'argument, SANS dire 'd'abord/ensuite/puis' — chaque angle est autonome, pas une etape\",\"morceaux\":[{\"artist\":\"x\",\"track\":\"x\",\"album\":\"x\",\"pourquoi\":\"1 phrase: ce que ce morceau apporte a CET angle precis\"}]}],\n\"connexions\":[{\"de\":\"morceau A\",\"vers\":\"morceau B\",\"lien\":\"description sans fausses citations\"}]\n}\n\nAVANT TOUTE CHOSE: lis le brief et identifie les ARTISTES PRINCIPAUX. Ex: si le brief parle de Kendrick et Drake, les artistes principaux sont Kendrick Lamar et Drake. POINT.\nATTENTION: un artiste mentionne seulement dans une clause secondaire (\"dans le beef avec Drake\", \"face a Papa Doc\") est QUAND MEME un artiste principal, meme si le sujet grammatical du brief est un autre artiste. Ne le traite PAS comme un simple antagoniste de contexte — cherche VRAIMENT ses morceaux.\nCAS SPECIFIQUE DU BEEF: si le brief decrit un beef/clash entre deux artistes, meme si un seul est le \"heros\" de l'histoire, TU DOIS chercher et inclure des morceaux DES DEUX COTES, repartis dans les angles pertinents. Un beef raconte avec les sons d'un seul camp est incomplet et FAUX — l'attaque de l'un et la reponse de l'autre sont toutes les deux necessaires pour que l'argument tienne debout.\n\n=== ANGLES, PAS UN PLAN ===\n3 a 5 angles/facettes DIFFERENTS et INDEPENDANTS du meme argument — pas des etapes d'un recit unique. Chaque angle doit pouvoir etre compris et utilise SEUL, sans les autres. Exemples de bons angles pour un argument 'exposer ses failles neutralise l'attaque': (1) comment l'artiste construit cette exposition sur son album, (2) comment l'adversaire tente et echoue a exploiter ces failles, (3) le parallele avec une reference externe (film, autre artiste), (4) un precedent historique similaire. Chaque angle a SES PROPRES morceaux (un morceau peut apparaitre dans plusieurs angles si vraiment pertinent).\nUn morceau peut apparaitre dans PLUSIEURS angles a la fois si c'est reellement justifie — ne force pas l'unicite.\n\n=== REGLE LA PLUS IMPORTANTE ===\nTOUS les morceaux dans TOUS les angles = UNIQUEMENT des morceaux des ARTISTES PRINCIPAUX identifies OU des morceaux EXPLICITEMENT NOMMES par l'utilisateur (voir exception ci-dessous). Cette regle sert a t'empecher de DERIVER vers des artistes que PERSONNE n'a demandes — elle ne sert PAS a exclure un morceau que l'utilisateur a lui-meme tape.\n\nEXCEPTION OBLIGATOIRE — MORCEAUX EXPLICITEMENT LISTES PAR L'UTILISATEUR:\nSi le brief contient une liste de titres de morceaux tapee par l'utilisateur (ex: 'Meet The Grahams, Story Of Adidon, push-ups...'), CHAQUE titre de cette liste DOIT apparaitre dans au moins un angle, PEU IMPORTE l'artiste — meme si c'est un troisieme artiste comme Pusha T dans un beef Kendrick/Drake. L'utilisateur qui tape un titre precis n'est PAS une derive a bloquer, c'est une INSTRUCTION DIRECTE que tu dois executer. Ne saute AUCUN titre de cette liste. Si tu ne peux pas confirmer l'artiste exact d'un titre liste, cherche-le sur le web plutot que de l'ignorer.\n\nEXEMPLES DE CE QUI EST INTERDIT (uniquement quand l'artiste n'est PAS explicitement demande):\n- Brief parle de Kendrick/Drake sans lister de titres precis -> suggerer Jay-Z, Boldy James, Little Simz, MIKE = INTERDIT\n- Brief mentionne 8 Mile comme PARALLELE conceptuel SANS lister de morceau precis d'Eminem -> mettre Lose Yourself comme morceau dans un angle = INTERDIT. 8 Mile est une REFERENCE pour expliquer le concept, PAS un artiste a inclure. Mentionne 8 Mile dans les DESCRIPTIONS et CONNEXIONS, jamais comme morceau.\n- Suggerer un artiste NI nomme dans le texte NI liste en titre precis = INTERDIT, meme s il est thematiquement proche.\n\nSi le brief dit Kendrick et Drake: les morceaux repartis dans les angles = sons de KENDRICK + sons de DRAKE. Rien d autre. Utilise la RECHERCHE WEB pour trouver TOUS les sons pertinents de ces deux artistes.\n\n=== RECHERCHE WEB ===\n- ATTENTION AU BIAIS DE DONNEES: les \"PAROLES DISPONIBLES\" fournies dans le message viennent SEULEMENT de ce que l'utilisateur a deja decode dans l'app — ca reflete son historique de clics, PAS l'etendue reelle du brief. C'est tres souvent UN SEUL cote d'un beef/argument (ex: tout Kendrick, rien de Drake) simplement parce que l'utilisateur navigue dans l'album de Kendrick au moment ou il lance la recherche. NE CONFONDS PAS \"j'ai plein de texte pour ce cote\" avec \"cet artiste est plus important\" — c'est un artefact technique, pas un signal editorial. Pour l'artiste/le cote SANS paroles fournies, tu DOIS quand meme chercher activement sur le web et l'inclure a poids EGAL, meme si tu n'as que ta connaissance/recherche pour lui et pas de texte pre-fourni.\n- Cherche les VRAIS sons lies au brief. Pour un beef: trouve TOUS les diss des DEUX cotes.\n- Kendrick vs Drake 2024 = Like That, Push Ups, Taylor Made, euphoria, 6:16 in LA, Meet the Grahams, Family Matters, Not Like Us, The Heart Part 6, BBL Drizzy, wacced out murals.\n- Mr. Morale = United In Grief, N95, Father Time, Rich Spirit, We Cry Together, Purple Hearts, Count Me Out, Crown, Auntie Diaries, Mother I Sober, Mirror, Die Hard, Savior.\n- Cherche aussi les sons MOINS EVIDENTS (Die Hard = can I open up is it safe or not, c est de l auto-exposition aussi).\n- QUAND UNE LISTE DE MORCEAUX DE REFERENCE EST DONNEE CI-DESSUS (ex: la liste Kendrick vs Drake 2024): traite-la comme une liste a COUVRIR EN ENTIER, pas une piscine dans laquelle piocher un sous-ensemble au hasard. Si le beef ou l'album concerne correspond a une de ces listes, inclus TOUS les morceaux lists, pas juste 3 ou 4 parmi eux.\n- Au total, entre 8 et 15 morceaux repartis dans les angles (un morceau peut compter dans plusieurs angles). Sois EXHAUSTIF sur les artistes du brief.\n\n=== CONNEXIONS ===\n- NE CITE JAMAIS de paroles sauf si trouvees sur le web et verifiees.\n- Decris le lien sans fausses citations. Ne confonds JAMAIS qui dit quoi.\n- Cherche les connexions PROFONDES: callbacks entre albums, mots reutilises, themes qui evoluent.\n- 4-8 connexions.\n\n=== PARALLELES CONCEPTUELS ===\nQuand le brief mentionne un film/concept (8 Mile, Eminem battle scene) SANS lister de morceau precis de cet artiste: utilise-le dans les DESCRIPTIONS et CONNEXIONS pour expliquer l argument. Mais NE L'AJOUTE PAS comme morceau dans un angle.\n\nSTYLE: parle normal. MOTS INTERDITS: met en lumiere, illustre, strategie, omnipresent, inattaquable, crucial, poignant, saisissant, resonant, transcende, incarnant. TOUT en francais.";

var ANALYSIS_SYSTEM = "Tu es un lecteur exigeant de rap lyrical. On te donne les paroles d'un morceau. Tu produis une analyse d'ECRITURE rigoureuse. DETECTE la langue et adapte tes references de gout et tes criteres.\n\nSI RAP ANGLOPHONE: profil RYM (gout: Ka, billy woods, MIKE, Earl, Navy Blue, Mach-Hommy, MF DOOM). Valorise l'understatement, la profondeur, le vecu, l'image qui hante autant que la technique.\n\nSI RAP FRANCAIS: profil amateur de technique et de plume (references: Veust, Limsa d'Aulnay, Infinit', Jeanjass, GAL, Alpha Wann, Nekfeu, Vald, Dinos, Lomepal cote technique). Valorise surtout: la PUNCHLINE (chute qui claque), le WORDPLAY (double sens, calembour, homophonie), les MULTISYLLABIQUES (rimes riches sur plusieurs syllabes), les RIMES INTERNES, l'image qui surprend. Le rap FR de ce niveau se juge d'abord sur la technique et la vanne. Reconnais l'argot et le verlan sans les traiter comme des fautes.\n\nJSON UNIQUEMENT:\n{\n\"score\": 74,\n\"score_breakdown\": {\"economie\": 8, \"imagery\": 7, \"rimes\": 6, \"subversion\": 5, \"profondeur\": 8},\n\"score_note\": \"1 phrase qui justifie la note\",\n\"essentiel\": [{\"o\":\"ligne exacte\",\"t\":\"trad si anglophone, sinon null\",\"why\":\"ce qui rend l'ecriture forte\",\"type\":\"craft\",\"impact\":9}],\n\"notable\": [{\"o\":\"ligne exacte\",\"t\":\"trad ou null\",\"why\":\"...\",\"type\":\"real\",\"impact\":6}],\n\"multis\": [{\"lines\":[\"ligne 1\",\"ligne 2\"],\"rhymed\":[\"syllabes qui riment ligne 1\",\"syllabes qui riment ligne 2\"],\"syllables\": 4, \"note\":\"pourquoi ce schema est fort\",\"impact\":8}]\n}\n\n=== SCORE (A) ===\nNote /100 la QUALITE D'ECRITURE (pas le plaisir d'ecoute, pas la prod). breakdown: 5 axes /10.\n- economie: densite, dire beaucoup en peu\n- imagery: force et originalite des images\n- rimes: complexite et musicalite des schemas (multis, rimes internes) — AXE CENTRAL pour le rap FR technique\n- subversion: capacite a surprendre, punchline inattendue, eviter les cliches\n- profondeur: doubles lectures, double sens, sens qui s'ouvre\nECHELLE (utilise toute la gamme, sois discriminant):\n- 90-100: chef-d'oeuvre d'ecriture\n- 80-89: tres grande ecriture, dense et maitrisee\n- 70-79: bonne ecriture solide, quelques vrais moments\n- 55-69: correct mais sans relief\n- sous 55: ecriture faible, cliches, rimes paresseuses\nUn bon son technique doit pouvoir atteindre 80+. Ne bloque pas tout dans le ventre mou 60-70. Sois discriminant.\n\n=== SELECTION PAR MORCEAU (C) ===\nOn analyse UN morceau en profondeur. Selectionne les lignes INSTAGRAMMABLES: celles qu'on peut poster hors contexte et qui frappent SEULES.\n- \"essentiel\": 2 a 4 lignes. Le cream absolu.\n- \"notable\": 3 a 6 lignes de qualite.\n\nTEST INSTAGRAM: si tu postes cette ligne sur Insta SANS dire de quel son c'est, est-ce que quelqu'un qui l'a jamais entendu va trouver ca fort? Si oui = bonne selection. Si la ligne a besoin du contexte du morceau pour etre impressionnante = NE LA METS PAS.\nEXEMPLE BON a selectionner: 'J'pete un plomb, l'seul noir proche qui me vengera c'est mon flingue' — le double sens frappe seul.\nEXEMPLE MAUVAIS a selectionner: 'Cinq policiers viennent me voir pour me dire: Monsieur vous avez eu raison' — c'est du storytelling, ca marche que dans le morceau. Hors contexte c'est rien.\n\n- Copie \"o\" EXACTEMENT. \"t\": traduction SI anglophone, null si francais.\n- \"why\": 1 phrase COURTE (15 mots max). Dis ce qui claque: le double sens? le wordplay? la chute?\n- types: \"craft\" / \"real\" / \"depth\" / \"subversion\"\n- \"impact\": note 1-10 la force de CETTE LIGNE PRECISE (pas le morceau entier). Ca sert a comparer des lignes de morceaux DIFFERENTS entre elles, donc sois HONNETE et discriminant: 9-10 = ligne qui marquerait meme dans un album d'un autre artiste, 7-8 = tres solide, 5-6 = correct. N'attribue pas 8+ a tout, la plupart des lignes sont 5-7.\n- Rap FR: punchlines et jeux de mots d'abord. Rap US: l'understatement compte autant.\n- INTERDIT: une ligne deja mise dans \"essentiel\" ne doit PAS reapparaitre dans \"notable\", et une ligne/paire de lignes deja utilisee dans \"multis\" ne doit PAS aussi etre copiee dans \"essentiel\" ou \"notable\". Chaque ligne du morceau n'apparait qu'UNE SEULE FOIS dans toute ta reponse, meme si elle merite plusieurs categories — choisis la categorie ou elle est la plus forte.\n\n=== MULTIS (A) ===\nRepere les 2-4 MEILLEURS schemas multisyllabiques: plusieurs syllabes consecutives qui riment entre les lignes. TRES important pour le rap FR technique.\n- \"lines\": lignes concernees (exactes, copiees mot pour mot)\n- \"rhymed\": pour CHAQUE ligne, la SOUS-CHAINE EXACTE qui porte la rime multi. Ce DOIT etre un extrait MOT POUR MOT de la ligne correspondante.\n\nREGLES STRICTES:\nMETHODE: ecris la TRANSCRIPTION PHONETIQUE des deux portions. Si les sons finaux ne matchent PAS, c'est PAS un multi. Dans le doute, NE METS PAS.\n\n1. Les 2+ dernieres syllabes des portions doivent sonner PAREIL. Pas 'similaire', PAREIL.\n2. INTERDIT: meme famille/racine ('soumis'/'soumission', 'sentiments'/'desensibilisation').\n3. INTERDIT: une ligne dans plus d'UN multi.\n4. Chaque \"rhymed\" = 2+ mots consecutifs, pas un mot seul.\n5. EXEMPLES FAUX (NE FAIS PAS CA):\n   'vers les interdits'/'dites-nous pourquoi' → -di/-kwa = RIME PAS\n   'fais manger'/'en argent' → -je/-an = RIME PAS\n   'etre blessant'/'respecte leur vie' → -an/-i = RIME PAS\n   'de nouveau'/'es possedee' → -vo/-de = RIME PAS\n6. EXEMPLES VRAIS:\n   'bouts d'chaines'/'propre budget' → -en/-e = sons proches, OK\n   'mon or'/'lion mort' → -on or/-on or = IDENTIQUE, OK\n   'en cavale'/'festival' → -val/-val = IDENTIQUE, OK\n- \"syllables\": nombre de syllabes qui riment\n- \"note\": pourquoi c'est technique/reussi\n- \"impact\": note 1-10 la force de CE schema precis, meme echelle que essentiel (9-10 rare, la plupart 5-7). Sert a comparer avec des lignes d'autres morceaux.\nSi pas de vrais multis, multis=[]. N'INVENTE PAS de fausses rimes. Mieux vaut 0 multi que 4 faux.\n\nQUALITE > QUANTITE partout.\n\nSTYLE: ecris tes explications (why, score_note, note) dans un francais NATUREL et fluide, comme un vrai passionne de rap qui parle. TOUJOURS en francais, MEME pour un morceau anglophone (seul le champ \"o\" garde la langue originale, et \"t\" la traduction). Phrases bien construites, pas de tournures bizarres.";

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
  var attachCitations = function(obj) {
    if (data.citations && data.citations.length) obj._citations = data.citations;
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
  var _p = useState(false), plLoading = _p[0], setPlLoading = _p[1];
  // Panneau actif dans le detail (null = vue morceau normale via `sel`, sinon un des 4 panneaux speciaux).
  // Remplace 4 booleans independants qu'il fallait reset a la main a chaque site d'appel.
  var _panel = useState(null), activePanel = _panel[0], setActivePanel = _panel[1];
  var _apl = useState(false), albumPlLoading = _apl[0], setAlbumPlLoading = _apl[1];
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
  var _vsd = useState({}), videoSugDecoding = _vsd[0], setVideoSugDecoding = _vsd[1];
  var _vex = useState({}), videoExpanded = _vex[0], setVideoExpanded = _vex[1];
  var _ac = useState(null), albumCtx = _ac[0], setAlbumCtx = _ac[1];
  var _acl = useState(false), albumCtxLoading = _acl[0], setAlbumCtxLoading = _acl[1];
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

  var fetchAlbumContext = function(art, alb) {
    setAlbumCtxLoading(true);
    callGemini(ALBUM_CONTEXT_SYSTEM, "Album: \"" + alb + "\" par " + art + ".\n\nCherche activement les interviews ou articles ou " + art + " parle de sa vie personnelle, de sa sante, ou des evenements precis qui l'ont mene a faire cet album. Si tu trouves ce genre d'info, sois FACTUEL ET PRECIS dans le champ backstory — ne la resume pas en formule vague.", false, "perplexity/sonar")
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
        if (!albumCtx) fetchAlbumContext(artist, album);
        return;
      }
      setView("loading"); setErr("");
      try {
        var r = await callGemini(TRACKLIST_SYSTEM, album + " - " + artist, false, "perplexity/sonar");
        if (r.tracks && r.tracks.length) {
          tlSet(artist, album, r.tracks);
          setTracks(r.tracks); hydrate(artist, r.tracks); setSel(null); setView("list");
          fetchAlbumContext(artist, album);
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

      var decoded = false;
      if (genius.found) {
        try {
          var prompt = "Voici les paroles EXACTES de \"" + name + "\" par " + artist + " (source: lrclib).\nCopie chaque ligne originale mot pour mot dans le champ \"o\". Ne modifie rien.\n\nPAROLES:\n\n" + genius.lyrics;
          var r = sanitizeTranslation(await callGemini(TRANSLATE_SYSTEM, prompt, false));
          // Meme une source "reelle" peut renvoyer un scrape foireux (page spam/generee) — verifie le contenu, pas juste la source.
          if (looksDegenerate(r.lines)) throw new Error("degenerate content from source");
          r.found = true;
          r._source = genius.source;
          r._geniusId = genius.geniusId || null;
          up({ st: "ok", d: r }); setDone(function(p) { return p + 1; });
          if (r.lines && r.lines.length) cacheSet(artist, name, { d: r });
          fetchContext(name);
          decoded = true;
        } catch(e2) {}
      }
      if (!decoded) {
        try {
          var LLM_FALLBACK = "Tu es un traducteur rap. Utilise IMPERATIVEMENT web_search pour trouver les paroles EXACTES et VERIFIEES de ce morceau (site parolier fiable, genius, azlyrics...). N'ecris JAMAIS de paroles de memoire sans les avoir verifiees par la recherche.\n\nSi la recherche ne trouve PAS de source fiable et complete pour CE morceau precis: reponds {\"found\":false,\"lines\":[],\"notes\":[]}. N'invente RIEN pour combler les trous — mieux vaut ne rien trouver que d'inventer des paroles qui n'existent pas.\n\nFormat JSON si trouve:\n{\"found\":true,\"lang\":\"francais\",\"lines\":[{\"s\":\"[Couplet 1]\"},{\"o\":\"ligne originale\",\"t\":null,\"c\":80}],\"notes\":[{\"r\":\"mot\",\"e\":\"explication\",\"t\":\"slang\"}]}\n\nSi le morceau est en francais: t=null pour chaque ligne. Si anglophone: t=traduction francaise.";
          // "search:true" seul ne fait RIEN sur le backend (api/gemini.js ignore ce flag) — sans passer
          // explicitement le modele perplexity/sonar, ce call n'a jamais eu de vraie recherche web, meme apres
          // les deux tentatives precedentes de corriger le prompt. C'est le vrai fix, comme partout ailleurs
          // dans ce fichier ou une recherche reelle est necessaire (contexte album, tracklist, video research).
          var r2 = await callGemini(LLM_FALLBACK, "Trouve et traduis les paroles de \"" + name + "\" par " + artist + ".", false, "perplexity/sonar");
          if (r2.found && r2.lines && r2.lines.length > 3 && !looksDegenerate(r2.lines)) {
            r2._source = "llm-recall";
            up({ st: "ok", d: r2 }); setDone(function(p) { return p + 1; });
            cacheSet(artist, name, { d: r2 });
            fetchContext(name);
          } else {
            up({ st: "ok", d: { found: false, lines: [], notes: [], _source: genius.source || null } });
            setDone(function(p) { return p + 1; });
          }
        } catch(e3) {
          up({ st: "ok", d: { found: false, lines: [], notes: [], _source: genius.source || null } });
          setDone(function(p) { return p + 1; });
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
    setVideoResults(null); setVideoSugDecoding({});
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
      var r = null;
      if (genius.found && genius.lyrics) {
        var prompt = "Voici les paroles EXACTES de \"" + sug.track + "\" par " + sug.artist + ".\nCopie chaque ligne originale mot pour mot.\n\nPAROLES:\n\n" + genius.lyrics;
        var rTry = sanitizeTranslation(await callGemini(TRANSLATE_SYSTEM, prompt, false));
        // Meme une source "reelle" peut renvoyer un scrape foireux (page spam/generee) — verifie le contenu.
        if (!looksDegenerate(rTry.lines)) r = rTry;
      }
      if (r) {
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
        if (r2.found && r2.lines && r2.lines.length && !looksDegenerate(r2.lines)) {
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
  var compressTrackLyrics = function(trackName, cached) {
    if (!cached || !cached.d || !cached.d.lines) return "";
    var d = cached.d;
    var lines = d.lines;
    var result = "\n--- " + trackName + " ---\n";
    if (d.context) {
      if (d.context.themes && d.context.themes.length) result += "Themes: " + d.context.themes.join(", ") + "\n";
      if (d.context.summary) result += "Resume: " + d.context.summary + "\n";
    }
    var content = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].s) continue;
      if (lines[i].o) content.push(lines[i].o);
    }
    var max = 20;
    if (content.length <= max) {
      result += content.join("\n") + "\n";
    } else {
      var blockSize = 5;
      var numBlocks = Math.floor(max / blockSize);
      var spacing = Math.floor(content.length / numBlocks);
      for (var b = 0; b < numBlocks; b++) {
        var start = Math.min(b * spacing, content.length - blockSize);
        for (var k = 0; k < blockSize && start + k < content.length; k++) {
          result += content[start + k] + "\n";
        }
        if (b < numBlocks - 1) result += "[...]\n";
      }
    }
    return result;
  };

  // Video Research
  var runVideoResearch = async function() {
    if (!videoBrief.trim()) return;
    setVideoLoading(true);
    setVideoResults(null);
    try {
      var decodedList = [];
      var albums = getCachedAlbums();
      if (mode === "album" && artist && album && done > 0) {
        var exists = albums.some(function(a) { return norm(a.artist) === norm(artist) && norm(a.album) === norm(album); });
        if (!exists) albums.unshift({ artist: artist, album: album, tracks: tracks, decoded: done });
      }
      var albumChunks = [];
      albums.forEach(function(alb) {
        var chunk = "\n\n======= " + alb.artist + " - " + alb.album + " =======\n";
        alb.tracks.forEach(function(t) {
          var c = cacheGet(alb.artist, t);
          chunk += compressTrackLyrics(t, c);
        });
        decodedList.push(alb.artist + " - " + alb.album);
        albumChunks.push(chunk);
      });
      var allLyrics = albumChunks.join("");

      if (allLyrics.length <= MAX_VIDEO_CHARS) {
        var r = await callGemini(VIDRESEARCH_SYSTEM, "BRIEF VIDEO:\n" + videoBrief + "\n\nALBUMS DEJA DECODES PAR L'UTILISATEUR (juste ce qu'il a deja consulte dans l'app, PAS la portee du brief): " + decodedList.join(", ") + "\n\nPAROLES DISPONIBLES POUR CES ALBUMS SEULEMENT (condensees, lignes cles de chaque morceau) — ATTENTION, ceci ne couvre souvent qu'UN SEUL COTE d'un beef/argument, ne laisse PAS ce desequilibre de matiere biaiser ta selection vers le cote le mieux fourni:\n" + allLyrics, false, "perplexity/sonar");
        setVideoResults(r);
      } else {
        var batches = [];
        var curBatch = [];
        var curLen = 0;
        for (var bi = 0; bi < albumChunks.length; bi++) {
          if (curLen + albumChunks[bi].length > MAX_VIDEO_CHARS && curBatch.length > 0) {
            batches.push(curBatch.join(""));
            curBatch = [];
            curLen = 0;
          }
          curBatch.push(albumChunks[bi]);
          curLen += albumChunks[bi].length;
        }
        if (curBatch.length > 0) batches.push(curBatch.join(""));

        var results = await Promise.all(batches.map(function(batchLyrics, idx) {
          var prefix = idx === 0 ? "" : "NOTE: ceci est le lot " + (idx + 1) + "/" + batches.length + ". Concentre-toi sur les suggestions et connexions pour ces paroles.\n\n";
          return callGemini(VIDRESEARCH_SYSTEM, prefix + "BRIEF VIDEO:\n" + videoBrief + "\n\nTOUS LES ALBUMS DEJA DECODES PAR L'UTILISATEUR (juste ce qu'il a deja consulte, PAS la portee du brief): " + decodedList.join(", ") + "\n\nPAROLES DISPONIBLES POUR CES ALBUMS SEULEMENT — ne laisse pas ce desequilibre de matiere biaiser ta selection vers le cote le mieux fourni:\n" + batchLyrics, false, "perplexity/sonar")
            .catch(function() { return { angles: [], connexions: [] }; });
        }));

        var merged = { angles: [], connexions: [], argument_resume: "" };
        results.forEach(function(r) {
          if (r.argument_resume && r.argument_resume.length > (merged.argument_resume || "").length) merged.argument_resume = r.argument_resume;
          if (r.angles) merged.angles = merged.angles.concat(r.angles);
          if (r.connexions) merged.connexions = merged.connexions.concat(r.connexions);
        });
        setVideoResults(merged);
      }
    } catch (e) {
      setVideoResults({ plan: [], suggestions: [], connexions: [], error: e.message });
    }
    setVideoLoading(false);
  };

  // Ouvre/ferme le morceau complet en place dans son angle, sans toucher a la
  // navigation principale (sel/artist) qui est couplee a l'album charge.
  var toggleVideoExpand = async function(m) {
    var key = m.artist + ":" + m.track;
    var isOpen = !!videoExpanded[key];
    if (isOpen) {
      setVideoExpanded(function(p) { var n = Object.assign({}, p); delete n[key]; return n; });
      return;
    }
    var cached = cacheGet(m.artist, m.track);
    if (!cached || !cached.d || !cached.d.lines || !cached.d.lines.length) {
      await decodeVideoSuggestion(m);
    }
    setVideoExpanded(function(p) { var n = Object.assign({}, p); n[key] = true; return n; });
  };

  var decodeVideoSuggestion = function(sug) { return decodeSuggestionWith(sug, setVideoSugDecoding); };

  // Best Bars: envoie TOUTES les paroles de l'album en un seul appel
  var extractBestBars = async function() {
    setActivePanel('bestBars');
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
    setActivePanel('albumPl');
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
  var showSidebar = !isMobile || (!sel && !activePanel);
  var showDetail = !isMobile || sel || activePanel;
  var headerLabel = mode === "single" ? single : album;

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
                    </div>
                    );
                  })()}
                </div>
              )}
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

          {showDetail && activePanel === 'video' && (
            <div style={S.detail}>
              <button onClick={function() { setActivePanel(null); if (!tracks.length) setView("input"); }} style={Object.assign({}, S.back, { marginBottom: 12 })}>{"<- retour"}</button>
              <div style={S.trackTitle}>▶ Video Research</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 4, marginBottom: 18 }}>Decris ton argument de video — on trouve les extraits et on structure</div>

              <textarea
                value={videoBrief}
                onChange={function(e) { setVideoBrief(e.target.value); }}
                placeholder={"Decris ta video...\n\nEx: Je veux montrer que Kendrick s'expose volontairement sur Mr. Morale pour que ses faiblesses soient inutilisables dans le beef avec Drake, comme B-Rabbit dans 8 Mile qui assume tout avant que Papa Doc puisse l'attaquer"}
                style={{
                  width: "100%", minHeight: 120, padding: "12px", background: "#0a0a0a",
                  color: "#ddd", border: "1px solid #222", borderRadius: 6,
                  fontFamily: "inherit", fontSize: 12, lineHeight: 1.6, outline: "none",
                  boxSizing: "border-box", resize: "vertical",
                }}
              />

              <button
                onClick={runVideoResearch}
                disabled={videoLoading || !videoBrief.trim()}
                style={{
                  width: "100%", padding: "12px 0", marginTop: 10,
                  background: videoLoading || !videoBrief.trim() ? "#111" : "#1a1020",
                  color: videoLoading ? "#555" : "#c084fc",
                  border: "1px solid #2a1a3a", borderRadius: 4,
                  fontFamily: "inherit", fontSize: 11, cursor: "pointer",
                  letterSpacing: 3, textTransform: "uppercase", marginBottom: 20,
                }}>
                {videoLoading ? "recherche..." : "rechercher"}
              </button>

              {videoResults && (
                <div>
                  {videoResults.error && (
                    <div style={{ padding: "12px", background: "#1a0a0a", border: "1px solid #2a1010", borderRadius: 6, marginBottom: 16, fontSize: 12, color: "#e05030" }}>
                      Erreur: {videoResults.error}
                    </div>
                  )}
                  {videoResults.argument_resume && (
                    <div style={{ fontSize: 12, color: "#c084fc", fontStyle: "italic", marginBottom: 20, padding: "12px", background: "#0d0a10", border: "1px solid #1a1020", borderRadius: 6, lineHeight: 1.6 }}>
                      {stripCitationMarks(videoResults.argument_resume)}
                    </div>
                  )}

                  {videoResults.angles && videoResults.angles.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 9, color: "#c084fc", letterSpacing: 3, textTransform: "uppercase", marginBottom: 4, paddingBottom: 6, borderBottom: "1px solid #1a1a1a" }}>angles a explorer</div>
                      <div style={{ fontSize: 9, color: "#444", marginBottom: 16, fontStyle: "italic" }}>pas un ordre impose — choisis ceux qui servent ton propos et monte-les comme tu veux</div>
                      {videoResults.angles.map(function(angle, ai) {
                        var angleColors = ["#38bdf8", "#4ade80", "#f0c040", "#e05030", "#c084fc"];
                        var ac = angleColors[ai % angleColors.length];
                        return (
                          <div key={ai} style={{ marginBottom: 28, paddingLeft: 12, borderLeft: "3px solid " + ac }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: ac, marginBottom: 4 }}>{angle.titre}</div>
                            <div style={{ fontSize: 11, color: "#999", marginBottom: 12, lineHeight: 1.5 }}>{stripCitationMarks(angle.description)}</div>
                            {(angle.morceaux || []).map(function(m, mi) {
                              var key = m.artist + ":" + m.track;
                              var status = videoSugDecoding[key] || null;
                              var isExpanded = !!videoExpanded[key];
                              var fullCached = cacheGet(m.artist, m.track);
                              var fullLines = (isExpanded && fullCached && fullCached.d && fullCached.d.lines) || [];
                              return (
                                <div key={mi} style={{ marginBottom: 10, padding: "10px 12px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 6 }}>
                                  <div style={{ fontSize: 12, color: "#ddd" }}>{m.track}</div>
                                  <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{m.artist}{m.album ? " — " + m.album : ""}</div>
                                  {isExpanded && fullLines.length > 0 && (
                                    <div style={{ background: "#0d0d0f", border: "1px solid #1a1a22", borderRadius: 6, padding: "12px 14px", marginTop: 8, maxHeight: 340, overflowY: "auto" }}>
                                      {fullLines.map(function(ln, li) {
                                        if (ln.s) return <div key={li} style={{ fontSize: 9, color: "#555", letterSpacing: 1, textTransform: "uppercase", marginTop: li ? 10 : 0, marginBottom: 4 }}>{ln.s}</div>;
                                        return (
                                          <div key={li} style={{ marginBottom: 6 }}>
                                            <div style={{ fontSize: 12, color: "#e6e6e6", lineHeight: 1.5 }}>{ln.o}</div>
                                            {ln.t && <div style={{ fontSize: 10, color: "#888", fontStyle: "italic", marginTop: 1 }}>{ln.t}</div>}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {m.pourquoi && <div style={{ fontSize: 10, color: "#777", lineHeight: 1.4, fontStyle: "italic", marginTop: 6 }}>{stripCitationMarks(m.pourquoi)}</div>}
                                  <button
                                    onClick={function() { toggleVideoExpand(m); }}
                                    disabled={status === "load"}
                                    style={{
                                      background: "transparent", border: "none", color: "#555",
                                      fontFamily: "inherit", fontSize: 9, padding: "6px 0 0",
                                      cursor: status === "load" ? "default" : "pointer",
                                      letterSpacing: 1, textTransform: "uppercase", textDecoration: "underline",
                                    }}>
                                    {isExpanded ? "← reduire" : status === "load" ? "..." : "voir le morceau complet"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {videoResults.connexions && videoResults.connexions.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 9, color: "#f0c040", letterSpacing: 3, textTransform: "uppercase", marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid #1a1a1a" }}>connexions</div>
                      {videoResults.connexions.map(function(cx, ci) {
                        return (
                          <div key={ci} style={{ marginBottom: 12, padding: "10px 12px", background: "#0d0a08", border: "1px solid #1a1810", borderRadius: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                              <span style={{ fontSize: 11, color: "#f0c040", fontWeight: 600 }}>{cx.de}</span>
                              <span style={{ fontSize: 10, color: "#333" }}>→</span>
                              <span style={{ fontSize: 11, color: "#f0c040", fontWeight: 600 }}>{cx.vers}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "#999", lineHeight: 1.4 }}>{stripCitationMarks(cx.lien)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {videoResults.angles && videoResults.angles.length > 0 && Object.values(videoSugDecoding).some(function(v) { return v === "ok"; }) && (
                    <div style={{ marginBottom: 20 }}>
                        <button onClick={runVideoResearch} style={{
                          width: "100%", padding: "10px 0", marginTop: 8,
                          background: "#0d0a10", color: "#c084fc",
                          border: "1px solid #2a1a3a", borderRadius: 4,
                          fontFamily: "inherit", fontSize: 10, cursor: "pointer",
                          letterSpacing: 2, textTransform: "uppercase",
                        }}>
                          ↻ relancer (inclure les nouveaux)
                        </button>
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
                        ? <span style={Object.assign({}, S.tag, { color: "#4ade80" })}>paroles trouvees</span>
                        : <span style={Object.assign({}, S.tag, { color: "#f0c040" })}>pas de paroles</span>}
                      {curD._source && (curD._source === "llm-recall" || curD._source === "sonar-search")
                        ? <>
                            <span style={Object.assign({}, S.tag, { color: "#f0c040" })} title="Paroles trouvees par l'IA via recherche web, pas depuis une base de paroles classique — verifie si un doute, de petites imprecisions restent possibles.">reconstruction IA</span>
                            <span style={Object.assign({}, S.tag, { color: "#666", cursor: "pointer", textDecoration: "underline" })} title="Rejoue la recherche a partir de zero (ignore le resultat en cache)" onClick={function() { decode(sel, false, true); }}>relancer</span>
                          </>
                        : curD._source && <a href={curD._source} target="_blank" rel="noopener noreferrer" style={Object.assign({}, S.tag, { color: "#555", textDecoration: "none" })}>source</a>}
                      <span style={{ fontSize: 9, color: "#333", marginLeft: "auto" }}>Clique une ligne pour analyser</span>
                    </div>
                  </div>

                  {curD.context && (realVal(curD.context.summary) || realVal(curD.context.album)) && (function() {
                    var ctx = curD.context;
                    var cAlbum = realVal(ctx.album), cYear = realVal(ctx.year), cProd = realVal(ctx.producer);
                    var cRole = realVal(ctx.role), cSummary = realVal(ctx.summary), cStandout = realVal(ctx.standout);
                    var cPhilo = realVal(ctx.philo);
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
                        {cPhilo && (
                          <div style={{ borderLeft: "2px solid #38bdf8", paddingLeft: 8, marginTop: 4 }}>
                            <div style={{ fontSize: 8, color: "#38bdf8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>parallele philo</div>
                            <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5 }}>{cPhilo}</div>
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
