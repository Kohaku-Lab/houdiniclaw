# 实现计划：自动抓取文档 & HIP 文件解析

## 背景分析

### 已有能力
- `crawl.ts`：抓取 SideFX 官方文档 HTML 页面（~63 个节点路径）
- `annotate.ts`：通过 LLM 将原始文档转化为结构化标注
- `ingest.ts`：写入 SQLite + 向量索引
- `seed.ts`：人工验证的基线数据（4 个节点）
- `run-pipeline.ts`：编排完整流水线

### 缺失能力
1. **SideFX 示例文件（HIP）抓取**：`crawl.ts` 类型定义中有 `"hip_file"` 但从未使用
2. **HIP 文件解析**：完全未实现
3. **Content Library 抓取**：SideFX Content Library 有 HIP/HDA 文件，未集成
4. **论坛深度抓取**：论坛源已配置但抓取逻辑未实现（仅实现了 SideFX docs）

### HIP 文件格式技术调研
- `.hip` 文件本质是 **CPIO 归档**（类似 tar），可不依赖 Houdini 许可证解析
- 包含 ASCII 和 binary 混合数据，节点参数信息在 ASCII 段中
- 可用 Python/Node.js 实现轻量 CPIO 解析器
- 压缩内容头部有 4 字节标志需跳过
- `hexpand` 可展开为目录结构，但需要 Houdini 环境

### SideFX 示例文件分布
- **安装随附**：`$HH/help/files/` 目录下按类别组织
- **在线文档**：`sidefx.com/docs/houdini/examples/nodes/{type}/{node}/` 有示例说明页
- **Content Library**：`sidefx.com/contentlibrary/` 有可下载的 HIP/HDA 文件（含内部 API `/contentlibrary/get-contents/`）

---

## 实现计划

### 阶段 1：增强文档爬虫（扩展 crawl.ts）

**目标**：扩展现有爬虫覆盖 SideFX 示例页面和 Content Library

#### 1.1 新增示例文档页面爬取
**文件**：`src/houdini-claw/crawl.ts`

- 为每个已知节点路径增加对应的 examples 页面抓取
  - URL 模式：`https://www.sidefx.com/docs/houdini/examples/nodes/{type}/{node}.html`
  - 提取示例名称、描述、关联的 HIP 文件名
- 新增 `crawlExamplesIndex()` 函数，抓取 examples 索引页获取完整示例目录
- 在 `CrawledPage` 接口中增加 `exampleFiles?: string[]` 字段

#### 1.2 新增 Content Library 爬取
**新文件**：`src/houdini-claw/crawl-content-library.ts`

- 调用 Content Library 内部 API (`/contentlibrary/get-contents/`)
- 按类别过滤（Pyro FX, Destruction FX, Fluids, Vellum 等）
- 获取 HIP 文件元数据（名称、描述、版本、下载链接）
- 存储到 `CrawledPage` 中，标记 `sourceType: "content_library"`
- 实现分页加载和限速

#### 1.3 扩展 CRAWL_SOURCES 配置
```typescript
{
  id: "sidefx-examples",
  type: "sidefx_docs",  // 复用已有类型
  baseUrl: "https://www.sidefx.com/docs/houdini/examples/",
  priority: 0,
  enabled: true,
},
{
  id: "content-library",
  type: "hip_file",  // 激活已定义但未使用的类型
  baseUrl: "https://www.sidefx.com/contentlibrary/",
  priority: 1,
  enabled: true,
}
```

---

### 阶段 2：HIP 文件下载与管理

**目标**：从已知来源下载 HIP 文件并建立本地文件管理

#### 2.1 HIP 文件下载器
**新文件**：`src/houdini-claw/hip-downloader.ts`

- 从 Content Library 下载 HIP 文件到本地缓存目录 (`~/.openclaw/houdini-claw/hip-cache/`)
- 实现断点续传和文件完整性校验（SHA-256）
- 限速下载，避免被源站限流
- 支持增量更新（对比文件哈希）

#### 2.2 本地示例文件发现
- 支持从本地 Houdini 安装目录读取示例文件
  - 扫描 `$HH/help/files/` 和 `$HOUDINI_PATH/examples/`
  - 环境变量 `HOUDINI_INSTALL_PATH` 指定安装路径
