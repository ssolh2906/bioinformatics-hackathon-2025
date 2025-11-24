// server.js (CommonJS) — fixed guard
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();
const app = express();
app.use(cors({ origin: ["http://localhost:3000", "http://localhost:5173"], methods: ["POST", "GET"] }));
app.use(express.json());

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

app.get("/", (_req, res) => res.type("text/plain").send("Claude proxy OK. POST /api/claude"));

app.post("/api/claude", async (req, res) => {
  try {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY on server" });

    const { facts } = req.body || {};
    const system = "You write concise, structured clinical/bioinformatics insight summaries as compact JSON.";
    const user =
      `Return JSON with keys: title, functional_role, disease_associations, known_variants, clinical_notes, sources. Under 150 words total. Use strictly these facts: ${JSON.stringify(facts)}`;

    const body = {
      model: "claude-3-5-sonnet-latest",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
      temperature: 0.2,
    };

    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const textBody = await r.text();
    if (!r.ok) return res.status(r.status).send(textBody);

    const json = JSON.parse(textBody);
    const text = json?.content?.[0]?.text || "";
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: "Proxy error", details: String(e) });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`Claude proxy on http://localhost:${PORT}`));
