import { useState, useRef, useCallback } from "react";

const TRACKLIST_PROMPT = `Utilise web_search pour trouver la tracklist EXACTE de l'album demandé. Cherche sur Wikipedia ou Genius.
Retourne UNIQUEMENT du JSON sans backticks: {"tracks": ["titre 1", "titre 2", ...]}
Titres exacts sans featurings. Si introuvable: {"tracks": [], "error": "introuvable"}`;

const DECODE_PROMPT = `Tu es un traducteur rap expert. L'utilisateur te donne un morceau + artiste + album.

ÉTAPE 1: Utilise web_search pour trouver les paroles de ce morceau sur Genius ou un site de lyrics.
ÉTAPE 2: À partir des paroles trouvées, produis une traduction bilingue ligne par ligne + un décryptage.

Retourne UNIQUEMENT du JSON sans backticks:
{
  "found": true,
  "lang": "langue",
  "lines": [
    {"section": "[Couplet 1]"},
    {"og": "ligne originale", "fr": "traduction française"},
    {"og": "ligne originale 2", "fr": "traduction française 2"},
    {"section": "[Refrain]"},
    {"og": "...", "fr": "..."}
  ],
  "decryptage": [
    {"ref": "mot ou expression", "explication": "explication concise du slang, ref culturelle, wordplay, double sens"}
  ]
}

Chaque objet dans "lines" est SOIT {"section": "nom de section"} SOIT {"og": "original", "fr": "traduction"}.

Règles:
- La traduction privilégie le SENS sur le mot à mot. Adapte les expressions.
- Le décryptage ne couvre que les passages opaques: slang, refs, wordplay. Pas les lignes évidentes.
- Si le morceau est en français: "fr" = null pour chaque ligne.
- Si les paroles sont introuvables: {"found": false, "lang": "?", "lines": [], "decryptage": []}
- Ton direct, pas académique.`;

async function callClaude(system, user, search = false) {
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (search) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response");
  return JSON.parse(m[0]);
}

const Dot = ({ status }) => (
  <span style={{
    width: 7, height: 7, borderRadius: "50%", flexShrink: 0, marginRight: 10, display: "inline-block",
    background: { idle: "#252525", loading: "#f0c040", done: "#4ade80", error: "#ef4444" }[status] || "#252525",
    animation: status === "loading" ? "pulse 1s infinite" : "none",
  }} />
);

const Tag = ({ children, color = "#666" }) => (
  <span style={{
    fontSize: 10, color, background: `${color}12`, border: `1px solid ${color}25`,
    padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap", fontFamily: "inherit",
  }}>{children}</span>
);

const Shimmer = () => (
  <div style={{ width: 150, height: 3, background: "#111", borderRadius: 2, margin: "0 auto", overflow: "hidden" }}>
    <div style={{
      width: "40%", height: "100%", borderRadius: 2,
      background: "linear-gradient(90deg, transparent, #f0c040, transparent)",
      backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite",
    }} />
  </div>
);

function Section({ title, color, children, open: initOpen = true }) {
  const [open, setOpen] = useState(initOpen);
  return (
    <div style={{ marginBottom: 20 }}>
      <div onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
        marginBottom: open ? 10 : 0, userSelect: "none",
      }}>
        <div style={{ width: 3, height: 12, background: color, borderRadius: 2 }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#454545" }}>{title}</span>
        <span style={{ fontSize: 10, color: "#2a2a2a", marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && <div style={{ background: "#0d0d0d", borderRadius: 8, padding: "14px 16px", border: "1px solid #161616" }}>{children}</div>}
    </div>
  );
}

function Inp({ label, val, set, ph, enter }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 9, color: "#333", textTransform: "uppercase", letterSpacing: 1.5, display: "block", marginBottom: 4 }}>{label}</label>
      <input value={val} onChange={e => set(e.target.value)} placeholder={ph}
        onKeyDown={e => e.key === "Enter" && enter?.()}
        style={{
          width: "100%", background: "#0d0d0d", border: "1px solid #181818",
          color: "#fff", padding: "10px 11px", borderRadius: 5,
          fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
        }} />
    </div>
  );
}

