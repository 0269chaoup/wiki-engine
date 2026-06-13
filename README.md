# wiki-engine

Obsidian Vault 知识网络分析引擎 — 图谱构建、连接发现、去重检测、内容导入一站式 CLI 工具。

## 简介

`wiki-engine` 面向 Obsidian 知识库，提供结构化的知识网络管理能力。基于**四层本体模型**（Story / Event / Entity / Concept），结合 MOC（Map of Content）横向索引，帮助你从散乱的 vault 中构建有序的知识体系。

核心能力：
- **图谱分析** — 可视化知识拓扑，识别孤立节点与桥接节点
- **连接发现** — 借助 LLM 发现笔记间的潜在关联
- **去重检测** — 三阶段去重，清理重复/相似内容
- **内容导入** — 从外部来源（网页、文件）摄入到 vault
- **双链补全** — 扫描未链接的概念提及，自动补 `[[wikilink]]`
- **MOC 同步** — 自动维护 Map of Content 索引
- **Frontmatter 管理** — 验证与修复 YAML frontmatter

## 安装

```bash
# 克隆项目
git clone <repo-url> wiki-engine
cd wiki-engine

# 安装依赖
npm install

# 构建
npm run build

# 全局链接（可选）
npm link
```

安装后即可在终端使用 `wiki-engine` 命令。

## 全局选项

所有命令共享以下全局选项：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--vault <path>` | Vault 根目录路径 | `$OBSIDIAN_VAULT` 或当前目录 |
| `--llm <provider>` | LLM 提供商：`agent` / `api` / `openclaw` | `agent` |
| `--api-provider <name>` | API 提供商：`anthropic` / `openai` | `anthropic` |
| `--model <name>` | LLM 模型名称 | `claude-sonnet-4-6` |
| `--api-key <key>` | API 密钥（也可通过环境变量设置） | — |
| `--base-url <url>` | 自定义 API 基础 URL | — |
| `--agent-id <id>` | OpenClaw Agent ID | `main` |
| `--verbose` | 详细输出 | `false` |

环境变量：`ANTHROPIC_AUTH_TOKEN`、`OPENAI_API_KEY`

## 命令速查

### `scan` — 扫描统计

扫描 vault，输出文件数量、标签分布等统计信息。

```bash
wiki-engine scan --vault /path/to/vault --tags
```

### `graph` — 图谱分析

生成知识图谱，分析拓扑结构。

```bash
wiki-engine graph --vault /path/to/vault --top 20 --orphans --bridges
```

| 参数 | 说明 |
|------|------|
| `--top <n>` | 显示度数最高的 N 个节点 |
| `--orphans` | 列出孤立节点（无链接） |
| `--bridges` | 识别桥接节点 |

### `connect` — 连接发现

发现笔记间的潜在关联，支持本地算法 + LLM 增强。

```bash
wiki-engine connect "note title" --vault /path/to/vault --llm agent
```

### `dedup` — 去重检测

三阶段去重：指纹 → 相似度 → LLM 语义判定。

```bash
wiki-engine dedup --vault /path/to/vault --threshold 0.6
```

| 参数 | 说明 |
|------|------|
| `--threshold <n>` | 相似度阈值（0-1） |

### `ingest` — 内容导入

从外部文件导入内容到 vault。

```bash
wiki-engine ingest <file> --vault /path/to/vault --llm agent
```

### `archive` — Inbox 归档

将 Inbox 中的内容归档到永久笔记区。

```bash
wiki-engine archive --batch <id> --vault /path/to/vault
```

### `quote` — 语录管理

管理个人语录集合。

```bash
wiki-engine quote add "语录内容" --author "作者"
wiki-engine quote list
wiki-engine quote count
```

### `moc-sync` — MOC 同步

同步 Map of Content 索引文件。

```bash
wiki-engine moc-sync
```

### `create` — 创建知识文件

按照四层本体模型创建新的知识文件。

```bash
wiki-engine create --title "标题" --type concept
```

### `validate` — Frontmatter 验证

验证 vault 中文件的 frontmatter 格式。

```bash
wiki-engine validate --vault /path/to/vault
```

### `fix-frontmatter` — Frontmatter 修复

自动修复不符合规范的 frontmatter。

```bash
wiki-engine fix-frontmatter --vault /path/to/vault
```

## 架构概览

```
wiki-engine/
├── src/
│   ├── index.ts              # CLI 入口（commander）
│   ├── commands/             # 命令定义层
│   │   ├── scan.ts           # 扫描统计
│   │   ├── graph.ts          # 图谱分析
│   │   ├── connect.ts        # 连接发现
│   │   ├── dedup.ts          # 去重检测
│   │   ├── ingest.ts         # 内容导入
│   │   ├── archive.ts        # Inbox 归档
│   │   ├── quote.ts          # 语录管理
│   │   ├── moc-sync.ts       # MOC 同步
│   │   ├── create.ts         # 创建文件
│   │   ├── validate.ts       # 验证 frontmatter
│   │   ├── fix-frontmatter.ts# 修复 frontmatter
│   │   └── work.ts           # 工作任务
│   ├── lib/                  # 核心逻辑层
│   │   ├── vault.ts          # Vault 读写抽象
│   │   ├── types.ts          # TypeScript 类型定义
│   │   ├── graph.ts          # 图谱算法
│   │   ├── dedup.ts          # 去重算法（三阶段）
│   │   ├── ingest.ts         # 导入管线核心
│   │   ├── archive.ts        # 归档逻辑
│   │   ├── quote.ts          # 语录处理
│   │   ├── moc-sync.ts       # MOC 同步逻辑
│   │   ├── clip.ts           # 网页剪藏
│   │   ├── create.ts         # 文件创建
│   │   ├── validate.ts       # 验证逻辑
│   │   ├── fix-frontmatter.ts# 修复逻辑
│   │   ├── stage2-align.ts   # 导入阶段 2：对齐
│   │   ├── stage4-dispatch.ts# 导入阶段 4：分发
│   │   ├── manifest.ts       # 清单管理
│   │   ├── cli-utils.ts      # CLI 工具函数
│   │   └── work.ts           # 工作任务逻辑
│   └── llm/                  # LLM 提供商层
│       ├── provider.ts       # 提供商接口定义
│       ├── factory.ts        # 提供商工厂
│       ├── api-provider.ts   # 直连 API 调用
│       ├── pipe-provider.ts  # Helios 管道协议
│       └── openclaw-provider.ts # OpenClaw 平台
└── docs/
    └── plan.md               # 架构设计文档
```

### 分层设计

1. **命令层** (`commands/`) — CLI 参数解析、输出格式化，不含业务逻辑
2. **逻辑层** (`lib/`) — 核心算法与数据处理，可独立复用
3. **LLM 层** (`llm/`) — 统一的 LLM 调用抽象，支持多种后端

### 核心原则

- 知识 SSOT（单一事实源）在 `50-Knowledge/` 目录
- 四层本体模型：**Story** / **Event** / **Entity** / **Concept**
- MOC 作为横向控制台，桥接纵向目录结构
- 全局四法则：禁止单纯概括、强制原文锚定、Obsidian 原生 Callout、归档块前置

## 开发说明

```bash
# 开发模式（自动编译）
npm run dev

# 构建
npm run build

# 运行测试
npm test
```

- 语言：TypeScript（ESM）
- 运行时：Node.js
- 测试框架：Vitest
- 依赖：commander、gray-matter、glob、chalk、cli-table3、turndown、defuddle、linkedom

## 相关文档

- [架构设计文档](docs/plan.md) — 四层本体模型、CLI 命令设计、LLM 集成方案、实施状态

## 许可

Private
