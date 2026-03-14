// Memory system - reads/writes .md files in /db/ for persistent learning
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';

const DB_ROOT = join(process.cwd(), 'db');

const CATEGORIES = [
  'strategies',     // Combat & crime strategies learned
  'combat-logs',    // Fight history and outcomes
  'player-profiles',// Intel on other players
  'economy',        // Economic insights & trade data
  'chat-logs',      // Conversation history & social intel
  'learning',       // Gameplay patterns discovered
  'sessions',       // Session state snapshots
];

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function now() {
  return new Date().toISOString();
}

// Save a memory entry as .md with frontmatter
export function saveMemory(category, title, content, metadata = {}) {
  ensureDir(join(DB_ROOT, category));
  const filename = `${slug(title)}.md`;
  const filepath = join(DB_ROOT, category, filename);

  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `category: ${category}`,
    `created: ${metadata.created || now()}`,
    `updated: ${now()}`,
    ...Object.entries(metadata)
      .filter(([k]) => !['created'].includes(k))
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : v}`),
    '---',
    '',
  ].join('\n');

  writeFileSync(filepath, frontmatter + content, 'utf8');
  return filepath;
}

// Append to an existing memory or create it
export function appendMemory(category, title, newContent) {
  const filepath = join(DB_ROOT, category, `${slug(title)}.md`);
  if (existsSync(filepath)) {
    const existing = readFileSync(filepath, 'utf8');
    // Update the "updated" timestamp
    const updated = existing.replace(/^updated: .+$/m, `updated: ${now()}`);
    writeFileSync(filepath, updated + '\n' + newContent, 'utf8');
  } else {
    saveMemory(category, title, newContent);
  }
  return filepath;
}

// Read a specific memory
export function readMemory(category, title) {
  const filepath = join(DB_ROOT, category, `${slug(title)}.md`);
  if (!existsSync(filepath)) return null;
  return readFileSync(filepath, 'utf8');
}

// List all memories in a category
export function listMemories(category) {
  const dir = join(DB_ROOT, category);
  ensureDir(dir);
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = readFileSync(join(dir, f), 'utf8');
      const titleMatch = content.match(/^title: "(.+)"/m);
      return {
        file: f,
        title: titleMatch ? titleMatch[1] : basename(f, '.md'),
        path: join(dir, f),
      };
    });
}

// Search across all memories
export function searchMemories(query) {
  const results = [];
  const q = query.toLowerCase();
  for (const cat of CATEGORIES) {
    const dir = join(DB_ROOT, cat);
    ensureDir(dir);
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const content = readFileSync(join(dir, f), 'utf8');
      if (content.toLowerCase().includes(q)) {
        const titleMatch = content.match(/^title: "(.+)"/m);
        results.push({
          category: cat,
          file: f,
          title: titleMatch ? titleMatch[1] : basename(f, '.md'),
          snippet: extractSnippet(content, q),
        });
      }
    }
  }
  return results;
}

function extractSnippet(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + query.length + 80);
  return '...' + text.slice(start, end) + '...';
}

// Delete a memory
export function deleteMemory(category, title) {
  const filepath = join(DB_ROOT, category, `${slug(title)}.md`);
  if (existsSync(filepath)) {
    unlinkSync(filepath);
    return true;
  }
  return false;
}

// Get all memories as a summary for context
export function getMemorySummary() {
  const summary = {};
  for (const cat of CATEGORIES) {
    const entries = listMemories(cat);
    summary[cat] = entries.map(e => e.title);
  }
  return summary;
}

// Save session state
export function saveSession(state) {
  return saveMemory('sessions', `session-${Date.now()}`, JSON.stringify(state, null, 2), {
    type: 'session-snapshot',
  });
}

// Load latest session
export function loadLatestSession() {
  const sessions = listMemories('sessions');
  if (sessions.length === 0) return null;
  const latest = sessions.sort((a, b) => b.file.localeCompare(a.file))[0];
  const content = readFileSync(latest.path, 'utf8');
  // Extract JSON after frontmatter
  const bodyStart = content.indexOf('---', 3);
  if (bodyStart === -1) return null;
  const body = content.slice(bodyStart + 3).trim();
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
