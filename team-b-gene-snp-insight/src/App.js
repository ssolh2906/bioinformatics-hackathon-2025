import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Sparkles, Database, Download, Link2 } from "lucide-react";

// --- Minimal tailwind-friendly UI primitives (shadcn-like) ---
const Card = ({ children, className = "" }) => (
  <div className={`rounded-2xl shadow-lg border bg-white ${className}`}>{children}</div>
);
const CardHeader = ({ children, className = "" }) => (
  <div className={`p-5 border-b ${className}`}>{children}</div>
);
const CardContent = ({ children, className = "" }) => (
  <div className={`p-5 ${className}`}>{children}</div>
);
const Button = ({ children, className = "", ...props }) => (
  <button
    className={`px-4 py-2 rounded-xl border shadow-sm hover:shadow transition ${className}`}
    {...props}
  >
    {children}
  </button>
);
const Input = (props) => (
  <input
    {...props}
    className={`w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring ${props.className || ""}`}
  />
);
const Select = ({ children, className = "", ...props }) => (
  <select {...props} className={`w-full px-3 py-2 rounded-xl border ${className}`}>{children}</select>
);

// --- Helpers ---
const isRsId = (q) => /^rs\d+$/i.test((q || "").trim());

async function fetchMyGene(symbol) {
  // Query for a human gene by official symbol
  const url = "https://mygene.info/v3/query?q=symbol:" +
    encodeURIComponent(symbol) +
    "%20AND%20species:human&fields=symbol,name,summary,entrezgene,ensembl.gene,genomic_pos,go.BP.term,go.MF.term,pathway.reactome.name";
  const r = await fetch(url);
  if (!r.ok) throw new Error("MyGene.info error " + r.status);
  const data = await r.json();
  const hit = data.hits && data.hits[0];
  return hit || null;
}

async function fetchEnsemblRs(rsid) {
  const url = "https://rest.ensembl.org/variation/homo_sapiens/" +
    encodeURIComponent(rsid) + "?content-type=application/json";
  const r = await fetch(url);
  if (!r.ok) throw new Error("Ensembl REST error " + r.status);
  const data = await r.json();
  return data;
}

function toInsightFromGene(hit) {
  if (!hit) return null;
  const goBP = (hit.go?.BP || []).map((x) => x.term);
  const goMF = (hit.go?.MF || []).map((x) => x.term);
  const pathways = (hit.pathway?.reactome || []).map((x) => x.name);
  return {
    type: "gene",
    symbol: hit.symbol,
    name: hit.name,
    entrez: hit.entrezgene,
    ensembl: hit.ensembl?.gene,
    location: hit.genomic_pos
      ? hit.genomic_pos.chr + ":" + hit.genomic_pos.start + "-" + hit.genomic_pos.end
      : undefined,
    summary: hit.summary,
    functional_role: {
      go_biological_process: goBP.slice(0, 6),
      go_molecular_function: goMF.slice(0, 6),
      pathways: pathways.slice(0, 6),
    },
    links: {
      mygene: hit.entrezgene ? ("https://mygene.info/v3/gene/" + hit.entrezgene) : null,
      ncbi_gene: hit.entrezgene ? ("https://www.ncbi.nlm.nih.gov/gene/" + hit.entrezgene) : null,
      ensembl_gene: hit.ensembl?.gene
        ? ("https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=" + hit.ensembl.gene)
        : null,
    },
  };
}

function summarizePopFreq(popGenotypes = []) {
  const mafList = [];
  for (const g of popGenotypes) {
    if (typeof g.frequency === "number") mafList.push(g.frequency);
  }
  if (!mafList.length) return null;
  const maf = Math.max.apply(null, mafList);
  return maf; // 0-1
}

