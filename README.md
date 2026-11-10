# dsh-skill-panel

> DSH 技能包工作台：在 Web GUI 侧边栏里浏览、编辑、新建「技能包」，把成套的 skill 一次性交给某个 agent。

---

## 它解决什么

DSH 的 skill 有两条路：

1. **装进 `~/.dsh/skills/`** —— 全局常驻，每次对话都在 catalog 里，占固定上下文
2. **放在别处，用时 `read` 路径** —— 不占常驻，但每次都要手写路径

第三种做法是**技能包**：一份 markdown 文件，写明「这个领域有哪些 skill、在哪、什么时候用」。
派子代理时只需一行：

```
技能包：D:\workspace\DSH-skills-packs\学术写作.md
先 read 它，按里面的指示加载需要的 skill。
```

子代理读这一个文件就知道全部，不用你在任务书里逐个写路径。

**这个插件就是管理这些技能包的界面。**

---

## 功能

### 三栏工作台

```
┌──────────┬─────────────┬────────────────────┐
│ 技能包   │ 源与技能    │ 编辑器              │
│          │             │                    │
│ 学术写作 │ ☐ 全局 12个 │ ---                │
│ 科学计算 │ ☐ 科学 181  │ pack: 学术写作      │
│ 文档办公 │ ☐ Nature 24 │ sources: [nature]  │
│ 文献研究 │ ☑ Anthropic │ picks: [...]       │
│ 方法论   │ ☐ 每日 7    │ ---                │
│          │             │                    │
│ [+ 新建] │ 过滤…       │ # 正文…            │
└──────────┴─────────────┴────────────────────┘
```

- **左栏**：技能包列表，显示每个包的 `sources` / `picks` / `global` 数量与校验状态
- **中栏**：全部 skill 按源分组，勾选即写入当前包的 `picks`（并自动补上所属 `sources`）
- **右栏**：包正文编辑器，支持 `Ctrl/Cmd+S` 保存、`Tab` 缩进

### 校验

每个包会被自动检查：

| 检查项 | 说明 |
|---|---|
| frontmatter 合法 | `pack` / `description` 必填 |
| `sources` 引用 | id 必须在 `_sources.json` 里，且目录真的存在 |
| `picks` 引用 | skill 必须在声明的源里真实存在 |
| `global` 引用 | 名字必须是合法 kebab-case |

错误直接显示在包列表和编辑器顶部，**不用等子代理 read 失败才发现**。

---

## 安装

```bash
# 从本地目录安装
dsh plugin --profile <profile> add D:\path\to\dsh-skill-panel
```

或在 DSH 里让 agent 调用 `plugin_manager` 的 `install_bundle`。

安装后重启 DSH，侧边栏会出现「技能包」图标。

---

## 目录约定

插件默认读写：

```
D:\workspace\DSH-skills-packs\
├── _sources.json      源目录注册表
├── _FORMAT.md         包格式规范
├── README.md
└── *.md               各个技能包
```

`_` 开头的文件不当作技能包。

### 技能包格式

```markdown
---
pack: 学术写作
description: 学术写作、润色、引用、综述
sources:
  - nature
  - litreview
picks:
  - nature-reader
global:
  - nature-writing
---

# 学术写作技能包

（正文：写给 agent 看的加载指示）
```

三种引用方式：

| 写法 | 含义 | 适合 |
|---|---|---|
| `global: [名字]` | 已装进 `~/.dsh/skills/`，直接调 `skill` 工具，不写路径 | 常驻能力 |
| `picks: [名字]` | 点名，正文里给出路径 | 确定会用到的 |
| `sources: [id]` | 整个源可达，用时自己按名字找 | 源很大或不确定 |

**不要**把几百个 skill 逐个写进 `picks` —— 那是抄一遍清单，源一更新就过期。

### 源注册表

`_sources.json`：

```json
{
  "version": 1,
  "sources": [
    {
      "id": "scientific",
      "name": "科学计算",
      "root": "D:\\plan\\claude-scientific-skills\\skills",
      "note": "181 个，生命科学/化学/物理/统计/ML"
    }
  ]
}
```

面板按这个列表扫描 skill。改这里就能加减源。

---

## 设计原则

**指针，不是副本**

包文件里写的是路径，不是 skill 全文。源目录更新后自动生效，不会静默过期。

复制只在「导出给别人」时做（后续功能）。

**失败要响亮**

包里路径失效时，子代理 `read` 会立刻报错。
这比复制一份过期副本、子代理照旧内容干活要好得多。

**文件系统是真源**

面板每次都以磁盘上的实际内容为准，不以 `_sources.json` 里写死的为准。
源目录改了名，校验会报出来。

---

## HTTP 接口

Host 半边挂在 `/dsh-skill-panel` 前缀下：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/list` | 一次拿齐：包、源、全局 skill |
| POST | `/save` | 保存一个包 |
| POST | `/create` | 新建包 |
| POST | `/remove` | 删除包 |
| POST | `/sources` | 保存源注册表 |

所有写操作都校验路径必须落在允许的根目录内，不接受任意路径。

---

## 已知限制

- **只扫一层目录**：DSH 的 skill 发现机制只认 `<root>/<name>/SKILL.md`，不支持嵌套。所以技能包也不能靠目录嵌套表达分组。
- **源目录会漂移**：第三方项目改名、移动、删 skill 都可能导致包内路径失效。面板的校验能发现，但需要你手动修。
- **不管理 `~/.dsh/skills/` 的内容**：全局 skill 只读展示，增删仍走文件系统或 `dsh plugin`。

---

## 许可

MIT
