# Houdini Claw 数据采集管线开发文档

> 版本：v0.1 draft
> 日期：2026-02-18
> 模块路径：`src/houdini-claw/crawl.ts`

---

## 目录

1. [SideFX 官方文档爬虫优化](#1-sidefx-官方文档爬虫优化)
2. [SideFX 论坛爬虫](#2-sidefx-论坛爬虫)
3. [Odforce 社区爬虫](#3-odforce-社区爬虫)
4. [HIP 文件参数提取器](#4-hip-文件参数提取器)

---

## 1. SideFX 官方文档爬虫优化

### 1.1 现状

当前 `crawlSideFxDoc()` 实现存在两个关键问题：

**问题 A：内容提取正则过于脆弱**

```typescript
// crawl.ts:212-217  —  当前实现
const mainMatch = content.match(
  /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
);
```

SideFX 文档页面的实际 DOM 结构为：

```html
<div id="content">
  <div class="heading"><h1>Node Name</h1></div>
  <div class="content">
    <div class="summary">...</div>
    <div class="section">
      <h2>Parameters</h2>
      <div id="parmpane">
        <div id="folder-...">
          <h3>Parameter Name</h3>
          <p>Parameter description...</p>
        </div>
      </div>
    </div>
  </div>
</div>
```

当前正则用非贪婪 `[\s\S]*?` 匹配嵌套 `<div>`，在遇到多层嵌套时会在第一个 `</div></div>` 处截断，丢失大量参数内容。

**问题 B：节点发现依赖硬编码列表**

```typescript
// crawl.ts:64-156  —  手工维护的路径列表
const PYRO_NODES = [
  "nodes/dop/pyrosolver",
  "nodes/dop/smokesolver",
  // ... 19 个路径
];
```

SideFX 每个大版本（如 20.0 → 20.5）都会新增/废弃节点，硬编码列表无法自动跟踪。

### 1.2 方案

#### A. 替换 HTML 提取为结构化解析

使用 `node-html-parser`（零依赖，比 cheerio 轻 10 倍）做 DOM 解析：

```typescript
import { parse } from "node-html-parser";

interface ParsedNodeDoc {
  title: string;
  summary: string;
  parameters: Array<{
    name: string;
    label: string;
    description: string;
    folder: string; // 参数所属折叠面板，如 "Simulation" / "Shape"
  }>;
  notes: string[];       // "Note" / "Tip" / "Warning" 块
  relatedNodes: string[];
  rawText: string;       // 全文纯文本（供 annotation 用）
}

function parseSideFxNodeDoc(html: string): ParsedNodeDoc {
  const root = parse(html);

  const title = root.querySelector("h1")?.text?.trim() ?? "";
  const summary = root.querySelector(".summary")?.text?.trim() ?? "";

  // 参数使用 <h3> + <p> 结构，嵌套在 #parmpane 下
  const parmPane = root.querySelector("#parmpane");
  const parameters: ParsedNodeDoc["parameters"] = [];

  if (parmPane) {
    let currentFolder = "General";
    for (const child of parmPane.querySelectorAll("h3, p, h2")) {
      if (child.tagName === "H2") {
        currentFolder = child.text.trim();
      } else if (child.tagName === "H3") {
        parameters.push({
          name: child.getAttribute("id") ?? child.text.trim(),
          label: child.text.trim(),
          description: "", // 将由下一个 <p> 填充
          folder: currentFolder,
        });
      } else if (child.tagName === "P" && parameters.length > 0) {
        const last = parameters[parameters.length - 1];
        if (!last.description) {
          last.description = child.text.trim();
        }
      }
    }
  }

  // 相关节点链接
  const relatedNodes = root
    .querySelectorAll('a[href*="/nodes/"]')
    .map((a) => a.getAttribute("href") ?? "")
    .filter(Boolean);

  return { title, summary, parameters, notes: [], relatedNodes, rawText: root.text };
}
```

**关键决策**：保留 `rawText` 字段供 `annotate.ts` 使用，同时新增结构化 `parameters` 数组。这样 annotation 模型可以同时看到结构化参数列表和完整上下文。

#### B. 通过 Sitemap 自动发现节点

SideFX 文档站点提供标准 sitemap：

```
https://www.sidefx.com/docs/houdini/sitemap.xml
```

实现节点自动发现：

```typescript
interface NodeDiscovery {
  path: string;       // "nodes/dop/pyrosolver"
  category: string;   // "DOP"
  nodeType: string;   // "pyrosolver"
  lastmod?: string;   // sitemap 中的最后修改时间
}

async function discoverNodesFromSitemap(
  baseUrl: string = "https://www.sidefx.com/docs/houdini/"
): Promise<NodeDiscovery[]> {
  const sitemapUrl = `${baseUrl}sitemap.xml`;
  const resp = await fetch(sitemapUrl);
  const xml = await resp.text();

  // 从 sitemap 提取所有 nodes/ 路径
  const urlPattern = /<loc>(.*?)<\/loc>/g;
  const modPattern = /<lastmod>(.*?)<\/lastmod>/g;
  const nodes: NodeDiscovery[] = [];

  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(xml)) !== null) {
    const url = match[1];
    const nodeMatch = url.match(/\/nodes\/(\w+)\/(\w+)\.html$/);
    if (nodeMatch) {
      nodes.push({
        path: `nodes/${nodeMatch[1]}/${nodeMatch[2]}`,
        category: nodeMatch[1].toUpperCase(),
        nodeType: nodeMatch[2],
      });
    }
  }

  return nodes;
}
```

然后将硬编码的 `ALL_NODE_PATHS` 改为 **动态发现 + 优先级白名单** 双模式：

```typescript
export async function resolveNodePaths(
  mode: "whitelist" | "discover" | "both"
): Promise<Record<string, string[]>> {
  if (mode === "whitelist") {
    return ALL_NODE_PATHS; // 原始硬编码列表
  }

  const discovered = await discoverNodesFromSitemap();

  if (mode === "discover") {
    return groupBySystem(discovered);
  }

  // both: 合并白名单 + 发现结果，白名单节点优先爬取
  return mergeWithPriority(ALL_NODE_PATHS, groupBySystem(discovered));
}
```

### 1.3 改动范围

| 文件 | 改动 |
|------|------|
| `crawl.ts` | 替换 `extractDocContent()` → `parseSideFxNodeDoc()`；新增 `discoverNodesFromSitemap()` |
| `annotate.ts` | `buildAnnotationPrompt()` 中利用结构化参数列表提高 annotation 质量 |
| `package.json` | 新增依赖 `node-html-parser` |

### 1.4 增量模式适配

`crawl_log` 表已记录 `content_hash`，增量模式下通过比较 hash 判断内容是否变更：

```typescript
// 增量模式：先 HEAD 请求获取 ETag 或下载后比较 hash
if (mode === "incremental") {
  const lastCrawl = kb.getLastCrawl(url);
  if (lastCrawl && lastCrawl.content_hash === newHash) {
    // 内容未变，跳过
    continue;
  }
}
```

### 1.5 验收标准

- [ ] 对 `pyrosolver` 页面提取的参数数量 ≥ 20（当前正则提取约 5-8 个）
- [ ] sitemap 发现的节点总数 ≥ 500
- [ ] 增量模式下，已爬过且未变更的页面不重复下载
- [ ] `CrawledPage` 类型扩展 `parameters` 字段，保持向后兼容

---

## 2. SideFX 论坛爬虫

### 2.1 现状

`CRAWL_SOURCES` 中已声明 `sidefx_forum` 源（`crawl.ts:46-50`），但无对应的爬取函数。`CrawlSource.type` 包含 `"sidefx_forum"` 类型，但 `runCrawl()` 中只调用了 `crawlSideFxDoc()`。

### 2.2 平台分析

SideFX 论坛是 **Django 自建平台**（非 Discourse / Invision），关键特征：

| 属性 | 值 |
|------|-----|
| 基础 URL | `https://www.sidefx.com/forum/` |
| 帖子 URL 格式 | `/forum/topic/{topic_id}/` |
| 分页 | `?page={N}` |
| RSS 订阅 | `/forum/feeds/forum/{forum_id}/` — RSS 2.0 格式 |
| 公开 API | **无** — 无 REST/GraphQL API |
| 认证 | 公开帖子无需登录即可读取 |
| robots.txt | 需遵守，爬取前检查 |

**数据获取策略**：RSS feeds + HTML 抓取双路径。

### 2.3 方案

#### A. RSS Feed 快速采集（首选）

RSS 提供最近的帖子摘要，适合增量模式：

```typescript
interface ForumPost {
  topicId: string;
  title: string;
  author: string;
  content: string;      // RSS description 字段
  publishedAt: string;
  url: string;
  forumId: string;
  tags: string[];
}

// SideFX 论坛相关板块 ID
const SIDEFX_FORUM_IDS = {
  houdini: "46",       // Houdini 主板块（需实际确认 ID）
  pyro: "48",
  flip: "49",
  solaris: "51",
  vellum: "50",
  vex: "47",
};

async function crawlSideFxForumRSS(
  forumId: string,
  forumName: string,
): Promise<ForumPost[]> {
  const feedUrl = `https://www.sidefx.com/forum/feeds/forum/${forumId}/`;
  const resp = await fetch(feedUrl, {
    headers: { "User-Agent": "HoudiniClaw/1.0 (knowledge-base-builder)" },
  });

  if (!resp.ok) return [];
  const xml = await resp.text();

  return parseRSS(xml, forumId);
}

function parseRSS(xml: string, forumId: string): ForumPost[] {
  const items: ForumPost[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = item.match(/<title>(.*?)<\/title>/)?.[1] ?? "";
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
    const desc = item.match(/<description>(.*?)<\/description>/)?.[1] ?? "";
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";

    const topicMatch = link.match(/\/topic\/(\d+)/);
    if (topicMatch) {
      items.push({
        topicId: topicMatch[1],
        title: decodeXmlEntities(title),
        author: "",
        content: decodeXmlEntities(desc),
        publishedAt: pubDate ? new Date(pubDate).toISOString() : "",
        url: link,
        forumId,
        tags: [],
      });
    }
  }

  return items;
}
```

#### B. HTML 全量采集（深度爬取）

对高价值帖子（回复数多、标记为 solved 的），获取完整帖子内容：

```typescript
async function crawlForumTopic(topicId: string): Promise<ForumPost | null> {
  const url = `https://www.sidefx.com/forum/topic/${topicId}/`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "HoudiniClaw/1.0 (knowledge-base-builder)" },
  });

  if (!resp.ok) return null;
  const html = await resp.text();
  const root = parse(html);

  // 提取所有回复内容
  const posts = root.querySelectorAll(".forum-post-content, .post-body");
  const content = posts.map((p) => p.text.trim()).join("\n\n---\n\n");

  const title = root.querySelector("h1, .topic-title")?.text?.trim() ?? "";

  return {
    topicId,
    title,
    author: root.querySelector(".post-author, .username")?.text?.trim() ?? "",
    content,
    publishedAt: "",
    url,
    forumId: "",
    tags: root
      .querySelectorAll(".tag, .topic-tag")
      .map((t) => t.text.trim()),
  };
}
```

#### C. 内容过滤与相关性评分

论坛帖子噪声高。入库前需做相关性筛选：

```typescript
interface ForumRelevanceFilter {
  /** 必须包含的关键词之一 */
  requiredKeywords: string[];
  /** 最低回复数（回复越多通常质量越高） */
  minReplies: number;
  /** 排除的标签/板块 */
  excludeTags: string[];
}