function toInsightFromRs(ens) {
  if (!ens) return null;
  const maf = summarizePopFreq(ens.population_genotypes);
  const genes = (ens.mappings || [])
    .map((m) => m.gene_symbol)
    .filter(Boolean);
  return {
    type: "snp",
    rsid: ens.name || ens.id,
    most_severe_consequence: ens.most_severe_consequence,
    clinical_significance: ens.clinical_significance || undefined,
    minor_allele_freq: typeof maf === "number" ? maf : undefined,
    genes: Array.from(new Set(genes)),
    links: {
      ensembl: "https://www.ensembl.org/Homo_sapiens/Variation/Explore?v=" + (ens.name || ens.id),
      dbsnp: ens.name ? ("https://www.ncbi.nlm.nih.gov/snp/" + ens.name) : null,
    },
  };
}

// ---------------- AI providers (optional) ----------------
async function geminiSummarize(apiKey, facts) {
  const model = "gemini-1.5-flash"; // fast & free tier friendly
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;
  const prompt = "You are generating a concise, structured clinical/bioinformatics insight summary.\n" +
    "Return JSON with keys: title, functional_role, disease_associations, known_variants, clinical_notes, sources.\n" +
    "Use only the provided facts. Keep it under 150 words total.\nFacts:\n" + JSON.stringify(facts);
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Gemini API error " + r.status);
  const json = await r.json();
  const text = (json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text) || "";
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      return JSON.parse(text.slice(start, end + 1));
    }
  } catch (e) {}
  return { title: "Insight Summary", clinical_notes: text, sources: [] };
}

async function groqSummarize(apiKey, facts) {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const sys = "You write concise, structured clinical/bioinformatics insight summaries as compact JSON.";
  const user = "Return JSON with keys: title, functional_role, disease_associations, known_variants, clinical_notes, sources. Under 150 words total. Use strictly these facts: " + JSON.stringify(facts);
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error("Groq API error " + r.status + " (CORS? If so, route via a tiny server proxy).");
  const json = await r.json();
  const text = (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || "";
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1) return JSON.parse(text.slice(start, end + 1));
  } catch (e) {}
  return { title: "Insight Summary", clinical_notes: text, sources: [] };
}

async function claudeSummarizeViaProxy(facts) {
const r = await fetch("http://localhost:8787/api/claude", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ facts }),
});
if (!r.ok) throw new Error(`Proxy error: ${await r.text()}`);
const { text } = await r.json();
try {
const s = text.indexOf("{");
const e = text.lastIndexOf("}");
if (s !== -1 && e !== -1) return JSON.parse(text.slice(s, e + 1));
} catch {}
return { title: "Insight Summary", clinical_notes: text, sources: [] };
}

// ---------------- External hooks: ClinVar & Open Targets ----------------
async function fetchClinVarByGene(symbol, opts) {
  opts = opts || {}; const retmax = opts.retmax || 10;
  const esearch = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=" +
    encodeURIComponent(symbol) + "%5Bgene%5D+AND+%22Homo+sapiens%22%5BOrganism%5D&retmode=json&retmax=" + retmax;
  const r1 = await fetch(esearch);
  if (!r1.ok) throw new Error("ClinVar esearch error " + r1.status);
  const j1 = await r1.json();
  const ids = (j1.esearchresult && j1.esearchresult.idlist) || [];
  if (!ids.length) return [];
  const idstr = ids.join(",");
  const esum = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=" + idstr + "&retmode=json";
  const r2 = await fetch(esum);
  if (!r2.ok) throw new Error("ClinVar esummary error " + r2.status);
  const j2 = await r2.json();
  const result = j2.result || {};
  return ids.map((id) => {
    const x = result[id] || {};
    return {
      id: id,
      title: x.title,
      clinical_significance: x.clinical_significance && x.clinical_significance.description,
      accession: x.accession,
      last_update: x.last_update,
      url: x.uid ? ("https://www.ncbi.nlm.nih.gov/clinvar/" + x.uid + "/") : undefined,
    };
  });
}

