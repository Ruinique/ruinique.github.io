# Notion → Markdown → AstroPaper

## 为什么要中转一层

Notion API 需要 token，而 token 不适合放进构建环境长期保存。这里的做法是：

1. 通过 Notion 连接把页面导出成 Markdown，放在 `Notion/`；
2. 构建时只读本地文件，不需要任何密钥；
3. GitHub Actions 只跑 `npm run build`。

## 目录

```
Notion/
├── .notion-sync.json      # 页面清单：id、标题、文件路径、最后修改时间
├── 个人学习.md             # 目录页（frontmatter type: container，会被跳过）
├── 个人学习/
│   └── ....md             # 文章
└── pages/
    └── about.md           # 手写的独立页面
```

## 同步步骤

1. 重新从 Notion 拉取页面（覆盖 `Notion/` 下的文件）。
2. 运行 `npm run sync:content`。
3. 检查 `src/content/` 下生成的文件，`npm run dev` 预览。

`npm run build` 会自动执行第 2 步。

## frontmatter

同步下来的 Markdown 顶部会带这些字段，转换脚本按它们生成 AstroPaper 需要的 frontmatter：

```yaml
---
title: 文章标题
type: post          # post | page | container（container 跳过）
slug: my-post       # 不填就用标题生成
tags: 标签一, 标签二
published: 2026-10-18
summary: 首页卡片和 SEO 用的一句话摘要
---
```

转换后写入 `src/content/posts/<slug>.md`：

```yaml
---
notion_id: "..."
title: "..."
author: "Ruiyi Zhan"
pubDatetime: 2026-10-18T00:00:00.000Z
modDatetime: 2026-10-18T09:56:02.661Z
featured: false
draft: false
tags: ["位置编码", "RoPE"]
description: "..."
---
```

生成的文件不要手改，下次同步会被覆盖。要改内容就改 Notion。

## 已知处理

- **段落**：Notion 每个段落单独一行，脚本会在相邻段落间补空行，否则 Markdown 会把它们粘成一整段。
- **公式**：`$$...$$` 和 `$...$` 原样保留，构建时由 KaTeX 渲染，不依赖浏览器端 JS。
- **标题**：正文开头的 H1 会被去掉，页面标题由模板渲染。
- **清理**：同步脚本会删除上一轮生成、这次已不存在的文章（靠 frontmatter 里的 `notion_id` 识别）。