const DEFAULT_FILTER: ForumRelevanceFilter = {
  requiredKeywords: [
    "pyro", "flip", "vellum", "rbd", "solver",
    "parameter", "dissipation", "viscosity", "turbulence",
    "substep", "collision", "constraint", "fracture",
  ],
  minReplies: 2,
  excludeTags: ["job-posting", "showcase", "off-topic"],
};

function isRelevantPost(post: ForumPost, filter: ForumRelevanceFilter): boolean {
  const text = `${post.title} ${post.content}`.toLowerCase();
  const hasKeyword = filter.requiredKeywords.some((kw) => text.includes(kw));
  const notExcluded = !post.tags.some((t) =>
    filter.excludeTags.includes(t.toLowerCase()),
  );
  return hasKeyword && notExcluded;
}
```

### 2.4 数据模型扩展

论坛数据比文档数据多了"对话结构"（帖子→回复→采纳答案），需要在 `CrawledPage` 中反映：

```typescript
// 扩展 CrawledPage
interface CrawledPage {
  url: string;
  sourceType: string;
  nodeName?: string;
  title: string;
  content: string;
  contentHash: string;
  crawledAt: string;
  // ── 新增字段（论坛专用）──
  forumMeta?: {
    topicId: string;
    replyCount: number;
    isSolved: boolean;
    mentionedNodes: string[];   // 从内容中提取的节点名
    relevanceScore: number;     // 0.0 - 1.0
  };
}
```

### 2.5 速率限制

```typescript
const SIDEFX_FORUM_RATE = {
  requestIntervalMs: 2000,  // 每次请求间隔 2 秒
  maxRequestsPerHour: 500,  // 每小时上限
  respectRobotsTxt: true,
};
```

### 2.6 改动范围

| 文件 | 改动 |
|------|------|
| `crawl.ts` | 新增 `crawlSideFxForumRSS()`、`crawlForumTopic()`；`runCrawl()` 中分发到论坛爬取路径 |
| `schema.ts` | `crawl_log.source_type` 已支持 `sidefx_forum`，无需改动 |
| `annotate.ts` | 新增论坛帖子→annotation 的 prompt 模板（与文档 prompt 不同，需处理对话式内容） |
| `ingest.ts` | 论坛来源的 `system` 字段从帖子 tag / 板块名推断 |

### 2.7 验收标准

- [ ] RSS 模式可抓取各板块最近 20 条帖子
- [ ] 相关性过滤后入库率在 30%-60%（太高说明过滤太松，太低说明关键词不够）
- [ ] 论坛帖子的 `CrawledPage.forumMeta.mentionedNodes` 能正确识别节点名
- [ ] 速率限制不超过 500 req/hr

---

## 3. Odforce 社区爬虫

### 3.1 现状

`CRAWL_SOURCES` 中已声明 `odforce` 源（`crawl.ts:52-58`），但同样无实现。Odforce 是 Houdini 社区最活跃的第三方论坛，大量 TD 在此分享生产经验。

### 3.2 平台分析

Odforce 运行在 **Invision Community**（IPS）平台上，关键特征：

| 属性 | 值 |
|------|-----|
| 基础 URL | `https://forums.odforce.net/` |
| 平台 | Invision Community 4.x |
| REST API | **有** — Invision 内置 REST API |
| API 文档 | `https://invisioncommunity.com/developers/rest-api/` |
| 认证 | API Key（HTTP Basic Auth）或 OAuth 2.0 |
| RSS | `/rss/{forum_id}-{forum_name}.xml/` |
| 统计 | 46,373 成员，231.5k+ 帖子 |

