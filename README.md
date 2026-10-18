# Ruinique

个人博客。内容在 Notion 里写，本地同步成 Markdown，再由 Astro 构建成静态站点，发布到 GitHub Pages：
<https://ruinique.github.io/>

主题基于 [AstroPaper](https://github.com/satnaing/astro-paper)（MIT），按需要改过：

- 中文界面（`src/i18n/lang/zh-CN.ts`）
- KaTeX 公式（`remark-math` + `rehype-katex`）
- 内容来自 `Notion/` 目录，不再直接请求 Notion API

## 本地开发

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # 输出到 dist/
npm run preview
```

`npm run build` 会先跑 `prebuild`，把 `Notion/` 里的 Markdown 转成 `src/content/` 下的文章和页面。

## 内容怎么更新

1. 从 Notion 同步页面到 `Notion/`（由 agent 通过 Notion 连接完成）。
2. `npm run sync:content`：生成 `src/content/posts/*.md` 和 `src/content/pages/*.md`。
3. 本地预览确认，然后 commit、push。推到 `master` 后 GitHub Actions 自动构建并发布。

frontmatter 支持的字段和各步骤细节见 [docs/notion-sync.md](docs/notion-sync.md)。

## 目录

```
Notion/                     Notion 同步下来的原始 Markdown（内容源）
scripts/build-content-*.mjs 转成 AstroPaper 内容格式的脚本
src/content/posts/          生成的文章（不要手改，会被覆盖）
src/content/pages/          生成的独立页面
astro-paper.config.ts       站点信息、导航、社交链接
```

## 部署

`.github/workflows/deploy.yml` 用 GitHub 官方的 Pages actions。仓库 `Settings → Pages` 的 Source 选 `GitHub Actions` 即可。

用户页（`<user>.github.io`）部署在根路径，不需要 `BASE_PATH`。如果要部署到项目页，可以在构建时设置 `BASE_PATH=/<repo>`，`astro.config.ts` 会读取它。

## 许可

站点内容是个人原创，代码部分沿用 AstroPaper 的 MIT 许可，见 `LICENSE`。