async function fetchClinVarByRsid(rsid, opts) {
  opts = opts || {}; const retmax = opts.retmax || 10;
  const term = rsid;
  const esearch = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=" + encodeURIComponent(term) + "&retmode=json&retmax=" + retmax;
  const r1 = await fetch(esearch);
  if (!r1.ok) throw new Error("ClinVar esearch error " + r1.status);
  const j1 = await r1.json();
  const ids = (j1.esearchresult && j1.esearchresult.idlist) || [];
  if (!ids.length) return [];
  const esum = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=" + ids.join(",") + "&retmode=json";
  const r2 = await fetch(esum);
  if (!r2.ok) throw new Error("ClinVar esummary error " + r2.status);
  const j2 = await r2.json();
  const result = j2.result || {};
  return ids.map((id) => {
    const x = result[id] || {};
    return {
      id: id,
      title: x.title,
      clinical_significance: x.clinical_significance && x.clinical_significance.description,
      accession: x.accession,
      last_update: x.last_update,
      url: x.uid ? ("https://www.ncbi.nlm.nih.gov/clinvar/" + x.uid + "/") : undefined,
    };
  });
}

async function fetchOpenTargetsAssociations(ensemblId, opts) {
  opts = opts || {}; const size = opts.size || 10;
  const endpoint = "https://api.platform.opentargets.org/api/v4/graphql";
  const query = [
    "query GetAssociations($ensemblId: String!, $size: Int) {",
    "  target(ensemblId: $ensemblId) {",
    "    approvedSymbol",
    "    id",
    "    associatedDiseases(page: {index: 0, size: $size}) {",
    "      count",
    "      rows {",
    "        disease { id name }",
    "        score",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");
  const body = { query: query, variables: { ensemblId: ensemblId, size: size } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("OpenTargets error " + r.status);
  const j = await r.json();
  const rows = (j && j.data && j.data.target && j.data.target.associatedDiseases && j.data.target.associatedDiseases.rows) || [];
  return rows.map((x) => ({
    disease: x && x.disease && x.disease.name,
    disease_id: x && x.disease && x.disease.id,
    score: x && x.score,
  }));
}



// ---------------- Export helpers ----------------
function download(filename, text, type) {
  type = type || "text/plain";
  const blob = new Blob([text], { type: type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportJSON(name, payload) {
  download(name + ".json", JSON.stringify(payload, null, 2), "application/json");
}

function toKVRows(prefix, obj) {
  const rows = [];
  const walk = (base, o) => {
    if (o == null) return;
    if (Array.isArray(o)) {
      rows.push([base, o.join("; ")]);
      return;
    }
    if (typeof o === "object") {
      Object.keys(o).forEach((k) => walk((base ? base + "." : "") + k, o[k]));
      return;
    }
    rows.push([base, String(o)]);
  };
  walk(prefix, obj);
  return rows;
}

function exportCSV(name, sections) {
  // sections: array of { label, data (object) }
  const lines = ["section,key,value"];
  sections.forEach((s) => {
    toKVRows(s.label, s.data).forEach(([k, v]) => {
      const esc = (x) => '"' + String(x).replace(/"/g, '""') + '"';
      lines.push([esc(s.label), esc(k), esc(v)].join(","));
    });
  });
  download(name + ".csv", lines.join("\n"), "text/csv");
}

export default function App() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState(null);
  const [insight, setInsight] = useState(null);
  const [aiProvider, setAiProvider] = useState("gemini");
  const [apiKey, setApiKey] = useState("");
  const [aiError, setAiError] = useState("");
  const [clinvar, setClinvar] = useState({ items: [], error: "" });
  const [ot, setOt] = useState({ items: [], error: "" });

  const example = useMemo(() => ({ genes: ["TP53", "CFTR", "BRCA1"], snps: ["rs429358", "rs334"] }), []);

  async function run() {
    setLoading(true);
    setError("");
    setInsight(null);
    setRaw(null);
    setAiError("");
    setClinvar({ items: [], error: "" });
    setOt({ items: [], error: "" });
    try {
      const q = query.trim();
      if (!q) throw new Error("Enter a gene symbol (e.g., TP53) or SNP rsID (e.g., rs429358)");
      if (isRsId(q)) {
        const ens = await fetchEnsemblRs(q);
        const base = toInsightFromRs(ens);
        setRaw({ source: "ensembl", data: ens });
        const facts = { type: "snp", core: base };
        let summary = null;
        try {
        summary = await claudeSummarizeViaProxy(facts);
        } catch (e) {
        setAiError(e.message);
        }
        setInsight({ base, summary });
        // Hooks: ClinVar for rsID
        try { setClinvar({ items: await fetchClinVarByRsid(q, { retmax: 10 }), error: "" }); }
        catch (e) { setClinvar({ items: [], error: e.message + " (ClinVar may block CORS in some browsers)" }); }
      } else {
        const gene = await fetchMyGene(q);
        if (!gene) throw new Error("No human gene match on MyGene.info");
        const base = toInsightFromGene(gene);
        setRaw({ source: "mygene", data: gene });
        const facts = { type: "gene", core: base };
        let summary = null;
        try {
        summary = await claudeSummarizeViaProxy(facts);
        } catch (e) {
        setAiError(e.message);
        }
        setInsight({ base, summary });
        // Hooks: ClinVar (gene) + Open Targets (associations)
        try { setClinvar({ items: await fetchClinVarByGene(q, { retmax: 10 }), error: "" }); }
        catch (e) { setClinvar({ items: [], error: e.message + " (ClinVar may block CORS in some browsers)" }); }
        try { if (base.ensembl) setOt({ items: await fetchOpenTargetsAssociations(base.ensembl, { size: 10 }), error: "" }); }
        catch (e) { setOt({ items: [], error: e.message }); }
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const exportName = () => (insight && insight.base && (insight.base.type === "gene" ? insight.base.symbol : insight.base.rsid)) || "insight";
  const handleExportJSON = () => {
    const payload = {
      query: query,
      timestamp: new Date().toISOString(),
      base: insight && insight.base || null,
      ai_summary: insight && insight.summary || null,
      clinvar: clinvar && clinvar.items || [],
      open_targets: ot && ot.items || [],
      raw_source: raw || null,
    };
    exportJSON(exportName() + "-insight", payload);
  };
  const handleExportCSV = () => {
    const sections = [];
    if (insight && insight.base) sections.push({ label: "base", data: insight.base });
    if (insight && insight.summary) sections.push({ label: "ai_summary", data: insight.summary });
    if (clinvar && clinvar.items && clinvar.items.length) sections.push({ label: "clinvar", data: clinvar.items });
    if (ot && ot.items && ot.items.length) sections.push({ label: "open_targets", data: ot.items });
    exportCSV(exportName() + "-insight", sections);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <motion.h1 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-3xl font-semibold tracking-tight">
          Gene/SNP Insight Summarizer
        </motion.h1>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-slate-700">
              <Search className="w-5 h-5" />
              <strong>Enter a gene symbol or SNP rsID</strong>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <Input placeholder="e.g., TP53 or rs429358" value={query} onChange={(e) => setQuery(e.target.value)} />
                <div className="text-xs text-slate-500 mt-2">
                  Try quick picks: {example.genes.map((g) => (
                    <Button key={g} className="text-xs mr-2" onClick={() => setQuery(g)}>{g}</Button>
                  ))}
                  {example.snps.map((s) => (
                    <Button key={s} className="text-xs mr-2" onClick={() => setQuery(s)}>{s}</Button>
                  ))}
                </div>
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={run} disabled={loading} className="bg-slate-900 text-white">{loading ? "Fetching…" : "Collect facts"}</Button>
              </div>
            </div>
            {error && (<div className="mt-3 text-sm text-red-600">{error}</div>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-slate-700"><Sparkles className="w-5 h-5" /><strong>Optional: AI Summary</strong></div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-3">
              <Select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
                <option value="gemini">Google Gemini (recommended)</option>
                <option value="groq">Groq (may need proxy due to CORS)</option>
                <option value="claude">Claude (may need proxy due to CORS)</option>
              </Select>
              <Input placeholder="Enter your API key (kept in-browser)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" />
              <div className="flex items-end"><div className="text-xs text-slate-500">Gemini works from the browser via REST; Groq may require a tiny server if CORS blocks.</div></div>
            </div>
            {aiError && (<div className="mt-3 text-sm text-amber-700">{aiError}</div>)}
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center gap-2 text-slate-700"><Database className="w-5 h-5" /><strong>Facts collected</strong></div>
            </CardHeader>
            <CardContent>
              {!raw && (<div className="text-sm text-slate-500">No data yet. Collect facts above.</div>)}
              {raw && (
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Source</div>
                  <div className="text-sm">
                    {raw.source === "ensembl" && (<a className="underline" href="https://rest.ensembl.org" target="_blank" rel="noreferrer">Ensembl REST</a>)}
                    {raw.source === "mygene" && (<a className="underline" href="https://mygene.info" target="_blank" rel="noreferrer">MyGene.info</a>)}
                  </div>
                  <pre className="text-xs bg-slate-50 p-3 rounded-xl overflow-auto max-h-96">{JSON.stringify(raw.data, null, 2)}</pre>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-slate-700"><Sparkles className="w-5 h-5" /><strong>Insight Summary (structured)</strong></div>
            </CardHeader>
            <CardContent>
              {!insight && (<div className="text-sm text-slate-500">Run a query to generate a summary. If no API key is provided, you'll still see a structured base from primary sources.</div>)}
              {insight && (
                <div className="space-y-4">
                  {insight.base && insight.base.type === "gene" && (
                    <div className="space-y-2">
                      <div className="text-lg font-semibold">{insight.base.symbol} — {insight.base.name}</div>
                      {insight.base.location && (<div className="text-sm text-slate-600">Location: {insight.base.location}</div>)}
                      {insight.base.summary && (<div className="text-sm">{insight.base.summary}</div>)}
                      <div className="text-sm">
                        <div className="font-medium">Functional role</div>
                        <ul className="list-disc ml-5">
                          {insight.base.functional_role.go_biological_process.map((t, i) => (<li key={"bp" + i}>{t}</li>))}
                          {insight.base.functional_role.go_molecular_function.map((t, i) => (<li key={"mf" + i}>{t}</li>))}
                        </ul>
                        {insight.base.functional_role.pathways && insight.base.functional_role.pathways.length ? (
                          <div className="mt-2 text-xs text-slate-600">Pathways: {insight.base.functional_role.pathways.join(", ")}</div>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-600 space-x-3">
                        {insight.base.links && insight.base.links.ncbi_gene && (<a className="underline" href={insight.base.links.ncbi_gene} target="_blank" rel="noreferrer">NCBI</a>)}
                        {insight.base.links && insight.base.links.ensembl_gene && (<a className="underline" href={insight.base.links.ensembl_gene} target="_blank" rel="noreferrer">Ensembl</a>)}
                        {insight.base.links && insight.base.links.mygene && (<a className="underline" href={insight.base.links.mygene} target="_blank" rel="noreferrer">MyGene</a>)}
                      </div>
                    </div>
                  )}
                  {insight.base && insight.base.type === "snp" && (
                    <div className="space-y-2">
                      <div className="text-lg font-semibold">{insight.base.rsid}</div>
                      {insight.base.genes && insight.base.genes.length ? (<div className="text-sm text-slate-600">Nearby/affected genes: {insight.base.genes.join(", ")}</div>) : null}
                      <div className="text-sm">Most severe consequence: <span className="font-medium">{insight.base.most_severe_consequence || "—"}</span></div>
                      {typeof insight.base.minor_allele_freq === "number" && (<div className="text-sm">Approx. MAF (max across populations): {Math.round(insight.base.minor_allele_freq * 1000) / 10}%</div>)}
                      {insight.base.clinical_significance && (<div className="text-sm">Clinical significance: {Array.isArray(insight.base.clinical_significance) ? insight.base.clinical_significance.join(", ") : String(insight.base.clinical_significance)}</div>)}
                      <div className="text-xs text-slate-600 space-x-3">
                        {insight.base.links && insight.base.links.ensembl && (<a className="underline" href={insight.base.links.ensembl} target="_blank" rel="noreferrer">Ensembl</a>)}
                        {insight.base.links && insight.base.links.dbsnp && (<a className="underline" href={insight.base.links.dbsnp} target="_blank" rel="noreferrer">dbSNP</a>)}
                      </div>
                    </div>
                  )}

                  {/* AI summarization (optional) */}
                  {insight.summary && (
                    <div className="rounded-xl bg-slate-50 p-3 border">
                      <div className="text-sm font-medium mb-2">AI-powered summary</div>
                      <pre className="text-xs overflow-auto max-h-80">{JSON.stringify(insight.summary, null, 2)}</pre>
                    </div>
                  )}

                  {/* Exports */}
                  <div className="flex gap-2 pt-2">
                    <Button onClick={handleExportJSON} className="flex items-center gap-2"><Download className="w-4 h-4" /> Export JSON</Button>
                    <Button onClick={handleExportCSV} className="flex items-center gap-2"><Download className="w-4 h-4" /> Export CSV</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Hooks panel */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-slate-700"><Link2 className="w-5 h-5" /><strong>ClinVar & OpenTargets hooks</strong></div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="font-medium mb-2">ClinVar (top 10)</div>
                {clinvar.error && (<div className="text-sm text-amber-700">{clinvar.error}</div>)}
                {!clinvar.items.length && !clinvar.error && (<div className="text-sm text-slate-500">No ClinVar records yet.</div>)}
                <ul className="text-sm space-y-2">
                  {clinvar.items.map((x) => (
                    <li key={x.id} className="border rounded-lg p-2">
                      <div className="font-medium">{x.title}</div>
                      <div className="text-xs text-slate-600">Significance: {x.clinical_significance || "—"}</div>
                      {x.url && (<a className="text-xs underline" href={x.url} target="_blank" rel="noreferrer">Open in ClinVar</a>)}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-medium mb-2">Open Targets (top 10 disease associations)</div>
                {ot.error && (<div className="text-sm text-amber-700">{ot.error}</div>)}
                {!ot.items.length && !ot.error && (<div className="text-sm text-slate-500">No associations yet (requires Ensembl ID from gene query).</div>)}
                <ul className="text-sm space-y-2">
                  {ot.items.map((x, i) => (
                    <li key={i} className="border rounded-lg p-2 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{x.disease}</div>
                        <div className="text-xs text-slate-600">{x.disease_id}</div>
                      </div>
                      <div className="text-xs">Score: {typeof x.score === "number" ? x.score.toFixed(3) : "—"}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><strong>Notes</strong></CardHeader>
          <CardContent>
            <ul className="list-disc ml-5 text-sm text-slate-700 space-y-2">
              <li>Primary sources: <a className="underline" href="https://mygene.info" target="_blank" rel="noreferrer">MyGene.info</a> (genes) and <a className="underline" href="https://rest.ensembl.org" target="_blank" rel="noreferrer">Ensembl REST</a> (rsIDs).</li>
              <li>Hooks: ClinVar via NCBI E-utilities and Open Targets GraphQL. Some browsers may block ClinVar calls due to CORS; use a tiny proxy if needed.</li>
              <li>Gemini calls stay in-browser via Google Generative Language REST (<code>gemini-1.5-flash</code>). Provide your API key above. Nothing is stored server-side.</li>
              <li>Groq calls may require a tiny server proxy if CORS blocks browser requests.</li>
              <li>Exports: click <em>Export JSON</em> or <em>Export CSV</em> for a snapshot of base facts, optional AI summary, and hook results.</li>
              <li>AI summaries use <strong>Anthropic Claude</strong> via a local proxy</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