### 3.3 方案

#### A. REST API 采集（首选）

Invision Community 提供结构化的 REST API，比 HTML 抓取更稳定、更高效。

**认证方式**：

```typescript
// API Key 通过 HTTP Basic Auth 传递
// username = API Key, password = 空
const ODFORCE_API_KEY = process.env.HOUDINI_CLAW_ODFORCE_API_KEY;

function buildOdforceHeaders(): HeadersInit {
  if (!ODFORCE_API_KEY) {
    throw new Error("HOUDINI_CLAW_ODFORCE_API_KEY not set");
  }
  const credentials = Buffer.from(`${ODFORCE_API_KEY}:`).toString("base64");
  return {
    Authorization: `Basic ${credentials}`,
    Accept: "application/json",
    "User-Agent": "HoudiniClaw/1.0 (knowledge-base-builder)",
  };
}
```

**核心接口封装**：

```typescript
interface OdforceApiClient {
  /** 获取帖子列表 */
  getTopics(params: {
    forumIds?: number[];
    sortBy?: "date" | "posts" | "views";
    sortDir?: "asc" | "desc";
    page?: number;
    perPage?: number;
  }): Promise<OdforceTopicList>;

  /** 获取帖子回复 */
  getPosts(topicId: number, params?: {
    page?: number;
    perPage?: number;
  }): Promise<OdforcePostList>;

  /** 搜索帖子 */
  search(query: string, params?: {
    type?: "forums_topic" | "forums_post";
    page?: number;
  }): Promise<OdforceSearchResult>;
}

interface OdforceTopic {
  id: number;
  title: string;
  forum: { id: number; name: string };
  firstPost: { content: string; author: { name: string } };
  posts: number;
  views: number;
  pinned: boolean;
  locked: boolean;
  tags: string[];
  url: string;
  date: string;     // ISO 8601
}

interface OdforcePost {
  id: number;
  content: string;  // HTML
  author: { id: number; name: string };
  date: string;
  isFirst: boolean;
  isBest: boolean;  // 采纳答案
}

interface OdforceTopicList {
  page: number;
  perPage: number;
  totalResults: number;
  totalPages: number;
  results: OdforceTopic[];
}

interface OdforcePostList {
  page: number;
  perPage: number;
  totalResults: number;
  totalPages: number;
  results: OdforcePost[];
}

interface OdforceSearchResult {
  page: number;
  totalResults: number;
  results: Array<{ title: string; url: string; content: string }>;
}
```

