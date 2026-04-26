import { useState, useRef, useCallback } from "react";

var TRACKLIST_SYSTEM = "Tu donnes les tracklists d'albums. Reponds en JSON: {\"tracks\":[\"titre1\",\"titre2\",...]} Titres exacts, sans featurings. Si inconnu: {\"tracks\":[]}";

var TRANSLATE_SYSTEM = "Tu es un traducteur rap. On te donne les PAROLES EXACTES d'un morceau.\n\nREGLES:\n1. Regroupe les lignes trop courtes qui font partie de la meme phrase en UNE seule ligne.\n2. Sections: utilise UNIQUEMENT des titres generiques comme [Intro], [Verse 1], [Verse 2], [Chorus], [Bridge], [Outro], [Interlude]. N'ajoute JAMAIS le nom d'un rappeur dans le titre de section.\n3. Inclus TOUTES les lignes des paroles originales, y compris les interludes, skits et outros en entier. Ne coupe JAMAIS une section.\n4. Champ \"o\" = ligne originale (regroupee si necessaire). \"t\" = traduction francaise.\n5. Pour CHAQUE ligne, ajoute \"c\" = ton niveau de confiance (0-100). 100 = traduction evidente. <70 = slang rare, ref obscure, wordplay difficile, sens incertain.\n6. Si francais: \"t\"=null.\n7. CONTEXTE RAP: \"bitch\" = meuf/copine (JAMAIS pute). \"nigga\" = ne traduis pas, laisse tel quel ou dis \"negro\". \"whip\" = caisse. Adapte au registre du rap francais, pas du francais scolaire.\n\nPour les notes de decryptage:\n- \"r\" = mot/expression\n- \"e\" = explication concise\n- \"t\" = type: \"slang\" / \"ref\" / \"wordplay\" / \"sample\"\n\nReponds en JSON:\n{\n\"lang\":\"anglais\",\n\"lines\":[\n{\"s\":\"[Intro]\"},\n{\"o\":\"ligne originale\",\"t\":\"traduction\",\"c\":95}\n],\n\"notes\":[\n{\"r\":\"mot\",\"e\":\"explication\",\"t\":\"ref\"}\n]\n}";

var DEEP_ANALYSIS_SYSTEM = "Tu es un analyste rap expert. On te donne UNE ligne d'un morceau, le contexte du morceau, et les lignes qui entourent.\n\nAnalyse cette ligne en profondeur:\n- Sens litteral\n- Sens figure / ce que l'artiste veut vraiment dire\n- Refs (personnes, marques, lieux, evenements, samples)\n- Wordplay, double sens, homophones\n- Technique (flow, rime, schema)\n\nReponds en JSON:\n{\n\"literal\":\"sens litteral\",\n\"meaning\":\"ce que l'artiste dit vraiment\",\n\"refs\":[{\"r\":\"ref\",\"e\":\"explication\"}],\n\"wordplay\":\"wordplay si present, sinon null\",\n\"technique\":\"note sur la technique si notable, sinon null\"\n}";

