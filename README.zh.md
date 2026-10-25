# 全球热点图谱 · Global Hotspot Atlas

把一堆散乱的国际新闻，变成一张能旋转、能点击、能顺藤摸瓜的关系地图。

产物是**单个 HTML 文件**（约 130KB），零外部依赖：没有 CDN、没有 API Key、断网也能双击打开，可以直接发给别人看。

它以 3D 地球（事件以发光点呈现）叠加力导向实体关系图谱（人物 / 组织 / 国家 / 地点 / 议题及其关联）为核心，并可选叙事导览、来源分歧对照、假设推演等功能。

## 何时使用

命中以下任一意图就启动：

- 想看全球或某区域近期的热点事件，且希望"看到地图"而不只是一段文字
- 需要把事件里的关键人物、组织、国家、议题之间的关系可视化
- 要做态势大屏、新闻聚合页、地缘政治复盘材料
- 用户提到"3D 地球""关系图谱""事件脉络""热点地图""全球态势"

**不适用**：只要一段新闻摘要（直接回答即可）、只要静态世界地图（用普通地图工具）、需要实时流式更新（本技能是快照式生成）。

## 环境要求

- **Node.js**（供 fetch / scaffold / build 脚本使用）
- 抓取新闻需要外网访问（不可用时会降级到 WebSearch / 手写数据）

## 工作流

严格按顺序执行。第 3 步是唯一需要动脑的地方，其余都是确定性操作。

> **路径约定**：所有脚本都用**本技能的绝对路径**调用（即加载本技能时给出的 Base directory），工作目录保持在用户当前项目下，这样中间产物落在项目里，不会污染技能目录。下文用 `$SKILL` 代指该绝对路径，执行前先：
>
> ```bash
> SKILL="/绝对/路径/global-hotspot-atlas"
> ```

### 第 0 步 · 定参数（不要追问，用默认值）

| 参数   | 默认                  | 说明                        |
| ---- | ------------------- | ------------------------- |
| 时间窗  | 48 小时               | 用户说"这周"就改 168             |
| 事件数  | 12–16 条             | 少于 8 条地球会显得空，多于 20 条标签会打架 |
| 范围   | 全球                  | 用户点名某区域就只保留该区域事件          |
| 落盘目录 | 当前工作目录下的 `hotspot/` | 中间文件都放这里，别污染根目录           |

用户没说就按默认走。只有"范围"确实无法从上下文推断时才问一句。

### 第 1 步 · 采集

**优先用脚本**（一次调用拿到多源结构化数据）：

```bash
mkdir -p hotspot
node "$SKILL/scripts/fetch.mjs" --hours 48 --limit 40 --out hotspot/raw.json
```

脚本会打印每个源的成功/失败。判据：**带坐标的候选不少于 10 条就可以往下走**。

**脚本失败或结果太少时**，改用 WebSearch 兜底：围绕「冲突 / 政治 / 经济 / 科技 / 气候灾害 / 社会」六个面向各检索 1–2 次，自己整理成候选列表。细节见 `references/sources.md`。

### 第 2 步 · 生成骨架

```bash
node "$SKILL/scripts/scaffold.mjs" --raw hotspot/raw.json --out hotspot/atlas.json --pick 14
```

产出是一份**合法但内容单薄**的 atlas.json：事件齐全，但 `entities` 和 `relations` 是空的。这样后续只需增量修改，不必从零手写 JSON。

若第 1 步走的是 WebSearch 兜底，跳过本步，直接按 `references/schema.md` 手写 atlas.json。

### 第 3 步 · 编辑 atlas.json（核心步骤）

只做三件事，做完就停：

1. **改写 `summary`**：每条 60–120 字，写清「谁 / 做了什么 / 为什么重要」。不要复述标题，不要堆形容词。
2. **补 `entities`**：15–30 个。类型只用 `person` / `org` / `country` / `place` / `topic`。宁少勿滥——只收真正在多条事件里出现的角色。
3. **补 `relations`**：30–60 条，把实体接到事件上、实体接到实体上。
4. **（可选）加高阶字段**：
   - `heatReasons`：3–4 条短语，解释"这事件为什么热"
   - `disputes`：同一事件不同来源的说法分歧，双栏对照
   - `simulation`：假设推演，如"若停火达成"会看到哪些事件缓解/恶化
   - `meta.story`：叙事导览步骤，用户点击播放后自动飞地球、高亮事件
   - `blindspots`：报道密度低的地区，标出"这里在烧但没人报"

`relations[].type` 只能取这七个值（写别的会被自动归类为 related）：

| type          | 含义                | 典型场景           |
| ------------- | ----------------- | -------------- |
| `participate` | 参与 / 主导 / 发动      | 某国参与谈判、某组织主导行动 |
| `stance`      | 表态 / 施压 / 谴责 / 支持 | 官员发声、政府声明      |
| `sanction`    | 制裁 / 封锁 / 对抗      | 出口管制、经济制裁      |
| `cooperate`   | 合作 / 会谈 / 签署 / 援助 | 双边协议、军事援助      |
| `cause`       | 导致 / 引发           | 事件 A 引发市场波动    |
| `located`     | 发生于 / 位于          | 事件发生地、实体所在地    |
| `related`     | 其他关联              | 兜底             |

三条硬规则，违反会直接毁掉图谱：

- **每个实体至少有一条边**。没有边的实体会变成图谱里飘着的孤点。
- **跨事件共享实体**。同一批国家/组织要出现在多条事件里，图才会连成一片；否则只是一堆互不相连的小团。
- **`relations` 里引用的 id 必须存在**。实体 id 用 `ent_` / `p_` / `org_` / `topic_` / `place_` 前缀，事件 id 保持 `evt_N`。

