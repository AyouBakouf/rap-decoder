import { useState, useRef, useCallback } from “react”;

const TRACKLIST_SYSTEM = “Tu donnes les tracklists d’albums. Reponds en JSON: {"tracks":["titre1","titre2",…]} Titres exacts, sans featurings. Si inconnu: {"tracks":[]}”;

const DECODE_SYSTEM = “Tu es un traducteur rap expert.\n\nETAPE 1: Utilise web_search pour trouver les paroles COMPLETES du morceau. Cherche "[titre] [artiste] lyrics site:genius.com". Verifie que le titre et l’artiste correspondent EXACTEMENT. Si ca matche pas, refais une recherche.\n\nETAPE 2: Traduis TOUTES les paroles ligne par ligne.\n\nREGLE ABSOLUE: Tu dois inclure CHAQUE ligne du morceau, du tout debut a la toute fin, dans l’ordre exact. Si le morceau a 3 couplets, les 3 doivent etre la. Si un refrain se repete 4 fois, il apparait 4 fois. Ne resume JAMAIS, ne saute JAMAIS un couplet ou un refrain. Le nombre de lignes originales et traduites doit etre IDENTIQUE aux paroles completes du morceau.\n\nReponds en JSON:\n{\n"found":true,\n"lang":"anglais",\n"lines":[\n{"s":"[Intro]"},\n{"o":"original line","t":"traduction francaise"},\n{"s":"[Couplet 1]"},\n{"o":"…","t":"…"},\n{"s":"[Refrain]"},\n{"o":"…","t":"…"},\n{"s":"[Couplet 2]"},\n{"o":"…","t":"…"}\n],\n"notes":[\n{"r":"mot/expression","e":"explication concise: slang, ref culturelle, wordplay, double sens"}\n]\n}\n\n"s"=section header, "o"=ligne originale, "t"=traduction francaise.\nTraduis le SENS pas mot a mot. Si francais: "t"=null.\nDecryptage uniquement sur les passages opaques.\nSi introuvable: {"found":false,"lang":"?","lines":[],"notes":[]}”;

async function callAPI(system, message, search) {
if (search === undefined) search = false;
var res = await fetch(”/api/gemini”, {
method: “POST”,
headers: { “Content-Type”: “application/json” },
body: JSON.stringify({ system: system, message: message, search: search }),
});
var data = await res.json();
if (data.error) throw new Error(data.error);
var text = data.text || “”;
var m = text.match(/{[\s\S]*}/);
if (!m) throw new Error(“No JSON in response”);
return JSON.parse(m[0]);
}

