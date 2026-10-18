// 把 Notion/ 目录里同步下来的 Markdown 转成 AstroPaper 的内容文件。
// 输入：Notion/.notion-sync.json + 各个 .md（带 frontmatter）
// 输出：src/content/posts/*.md、src/content/pages/*.md
// 用法：node scripts/build-content-from-local.mjs

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const syncFile = resolve("Notion/.notion-sync.json");
const postsDir = resolve("src/content/posts");
const pagesDir = resolve("src/content/pages");
const author = "Ruiyi Zhan";

if (!existsSync(syncFile)) {
  console.log("No Notion/.notion-sync.json found. Keeping existing content.");
  process.exit(0);
}

const state = JSON.parse(await readFile(syncFile, "utf8"));
await mkdir(postsDir, { recursive: true });
await mkdir(pagesDir, { recursive: true });

const written = new Set();

for (const item of state.pages || []) {
  const file = resolve(item.file);
  if (!existsSync(file)) {
    console.warn(`Missing synced file: ${item.file}`);
    continue;
  }

  const { front, body } = parseFrontmatter(await readFile(file, "utf8"));
  const type = normalizeType(front.type, body);
  if (!type) {
    console.log(`Skip container page: ${front.title || item.title}`);
    continue;
  }

  const title = front.title || item.title;
  const slug = front.slug || slugify(title);
  const description = front.summary || buildSummary(body);
  const content = normalizeParagraphs(stripLeadingHeading(body));

  if (type === "page") {
    const out = resolve(pagesDir, `${slug}.md`);
    await writeFile(out, pageFile({ title, description, content }), "utf8");
    written.add(out);
  } else {
    const out = resolve(postsDir, `${slug}.md`);
    await writeFile(
      out,
      postFile({
        title,
        description,
        content,
        tags: toStringArray(front.tags),
        published: front.published || item.last_edited,
        updated: item.last_edited,
        featured: Boolean(front.featured),
        notionId: item.id,
      }),
      "utf8"
    );
    written.add(out);
  }
}

// 手写的独立页面（可选）：Notion/pages/*.md
if (existsSync(resolve("Notion/pages"))) {
  for (const name of await readdir(resolve("Notion/pages"))) {
    if (!name.endsWith(".md")) continue;
    const { front, body } = parseFrontmatter(
      await readFile(resolve("Notion/pages", name), "utf8")
    );
    const out = resolve(pagesDir, `${front.slug || slugify(front.title)}.md`);
    await writeFile(
      out,
      pageFile({
        title: front.title,
        description: front.summary || buildSummary(body),
        content: normalizeParagraphs(stripLeadingHeading(body)),
      }),
      "utf8"
    );
    written.add(out);
  }
}

// 清理上一轮生成、这次已经不存在的文件
for (const dir of [postsDir, pagesDir]) {
  for (const name of await readdir(dir)) {
    const file = resolve(dir, name);
    if (!name.endsWith(".md") || written.has(file)) continue;
    const raw = await readFile(file, "utf8");
    if (raw.startsWith("---\nnotion_id:")) {
      await rm(file);
      console.log(`Removed stale content: ${name}`);
    }
  }
}

console.log(`Synced ${written.size} content file(s) from local Notion mirror.`);

function postFile({ title, description, content, tags, published, updated, featured, notionId }) {
  return `---
notion_id: ${yamlString(notionId)}
title: ${yamlString(title)}
author: ${yamlString(author)}
pubDatetime: ${isoDate(published)}
modDatetime: ${isoDate(updated)}
featured: ${featured ? "true" : "false"}
draft: false
tags: ${JSON.stringify(tags.length ? tags : ["笔记"])}
description: ${yamlString(description)}
---

${content.trim()}
`;
}

function pageFile({ title, description, content }) {
  return `---
title: ${yamlString(title)}
description: ${yamlString(description)}
---

${content.trim()}
`;
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { front: {}, body: raw };

  const front = {};
  let currentKey = null;

  for (const line of match[1].split("\n")) {
    const item = line.match(/^-\s+(.*)$/);
    if (item && currentKey) {
      const value = front[currentKey];
      front[currentKey] = Array.isArray(value)
        ? [...value, cleanValue(item[1])]
        : [value, cleanValue(item[1])].filter(Boolean);
      continue;
    }

    const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!pair) continue;
    currentKey = pair[1];
    const rawValue = pair[2].trim();
    front[currentKey] = rawValue ? cleanValue(rawValue) : undefined;
  }

  return { front, body: raw.slice(match[0].length) };
}

function cleanValue(value) {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^"(.*)"$/s) ?? trimmed.match(/^'(.*)'$/s);
  const text = quoted ? quoted[1] : trimmed;
  return text.replace(/\\"/g, '"').replace(/\\n/g, "\n");
}

function normalizeType(value, body) {
  const type = String(value || "").trim().toLowerCase();
  if (["post", "article", "文章"].includes(type)) return "post";
  if (["page", "页面"].includes(type)) return "page";
  if (["skip", "container", "目录"].includes(type)) return "";

  const plain = body.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ");
  return plain.length >= 80 ? "post" : "";
}

// Notion 导出把每个段落放在单独一行；Markdown 需要空行才会分段
function normalizeParagraphs(body) {
  const blocks = [];
  const protectedBody = body.replace(
    /(```[\s\S]*?```|\$\$[\s\S]*?\$\$)/g,
    (match) => `\u0000BLOCK${blocks.push(match) - 1}\u0000`
  );

  const lines = protectedBody.split("\n");
  const isList = (line) => /^\s*([-*+]|\d+\.)\s/.test(line);
  const isQuote = (line) => /^\s*>/.test(line);
  const isTable = (line) => /^\s*\|/.test(line);
  const out = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    out.push(current);

    const next = lines[index + 1];
    if (next === undefined) continue;
    if (!current.trim() || !next.trim()) continue;

    const sameBlock =
      (isList(current) && isList(next)) ||
      (isQuote(current) && isQuote(next)) ||
      (isTable(current) && isTable(next));

    if (!sameBlock) out.push("");
  }

  return out
    .join("\n")
    .replace(/\u0000BLOCK(\d+)\u0000/g, (_match, index) => blocks[Number(index)]);
}

function stripLeadingHeading(body) {
  return body.replace(/^\s*#\s+.*\n/, "");
}

function buildSummary(body) {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
}

function toStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value)
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isoDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}