建模方法论与好/坏对照见 `references/graph-design.md`；字段完整定义见 `references/schema.md`。

### 第 4 步 · 构建

```bash
node "$SKILL/scripts/build.mjs" --data hotspot/atlas.json --out hotspot/全球热点图谱.html
```

构建前会自动校验，报错必须回去改数据，**不要用任何方式绕过校验**。警告（⚠）可以酌情忽略，但「N 个实体没有关系边」这类警告建议修掉。

### 第 5 步 · 交付

打开生成的 HTML，然后用 3–5 句话向用户说明：

- 时间窗与事件数量
- 最值得注意的 2–3 条主线（不是逐条罗列）
- 图上怎么操作（拖拽旋转、点光点看详情、按 G 展开关系图谱、按 S 播放叙事导览）
- 新功能提示（如存在）：点击事件可查看「分歧说法」「热度原因」「假设推演」

## 数据结构速查

```jsonc
{
  "meta": {
    "title", "window", "generated_at", "sources": [], "disclaimer",
    "story": { "title", "steps": [{ "eventId", "narration" }] }   // L1 叙事导览
  },
  "events": [{
    "id": "evt_1", "title", "short", "summary",
    "category": "conflict|politics|economy|tech|climate|society",
    "heat": 0-100, "severity": 1-5, "time": "ISO8601",
    "location": { "name", "lat", "lng" },
    "actors": ["ent_1", "p_2"], "topics": [], "sources": [{ "name", "title", "url" }],
    "heatReasons": ["涉及 3 个大国", "8 家媒体同日报道"],            // L3 可解释热度
    "disputes": [{ "claim", "sources": [{ "name", "stance", "quote" }] }], // L3 分歧对照
    "simulation": { "label", "effects": [{ "eventId", "type", "desc" }] }   // L2 假设推演
  }],
  "entities": [{ "id", "name", "type": "person|org|country|place|topic", "desc" }],
  "relations": [{ "source", "target", "type", "label", "weight": 1 }],
  "blindspots": [{ "name", "lat", "lng", "hint" }]                     // L3 新闻盲区
}
```

## 质量红线

1. **事实**：标题与 summary 必须有来源支撑。数字、伤亡、人名不确定就写「据报道」，绝不编造。聚合多个来源时优先采用通讯社口径。
2. **坐标**：定位到城市或地区中心即可，不要精确到建筑或军事设施。不标注军事禁区、不发布他人位置信息。
3. **地图合规**：本技能的 3D 地球是**纯物理陆地掩膜 + 点阵渲染**，不绘制任何国界线、行政区划或主权标注，因此不涉及边界表达问题。若用户另行要求真实底图或街道级地图，必须改用腾讯地图（默认代理模式），并遵守 `references/visual-spec.md` 中的合规约束。
4. **立场**：只陈述事实与各方公开表态，不做价值判断，不给事件"定性"。

## 脚本一览

| 脚本                        | 作用                 | 关键参数                                  |
| ------------------------- | ------------------ | ------------------------------------- |
| `scripts/fetch.mjs`       | 多源抓取 + 地名匹配 + 去重打分 | `--hours` `--limit` `--feeds` `--out` |
| `scripts/scaffold.mjs`    | 候选池 → 图谱骨架         | `--raw` `--out` `--pick`              |
| `scripts/build.mjs`       | 校验 + 编译单文件 HTML    | `--data` `--out` `--check`            |
| `tools/build-landmask.py` | 重新生成陆地掩膜（仅维护用）     | `--input`                             |

自检：想先确认环境是否正常，直接构建自带样例：

```bash
node "$SKILL/scripts/build.mjs" --data "$SKILL/assets/sample.json" --out /tmp/atlas-sample.html
```

## 排错

| 现象                        | 原因与处理                                               |
| ------------------------- | --------------------------------------------------- |
| `node: command not found` | 换用绝对路径；仍不可用则走 WebSearch 采集 + 手写 atlas.json，第 2 步可跳过 |
| 抓取全部源失败                   | 网络受限。转 WebSearch 兜底，不要卡在脚本上                         |
| 地球上一个点都没有                 | 事件缺 `location` 或经纬度非法。用 `--check` 看警告               |
| 图谱是一堆散点没有连线               | `relations` 为空或引用了不存在的 id。检查 id 拼写                  |
| 标签互相遮挡                    | 事件太多。把 `--pick` 降到 10–12，或合并同类事件                    |
| 打开是空白页                    | 确认文件完整（约 130KB），并用浏览器直接打开该 HTML                     |

## 项目结构

```
global-hotspot-atlas/
├── SKILL.md                 # 技能定义（工作流、规则）
├── assets/
│   ├── atlas/               # 地球 + 图谱 + 导览运行时（HTML/CSS/JS）
│   ├── gazetteer.json       # 约 130 个内置地名 + 坐标
│   └── sample.json          # 自检用样例 atlas
├── references/
│   ├── schema.md            # atlas.json 字段完整定义
│   ├── sources.md           # 新闻源与抓取策略
│   ├── graph-design.md      # 实体/关系建模方法论
│   └── visual-spec.md       # 地图合规约束
├── scripts/
│   ├── fetch.mjs            # 多源采集脚本
│   ├── scaffold.mjs         # 骨架生成脚本
│   └── build.mjs            # 校验 + 单文件构建脚本
└── tools/
    └── build-landmask.py    # 陆地掩膜重生成（维护用）
```
