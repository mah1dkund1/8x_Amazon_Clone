#!/usr/bin/env node
// Agent capture hook. Usage: node capture.js prompt|response  (hook JSON on stdin)
// Appends the verbatim prompt / final response of each turn to .agent-logs/<session>.md
// Never captures thinking, tool calls or intermediate steps.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const kind = process.argv[2];
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (e) {}
let input = {};
try { input = JSON.parse(raw); } catch (e) { process.exit(0); }

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const dir = path.join(root, '.agent-logs');
fs.mkdirSync(dir, { recursive: true });

const sid = input.session_id || 'unknown';
const short = sid.slice(0, 8);
const now = new Date().toISOString();

function readTranscript() {
  try {
    return fs.readFileSync(input.transcript_path, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
function lastModel(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const m = entries[i].message && entries[i].message.model;
    if (entries[i].type === 'assistant' && m && m !== '<synthetic>') return m;
  }
  return null;
}
function settingsModel() {
  for (const f of [path.join(root, '.claude', 'settings.local.json'), path.join(root, '.claude', 'settings.json'),
                   path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'settings.json')]) {
    try { const m = JSON.parse(fs.readFileSync(f, 'utf8')).model; if (m) return m; } catch (e) {}
  }
  return null;
}
function textOf(entry) {
  const c = entry.message && entry.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

let file = fs.readdirSync(dir).map(f => path.join(dir, f)).find(f => f.endsWith(`_${sid}.md`));
let body = '';
if (file) {
  body = fs.readFileSync(file, 'utf8');
  body = body.slice(body.indexOf('\n---\n', 4) + 5); // strip front matter
}

let author = process.env.AGENT_LOG_AUTHOR;
if (!author) { try { author = execSync('git config user.name', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {} }
author = author || 'sentinel.fyp.fast';
const project = path.basename(root);

const count = (t) => (body.match(new RegExp(`\\[LOG_ENTRY type=${t} `, 'g')) || []).length;
let model, text, num;
if (kind === 'prompt') {
  const entries = readTranscript();
  model = lastModel(entries) || settingsModel() || 'unknown';
  text = input.prompt || '';
  num = count('PROMPT') + 1;
} else {
  const entries = readTranscript();
  model = lastModel(entries) || settingsModel() || 'unknown';
  text = input.last_assistant_message;
  if (!text) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === 'assistant' && textOf(entries[i]).trim()) { text = textOf(entries[i]); break; }
    }
  }
  text = text || '';
  num = count('RESPONSE') + 1;
}

body += `\n[LOG_ENTRY type=${kind === 'prompt' ? 'PROMPT' : 'RESPONSE'} num=${num} session=${short}]\ntimestamp: ${now}\nmodel: ${model}\n\n${text}\n\n`;

const times = [...body.matchAll(/type=PROMPT[^\]]*\]\ntimestamp: (\S+)/g)].map(m => m[1]);
const first = times[0] || now, last = times[times.length - 1] || now;
const date = first.slice(0, 10);
if (!file) file = path.join(dir, `${date}_${first.slice(11, 19).replace(/:/g, '-')}_${sid}.md`);
const total = (body.match(/\[LOG_ENTRY type=PROMPT /g) || []).length;
const header = `---
session_id: ${sid}
date: ${date}
author: ${author}
model: ${model}
tool: claude-code
project: ${project}
total_exchanges: ${total}
first_prompt_time: ${first}
last_prompt_time: ${last}
---
`;
if (!/^\n?# Session Log/.test(body.trimStart())) {
  body = `\n# Session Log - ${date}\n\nSession: \`${short}\` | Project: \`${project}\` | Author: \`${author}\`\n\n---\n` + body;
}
fs.writeFileSync(file, header + body);
