# 数据契约 · atlas.json

渲染器只认这一份 schema。字段缺失时渲染器会降级而不是崩溃，但降级后的效果会明显变差，因此**尽量填满必填项**。

## 顶层

```jsonc
{
  "meta":       { ... },   // 必填
  "events":     [ ... ],   // 必填，至少 1 条
  "entities":   [ ... ],   // 强烈建议，否则图谱只有事件节点
  "relations":  [ ... ],   // 强烈建议，否则图谱没有连线
  "blindspots": [ ... ]    // L3 新闻盲区，可选
}
```

## meta

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 是 | 页面主标题，也会作为浏览器标题 |
| `window` | string | 否 | 时间窗描述，如 `近 48 小时`，显示在副标题 |
| `scope` | string | 否 | 范围描述，如 `全球` / `中东` |
| `generated_at` | ISO8601 | 否 | 生成时间，用于计算"几小时前" |
| `sources` | string[] | 否 | 数据来源名称，显示在左下角 |
| `disclaimer` | string | 否 | 免责说明 |
| `story` | object | 否 | L1 叙事导览 `{ title, steps:[{eventId, narration}] }` |

## events[]

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | 是 | 全局唯一，建议 `evt_1` `evt_2` |
| `title` | string | 是 | 完整标题，列表里最多显示两行 |
| `short` | string | 否 | 地球上的标签文字，建议 ≤ 12 字，不填则用 title 截断 |
| `summary` | string | 强烈建议 | 60–120 字。详情面板的主体内容 |
| `category` | enum | 是 | `conflict` `politics` `economy` `tech` `climate` `society`，非法值回落为 `society` |
| `heat` | number | 是 | 0–100，决定光点大小、排序、是否带脉冲环 |
| `severity` | number | 否 | 1–5，影响强度（当前版本仅存储，不参与渲染） |
| `time` | ISO8601 | 是 | 事件发生时间。写成 `2026-10-24T09:00:00Z` |
| `location` | object | 是 | `{ name, lat, lng }`。缺失则该事件不出现在地球上 |
| `actors` | string[] | 否 | 实体 id 数组。会自动生成"实体→事件"的 participate 关系 |
| `topics` | string[] | 否 | 话题标签 |
| `sources` | object[] | 否 | `{ name, title, url }`，详情面板底部展示 |
| `heatReasons` | string[] | 否 | L3 可解释热度，3–4 条理由短语 |
| `disputes` | object[] | 否 | L3 分歧点对照 `[{claim, sources:[{name, stance, quote}]}]` |
| `simulation` | object | 否 | L2 假设推演 `{ label, effects:[{eventId, type, desc}] }`，type 为 `ease`/`worsen`/`neutral` |

**location 注意事项**

- `lat` 范围 −90~90，`lng` 范围 −180~180。写反了（把经度写进 lat）会让点飞到奇怪的位置。
- `name` 是显示名，写「加沙地带」而不是「31.5,34.45」。
- 定位到城市/地区中心即可，不要精确到建筑、基地、住址。

## entities[]

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 建议前缀：`p_` 人物、`org_` 组织、`ent_` 国家、`place_` 地点、`topic_` 议题 |
| `name` | string | 是 | 显示名，中文优先 |
| `type` | enum | 是 | `person` `org` `country` `place` `topic`，非法值回落为 `topic` |
| `desc` | string | 否 | 一句话身份说明，鼠标悬停时显示 |

## relations[]

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source` | string | 是 | 起点 id（实体或事件） |
| `target` | string | 是 | 终点 id（实体或事件） |
| `type` | enum | 是 | 见下表，非法值回落为 `related` |
| `label` | string | 否 | 关系短语，如「要求先完成人员核验」 |
| `weight` | number | 否 | 默认 1。越大连线越粗，1–2 之间比较合适 |

`type` 与颜色的对应关系（渲染器内置）：

| type | 颜色 | 语义 |
|---|---|---|
| `participate` | 蓝 `#4d8dff` | 参与、主导、发动 |
| `stance` | 橙 `#ffab2e` | 表态、施压、谴责、支持 |
| `sanction` | 红 `#ff4d6a` | 制裁、封锁、对抗 |
| `cooperate` | 绿 `#2fd6a4` | 合作、会谈、援助 |
| `cause` | 紫 `#a06bff` | 因果、引发 |
| `located` | 灰蓝 `#5b6b80` | 发生于、位于 |
| `related` | 灰 `#6b7d95` | 其他关联 |

也接受中文/英文自由文本（如 `"参与谈判"`、`"sanctions"`），渲染器会按关键词自动归类，但**显式写枚举值更可靠**。

## 完整最小示例

```json
{
  "meta": {
    "title": "全球热点图谱",
    "window": "近 48 小时",
    "scope": "全球",
    "generated_at": "2026-10-25T10:00:00Z",
    "sources": ["中新网", "Reuters"],
    "disclaimer": "本图谱由公开报道聚合生成，仅供信息参考。"
  },
  "events": [
    {
      "id": "evt_1",
      "title": "加沙停火谈判进入第二阶段",
      "short": "加沙停火谈判",
      "summary": "斡旋方提出分阶段停火框架，第二阶段涉及被扣押人员交换与北部人道通道扩容。以色列要求先完成人员核验，联合国称当地面粉储备仅够维持一周。",
      "category": "conflict",
      "heat": 92,
      "severity": 5,
      "time": "2026-10-25T06:20:00Z",
      "location": { "name": "加沙地带", "lat": 31.50, "lng": 34.45 },
      "actors": ["ent_israel", "p_netanyahu", "org_un", "topic_ceasefire"],
      "topics": ["停火谈判"],
      "sources": [{ "name": "Reuters", "title": "Gaza truce talks enter second phase", "url": "https://www.reuters.com/" }]
    }
  ],
  "entities": [
    { "id": "ent_israel", "name": "以色列", "type": "country", "desc": "停火谈判当事方" },
    { "id": "p_netanyahu", "name": "内塔尼亚胡", "type": "person", "desc": "以色列总理" },
    { "id": "org_un", "name": "联合国", "type": "org", "desc": "人道协调方" },
    { "id": "topic_ceasefire", "name": "停火谈判", "type": "topic", "desc": "分阶段停火方案" }
  ],
  "relations": [
    { "source": "p_netanyahu", "target": "ent_israel", "type": "participate", "label": "以色列总理", "weight": 1.4 },
    { "source": "ent_israel", "target": "topic_ceasefire", "type": "participate", "label": "参与谈判", "weight": 1.8 },
    { "source": "org_un", "target": "evt_1", "type": "participate", "label": "人道协调", "weight": 1.5 },
    { "source": "p_netanyahu", "target": "evt_1", "type": "stance", "label": "要求先核验人员", "weight": 1.6 }
  ]
}
```

## 常见错误

| 错误 | 后果 | 修法 |
|---|---|---|
| `relations` 引用了不存在的 id | 该条边被丢弃，可能出现孤点 | 用 `--check` 看警告，逐个核对拼写 |
| `actors` 里写实体名而不是 id | 渲染器会自动补一个同名 topic 实体，图上出现重复节点 | 统一写 id |
| 所有 `heat` 都写 80 | 光点一样大，没有视觉层次 | 按真实热度拉开差距，最高 90+，最低 40 左右 |
| 所有事件都放在同一城市 | 光点重叠成一坨 | 尽量用真实发生地；同城事件可细分到区域 |
| `time` 写成 `2026/10/25` | `new Date()` 解析失败，显示为空 | 统一 ISO8601 |
| 实体名太长（> 12 字） | 图谱标签被截断 | 用通用简称，全称放 `desc` |
