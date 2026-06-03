---
type: Plan
status: active
created: 2026-05-27T00:00:00.000Z
updated: '2026-05-27'
version: 4
domain: wiki-engine
---

# wiki-engine-知识网络架构

## 背景

Obsidian vault 中的知识文件缺乏结构化管理

## 目标

构建结构化的知识网络，支持四层本体模型

## 方案设计

### 核心原则
- 知识 SSOT 在 50-Knowledge/
- 四层本体模型：Story/Event/Entity/Concept
- MOC（Map of Content）作为横向控制台
- 全局四法则：禁止单纯概括、强制原文锚定、Obsidian 原生 Callout、归档块前置

### CLI 命令
| 命令 | 功能 |
|------|------|
| graph | 生成 vault 图谱 |
| connect | 发现潜在连接（本地 + LLM） |
| dedup | 检测重复/相似内容 |
| ingest | 导入外部内容 |
| scan | 扫描 vault 统计 |
| moc-sync | 同步 MOC 索引 |
| quote | 管理个人语录 |
| validate | 验证 frontmatter |
| create | 创建知识文件 |
| fix-frontmatter | 修复 frontmatter |

### LLM 集成
- 支持 api 模式（直接调用 API）
- 支持 agent 模式（pipe 协议给 Agent 用）
## 实施状态

- [x] 核心 CLI 框架
- [x] 图谱生成（graph）
- [x] 连接发现（connect）
- [x] 去重检测（dedup）
- [x] 内容导入（ingest）
- [x] 扫描统计（scan）
- [x] MOC 同步（moc-sync）
- [x] 语录管理（quote）
- [x] frontmatter 验证/修复
- [x] LLM 集成
## 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-27 | v1 | 初稿 |
| 2026-05-27 | v4 | 初稿：整理现有架构到 plan-engine |