**API 请求实现**：

```typescript
const ODFORCE_BASE = "https://forums.odforce.net/api";

async function odforceRequest<T>(
  endpoint: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const url = new URL(`${ODFORCE_BASE}${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }

  const resp = await fetch(url.toString(), {
    headers: buildOdforceHeaders(),
  });

  if (resp.status === 429) {
    // 被限流，等待后重试
    const retryAfter = parseInt(resp.headers.get("Retry-After") ?? "60", 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return odforceRequest<T>(endpoint, params);
  }

  if (!resp.ok) {
    throw new Error(`Odforce API ${resp.status}: ${await resp.text()}`);
  }

  return resp.json() as Promise<T>;
}

async function getOdforceTopics(
  page = 1,
  perPage = 25,
): Promise<OdforceTopicList> {
  return odforceRequest<OdforceTopicList>("/forums/topics", {
    sortBy: "date",
    sortDir: "desc",
    page,
    perPage,
  });
}

async function getOdforcePosts(
  topicId: number,
  page = 1,
): Promise<OdforcePostList> {
  return odforceRequest<OdforcePostList>(
    `/forums/topics/${topicId}/posts`,
    { page, perPage: 50 },
  );
}
```

#### B. RSS 降级方案

如无法获取 API Key，降级为 RSS 采集：

```typescript
async function crawlOdforceRSS(): Promise<ForumPost[]> {
  const feedUrl = "https://forums.odforce.net/rss/1-odforce.xml/";
  // 复用 SideFX 论坛的 RSS 解析逻辑
  const resp = await fetch(feedUrl);
  const xml = await resp.text();
  return parseRSS(xml, "odforce");
}
```

#### C. 高价值内容抓取策略

Odforce 有 231k+ 帖子，不可能全部爬取。采用定向抓取策略：

```typescript
const ODFORCE_CRAWL_STRATEGY = {
  /** 按关键词搜索 + 按系统分类 */
  searchQueries: [
    // Pyro 相关
    "pyro solver parameters",
    "smoke simulation settings",
    "fire combustion setup",
    "pyro dissipation turbulence",

    // FLIP 相关
    "flip solver viscosity",
    "ocean simulation setup",
    "whitewater generation",
    "particle separation flip",

    // RBD 相关
    "bullet solver rbd",
    "voronoi fracture constraints",
    "glue constraint strength",
    "rbd collision geometry",

    // Vellum 相关
    "vellum cloth stiffness",
    "vellum hair simulation",
    "vellum grain solver",
  ],

  /** 按回复数排序，优先爬取高互动帖子 */
  minPosts: 3,

  /** 每次增量爬取的最大帖子数 */
  maxTopicsPerRun: 200,

  /** 分页上限 */
  maxPages: 10,
};
```

#### D. HTML → 纯文本

Odforce API 返回的 `content` 是 HTML，需要清洗：

```typescript
function stripOdforceHtml(html: string): string {
  const root = parse(html);

  // 保留代码块
  const codeBlocks = root.querySelectorAll("pre, code");
  const codes: string[] = [];
  codeBlocks.forEach((block) => {
    codes.push(`\`\`\`\n${block.text}\n\`\`\``);
  });

  // 提取引用块
  const quotes = root.querySelectorAll("blockquote");
  const quoteTexts = quotes.map((q) => `> ${q.text.trim()}`);

  // 纯文本
  let text = root.text
    .replace(/\s+/g, " ")
    .trim();

  return text;
}
```

### 3.4 环境变量

在 `houdini-claw.example.json` 和 `TOOLS.md` 中增加：

```
HOUDINI_CLAW_ODFORCE_API_KEY=<从 Odforce 管理员处申请>
HOUDINI_CLAW_ODFORCE_RATE_LIMIT=100   # 每小时请求上限
```

### 3.5 改动范围

| 文件 | 改动 |
|------|------|
| `crawl.ts` | 新增 `OdforceApiClient` 及相关函数；`runCrawl()` 增加 odforce 分发路径 |
| `schema.ts` | 无改动（`crawl_log.source_type` 已有 `odforce`） |
| `annotate.ts` | 新增社区经验→annotation 补充的 prompt 模板（作为文档 annotation 的增强层） |
| `houdini-claw.example.json` | 新增 `HOUDINI_CLAW_ODFORCE_API_KEY` |
| `TOOLS.md` | 新增 Odforce 相关环境变量说明 |

### 3.6 验收标准

- [ ] API 模式下可按系统关键词搜索并获取帖子列表
- [ ] 分页逻辑正确处理 `totalPages`，不超过 `maxPages` 上限
- [ ] API Key 缺失时自动降级为 RSS 模式并打印警告
- [ ] 429 限流时指数退避重试，最多 3 次
- [ ] 采集的帖子通过相关性过滤后入库

---

## 4. HIP 文件参数提取器

### 4.1 现状

`CrawlSource.type` 联合类型中已声明 `"hip_file"`（`crawl.ts:19`），`TOOLS.md` 也列出了 "Houdini Example Files — `.hip` parameter snapshots"，但无任何实现。

`.hip` 文件是 Houdini 的场景文件，其中包含所有节点的实际参数值——这是比文档更真实的参数数据源（文档描述默认值，`.hip` 包含 TD 实际调优后的值）。

### 4.2 HIP 文件格式分析

Houdini 的 `.hip` 文件实际上是 **CPIO archive**（一种 Unix 归档格式）：

```
.hip  — 未压缩 CPIO 归档
.hipnc — 非商业版，同为 CPIO
.hiplc — 有限商业版，同为 CPIO
.hipz  — gzip 压缩的 CPIO
```

**无需 Houdini 许可证即可读取**——只需标准 CPIO 解包工具。

CPIO 内部结构：

```
archive/
├── Nodes/                    # 节点层级
│   ├── obj/                  # Object 上下文
│   │   ├── geo1/             # Geometry 对象
│   │   │   ├── parms.json    # 节点参数值（JSON 或自定义格式）
│   │   │   └── sopnet/       # SOP 子网络
│   │   │       ├── scatter1/
│   │   │       │   └── parms  # 参数键值对
│   │   │       └── ...
│   ├── dop/                  # DOP 上下文
│   │   └── dopnet1/
│   │       ├── pyrosolver1/
│   │       │   └── parms     # Pyro Solver 参数
│   │       └── ...
├── .OPdummydefs              # 节点类型定义
└── .OPfallbacks              # 回退定义
```

每个 `parms` 文件包含该节点的参数键值对：

```
# 示例 parms 文件内容
{
    version 0.8
    dissipation [ 0 0.05 ]
    cooling_rate [ 0 0.3 ]
    turbulence [ 0 0.8 ]
    buoyancy_lift [ 0 1.5 ]
    ...
}
```

### 4.3 方案

#### A. CPIO 解包

Node.js 中使用纯 TypeScript 解析 CPIO，或调用系统 `cpio` 命令：

```typescript
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

