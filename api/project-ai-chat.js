const fs = require("fs");
const path = require("path");
const { tokenize } = require("../scripts/build-project-knowledge");

const KNOWLEDGE_FILE = path.join(process.cwd(), "ai-data", "project-knowledge.json");

let cachedKnowledge = null;
let cachedMtimeMs = 0;

function readKnowledge() {
  if (!fs.existsSync(KNOWLEDGE_FILE)) {
    return null;
  }

  const stat = fs.statSync(KNOWLEDGE_FILE);
  if (cachedKnowledge && stat.mtimeMs === cachedMtimeMs) {
    return cachedKnowledge;
  }

  cachedMtimeMs = stat.mtimeMs;
  cachedKnowledge = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, "utf8"));
  return cachedKnowledge;
}

function scoreChunk(chunk, queryTokens, idf, rawQuestion) {
  if (!chunk?.tokenCounts || !chunk?.tokenLength) {
    return 0;
  }

  let score = 0;
  for (const token of queryTokens) {
    const tf = (chunk.tokenCounts[token] || 0) / chunk.tokenLength;
    if (!tf) continue;
    score += tf * (idf[token] || 1);
  }

  const hay = String(chunk.text || "").toLowerCase();
  const raw = String(rawQuestion || "").toLowerCase().trim();
  if (raw && hay.includes(raw)) {
    score += 1.5;
  }

  return score;
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
}

function pickTopSentences(matches, queryTokens, maxSentences = 5) {
  const candidates = [];

  for (const match of matches) {
    const sentences = splitSentences(match.chunk.text);
    for (const sentence of sentences) {
      const sentenceTokens = new Set(tokenize(sentence));
      let overlap = 0;
      for (const token of queryTokens) {
        if (sentenceTokens.has(token)) overlap += 1;
      }
      if (!overlap) continue;

      candidates.push({
        sourcePath: match.chunk.sourcePath,
        sentence: sentence.length > 260 ? `${sentence.slice(0, 257)}...` : sentence,
        score: overlap + (match.score * 0.5)
      });
    }
  }

  const selected = [];
  const seen = new Set();

  for (const item of candidates.sort((a, b) => b.score - a.score)) {
    const key = `${item.sourcePath}::${item.sentence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(item);
    if (selected.length >= maxSentences) break;
  }

  return selected;
}

function buildAnswer(question, topSentences, topMatches) {
  if (!topMatches.length) {
    return {
      answer: "I couldn't find enough matching project context yet. Try a more specific question or retrain the knowledge index.",
      confidence: "low"
    };
  }

  if (!topSentences.length) {
    const fallback = topMatches
      .slice(0, 3)
      .map((m) => `${m.chunk.sourcePath}: ${String(m.chunk.text || "").replace(/\s+/g, " ").slice(0, 200)}...`)
      .join("\n");

    return {
      answer: `I found relevant project areas for "${question}".\n${fallback}`,
      confidence: "medium"
    };
  }

  const lines = topSentences.map((item, idx) => {
    return `${idx + 1}. ${item.sentence} [${item.sourcePath}]`;
  });

  return {
    answer: `Based on your project knowledge base, here is the best direct answer for "${question}":\n${lines.join("\n")}`,
    confidence: topSentences.length >= 3 ? "high" : "medium"
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use GET or POST." });
  }

  const questionRaw =
    req.method === "GET"
      ? String(req.query?.q || req.query?.question || "")
      : String(req.body?.q || req.body?.question || "");
  const question = questionRaw.trim();

  if (!question) {
    return res.status(400).json({ error: "Missing question. Provide q or question." });
  }

  const topKRaw =
    req.method === "GET"
      ? Number(req.query?.topK || req.query?.k || 6)
      : Number(req.body?.topK || req.body?.k || 6);
  const topK = Number.isFinite(topKRaw) ? Math.max(1, Math.min(12, Math.floor(topKRaw))) : 6;

  const knowledge = readKnowledge();
  if (!knowledge) {
    return res.status(409).json({
      error: "Knowledge base not found. Run node scripts/build-project-knowledge.js first."
    });
  }

  const queryTokens = tokenize(question);
  if (!queryTokens.length) {
    return res.status(400).json({
      error: "Question is too short. Please include more specific words."
    });
  }

  const ranked = (knowledge.chunks || [])
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk, queryTokens, knowledge.idf || {}, question)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const topSentences = pickTopSentences(ranked, queryTokens, 5);
  const built = buildAnswer(question, topSentences, ranked);

  return res.status(200).json({
    question,
    confidence: built.confidence,
    answer: built.answer,
    sources: ranked.map((row) => ({
      sourceType: row.chunk.sourceType,
      sourcePath: row.chunk.sourcePath,
      title: row.chunk.title,
      score: Number(row.score.toFixed(5))
    }))
  });
};