export default function App() {
var _a = useState(””), album = _a[0], setAlbum = _a[1];
var _b = useState(””), artist = _b[0], setArtist = _b[1];
var _c = useState([]), tracks = _c[0], setTracks = _c[1];
var _d = useState({}), data = _d[0], setData = _d[1];
var _e = useState(null), sel = _e[0], setSel = _e[1];
var _f = useState(“input”), view = _f[0], setView = _f[1];
var _g = useState(0), done = _g[0], setDone = _g[1];
var _h = useState(false), auto = _h[0], setAuto = _h[1];
var _i = useState(””), err = _i[0], setErr = _i[1];
var stopRef = useRef(false);
var dRef = useRef({});
var isMobile = window.innerWidth <= 700;

var go = async function() {
if (!album.trim() || !artist.trim()) return;
setView(“loading”); setErr(””);
try {
var r = await callAPI(TRACKLIST_SYSTEM, album + “ - “ + artist);
if (r.tracks && r.tracks.length) {
setTracks(r.tracks); setDone(0); setView(“list”);
} else { setErr(“Album introuvable”); setView(“error”); }
} catch (e) { setErr(e.message); setView(“error”); }
};

var decode = useCallback(async function(name) {
if (dRef.current[name] && dRef.current[name].st === “ok”) { setSel(name); return; }
var up = function(v) {
var next = Object.assign({}, dRef.current);
next[name] = v;
dRef.current = next;
setData(Object.assign({}, dRef.current));
};
up({ st: “load” }); setSel(name);
try {
var r = await callAPI(DECODE_SYSTEM, “Trouve les paroles COMPLETES de "” + name + “" par “ + artist + “, album "” + album + “". Cherche sur Genius. Inclus tous les couplets, refrains, ponts et outros sans rien sauter.”, true);
up({ st: “ok”, d: r }); setDone(function(p) { return p + 1; });
} catch (e) { up({ st: “err”, msg: e.message }); }
}, [artist, album]);

var decodeAll = useCallback(async function() {
stopRef.current = false; setAuto(true);
for (var i = 0; i < tracks.length; i++) {
if (stopRef.current) break;
var t = tracks[i];
if (dRef.current[t] && dRef.current[t].st === “ok”) continue;
await decode(t);
await new Promise(function(r) { setTimeout(r, 300); });
}
setAuto(false);
}, [tracks, decode]);

var reset = function() {
stopRef.current = true; setView(“input”); setTracks([]); setData({});
dRef.current = {}; setSel(null); setAuto(false); setDone(0);
};

var cur = sel && data[sel];
var curD = cur ? cur.d : null;
var showSidebar = !isMobile || !sel;
var showDetail = !isMobile || sel;

return (
<div style={S.root}>
<style>{CSS}</style>

```
  <div style={S.header}>
    <div style={S.logo}>{"翻"}</div>
    <div style={{ flex: 1 }}>
      <div style={S.title}>RAP DECODER</div>
      <div style={{ fontSize: 8, color: "#333" }}>gemini 3 flash - google search - traduction</div>
    </div>
    {view !== "input" && <button onClick={reset} style={S.back}>{"<-"}</button>}
  </div>

  {view === "input" && (
    <div style={S.inputWrap}>
      <Inp label="Artiste" val={artist} set={setArtist} ph="Denzel Curry" enter={go} />
      <Inp label="Album" val={album} set={setAlbum} ph="Melt My Eyez See Your Future" enter={go} />
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
              <div style={S.albumTitle}>{album}</div>
              <div style={S.albumSub}>{artist + " - " + done + "/" + tracks.length}</div>
            </div>
            <button onClick={auto ? function() { stopRef.current = true; setAuto(false); } : decodeAll}
              style={Object.assign({}, S.allBtn, { borderColor: auto ? "#ef4444" : "#222", color: auto ? "#ef4444" : "#f0c040" })}>
              {auto ? "Stop" : "Tout"}
            </button>
          </div>
          {tracks.map(function(t, i) {
            var st = (data[t] && data[t].st) || "idle";
            var isSel = sel === t;
            var colors = { idle: "#222", load: "#f0c040", ok: "#4ade80", err: "#ef4444" };
            return (
              <div key={i} onClick={function() { decode(t); }} style={Object.assign({}, S.trackRow, {
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

          {cur && cur.st === "load" && <div style={S.center}><div style={S.spinner} /><div style={S.dim}>Recherche + traduction...</div></div>}

          {cur && cur.st === "err" && (
            <div style={S.center}>
              <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 8 }}>{cur.msg}</div>
              <button onClick={function() { delete dRef.current[sel]; setData(Object.assign({}, dRef.current)); decode(sel); }} style={S.retryBtn}>Reessayer</button>
            </div>
          )}

          {curD && (
            <div style={{ animation: "fadeIn .2s ease" }}>
              <div style={{ marginBottom: 16 }}>
                <div style={S.trackTitle}>{sel}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                  <span style={Object.assign({}, S.tag, { color: "#888" })}>{curD.lang}</span>
                  {curD.found
                    ? <span style={Object.assign({}, S.tag, { color: "#4ade80" })}>lyrics trouvees</span>
                    : <span style={Object.assign({}, S.tag, { color: "#f0c040" })}>approximatif</span>}
                </div>
              </div>

              {curD.lines && curD.lines.length > 0 && (
                <Fold title="PAROLES + TRADUCTION" color="#4ade80">
                  {curD.lines.map(function(l, i) {
                    if (l.s) return <div key={i} style={S.section}>{l.s}</div>;
                    return (
                      <div key={i} style={S.linePair}>
                        <div style={S.og}>{l.o}</div>
                        {l.t && <div style={S.tr}>{l.t}</div>}
                      </div>
                    );
                  })}
                </Fold>
              )}

              {curD.notes && curD.notes.length > 0 && (
                <Fold title="DECRYPTAGE" color="#e05030">
                  {curD.notes.map(function(n, i) {
                    return (
                      <div key={i} style={S.note}>
                        <div style={S.noteRef}>{n.r}</div>
                        <div style={S.noteExp}>{n.e}</div>
                      </div>
                    );
                  })}
                </Fold>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )}
</div>
```

);
}