interface HipFile {
  filePath: string;
  isCompressed: boolean;
}

/**
 * 解包 .hip 文件到临时目录。
 * 返回解包后的目录路径。
 */
function extractHip(hip: HipFile): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "houdini-hip-"));
  const inputPath = hip.filePath;

  if (hip.isCompressed || inputPath.endsWith(".hipz")) {
    // .hipz → 先解压再解包
    execSync(
      `gunzip -c "${inputPath}" | cpio -idm --quiet`,
      { cwd: tmpDir, stdio: "pipe" },
    );
  } else {
    // .hip → 直接 CPIO 解包
    execSync(
      `cpio -idm --quiet < "${inputPath}"`,
      { cwd: tmpDir, stdio: "pipe" },
    );
  }

  return tmpDir;
}
```

#### B. 参数提取

遍历解包目录，找到所有 `parms` 文件并解析：

```typescript
interface ExtractedNodeParams {
  nodePath: string;       // 如 "obj/geo1/dopnet1/pyrosolver1"
  nodeType: string;       // 如 "pyrosolver"
  context: string;        // 如 "DOP"
  parameters: Record<string, unknown>;
  hipSource: string;      // 来源 .hip 文件路径
}

function extractAllParams(extractedDir: string): ExtractedNodeParams[] {
  const results: ExtractedNodeParams[] = [];

  function walk(dir: string, currentPath: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.name === "parms" || entry.name === "parms.json") {
        const raw = fs.readFileSync(fullPath, "utf-8");
        const params = parseHoudiniParms(raw);
        const parts = relPath.split("/");
        const nodeType = parts[parts.length - 2] ?? "unknown";

        // 推断上下文
        let context = "SOP";
        if (relPath.includes("/dop/") || relPath.includes("dopnet")) context = "DOP";
        if (relPath.includes("/cop/")) context = "COP";
        if (relPath.includes("/chop/")) context = "CHOP";

        results.push({
          nodePath: relPath.replace("/parms", "").replace("/parms.json", ""),
          nodeType: nodeType.replace(/\d+$/, ""), // "pyrosolver1" → "pyrosolver"
          context,
          parameters: params,
          hipSource: "",
        });
      }
    }
  }

  walk(extractedDir, "");
  return results;
}
```

#### C. Houdini 参数格式解析

Houdini 的 `parms` 文件使用自定义的键值格式（不是标准 JSON）：

```typescript
/**
 * 解析 Houdini parms 文件格式。
 *
 * 格式示例：
 *   version 0.8
 *   dissipation [ 0 0.05 ]
 *   stiffness [ 0 locks( 0 0 ) 1000 ]
 *   somestring [ 0 "hello world" ]
 *   toggle [ 0 "on" ]
 */
