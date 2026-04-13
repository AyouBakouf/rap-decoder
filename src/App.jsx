import { useState, useRef, useCallback } from "react";

const TRACKLIST_SYSTEM = `Tu donnes les tracklists d'albums. Réponds en JSON: {"tracks":["titre1","titre2",...]}
Titres exacts, sans featurings. Si inconnu: {"tracks":[]}`;

const DECODE_SYSTEM = `Tu es un traducteur rap expert. Utilise web_search pour trouver les paroles du morceau. Cherche "[titre du morceau] [artiste] lyrics site:genius.com". Vérifie que le titre et l'artiste correspondent EXACTEMENT avant de traduire. Si les paroles ne correspondent pas, refais une recherche.


Réponds en JSON:
{
"found":true,
"lang":"anglais",
"lines":[
{"s":"[Couplet 1]"},
{"o":"original line","t":"traduction française"},
{"s":"[Refrain]"},
{"o":"...","t":"..."}
],
"notes":[
{"r":"mot/expression","e":"explication concise: slang, ref culturelle, wordplay"}
]
}

"s"=section, "o"=original, "t"=traduction, "r"=référence, "e"=explication.
Traduis le SENS pas mot à mot. Si français: "t"=null. IMPORTANT: inclus CHAQUE ligne du morceau sans exception, ne saute rien, même les lignes répétées ou les ad-libs.
Décryptage uniquement sur les passages opaques.
Si introuvable: {"found":false,"lang":"?","lines":[],"notes":[]}`;

async function callAPI(system, message, search = false) {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, message, search }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  // Parse JSON from response text
  const text = data.text || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response");
  return JSON.parse(m[0]);
}