- 生成本地示例文件索引

---

### 阶段 3：HIP 文件解析器（核心）

**目标**：无需 Houdini 许可证即可解析 HIP 文件，提取节点和参数数据

#### 3.1 CPIO 解析器
**新文件**：`src/houdini-claw/hip-parser/cpio-reader.ts`

- 实现纯 TypeScript 的 CPIO 归档读取器
- 支持 gzip 解压（`.hip` 是 gzip 压缩的 CPIO）
- 处理压缩内容头部 4 字节标志
- 返回 `(filename, content)[]` 格式的文件列表

#### 3.2 HIP 内容解析器
**新文件**：`src/houdini-claw/hip-parser/hip-content-parser.ts`

- 从展开的 CPIO 内容中提取 Houdini 场景结构
- 解析节点层级（OBJ → SOP/DOP/VOP → 子节点）
- 提取参数定义和实际值
- 输出结构化 JSON：

```typescript
interface HipParseResult {
  hipVersion: string;          // Houdini 版本
  saveTime: string;            // 保存时间
  nodes: HipNode[];            // 所有节点
  connections: HipConnection[]; // 节点连接关系
}

interface HipNode {
  path: string;                // 如 /obj/pyro_sim/pyro_solver1
  type: string;                // 如 pyrosolver::2.0
  category: string;            // DOP/SOP/VOP 等
  parameters: HipParameter[];  // 实际参数值
  flags: Record<string, boolean>; // display, render, bypass 等
}

interface HipParameter {
  name: string;
  value: string | number | number[];
  isDefault: boolean;          // 是否为默认值
  expression?: string;         // VEX/HScript 表达式
  keyframes?: HipKeyframe[];   // 关键帧数据
}
```

#### 3.3 解析器模块入口
**新文件**：`src/houdini-claw/hip-parser/index.ts`

- 导出 `parseHipFile(filePath: string): Promise<HipParseResult>`
- 导出 `parseHipBuffer(buffer: Buffer): Promise<HipParseResult>`
- 错误处理：格式不支持时返回有意义的错误信息

---

### 阶段 4：HIP 数据集成到知识库

**目标**：将 HIP 文件解析结果融入现有标注流水线

#### 4.1 HIP 数据提取器
**新文件**：`src/houdini-claw/hip-extractor.ts`

- 从 `HipParseResult` 中提取知识库需要的数据：
  - **实际参数值**：用于验证/补充 `parameter_annotations` 中的 safe_range、default_value
  - **网络拓扑**：哪些节点通常一起使用，补充 `prerequisite_nodes` 和 `typical_network`
  - **非默认参数**：识别示例中故意调整的参数（更有学习价值）
  - **表达式模式**：常见的 VEX 表达式和 HScript 用法

#### 4.2 扩展数据库 Schema
**修改文件**：`src/houdini-claw/schema.ts`

新增表：
```sql
-- HIP 文件索引
CREATE TABLE IF NOT EXISTS hip_files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name       TEXT NOT NULL,
  file_hash       TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL,       -- content_library, local_install, community
  source_url      TEXT,
  houdini_version TEXT,
  description     TEXT,
  systems         TEXT,                -- JSON array: ["pyro", "rbd"]
  parsed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  parse_status    TEXT NOT NULL DEFAULT 'pending'  -- pending, success, error
);

-- HIP 文件中提取的参数快照
CREATE TABLE IF NOT EXISTS hip_parameter_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hip_file_id     INTEGER NOT NULL,
  node_type       TEXT NOT NULL,       -- 如 pyrosolver::2.0
  node_path       TEXT NOT NULL,       -- 如 /obj/pyro_sim/pyro_solver1
  param_name      TEXT NOT NULL,
  param_value     TEXT NOT NULL,       -- JSON 值
  is_default      INTEGER NOT NULL DEFAULT 0,
  expression      TEXT,

  FOREIGN KEY (hip_file_id) REFERENCES hip_files(id)
);

CREATE INDEX IF NOT EXISTS idx_hip_snapshots_type ON hip_parameter_snapshots(node_type);
CREATE INDEX IF NOT EXISTS idx_hip_snapshots_param ON hip_parameter_snapshots(param_name);
```