function parseHoudiniParms(raw: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const lines = raw.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("{") || trimmed.startsWith("}")) {
      continue;
    }

    // 格式: key [ channel value ]  或  key [ channel value1 value2 ... ]
    const match = trimmed.match(/^(\w+)\s+\[\s*\d+\s+(.*?)\s*\]$/);
    if (match) {
      const [, key, valueStr] = match;
      // 尝试解析数值
      const numVal = parseFloat(valueStr);
      if (!isNaN(numVal) && valueStr.trim() === String(numVal)) {
        params[key] = numVal;
      } else {
        // 字符串值或复合值
        params[key] = valueStr.replace(/^"|"$/g, "");
      }
    }
  }

  return params;
}
```

#### D. 与 annotation 管线对接

提取的参数快照可以增强现有 annotation 的质量：

```typescript
/**
 * 将 .hip 中提取的参数值与已有 annotation 交叉验证。
 *
 * - 如果 .hip 中的值在 annotation 的 safe_range 内 → 增加 confidence
 * - 如果 .hip 中的值在 danger_zone 内 → 标记为 "expert setting, verify"
 * - 如果参数在 annotation 中不存在 → 标记为 "discovered from hip"
 */
function crossValidateWithAnnotation(
  hipParams: ExtractedNodeParams,
  existingAnnotation: Record<string, unknown> | undefined,
): {
  validated: string[];      // 被 .hip 文件验证的参数
  newDiscoveries: string[]; // annotation 中没有但 .hip 中有的参数
  outliers: string[];       // 值超出已知 safe_range 的参数
} {
  // ... 实现交叉验证逻辑
}
```

#### E. HIP 文件来源

| 来源 | 获取方式 | 数量估计 |
|------|---------|---------|
| SideFX 官方示例 | Houdini 安装目录 `$HFS/houdini/help/examples/` | ~200 个 |
| SideFX 教程附件 | `https://www.sidefx.com/tutorials/` 页面附件 | ~100 个 |
| Entagma 教程 | 付费/免费教程附带 | ~50 个 |
| 用户提交 | 未来功能（用户上传 .hip 快照） | 待定 |