async function callGemini(system, message, search) {
  if (search === undefined) search = false;
  var res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: system, message: message, search: search }),
  });
  var data = await res.json();
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
  var stopRef = useRef(false);
  var dRef = useRef({});
  var isMobile = window.innerWidth <= 700;

  var go = async function() {
    if (mode === "album") {
      if (!album.trim() || !artist.trim()) return;
      setView("loading"); setErr("");
      try {
        var r = await callGemini(TRACKLIST_SYSTEM, album + " - " + artist, true);
        if (r.tracks && r.tracks.length) {
          setTracks(r.tracks); setDone(0); setView("list");
        } else { setErr("Album introuvable"); setView("error"); }
      } catch (e) { setErr(e.message); setView("error"); }
    } else {
      // Single mode: skip tracklist, go straight to decode
      if (!single.trim() || !artist.trim()) return;
      setTracks([single]); setDone(0); setView("list");
      // Auto-decode the single immediately
      setTimeout(function() { decode(single, false); }, 100);
    }
  };

  var decode = useCallback(async function(name, autoMode) {
    if (dRef.current[name] && dRef.current[name].st === "ok") {
      if (!autoMode) setSel(name);
      return;
    }
    var up = function(v) {
      var next = Object.assign({}, dRef.current);
      next[name] = v;
      dRef.current = next;
      setData(Object.assign({}, dRef.current));
    };
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
      } else {
        var FALLBACK_SYSTEM = "Tu es un traducteur rap. Utilise web_search pour trouver les paroles de ce morceau. Puis traduis ligne par ligne.\n\nAjoute \"c\" (0-100) pour la confiance de chaque traduction. <70 = incertain.\n\nReponds en JSON: {\"found\":true,\"lang\":\"anglais\",\"lines\":[{\"s\":\"[Verse 1]\"},{\"o\":\"ligne\",\"t\":\"traduction\",\"c\":80}],\"notes\":[{\"r\":\"mot\",\"e\":\"explication\",\"t\":\"ref\"}]}\n\nRegroupe les lignes courtes. \"bitch\"=meuf. \"nigga\"=laisse tel quel. Si introuvable: {\"found\":false,\"lines\":[],\"notes\":[]}";
        var ctx = mode === "single" ? "" : ", album \"" + album + "\"";
        var r2 = await callGemini(FALLBACK_SYSTEM, "Trouve et traduis les paroles de \"" + name + "\" par " + artist + ctx + ".", true);
        r2._source = genius.source || null;
        up({ st: "ok", d: r2 }); setDone(function(p) { return p + 1; });
      }
    } catch (e) { up({ st: "err", msg: e.message }); }
  }, [artist, album, mode]);

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
      var prompt = "Morceau: \"" + sel + "\" par " + artist + albumCtx + ".\n\nContexte:\n" + contextLines.join("\n") + "\n\nLIGNE A ANALYSER: " + line.o + "\n\nTraduction actuelle: " + (line.t || line.o);
      var r = await callGemini(DEEP_ANALYSIS_SYSTEM, prompt, true);
      setFocusData(r);
    } catch (e) {
      setFocusData({ error: e.message });
    }
    setFocusLoading(false);
  };

  var closeFocus = function() { setFocusLine(null); setFocusData(null); };

  var cur = sel && data[sel];
  var curD = cur ? cur.d : null;
  var showSidebar = !isMobile || !sel;
  var showDetail = !isMobile || sel;
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
              {tracks.map(function(t, i) {
                var st = (data[t] && data[t].st) || "idle";
                var isSel = sel === t;
                var colors = { idle: "#222", load: "#f0c040", ok: "#4ade80", err: "#ef4444" };
                return (
                  <div key={i} onClick={function() { decode(t, false); }} style={Object.assign({}, S.trackRow, {
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

          {showDetail && sel && (
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
                            {l.t && <div style={Object.assign({}, S.tr, isUncertain ? { color: "#8a7a4a" } : {})}>{l.t}</div>}
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
                  {focusData.literal && (
                    <div style={S.analysisBlock}>
                      <div style={S.analysisLabel}>SENS LITTERAL</div>
                      <div style={S.analysisText}>{focusData.literal}</div>
                    </div>
                  )}
                  {focusData.meaning && (
                    <div style={S.analysisBlock}>
                      <div style={S.analysisLabel}>CE QU'IL DIT VRAIMENT</div>
                      <div style={S.analysisText}>{focusData.meaning}</div>
                    </div>
                  )}
                  {focusData.wordplay && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#a855f7" })}>WORDPLAY</div>
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
                  {focusData.technique && (
                    <div style={S.analysisBlock}>
                      <div style={Object.assign({}, S.analysisLabel, { color: "#4ade80" })}>TECHNIQUE</div>
                      <div style={S.analysisText}>{focusData.technique}</div>
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