#### 4.3 扩展 KnowledgeBase 类
**修改文件**：`src/houdini-claw/db.ts`

- 新增 `upsertHipFile()`, `getHipFile()`, `listHipFiles()` 方法
- 新增 `insertParameterSnapshot()`, `getSnapshotsForNodeType()` 方法
- 新增 `getParameterStatistics(nodeType, paramName)` — 聚合多个 HIP 文件中的参数值，计算实际使用范围

#### 4.4 增强标注生成
**修改文件**：`src/houdini-claw/annotate.ts`

- 在标注 prompt 中注入 HIP 文件中提取的实际参数值
- 将实际使用统计作为标注的验证依据（"在 15 个官方示例中，dissipation 的值范围为 0.01~0.5"）
- 新增 `buildAnnotationPromptWithHipData()` 函数

---

### 阶段 5：流水线集成

**目标**：将 HIP 相关步骤集成到现有的自动化流水线中

#### 5.1 扩展 run-pipeline.ts
**修改文件**：`skills/houdini-annotator/scripts/run-pipeline.ts`

在现有 4 阶段基础上扩展：

```
Stage 1: Crawl  (文档 + 示例页面 + Content Library 目录)
Stage 1.5: Download HIP  (下载新发现的 HIP 文件)
Stage 1.6: Parse HIP  (解析 HIP 文件，提取参数快照)
Stage 2: Annotate  (结合文档 + HIP 数据生成标注)
Stage 3: Ingest  (写入知识库)
Stage 4: Report  (覆盖率报告 + HIP 覆盖率)
```

#### 5.2 更新 SKILL.md
**修改文件**：`skills/houdini-annotator/SKILL.md`

- 更新数据源表格，将 HIP 文件从 "计划" 改为 "已实现"
- 添加新的流水线阶段文档

#### 5.3 导出更新
**修改文件**：`src/houdini-claw/index.ts`

- 导出新增的模块：`hip-parser`、`hip-downloader`、`hip-extractor`

---

## 文件变更总结

### 新增文件（6 个）
| 文件 | 用途 |
|------|------|
| `src/houdini-claw/crawl-content-library.ts` | Content Library 爬取 |
| `src/houdini-claw/hip-downloader.ts` | HIP 文件下载管理 |
| `src/houdini-claw/hip-parser/cpio-reader.ts` | CPIO 归档解析器 |
| `src/houdini-claw/hip-parser/hip-content-parser.ts` | HIP 内容结构解析 |
| `src/houdini-claw/hip-parser/index.ts` | 解析器模块入口 |
| `src/houdini-claw/hip-extractor.ts` | HIP 数据 → 知识库转换 |

### 修改文件（6 个）
| 文件 | 变更内容 |
|------|----------|
| `src/houdini-claw/crawl.ts` | 增加示例页面抓取 |
| `src/houdini-claw/schema.ts` | 新增 hip_files、hip_parameter_snapshots 表 |
| `src/houdini-claw/db.ts` | 新增 HIP 相关 CRUD 方法 |
| `src/houdini-claw/annotate.ts` | 标注时融入 HIP 数据 |
| `src/houdini-claw/index.ts` | 导出新模块 |
| `skills/houdini-annotator/scripts/run-pipeline.ts` | 集成 HIP 流水线阶段 |

---

## 实施顺序

```
阶段 3 (HIP 解析器)  →  阶段 1 (文档爬虫增强)  →  阶段 2 (下载器)
                                                       ↓
                           阶段 4 (知识库集成)  ←  阶段 5 (流水线集成)
```

**推荐先做阶段 3**（CPIO 解析器），因为它是核心技术风险点。验证通过后再并行推进其余阶段。

---

## 技术风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| CPIO 解析器无法处理所有 HIP 版本 | 部分文件解析失败 | 降级为元数据提取；记录解析失败的文件供人工检查 |
| Content Library 反爬 | 无法下载 HIP 文件 | 使用 Firecrawl 降级；考虑仅从本地 Houdini 安装提取 |
| HIP 文件参数格式复杂 | 表达式/动画参数解析不完整 | 优先提取静态值；表达式作为字符串保留，后续迭代 |
| 大量 HIP 文件占用存储 | 磁盘空间不足 | 实现 LRU 缓存策略；可配置缓存大小上限 |