export default function App() {
  const [album, setAlbum] = useState("");
  const [artist, setArtist] = useState("");
  const [tracks, setTracks] = useState([]);
  const [data, setData] = useState({});
  const [sel, setSel] = useState(null);
  const [view, setView] = useState("input");
  const [done, setDone] = useState(0);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState("");
  const stopRef = useRef(false);
  const dRef = useRef({});
  const [isMobile] = useState(() => window.innerWidth <= 700);

  const go = async () => {
    if (!album.trim() || !artist.trim()) return;
    setView("loading"); setErr("");
    try {
      const r = await callAPI(TRACKLIST_SYSTEM, `${album} - ${artist}`);
      if (r.tracks?.length) {
        setTracks(r.tracks); setDone(0); setView("list");
      } else { setErr("Album introuvable"); setView("error"); }
    } catch (e) { setErr(e.message); setView("error"); }
  };

  const decode = useCallback(async (name) => {
    if (dRef.current[name]?.st === "ok") { setSel(name); return; }
    const up = v => { dRef.current = { ...dRef.current, [name]: v }; setData({ ...dRef.current }); };
    up({ st: "load" }); setSel(name);
    try {
      const r = await callAPI(DECODE_SYSTEM, `Paroles exactes de "${name}" par ${artist}, album "${album}". Cherche sur Genius.`
, true);
      up({ st: "ok", d: r }); setDone(p => p + 1);
    } catch (e) { up({ st: "err", msg: e.message }); }
  }, [artist, album]);

  const decodeAll = useCallback(async () => {
    stopRef.current = false; setAuto(true);
    for (const t of tracks) {
      if (stopRef.current) break;
      if (dRef.current[t]?.st === "ok") continue;
      await decode(t);
      await new Promise(r => setTimeout(r, 300));
    }
    setAuto(false);
  }, [tracks, decode]);

  const reset = () => {
    stopRef.current = true; setView("input"); setTracks([]); setData({});
    dRef.current = {}; setSel(null); setAuto(false); setDone(0);
  };

  const cur = sel && data[sel];
  const curD = cur?.d;
  const showSidebar = !isMobile || !sel;
  const showDetail = !isMobile || sel;

  return (
    <div style={S.root}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={S.header}>
        <div style={S.logo}>翻</div>
        <div style={{ flex: 1 }}>
          <div style={S.title}>RAP DECODER</div>
          <div style={{ fontSize: 8, color: "#333" }}>gemini 3 flash · google search · traduction</div>
        </div>
        {view !== "input" && <button onClick={reset} style={S.back}>←</button>}
      </div>

      {/* Input */}
      {view === "input" && (
        <div style={S.inputWrap}>
          <Inp label="Artiste" val={artist} set={setArtist} ph="Denzel Curry" enter={go} />
          <Inp label="Album" val={album} set={setAlbum} ph="Melt My Eyez See Your Future" enter={go} />
          <button onClick={go} style={S.goBtn}>Décoder</button>
        </div>
      )}

      {view === "loading" && <div style={S.center}><div style={S.spinner} /><div style={S.dim}>Tracklist...</div></div>}
      {view === "error" && (
        <div style={S.center}>
          <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 10 }}>{err}</div>
          <button onClick={() => setView("input")} style={S.retryBtn}>Retour</button>
        </div>
      )}

      {/* Main */}
      {view === "list" && (
        <div style={S.main}>
          {showSidebar && (
            <div style={{ ...S.sidebar, width: isMobile ? "100%" : 260, minWidth: isMobile ? 0 : 260 }}>
              <div style={S.sideHeader}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.albumTitle}>{album}</div>
                  <div style={S.albumSub}>{artist} · {done}/{tracks.length}</div>
                </div>
                <button onClick={auto ? () => { stopRef.current = true; setAuto(false); } : decodeAll}
                  style={{ ...S.allBtn, borderColor: auto ? "#ef4444" : "#222", color: auto ? "#ef4444" : "#f0c040" }}>
                  {auto ? "Stop" : "Tout"}
                </button>
              </div>
              {tracks.map((t, i) => {
                const st = data[t]?.st || "idle";
                const isSel = sel === t;
                return (
                  <div key={i} onClick={() => decode(t)} style={{
                    ...S.trackRow, background: isSel ? "#131313" : "transparent",
                    borderLeft: isSel ? "2px solid #f0c040" : "2px solid transparent",
                  }}>
                    <span style={{ ...S.dot, background: { idle: "#222", load: "#f0c040", ok: "#4ade80", err: "#ef4444" }[st],
                      animation: st === "load" ? "pulse 1s infinite" : "none" }} />
                    <span style={{ ...S.trackName, color: isSel ? "#ccc" : "#555" }}>
                      <span style={{ color: "#2a2a2a", marginRight: 6 }}>{String(i + 1).padStart(2, "0")}</span>{t}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {showDetail && sel && (
            <div style={S.detail}>
              {isMobile && <button onClick={() => setSel(null)} style={{ ...S.back, marginBottom: 12 }}>← morceaux</button>}

              {cur?.st === "load" && <div style={S.center}><div style={S.spinner} /><div style={S.dim}>Recherche + traduction...</div></div>}

              {cur?.st === "err" && (
                <div style={S.center}>
                  <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 8 }}>{cur.msg}</div>
                  <button onClick={() => { delete dRef.current[sel]; setData({ ...dRef.current }); decode(sel); }} style={S.retryBtn}>Réessayer</button>
                </div>
              )}

              {curD && (
                <div style={{ animation: "fadeIn .2s ease" }}>
                  <div style={{ marginBottom: 16 }}>
                    <div style={S.trackTitle}>{sel}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                      <span style={{ ...S.tag, color: "#888" }}>{curD.lang}</span>
                      {curD.found ? <span style={{ ...S.tag, color: "#4ade80" }}>lyrics trouvées</span> : <span style={{ ...S.tag, color: "#f0c040" }}>approximatif</span>}
                    </div>
                  </div>

                  {curD.lines?.length > 0 && (
                    <Fold title="PAROLES + TRADUCTION" color="#4ade80">
                      {curD.lines.map((l, i) => l.s
                        ? <div key={i} style={S.section}>{l.s}</div>
                        : <div key={i} style={S.linePair}>
                            <div style={S.og}>{l.o}</div>
                            {l.t && <div style={S.tr}>{l.t}</div>}
                          </div>
                      )}
                    </Fold>
                  )}

                  {curD.notes?.length > 0 && (
                    <Fold title="DÉCRYPTAGE" color="#e05030">
                      {curD.notes.map((n, i) => (
                        <div key={i} style={S.note}>
                          <div style={S.noteRef}>{n.r}</div>
                          <div style={S.noteExp}>{n.e}</div>
                        </div>
                      ))}
                    </Fold>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Fold({ title, color, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 18 }}>
      <div onClick={() => setOpen(!open)} style={S.foldHeader}>
        <div style={{ width: 3, height: 11, background: color, borderRadius: 2 }} />
        <span style={S.foldTitle}>{title}</span>
        <span style={{ fontSize: 10, color: "#222", marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && <div style={S.foldBody}>{children}</div>}
    </div>
  );
}

function Inp({ label, val, set, ph, enter }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 9, color: "#333", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>{label}</div>
      <input value={val} onChange={e => set(e.target.value)} placeholder={ph}
        onKeyDown={e => e.key === "Enter" && enter?.()}
        style={S.input} />
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap');
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
input::placeholder{color:#2a2a2a}
*::-webkit-scrollbar{width:4px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:#1a1a1a;border-radius:2px}
`;

const S = {
  root: { minHeight: "100vh", background: "#0a0a0a", color: "#ddd", fontFamily: "'JetBrains Mono',monospace" },
  header: { padding: "13px 16px", borderBottom: "1px solid #141414", display: "flex", alignItems: "center", gap: 10 },
  logo: { width: 26, height: 26, borderRadius: 5, background: "linear-gradient(135deg,#f0c040,#e05030)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#0a0a0a", flexShrink: 0 },
  title: { fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#fff" },
  back: { background: "none", border: "1px solid #1a1a1a", color: "#444", padding: "3px 9px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit" },
  inputWrap: { maxWidth: 380, margin: "0 auto", padding: "50px 16px" },
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
  linePair: { marginBottom: 5 },
  og: { fontSize: 11, color: "#b0b0b0", lineHeight: 1.5 },
  tr: { fontSize: 10, color: "#5a8a4a", lineHeight: 1.5, fontStyle: "italic" },
  note: { padding: "6px 0", borderBottom: "1px solid #131313" },
  noteRef: { fontSize: 9, color: "#f0c040", fontWeight: 500, marginBottom: 2 },
  noteExp: { fontSize: 10, color: "#777", lineHeight: 1.5 },
};