官方示例是最优先的来源——它们是 SideFX 官方调参的"标准答案"。

### 4.4 安全考量

`.hip` 文件可能包含：
- Python SOP / Houdini Expression 中的任意代码 → **不执行，仅读取 parms**
- 绝对路径（暴露用户目录结构）→ **过滤路径类参数**
- 第三方 HDA 引用 → **仅提取参数值，忽略不存在的节点类型**

```typescript
const PARAM_BLOCKLIST = [
  "file", "filename", "sopoutput", "dopoutput",
  "hip", "job", "home", // 路径相关
  "python", "script",   // 代码相关
];

function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (PARAM_BLOCKLIST.some((b) => key.toLowerCase().includes(b))) continue;
    if (typeof value === "string" && value.startsWith("/")) continue; // 绝对路径
    clean[key] = value;
  }
  return clean;
}
```

### 4.5 改动范围

| 文件 | 改动 |
|------|------|
| `crawl.ts` | 新增 `extractHip()`、`extractAllParams()`、`parseHoudiniParms()`；`runCrawl()` 增加 hip_file 模式 |
| `annotate.ts` | `buildAnnotationPrompt()` 支持注入 `.hip` 参数快照作为辅助参考 |
| `ingest.ts` | 新增 `crossValidateWithAnnotation()` 逻辑 |
| `schema.ts` | `crawl_log.source_type` 已支持通用扩展，无需改动 |
| `TOOLS.md` | 新增 HIP 文件路径配置说明 |

