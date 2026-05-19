const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "ai-data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "project-knowledge.json");
const SLACK_NOTES_FILE = path.join(OUTPUT_DIR, "slack-notes.json");

const INCLUDED_EXTENSIONS = new Set([".js", ".html", ".css", ".md", ".txt", ".json", ".sql"]);
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".vercel",
  ".cache",
  ".npm-cache",
  ".ld-agent-skills-main-extract",
  "Weekly CRM",
  "plugins"
]);

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "are", "was", "were", "have", "has",
  "had", "you", "your", "not", "but", "all", "can", "will", "one", "two", "our", "out", "use",
  "using", "into", "about", "more", "than", "when", "what", "where", "which", "how", "why", "who",
  "its", "it", "on", "in", "to", "of", "is", "as", "be", "or", "an", "at", "by", "if", "we", "do"
]);

function walkProjectFiles(dir, output = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(ROOT, fullPath);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      walkProjectFiles(fullPath, output);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!INCLUDED_EXTENSIONS.has(ext)) {
      continue;
    }

    if (relativePath.startsWith("ai-data\\") || relativePath.startsWith("ai-data/")) {
      continue;
    }

    output.push({ fullPath, relativePath: relativePath.replace(/\\/g, "/") });
  }

  return output;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\u0000/g, "")
    .trim();
}

function chunkText(text, maxChars = 1400, overlapChars = 220) {
  const cleaned = normalizeText(text);
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  function flush() {
    if (!current.trim()) return;
    chunks.push(current.trim());
    if (overlapChars <= 0) {
      current = "";
      return;
    }
    current = current.slice(Math.max(0, current.length - overlapChars)).trim();
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      const lines = paragraph.split("\n");
      for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length > maxChars && current) {
          flush();
          current = line;
        } else if (candidate.length > maxChars) {
          for (let i = 0; i < line.length; i += maxChars) {
            const piece = line.slice(i, i + maxChars);
            const pieceCandidate = current ? `${current}\n${piece}` : piece;
            if (pieceCandidate.length > maxChars && current) {
              flush();
              current = piece;
            } else {
              current = pieceCandidate;
            }
          }
        } else {
          current = candidate;
        }
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && current) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function tokenize(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return words.filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function countTokens(tokens) {
  const tokenCounts = {};
  for (const token of tokens) {
    tokenCounts[token] = (tokenCounts[token] || 0) + 1;
  }
  return tokenCounts;
}

function buildChunk({ id, sourceType, sourcePath, title, text }) {
  const tokens = tokenize(text);
  return {
    id,
    sourceType,
    sourcePath,
    title,
    text,
    tokenCounts: countTokens(tokens),
    tokenLength: tokens.length
  };
}

function loadSlackNoteChunks(startId) {
  if (!fs.existsSync(SLACK_NOTES_FILE)) {
    return { chunks: [], nextId: startId };
  }

  const parsed = JSON.parse(fs.readFileSync(SLACK_NOTES_FILE, "utf8"));
  const notes = Array.isArray(parsed) ? parsed : [];
  const chunks = [];
  let id = startId;

  for (const note of notes) {
    const title = String(note?.title || "Slack note");
    const source = String(note?.source || "slack");
    const at = String(note?.at || "");
    const text = normalizeText(`${title}\n${at}\n${note?.text || ""}`);
    if (!text) continue;

    const noteChunks = chunkText(text);
    for (let i = 0; i < noteChunks.length; i += 1) {
      chunks.push(
        buildChunk({
          id: `chunk-${id}`,
          sourceType: "slack",
          sourcePath: source,
          title: `${title} (${i + 1}/${noteChunks.length})`,
          text: noteChunks[i]
        })
      );
      id += 1;
    }
  }

  return { chunks, nextId: id };
}

function buildKnowledgeBase() {
  const files = walkProjectFiles(ROOT);
  const chunks = [];
  let idCounter = 1;

  for (const file of files) {
    let content = "";
    try {
      content = fs.readFileSync(file.fullPath, "utf8");
    } catch {
      continue;
    }

    const pieces = chunkText(content);
    for (let i = 0; i < pieces.length; i += 1) {
      chunks.push(
        buildChunk({
          id: `chunk-${idCounter}`,
          sourceType: "project-file",
          sourcePath: file.relativePath,
          title: `${file.relativePath} (${i + 1}/${pieces.length})`,
          text: pieces[i]
        })
      );
      idCounter += 1;
    }
  }

  const slack = loadSlackNoteChunks(idCounter);
  chunks.push(...slack.chunks);

  const docFrequency = {};
  for (const chunk of chunks) {
    const unique = new Set(Object.keys(chunk.tokenCounts));
    for (const token of unique) {
      docFrequency[token] = (docFrequency[token] || 0) + 1;
    }
  }

  const totalChunks = chunks.length;
  const idf = {};
  for (const [token, df] of Object.entries(docFrequency)) {
    idf[token] = Math.log((totalChunks + 1) / (df + 1)) + 1;
  }

  const payload = {
    createdAt: new Date().toISOString(),
    root: ROOT,
    totalChunks,
    filesIndexed: files.length,
    slackNotesIndexed: slack.chunks.length,
    idf,
    chunks
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), "utf8");

  return payload;
}

function main() {
  const result = buildKnowledgeBase();
  console.log(`Knowledge base built: ${OUTPUT_FILE}`);
  console.log(`Chunks: ${result.totalChunks}`);
  console.log(`Files indexed: ${result.filesIndexed}`);
  console.log(`Slack chunks indexed: ${result.slackNotesIndexed}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildKnowledgeBase,
  tokenize
};