function Fold(props) {
var _a = useState(true), open = _a[0], setOpen = _a[1];
return (
<div style={{ marginBottom: 18 }}>
<div onClick={function() { setOpen(!open); }} style={S.foldHeader}>
<div style={{ width: 3, height: 11, background: props.color, borderRadius: 2 }} />
<span style={S.foldTitle}>{props.title}</span>
<span style={{ fontSize: 10, color: “#222”, marginLeft: “auto” }}>{open ? “v” : “>”}</span>
</div>
{open && <div style={S.foldBody}>{props.children}</div>}
</div>
);
}

function Inp(props) {
return (
<div style={{ marginBottom: 16 }}>
<div style={{ fontSize: 9, color: “#333”, textTransform: “uppercase”, letterSpacing: 1.5, marginBottom: 4 }}>{props.label}</div>
<input value={props.val} onChange={function(e) { props.set(e.target.value); }} placeholder={props.ph}
onKeyDown={function(e) { if (e.key === “Enter” && props.enter) props.enter(); }}
style={S.input} />
</div>
);
}

var CSS = “@import url(‘https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap’);@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}input::placeholder{color:#2a2a2a}*::-webkit-scrollbar{width:4px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:#1a1a1a;border-radius:2px}”;

var S = {
root: { minHeight: “100vh”, background: “#0a0a0a”, color: “#ddd”, fontFamily: “‘JetBrains Mono’,monospace” },
header: { padding: “13px 16px”, borderBottom: “1px solid #141414”, display: “flex”, alignItems: “center”, gap: 10 },
logo: { width: 26, height: 26, borderRadius: 5, background: “linear-gradient(135deg,#f0c040,#e05030)”, display: “flex”, alignItems: “center”, justifyContent: “center”, fontSize: 12, fontWeight: 700, color: “#0a0a0a”, flexShrink: 0 },
title: { fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: “uppercase”, color: “#fff” },
back: { background: “none”, border: “1px solid #1a1a1a”, color: “#444”, padding: “3px 9px”, borderRadius: 4, cursor: “pointer”, fontSize: 10, fontFamily: “inherit” },
inputWrap: { maxWidth: 380, margin: “0 auto”, padding: “50px 16px” },
input: { width: “100%”, background: “#0d0d0d”, border: “1px solid #181818”, color: “#fff”, padding: “10px 11px”, borderRadius: 5, fontSize: 12, fontFamily: “inherit”, outline: “none”, boxSizing: “border-box” },
goBtn: { width: “100%”, padding: “11px”, borderRadius: 6, border: “none”, marginTop: 6, background: “linear-gradient(135deg,#f0c040,#e05030)”, color: “#0a0a0a”, fontSize: 11, fontWeight: 700, fontFamily: “inherit”, cursor: “pointer”, textTransform: “uppercase”, letterSpacing: 2 },
center: { textAlign: “center”, padding: “60px 16px” },
spinner: { width: 20, height: 20, border: “2px solid #222”, borderTop: “2px solid #f0c040”, borderRadius: “50%”, animation: “spin .8s linear infinite”, margin: “0 auto 12px” },
dim: { fontSize: 10, color: “#333” },
retryBtn: { background: “#131313”, border: “1px solid #1e1e1e”, color: “#666”, padding: “5px 12px”, borderRadius: 4, cursor: “pointer”, fontFamily: “inherit”, fontSize: 10 },
main: { display: “flex”, height: “calc(100vh - 51px)” },
sidebar: { borderRight: “1px solid #131313”, display: “flex”, flexDirection: “column”, overflowY: “auto” },
sideHeader: { padding: “10px 14px”, borderBottom: “1px solid #131313”, display: “flex”, alignItems: “center”, gap: 6 },
albumTitle: { fontSize: 10, fontWeight: 700, color: “#fff”, whiteSpace: “nowrap”, overflow: “hidden”, textOverflow: “ellipsis” },
albumSub: { fontSize: 9, color: “#333”, marginTop: 1 },
allBtn: { background: “#131313”, border: “1px solid #222”, padding: “3px 8px”, borderRadius: 4, cursor: “pointer”, fontSize: 9, fontFamily: “inherit”, fontWeight: 600, whiteSpace: “nowrap” },
trackRow: { padding: “7px 14px”, cursor: “pointer”, display: “flex”, alignItems: “center” },
dot: { width: 7, height: 7, borderRadius: “50%”, flexShrink: 0, marginRight: 10, display: “inline-block” },
trackName: { fontSize: 10, whiteSpace: “nowrap”, overflow: “hidden”, textOverflow: “ellipsis” },
detail: { flex: 1, overflowY: “auto”, padding: “14px 18px” },
trackTitle: { fontSize: 15, fontWeight: 700, color: “#fff” },
tag: { fontSize: 9, background: “#0d0d0d”, border: “1px solid #1a1a1a”, padding: “2px 8px”, borderRadius: 20 },
foldHeader: { display: “flex”, alignItems: “center”, gap: 7, cursor: “pointer”, marginBottom: 8, userSelect: “none” },
foldTitle: { fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: “uppercase”, color: “#404040” },
foldBody: { background: “#0d0d0d”, borderRadius: 7, padding: “12px 14px”, border: “1px solid #151515” },
section: { fontSize: 9, fontWeight: 700, color: “#f0c040”, letterSpacing: 1, padding: “10px 0 6px” },
linePair: { marginBottom: 5 },
og: { fontSize: 11, color: “#b0b0b0”, lineHeight: 1.5 },
tr: { fontSize: 10, color: “#5a8a4a”, lineHeight: 1.5, fontStyle: “italic” },
note: { padding: “6px 0”, borderBottom: “1px solid #131313” },
noteRef: { fontSize: 9, color: “#f0c040”, fontWeight: 500, marginBottom: 2 },
noteExp: { fontSize: 10, color: “#777”, lineHeight: 1.5 },
};
