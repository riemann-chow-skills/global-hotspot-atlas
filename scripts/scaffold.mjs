#!/usr/bin/env node
/**
 * scaffold.mjs — 把 fetch.mjs 的候选池转成符合图谱 schema 的「骨架文件」。
 *
 * 用法：
 *   node scripts/scaffold.mjs --raw raw.json --out atlas.json --pick 12
 *
 * 为什么要有这一步：
 *   直接让模型从零手写一整份 atlas.json 容易漏字段、id 对不上。
 *   先生成一份**合法但内容单薄**的骨架，模型只需在其上做增量修改
 *   （改写 summary、补 entities、补 relations），出错率显著下降，
 *   而且即使模型只完成一半，产物依然可渲染。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function parseArgs(argv) {
  const o = { raw: 'raw.json', out: 'atlas.json', pick: 12 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--raw') o.raw = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--pick') o.pick = Number(argv[++i]);
    else if (a === '--title') o.title = argv[++i];
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
const rawPath = resolve(process.cwd(), args.raw);
let raw;
try {
  raw = JSON.parse(readFileSync(rawPath, 'utf8'));
} catch (e) {
  console.error(`读取候选池失败：${e.message}`);
  process.exit(1);
}

const all = (raw.candidates || []);
// 优先用"硬新闻"（非展会/论坛/庆典类）；硬新闻不够时再回退到全量
const hard = all.filter(c => !c.soft);
const source = hard.filter(c => c.location).length >= 8 ? hard : all;
const cands = source.filter(c => c.location);
if (!cands.length) {
  console.error('候选池里没有带坐标的事件。请先用 --hours 放宽时间窗，或在抓取后手工补充坐标。');
  process.exit(1);
}
const dropped = all.length - cands.length;
const softDropped = source === hard ? all.filter(c => c.soft).length : 0;

/* 选取策略：先按热度排序，再做类别配额，保证地图上不会只有一个颜色 */
const CAT_QUOTA = { conflict: 5, politics: 3, economy: 3, tech: 2, climate: 2, society: 2 };
const used = {};
const picked = [];
for (const c of cands) {
  if (picked.length >= args.pick) break;
  const q = CAT_QUOTA[c.category] ?? 2;
  if ((used[c.category] || 0) >= q) continue;
  used[c.category] = (used[c.category] || 0) + 1;
  picked.push(c);
}
// 配额没用满就按热度补齐
for (const c of cands) {
  if (picked.length >= args.pick) break;
  if (!picked.includes(c)) picked.push(c);
}

const events = picked.map((c, i) => {
  const title = c.title.trim();
  return {
    id: 'evt_' + (i + 1),
    title,
    short: title.length > 16 ? title.slice(0, 16) : title,
    summary: c.snippet || '',
    category: c.category,
    heat: c.heat,
    severity: c.category === 'conflict' ? 4 : 3,
    time: c.published || new Date().toISOString(),
    location: { name: c.location.name, lat: c.location.lat, lng: c.location.lng },
    actors: [],
    topics: [],
    sources: [{ name: c.source, title: title, url: c.url }].concat(
      (c.also_from || []).map(s => ({ name: s, title: title, url: c.url }))
    )
  };
});

const atlas = {
  meta: {
    title: args.title || '全球热点图谱',
    scope: '全球',
    window: `近 ${raw.meta?.window_hours || 48} 小时`,
    generated_at: new Date().toISOString(),
    sources: Array.from(new Set((raw.meta?.sources || []).filter(s => s.ok).map(s => s.name))),
    disclaimer: '本图谱由公开报道聚合生成，事件定位为大致区域，仅供信息参考。'
  },
  events,
  entities: [],
  relations: []
};

const outPath = resolve(process.cwd(), args.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(atlas, null, 2), 'utf8');
console.log(`已生成骨架 ${outPath}：${events.length} 个事件（剔除无坐标 ${dropped} 条${softDropped ? `，过滤软新闻 ${softDropped} 条` : ''}）`);
console.log('下一步：补写 summary、新增 entities、用 relations 把实体与事件连起来。');