### 4.6 验收标准

- [ ] 能正确解包 `.hip` / `.hipz` 文件
- [ ] 对 SideFX 官方 Pyro 示例场景，提取 ≥ 10 个 pyro_solver 参数
- [ ] 参数值类型正确（数值为 number，字符串为 string）
- [ ] 安全过滤阻止路径和脚本类参数泄漏
- [ ] 交叉验证逻辑正确标识 validated / newDiscoveries / outliers

---

## 附录

### A. 总体架构图

```
┌─────────────────────────── Data Sources ───────────────────────────────┐
│                                                                        │
│  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ SideFX Docs│  │SideFX Forum│  │  Odforce  │  │  HIP Files        │  │
│  │ (HTML)     │  │ (RSS/HTML) │  │ (REST API)│  │  (CPIO archive)   │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬─────┘  └────────┬──────────┘  │
│        │               │               │                  │             │
└────────┼───────────────┼───────────────┼──────────────────┼─────────────┘
         │               │               │                  │
         ▼               ▼               ▼                  ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                        crawl.ts                             │
    │  crawlSideFxDoc()  crawlForumRSS()  odforceApi()  hipExtract│
    └──────────────────────────┬──────────────────────────────────┘
                               │
                               ▼  /tmp/houdini-raw/*.json
    ┌──────────────────────────────────────────────────────────────┐
    │                       annotate.ts                            │
    │  buildAnnotationPrompt() → GPT-5.2 xhigh → NodeAnnotation   │
    └──────────────────────────┬───────────────────────────────────┘
                               │
                               ▼  /tmp/houdini-annotated/*.json
    ┌──────────────────────────────────────────────────────────────┐
    │                        ingest.ts                             │
    │  ingestAnnotation() → SQLite upsert → vector chunk           │
    └──────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
    ┌──────────────────────────────────────────────────────────────┐
    │                   houdini_kb.db (SQLite)                     │
    │  node_annotations │ parameter_annotations │ recipes │ ...    │
    │  embedding_chunks │ kb_vec (sqlite-vec)   │ crawl_log        │
    └──────────────────────────────────────────────────────────────┘
```

### B. 开发优先级

| 优先级 | 任务 | 依赖 | 预估复杂度 |
|--------|------|------|-----------|
| **P0** | SideFX 文档 HTML 解析优化 | `node-html-parser` | 低 |
| **P0** | Sitemap 节点自动发现 | 无 | 低 |
| **P1** | SideFX 论坛 RSS 爬虫 | 无 | 中 |
| **P1** | Odforce REST API 爬虫 | API Key 申请 | 中 |
| **P2** | HIP 文件解包与参数提取 | 系统 `cpio` 命令 | 中高 |
| **P2** | HIP 参数与 annotation 交叉验证 | P0 + P2 解包 | 中 |
| **P3** | 论坛帖子深度爬取（HTML） | P1 RSS 完成后 | 中 |

### C. 新增环境变量汇总

```bash
# 已有
HOUDINI_CLAW_DB_PATH=~/.openclaw/houdini-claw/houdini_kb.db
HOUDINI_CLAW_EMBEDDING_MODEL=text-embedding-3-small
HOUDINI_CLAW_ANNOTATION_MODEL=gpt-5.2-xhigh

# 新增
HOUDINI_CLAW_ODFORCE_API_KEY=           # Odforce REST API Key
HOUDINI_CLAW_ODFORCE_RATE_LIMIT=100     # Odforce 每小时请求上限
HOUDINI_CLAW_HIP_EXAMPLES_DIR=          # HIP 示例文件目录（默认 $HFS/houdini/help/examples）
HOUDINI_CLAW_CRAWL_MODE=both            # 节点发现模式: whitelist | discover | both
```

### D. 依赖变更

```json
{
  "dependencies": {
    "node-html-parser": "^7.0.1"
  }
}
```

无其他新依赖。CPIO 解包使用系统命令，RSS/API 解析使用原生 `fetch` + 正则。
