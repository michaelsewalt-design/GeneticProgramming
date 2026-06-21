import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════
//  CLAUDE API — Idee → Fitness Functie
// ═══════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `Je bent een expert in genetische algoritmen en wiskundige optimalisatie.

De gebruiker beschrijft een idee of doel in gewone taal. Jouw taak is dit om te zetten naar een fitness functie voor een genetisch algoritme.

REGELS:
- Elk individu is een array "genes" met getallen tussen 0.0 en 1.0
- Kies tussen 4 en 8 genen (parameters), afhankelijk van de complexiteit
- De fitness functie retourneert een getal tussen 0 en 100 (hoger = beter)
- Schrijf de functie als JavaScript code (alleen de body, geen function declaratie)
- Schaal genes[i] naar zinvolle waarden binnenin de functie
- Voeg korte inline comments toe die uitleggen wat elk gen betekent

Reageer ALLEEN met geldig JSON in dit exacte formaat, geen uitleg of markdown:
{
  "geneCount": <number 4-8>,
  "geneLabels": ["label voor gen 0", "label voor gen 1", ...],
  "geneMin": [min waarde gen 0, min waarde gen 1, ...],
  "geneMax": [max waarde gen 0, max waarde gen 1, ...],
  "geneUnit": ["eenheid 0", "eenheid 1", ...],
  "fitnessFunction": "<JS code als string, gebruikt genes[0..n], retourneert 0-100>",
  "description": "<één zin: wat optimaliseert dit model?>",
  "perfectScore": "<wat betekent score=100 in mensentaal?>"
}`;

async function generateFitnessFunction(userIdea) {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userIdea }]
    })
  });
  const data = await response.json();
  if (!response.ok || !data.content) {
    throw new Error(data.error?.message || JSON.stringify(data));
  }
  const text = data.content.map(b => b.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ═══════════════════════════════════════════════════════════
//  GENETISCH ALGORITME
// ═══════════════════════════════════════════════════════════

function makeIndividual(n) {
  return Array.from({ length: n }, () => Math.random());
}

function makePopulation(size, n) {
  return Array.from({ length: size }, () => makeIndividual(n));
}

function evalFitness(individual, fitnessFn) {
  try { return Math.max(0, Math.min(100, fitnessFn(individual))); }
  catch { return 0; }
}

function select(population, fitnessFn, fraction = 0.4) {
  const scored = population.map(ind => ({ ind, score: evalFitness(ind, fitnessFn) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(2, Math.floor(population.length * fraction)));
}

function crossover(p1, p2) {
  return p1.map((g, i) => Math.random() < 0.5 ? g : p2[i]);
}

function mutate(ind, rate = 0.1) {
  return ind.map(g => Math.random() < rate ? Math.min(1, Math.max(0, g + (Math.random() - 0.5) * 0.3)) : g);
}

function nextGeneration(survivors, size, mutRate) {
  const pop = survivors.map(s => [...s.ind]);
  while (pop.length < size) {
    const p1 = survivors[Math.floor(Math.random() * survivors.length)].ind;
    const p2 = survivors[Math.floor(Math.random() * survivors.length)].ind;
    pop.push(mutate(crossover(p1, p2), mutRate));
  }
  return pop;
}

// ═══════════════════════════════════════════════════════════
//  VOORBEELDEN
// ═══════════════════════════════════════════════════════════

const EXAMPLES = [
  "Optimaliseer mijn dagelijkse routine: maximaliseer productiviteit, gezondheid en geluk door slaap, sport, werkuren en vrije tijd in balans te brengen",
  "Vind de ideale voedingsverdeling per dag voor maximale energie: koolhydraten, eiwitten, vetten, vezels, water en calorieën",
  "Ontwerp het optimale leerplan voor een student: verdeel tijd over colleges, zelfstudie, oefening, pauzes en slaap",
  "Optimaliseer een kleine moestuin: kies de beste mix van groenten op basis van opbrengst, waterverbruik en seizoen",
];

// ═══════════════════════════════════════════════════════════
//  HOOFD COMPONENT
// ═══════════════════════════════════════════════════════════

export default function App() {
  const [idea, setIdea] = useState("");
  const [phase, setPhase] = useState("input"); // input | loading | ready | running | done
  const [model, setModel] = useState(null);
  const [fitnessFn, setFitnessFn] = useState(null);
  const [error, setError] = useState("");

  const [population, setPopulation] = useState([]);
  const [generation, setGeneration] = useState(0);
  const [history, setHistory] = useState([]);
  const [bestInd, setBestInd] = useState(null);
  const [bestScore, setBestScore] = useState(0);

  const intervalRef = useRef(null);
  const stateRef = useRef({});

  const POP_SIZE = 30;
  const MUT_RATE = 0.08;
  const MAX_GEN = 100;

  // ── Stap 1: AI genereert fitness model ──
  const handleGenerate = async () => {
    if (!idea.trim()) return;
    setPhase("loading");
    setError("");
    try {
      const result = await generateFitnessFunction(idea);
      // Compileer de fitness functie
      const fn = new Function("genes", result.fitnessFunction);
      setModel(result);
      setFitnessFn(() => fn);
      // Init populatie
      const pop = makePopulation(POP_SIZE, result.geneCount);
      setPopulation(pop);
      setGeneration(0);
      setHistory([]);
      setBestInd(null);
      setBestScore(0);
      stateRef.current = { pop, gen: 0, hist: [], fn };
      setPhase("ready");
    } catch (e) {
      setError("Fout bij genereren: " + e.message);
      setPhase("input");
    }
  };

  // ── Stap 2: Evolutie stap ──
  const step = useCallback(() => {
    const { pop, gen, hist, fn } = stateRef.current;
    const scored = select(pop, fn, 0.4);
    const best = scored[0];
    const avgScore = scored.reduce((a, b) => a + b.score, 0) / scored.length;

    const newHist = [...hist, { gen: gen + 1, best: best.score, avg: avgScore }];
    stateRef.current.hist = newHist;

    if (gen + 1 >= MAX_GEN || best.score >= 99) {
      stateRef.current.gen = gen + 1;
      setGeneration(gen + 1);
      setHistory([...newHist]);
      setBestInd([...best.ind]);
      setBestScore(best.score);
      setPhase("done");
      clearInterval(intervalRef.current);
      return;
    }

    const newPop = nextGeneration(scored, POP_SIZE, MUT_RATE);
    stateRef.current = { pop: newPop, gen: gen + 1, hist: newHist, fn };
    setPopulation([...newPop]);
    setGeneration(gen + 1);
    setHistory([...newHist]);
    setBestInd([...best.ind]);
    setBestScore(best.score);
  }, []);

  const startEvo = () => {
    setPhase("running");
    intervalRef.current = setInterval(step, 80);
  };

  const pauseEvo = () => {
    clearInterval(intervalRef.current);
    setPhase("ready");
  };

  const resetAll = () => {
    clearInterval(intervalRef.current);
    setPhase("input");
    setModel(null);
    setFitnessFn(null);
    setIdea("");
    setHistory([]);
    setBestInd(null);
    setBestScore(0);
  };

  useEffect(() => () => clearInterval(intervalRef.current), []);

  const scaleGene = (val, i) => {
    if (!model) return val;
    const min = model.geneMin[i] ?? 0;
    const max = model.geneMax[i] ?? 1;
    return (val * (max - min) + min);
  };

  const formatVal = (val, i) => {
    const scaled = scaleGene(val, i);
    const unit = model?.geneUnit?.[i] ?? "";
    return `${scaled % 1 === 0 ? scaled.toFixed(0) : scaled.toFixed(2)} ${unit}`.trim();
  };

  // ── Fitness grafiek ──
  const maxH = 90;
  const histPoints = history.map((h, i) => ({
    x: (i / Math.max(history.length - 1, 1)) * 100,
    yBest: maxH - (h.best / 100) * maxH,
    yAvg: maxH - (h.avg / 100) * maxH,
  }));

  return (
    <div style={styles.root}>
      {/* Achtergrond raster */}
      <div style={styles.grid} />

      <div style={styles.container}>

        {/* ── Header ── */}
        <header style={styles.header}>
          <div style={styles.badge}>GENETISCH ALGORITME · AI MODULE</div>
          <h1 style={styles.title}>Idee → Evolutie</h1>
          <p style={styles.subtitle}>Beschrijf een optimalisatiedoel. AI vertaalt het naar een fitness functie. Het algoritme evolueert naar de oplossing.</p>
        </header>

        {/* ── Fase: Input ── */}
        {(phase === "input" || phase === "loading") && (
          <div style={styles.card}>
            <div style={styles.cardLabel}>① Beschrijf je idee of doel</div>
            <textarea
              style={styles.textarea}
              placeholder="Bijv: Optimaliseer mijn dagelijkse routine voor maximale productiviteit en gezondheid…"
              value={idea}
              onChange={e => setIdea(e.target.value)}
              rows={4}
            />

            {/* Voorbeelden */}
            <div style={{ marginTop: 14 }}>
              <div style={styles.exLabel}>Voorbeelden:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {EXAMPLES.map((ex, i) => (
                  <button key={i} style={styles.exBtn} onClick={() => setIdea(ex)}>
                    {ex.slice(0, 72)}…
                  </button>
                ))}
              </div>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button
              style={{ ...styles.btn, ...styles.btnPrimary, marginTop: 18, opacity: phase === "loading" ? 0.7 : 1 }}
              onClick={handleGenerate}
              disabled={phase === "loading" || !idea.trim()}
            >
              {phase === "loading" ? (
                <span>⟳ AI analyseert idee…</span>
              ) : (
                <span>→ Genereer Fitness Functie</span>
              )}
            </button>
          </div>
        )}

        {/* ── Fase: Model gereed / running / done ── */}
        {model && phase !== "input" && phase !== "loading" && (
          <>
            {/* Model beschrijving */}
            <div style={{ ...styles.card, borderColor: "#1a4a3a" }}>
              <div style={styles.cardLabel}>② AI-gegenereerd model</div>
              <div style={styles.modelDesc}>
                <span style={{ color: "#4ade80" }}>✓</span> {model.description}
              </div>
              <div style={styles.geneGrid}>
                {model.geneLabels.map((label, i) => (
                  <div key={i} style={styles.geneTag}>
                    <span style={{ color: "#94a3b8", fontSize: 10 }}>Gen {i}</span>
                    <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 12, marginTop: 2 }}>{label}</span>
                    <span style={{ color: "#64748b", fontSize: 10 }}>
                      {model.geneMin[i]} – {model.geneMax[i]} {model.geneUnit[i]}
                    </span>
                  </div>
                ))}
              </div>

              {/* Fitness code preview */}
              <details style={{ marginTop: 12 }}>
                <summary style={{ fontSize: 11, color: "#38bdf8", cursor: "pointer", letterSpacing: 1 }}>
                  BEKIJK FITNESS FUNCTIE ▾
                </summary>
                <pre style={styles.codeBlock}>
                  {`function fitness(genes) {\n${model.fitnessFunction}\n}`}
                </pre>
              </details>
            </div>

            {/* Status & Controls */}
            <div style={styles.statsRow}>
              <StatBox label="Generatie" value={generation} sub={`/ ${MAX_GEN}`} />
              <StatBox label="Beste score" value={bestScore ? bestScore.toFixed(1) : "—"} sub="/ 100" color="#4ade80" />
              <StatBox label="Status" value={
                phase === "running" ? "Evolueert" :
                phase === "done" ? (bestScore >= 99 ? "Optimum" : "Klaar") : "Klaar"
              } sub={phase === "done" ? "✓" : phase === "running" ? "⟳" : "▶"} />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {phase === "ready" && <button style={{ ...styles.btn, ...styles.btnGreen }} onClick={startEvo}>▶ Start</button>}
                {phase === "running" && <button style={{ ...styles.btn, ...styles.btnAmber }} onClick={pauseEvo}>⏸ Pauze</button>}
                {phase === "done" && <button style={{ ...styles.btn, ...styles.btnGreen }} onClick={() => {
                  const pop = makePopulation(POP_SIZE, model.geneCount);
                  stateRef.current = { pop, gen: 0, hist: [], fn: fitnessFn };
                  setPopulation(pop); setGeneration(0); setHistory([]); setBestInd(null); setBestScore(0); setPhase("ready");
                }}>↺ Opnieuw</button>}
                <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={resetAll}>Nieuw idee</button>
              </div>
            </div>

            {/* Voortgangsbalk */}
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${bestScore}%` }} />
            </div>

            {/* Grafiek + Beste individu naast elkaar */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

              {/* Grafiek */}
              <div style={styles.card}>
                <div style={styles.cardLabel}>Fitness over generaties</div>
                <svg width="100%" height={maxH + 10} viewBox={`0 0 100 ${maxH + 10}`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="bestGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4ade80" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {histPoints.length > 1 && (
                    <>
                      <polygon
                        points={[
                          ...histPoints.map(p => `${p.x},${p.yBest}`),
                          `${histPoints[histPoints.length-1].x},${maxH}`,
                          `0,${maxH}`
                        ].join(" ")}
                        fill="url(#bestGrad)"
                      />
                      <polyline
                        points={histPoints.map(p => `${p.x},${p.yAvg}`).join(" ")}
                        fill="none" stroke="#38bdf840" strokeWidth="0.8"
                      />
                      <polyline
                        points={histPoints.map(p => `${p.x},${p.yBest}`).join(" ")}
                        fill="none" stroke="#4ade80" strokeWidth="1.2"
                      />
                    </>
                  )}
                </svg>
                <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 10, color: "#64748b" }}>
                  <span><span style={{ color: "#4ade80" }}>—</span> Beste</span>
                  <span><span style={{ color: "#38bdf8" }}>—</span> Gemiddeld</span>
                </div>
              </div>

              {/* Beste individu */}
              <div style={styles.card}>
                <div style={styles.cardLabel}>Beste oplossing</div>
                {bestInd ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                      {model.geneLabels.map((label, i) => {
                        const val = bestInd[i];
                        const scaled = scaleGene(val, i);
                        const min = model.geneMin[i] ?? 0;
                        const max = model.geneMax[i] ?? 1;
                        const pct = ((scaled - min) / (max - min)) * 100;
                        return (
                          <div key={i}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                              <span style={{ color: "#94a3b8" }}>{label}</span>
                              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{formatVal(val, i)}</span>
                            </div>
                            <div style={{ height: 5, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #38bdf8, #4ade80)", borderRadius: 3 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {phase === "done" && (
                      <div style={styles.perfectBox}>
                        <div style={{ fontSize: 10, color: "#4ade80", letterSpacing: 2, marginBottom: 4 }}>OPTIMUM</div>
                        <div style={{ fontSize: 12, color: "#e2e8f0" }}>{model.perfectScore}</div>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ color: "#475569", fontSize: 13, marginTop: 12 }}>Start de evolutie om de beste oplossing te zien…</div>
                )}
              </div>
            </div>

            {/* Populatie heatmap */}
            {population.length > 0 && (
              <div style={styles.card}>
                <div style={styles.cardLabel}>Populatie heatmap — {model.geneCount} genen × {Math.min(population.length, 20)} individuen</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
                  {population.slice(0, 20).map((ind, row) => (
                    <div key={row} style={{ display: "flex", gap: 2 }}>
                      {ind.map((val, col) => (
                        <div key={col} style={{
                          flex: 1, height: 12, borderRadius: 2,
                          background: `hsl(${160 + val * 60}, 70%, ${20 + val * 40}%)`,
                          transition: "background 0.2s"
                        }} title={`Gen ${col}: ${val.toFixed(2)}`} />
                      ))}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 2, marginTop: 6 }}>
                  {model.geneLabels.map((l, i) => (
                    <div key={i} style={{ flex: 1, fontSize: 9, color: "#475569", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.split(" ")[0]}</div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Stat Box ──────────────────────────────────────────────────────────────────
function StatBox({ label, value, sub, color = "#38bdf8" }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 10, padding: "10px 16px", minWidth: 90 }}>
      <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ── Stijlen ───────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: "100vh",
    background: "#050d1a",
    color: "#e2e8f0",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    position: "relative",
    overflowX: "hidden",
  },
  grid: {
    position: "fixed", inset: 0, pointerEvents: "none",
    backgroundImage: "linear-gradient(rgba(56,189,248,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.03) 1px, transparent 1px)",
    backgroundSize: "40px 40px",
  },
  container: { maxWidth: 860, margin: "0 auto", padding: "32px 20px", position: "relative", zIndex: 1 },
  header: { marginBottom: 28, textAlign: "center" },
  badge: { fontSize: 10, letterSpacing: 4, color: "#38bdf8", marginBottom: 10, textTransform: "uppercase" },
  title: { fontSize: 32, fontWeight: 900, margin: "0 0 10px", letterSpacing: -1, color: "#f0f9ff" },
  subtitle: { fontSize: 13, color: "#64748b", maxWidth: 520, margin: "0 auto", lineHeight: 1.6 },
  card: {
    background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 12,
    padding: "18px 20px", marginBottom: 16,
  },
  cardLabel: { fontSize: 10, color: "#38bdf8", letterSpacing: 3, textTransform: "uppercase", marginBottom: 12, fontWeight: 700 },
  textarea: {
    width: "100%", background: "#0f1e35", border: "1px solid #1e3a5f",
    borderRadius: 8, padding: "12px 14px", color: "#e2e8f0",
    fontFamily: "inherit", fontSize: 13, lineHeight: 1.6, resize: "vertical",
    boxSizing: "border-box", outline: "none",
  },
  exLabel: { fontSize: 10, color: "#475569", letterSpacing: 2, marginBottom: 6 },
  exBtn: {
    background: "transparent", border: "1px solid #1e3a5f", borderRadius: 6,
    color: "#64748b", padding: "6px 10px", fontSize: 11, cursor: "pointer",
    textAlign: "left", fontFamily: "inherit", transition: "all 0.15s",
  },
  btn: { border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit", letterSpacing: 1 },
  btnPrimary: { background: "#38bdf8", color: "#050d1a", width: "100%" },
  btnGreen: { background: "#4ade80", color: "#050d1a" },
  btnAmber: { background: "#fbbf24", color: "#050d1a" },
  btnGhost: { background: "transparent", color: "#64748b", border: "1px solid #1e3a5f" },
  statsRow: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-start" },
  progressBar: { height: 6, background: "#0f1e35", borderRadius: 4, overflow: "hidden", marginBottom: 16 },
  progressFill: { height: "100%", background: "linear-gradient(90deg, #38bdf8, #4ade80)", borderRadius: 4, transition: "width 0.2s ease" },
  modelDesc: { fontSize: 13, color: "#94a3b8", lineHeight: 1.6, marginBottom: 14 },
  geneGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 },
  geneTag: {
    background: "#0f1e35", border: "1px solid #1e3a5f", borderRadius: 8,
    padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2,
  },
  codeBlock: {
    background: "#020810", border: "1px solid #0e2440", borderRadius: 8,
    padding: "12px 14px", fontSize: 11, color: "#4ade80", overflowX: "auto",
    marginTop: 10, lineHeight: 1.7,
  },
  perfectBox: {
    background: "#0a2a1a", border: "1px solid #166534", borderRadius: 8,
    padding: "12px 14px", marginTop: 14,
  },
  error: { color: "#f87171", fontSize: 12, marginTop: 10, padding: "8px 12px", background: "#2a0a0a", borderRadius: 6 },
};