export default function App() {
  const [album, setAlbum] = useState("");
  const [artist, setArtist] = useState("");
  const [tracks, setTracks] = useState([]);
  const [trackData, setTrackData] = useState({});
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [phase, setPhase] = useState("input");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [autoMode, setAutoMode] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const abortRef = useRef(false);
  const dataRef = useRef({});

  const go = async () => {
    if (!album.trim() || !artist.trim()) return;
    setPhase("loading");
    try {
      const r = await callClaude(TRACKLIST_PROMPT, `"${album}" par ${artist}`, true);
      if (r.tracks?.length) {
        setTracks(r.tracks);
        setProgress({ done: 0, total: r.tracks.length });
        setPhase("main");
      } else { setErrMsg(r.error || "Introuvable"); setPhase("error"); }
    } catch (e) { setErrMsg(e.message); setPhase("error"); }
  };

  const decode = useCallback(async (name) => {
    if (dataRef.current[name]?.status === "done") { setSelectedTrack(name); return; }
    const up = v => { dataRef.current = { ...dataRef.current, [name]: v }; setTrackData({ ...dataRef.current }); };
    up({ status: "loading" }); setSelectedTrack(name);
    try {
      const r = await callClaude(DECODE_PROMPT, `"${name}" par ${artist} (album: ${album})`, true);
      up({ status: "done", data: r });
      setProgress(p => ({ ...p, done: p.done + 1 }));
    } catch (e) { up({ status: "error", error: e.message }); }
  }, [artist, album]);

  const decodeAll = useCallback(async () => {
    abortRef.current = false; setAutoMode(true);
    for (const t of tracks) {
      if (abortRef.current) break;
      if (dataRef.current[t]?.status === "done") continue;
      await decode(t);
      await new Promise(r => setTimeout(r, 300));
    }
    setAutoMode(false);
  }, [tracks, decode]);

  const retry = n => { delete dataRef.current[n]; setTrackData({ ...dataRef.current }); decode(n); };
  const reset = () => {
    abortRef.current = true; setPhase("input"); setTracks([]); setTrackData({});
    dataRef.current = {}; setSelectedTrack(null); setAutoMode(false);
  };

  const sel = selectedTrack && trackData[selectedTrack]?.data;
  const selSt = selectedTrack ? trackData[selectedTrack]?.status : null;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#ddd", fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap');
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes slideIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        input::placeholder{color:#2a2a2a}
        *::-webkit-scrollbar{width:4px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:#1a1a1a;border-radius:2px}
      `}</style>

      <div style={{ padding: "13px 16px", borderBottom: "1px solid #131313", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 5, background: "linear-gradient(135deg,#f0c040,#e05030)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#0a0a0a",
        }}>翻</div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#fff" }}>RAP DECODER</div>
          <div style={{ fontSize: 8, color: "#333" }}>web search → traduction bilingue → décryptage</div>
        </div>
        {phase !== "input" && (
          <button onClick={reset} style={{
            marginLeft: "auto", background: "none", border: "1px solid #1a1a1a", color: "#444",
            padding: "3px 9px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit",
          }}>←</button>
        )}
      </div>

      {phase === "input" && (
        <div style={{ maxWidth: 380, margin: "0 auto", padding: "56px 16px", animation: "slideIn .25s ease" }}>
          <Inp label="Artiste" val={artist} set={setArtist} ph="Denzel Curry" enter={go} />
          <Inp label="Album" val={album} set={setAlbum} ph="Melt My Eyez See Your Future" enter={go} />
          <button onClick={go} style={{
            width: "100%", padding: "11px", borderRadius: 6, border: "none", marginTop: 6,
            background: "linear-gradient(135deg,#f0c040,#e05030)",
            color: "#0a0a0a", fontSize: 11, fontWeight: 700, fontFamily: "inherit",
            cursor: "pointer", textTransform: "uppercase", letterSpacing: 2,
          }}>Décoder</button>
        </div>
      )}

      {phase === "loading" && <div style={{ textAlign: "center", padding: "70px 0" }}><Shimmer /><div style={{ fontSize: 10, color: "#333", marginTop: 10 }}>Tracklist...</div></div>}
      {phase === "error" && (
        <div style={{ textAlign: "center", padding: "70px 0" }}>
          <div style={{ fontSize: 10, color: "#ef4444", marginBottom: 10 }}>{errMsg}</div>
          <button onClick={() => setPhase("input")} style={{ background: "#131313", border: "1px solid #1e1e1e", color: "#666", padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", fontSize: 10 }}>Retour</button>
        </div>
      )}

      {phase === "main" && (
        <div style={{ display: "flex", height: "calc(100vh - 53px)" }}>
          <div style={{ width: 260, minWidth: 260, borderRight: "1px solid #131313", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #131313", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{album}</div>
                <div style={{ fontSize: 9, color: "#333", marginTop: 1 }}>{artist} · {progress.done}/{progress.total}</div>
              </div>
              <button onClick={autoMode ? () => { abortRef.current = true; setAutoMode(false); } : decodeAll} style={{
                background: "#131313", border: `1px solid ${autoMode ? "#ef4444" : "#222"}`, color: autoMode ? "#ef4444" : "#f0c040",
                padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontSize: 9, fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap", marginLeft: 6,
              }}>{autoMode ? "Stop" : "Tout décoder"}</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {tracks.map((t, i) => {
                const st = trackData[t]?.status || "idle";
                const isSel = selectedTrack === t;
                return (
                  <div key={i} onClick={() => decode(t)} style={{
                    padding: "7px 14px", cursor: "pointer", display: "flex", alignItems: "center",
                    background: isSel ? "#131313" : "transparent",
                    borderLeft: isSel ? "2px solid #f0c040" : "2px solid transparent",
                  }}>
                    <Dot status={st} />
                    <span style={{ fontSize: 10, color: isSel ? "#ccc" : "#4a4a4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span style={{ color: "#252525", marginRight: 6 }}>{String(i + 1).padStart(2, "0")}</span>{t}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
            {!selectedTrack && <div style={{ textAlign: "center", padding: "50px 0", color: "#1e1e1e", fontSize: 10 }}>Sélectionne un morceau</div>}
            {selSt === "loading" && (
              <div style={{ padding: "36px 0", textAlign: "center", animation: "slideIn .2s" }}>
                <Shimmer /><div style={{ fontSize: 10, color: "#333", marginTop: 10 }}>Recherche + traduction...</div>
              </div>
            )}
            {selSt === "error" && (
              <div style={{ padding: "36px 0", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#ef4444", marginBottom: 8 }}>Erreur</div>
                <button onClick={() => retry(selectedTrack)} style={{ background: "#131313", border: "1px solid #1e1e1e", color: "#555", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", fontSize: 10 }}>Réessayer</button>
              </div>
            )}
            {sel && (
              <div style={{ animation: "slideIn .2s", maxWidth: 620 }}>
                <div style={{ marginBottom: 18 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>{selectedTrack}</h2>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <Tag>{sel.lang}</Tag>
                    {sel.found ? <Tag color="#4ade80">lyrics trouvées</Tag> : <Tag color="#f0c040">approximatif</Tag>}
                  </div>
                </div>
                {sel.lines?.length > 0 && (
                  <Section title="PAROLES + TRADUCTION" color="#4ade80">
                    {sel.lines.map((line, i) => {
                      if (line.section) {
                        return (
                          <div key={i} style={{
                            fontSize: 10, fontWeight: 700, color: "#f0c040", letterSpacing: 1,
                            padding: i === 0 ? "0 0 8px" : "14px 0 8px",
                            borderTop: i === 0 ? "none" : "1px solid #151515",
                          }}>{line.section}</div>
                        );
                      }
                      return (
                        <div key={i} style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 11, color: "#c0c0c0", lineHeight: 1.5 }}>{line.og}</div>
                          {line.fr && <div style={{ fontSize: 10.5, color: "#6a9a5a", lineHeight: 1.5, fontStyle: "italic" }}>{line.fr}</div>}
                        </div>
                      );
                    })}
                  </Section>
                )}
                {sel.decryptage?.length > 0 && (
                  <Section title="DÉCRYPTAGE" color="#e05030">
                    {sel.decryptage.map((d, i) => (
                      <div key={i} style={{
                        padding: "7px 0",
                        borderBottom: i < sel.decryptage.length - 1 ? "1px solid #141414" : "none",
                      }}>
                        <div style={{ fontSize: 10, color: "#f0c040", marginBottom: 2, fontWeight: 500 }}>{d.ref}</div>
                        <div style={{ fontSize: 10.5, color: "#777", lineHeight: 1.5 }}>{d.explication}</div>
                      </div>
                    ))}
                  </Section>
                )}
                {!sel.found && sel.lines?.length === 0 && (
                  <div style={{ color: "#444", fontSize: 11, padding: "20px 0" }}>Paroles introuvables pour ce morceau.</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
