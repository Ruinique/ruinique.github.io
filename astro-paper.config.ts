import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://ruinique.github.io",
    title: "Ruinique",
    description:
      "Ruiyi Zhan 的学习笔记：高性能计算、大模型系统与数学推导。",
    author: "Ruiyi Zhan",
    profile: "https://github.com/Ruinique",
    ogImage: "og.jpg",
    lang: "zh-CN",
    timezone: "Asia/Shanghai",
    dir: "ltr",
  },
  posts: {
    perPage: 5,
    perIndex: 5,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: false,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: false,
    },
    search: "pagefind",
  },
  socials: [
    {
      name: "github",
      url: "https://github.com/Ruinique",
      linkTitle: "GitHub",
    },
    {
      name: "mail",
      url: "mailto:ruinique2003@gmail.com",
      linkTitle: "邮件",
    },
  ],
  shareLinks: [
    { name: "x", url: "https://x.com/intent/post?url=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "mail", url: "mailto:?subject=See%20this%20post&body=" },
  ],
});
