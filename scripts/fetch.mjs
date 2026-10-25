#!/usr/bin/env node
/**
 * fetch.mjs — 多源新闻抓取 + 地名定位 + 热度打分，输出「候选事件」JSON。
 *
 * 用法：
 *   node scripts/fetch.mjs --out raw.json
 *   node scripts/fetch.mjs --hours 24 --limit 30 --out raw.json
 *   node scripts/fetch.mjs --feeds my-feeds.json --out raw.json
 *
 * 设计要点：
 *   - 零依赖（Node 18+ 内置 fetch / TextDecoder），不需要任何 API Key。
 *   - 单一源失败不影响整体：每个源独立超时、独立计分，失败会在 meta.sources 里标注。
 *   - 产物是**候选池**，不是最终图谱数据；实体与关系由智能体在后续步骤归纳补全。
 *
 * 输出 schema：
 *   { meta: {...}, candidates: [ {title,url,source,published,category,heat,location,snippet} ] }
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* ── 默认新闻源 ────────────────────────────────────────── */
const DEFAULT_FEEDS = [
  { name: '中新网', url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', w: 0.8 },
  { name: '中新网·国际', url: 'https://www.chinanews.com.cn/rss/world.xml', w: 1.05 },
  { name: '人民网·国际', url: 'http://www.people.com.cn/rss/world.xml', w: 1.0 },
  { name: '新浪·国际', url: 'http://rss.sina.com.cn/news/world/focus15.xml', w: 0.9 },
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', w: 1.1 },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', w: 1.0 },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', w: 1.0 },
  { name: 'DW World', url: 'https://rss.dw.com/rdf/rss-en-world', w: 1.0 },
  { name: 'WSJ World', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', w: 1.05 },
  { name: 'Nikkei Asia', url: 'https://asia.nikkei.com/rss/feed/nar', w: 1.0 }
];

/* ── 分类规则 ──────────────────────────────────────────── */
const CAT_RULES = [
  ['conflict', /冲突|战争|空袭|交火|停火|军事|导弹|无人机|袭击|爆炸|恐袭|入侵|军演|演习|武装|难民|war\b|strike|attack|militant|ceasefire|troops|missile|drone|conflict|combat|invasion|refugee/gi],
  ['politics', /选举|议会|政府|总统|首相|外交|峰会|制裁|谈判|法案|弹劾|执政|在野|公投|election|parliament|president|diplomat|summit|sanction|vote|treaty|premier|coalition/gi],
  ['economy', /经济|通胀|利率|降息|加息|股市|油价|贸易|关税|央行|失业|债务|财政|汇率|楼市|inflation|interest rate|stocks|oil price|trade|tariff|central bank|recession|debt|currency|gdp/gi],
  ['tech', /芯片|人工智能|半导体|科技|算法|卫星|机器人|数据安全|网络攻击|量子|chip|semiconductor|artificial intelligence|\bAI\b|tech|cyber|satellite|robot|quantum/gi],
  ['climate', /气候|地震|洪水|台风|飓风|干旱|山火|海啸|排放|极端天气|火山|earthquake|flood|typhoon|hurricane|drought|wildfire|tsunami|climate|emission|volcano|heatwave/gi],
  ['society', /抗议|示威|罢工|移民|疫情|卫生|教育|住房|犯罪|枪击|人权|protest|strike action|migrant|outbreak|health|housing|crime|shooting|rights/gi]
];

const INTENSIFY = /突发|紧急|重大|死亡|遇难|宣布|历史性|罕见|breaking|dead|killed|major|emergency|historic|unprecedented|surge|collapse/gi;

/* 软新闻：展会/论坛/庆典一类，热度大幅下调，避免挤占真正的事件位 */
const SOFT = /展会|博览|交易会|广交会|进博会|服贸会|论坛|研讨会|峰会开幕|庆典|周年|致辞|演讲|招聘|促销|美食|旅游|赛事|演唱会|新书|票房|签约|揭牌|开工|竣工|荣获|获评|榜单|专访|大赛|健身|体育|演出|艺术家|画卷|赋能|观察：|纪事|侧记|暖闻/;

/* ── 工具 ──────────────────────────────────────────────── */
const decodeEntities = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const stripTags = s => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function pick(block, tag) {
  const m = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
  if (!m) return '';
  return stripTags(m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, ''));
}

function pickLink(block) {
  const plain = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  if (plain && stripTags(plain[1])) return stripTags(plain[1]);
  const atom = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return atom ? atom[1] : '';
}

function parseFeed(xml) {
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  const entries = blocks.length ? blocks : xml.split(/<entry[\s>]/i).slice(1);
  const out = [];
  for (const raw of entries) {
    const block = raw.split(/<\/item>|<\/entry>/i)[0];
    const title = pick(block, 'title');
    if (!title) continue;
    const dateStr = pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated') || pick(block, 'dc:date');
    const t = dateStr ? new Date(dateStr) : null;
    out.push({
      title,
      link: pickLink(block),
      desc: pick(block, 'description') || pick(block, 'summary') || pick(block, 'content:encoded'),
      time: t && !isNaN(t.getTime()) ? t : null
    });
  }
  return out;
}

async function fetchFeed(feed, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(feed.url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'application/rss+xml,application/xml,text/xml,*/*'
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    // 依据 charset 解码，兼容 GBK 源
    let charset = 'utf-8';
    const ct = res.headers.get('content-type') || '';
    const m1 = ct.match(/charset=([\w-]+)/i);
    if (m1) charset = m1[1].toLowerCase();
    const head = new TextDecoder('utf-8').decode(buf.slice(0, 400));
    const m2 = head.match(/encoding=["']([\w-]+)["']/i);
    if (m2) charset = m2[1].toLowerCase();
    let xml;
    try {
      xml = new TextDecoder(charset).decode(buf);
    } catch {
      xml = new TextDecoder('utf-8').decode(buf);
    }
    return { ok: true, items: parseFeed(xml) };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

/* ── 地名匹配 ──────────────────────────────────────────── */
function loadGazetteer() {
  const raw = JSON.parse(readFileSync(join(ROOT, 'assets', 'gazetteer.json'), 'utf8'));
  const list = [];
  for (const p of raw.places) {
    for (const alias of [p.k, ...(p.alt || [])]) {
      if (alias && alias.length >= 2) list.push({ alias, p });
    }
  }
  // 长名优先，避免「新加坡」被「新加」类短名抢先
  list.sort((a, b) => b.alias.length - a.alias.length);
  return list;
}

function geocode(text, gaz) {
  const lower = text.toLowerCase();
  let best = null;
  for (const g of gaz) {
    const hit = /[\u4e00-\u9fa5]/.test(g.alias)
      ? text.includes(g.alias)
      : lower.includes(g.alias.toLowerCase());
    if (hit) {
      if (!best || g.alias.length > best.alias.length) best = g;
      if (best && best.alias.length >= 6) break;
    }
  }
  if (!best) return null;
  return { name: best.p.k, lat: best.p.lat, lng: best.p.lng, country: best.p.c };
}

/* ── 打分与去重 ────────────────────────────────────────── */
function classify(text) {
  let best = 'society', bestScore = 0;
  for (const [cat, re] of CAT_RULES) {
    re.lastIndex = 0;
    const n = (text.match(re) || []).length;
    if (n > bestScore) { bestScore = n; best = cat; }
  }
  return { cat: best, hits: bestScore };
}

function scoreHeat(item, now) {
  const text = item.title + ' ' + (item.desc || '').slice(0, 120);
  const ageH = item.time ? Math.max(0, (now - item.time) / 3600000) : 24;
  const recency = Math.max(0, 26 - ageH * 0.55);
  INTENSIFY.lastIndex = 0;
  const intense = Math.min(18, (text.match(INTENSIFY) || []).length * 7);
  const catBonus = item.category === 'conflict' ? 8 : item.category === 'politics' ? 5 : 2;
  const locBonus = item.location ? 6 : 0;
  const w = (item.weight || 1) * 6;
  const soft = SOFT.test(item.title) ? 24 : 0;
  return Math.max(8, Math.min(99, Math.round(30 + recency + intense + catBonus + locBonus + w - soft)));
}

function normTitle(t) {
  return t.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
}

function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function similar(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ── 主流程 ────────────────────────────────────────────── */
function parseArgs(argv) {
  const o = { hours: 48, limit: 40, timeout: 9000, out: 'raw.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hours') o.hours = Number(argv[++i]);
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else if (a === '--feeds') o.feeds = argv[++i];
    else if (a === '--quiet') o.quiet = true;
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const feeds = args.feeds
    ? JSON.parse(readFileSync(resolve(process.cwd(), args.feeds), 'utf8'))
    : DEFAULT_FEEDS;

  const gaz = loadGazetteer();
  const now = Date.now();
  const windowMs = args.hours * 3600000;

  const results = await Promise.all(feeds.map(f => fetchFeed(f, args.timeout)));

  const pool = [];
  const status = [];
  results.forEach((r, i) => {
    const f = feeds[i];
    status.push({ name: f.name, ok: r.ok, items: r.items.length, error: r.error });
    if (!r.ok) return;
    for (const it of r.items) {
      if (it.time && now - it.time.getTime() > windowMs) continue;
      if (it.time && it.time.getTime() > now + 3600000) continue;
      const text = it.title + ' ' + (it.desc || '').slice(0, 200);
      const { cat } = classify(text);
      // 地名优先从标题取：正文里的地名常是"在沪""伦敦会场"这类噪声
      const loc = geocode(it.title, gaz) || geocode(it.title + ' ' + (it.desc || '').slice(0, 120), gaz);
      const item = {
        title: it.title,
        url: it.link,
        source: f.name,
        weight: f.w,
        published: it.time ? it.time.toISOString() : null,
        category: cat,
        location: loc,
        soft: SOFT.test(it.title),
        snippet: (it.desc || '').slice(0, 180),
        _norm: normTitle(it.title)
      };
      item.heat = scoreHeat(item, now);
      pool.push(item);
    }
  });

  // 去重：标题相似度 > 0.72 视为同一事件，合并来源
  const kept = [];
  for (const item of pool.sort((a, b) => b.heat - a.heat)) {
    const g = bigrams(item._norm);
    const dup = kept.find(k => similar(k._grams, g) > 0.72);
    if (dup) {
      if (!dup.also_from.includes(item.source)) dup.also_from.push(item.source);
      dup.heat = Math.min(99, dup.heat + 1);
      continue;
    }
    item._grams = g;
    item.also_from = [];
    kept.push(item);
  }

  const candidates = kept.slice(0, args.limit).map(x => ({
    title: x.title,
    url: x.url,
    source: x.source,
    also_from: x.also_from,
    published: x.published,
    category: x.category,
    heat: x.heat,
    soft: !!x.soft,
    location: x.location,
    snippet: x.snippet
  }));

  const okCount = status.filter(s => s.ok).length;
  const out = {
    meta: {
      generated_at: new Date().toISOString(),
      window_hours: args.hours,
      source_total: feeds.length,
      source_ok: okCount,
      raw_items: pool.length,
      candidates: candidates.length,
      sources: status
    },
    candidates
  };

  const outPath = resolve(process.cwd(), args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  if (!args.quiet) {
    console.log(`抓取完成：${okCount}/${feeds.length} 个源可用，原始 ${pool.length} 条 → 去重后 ${candidates.length} 条候选`);
    status.forEach(s => {
      console.log(`  ${s.ok ? '✓' : '✗'} ${s.name.padEnd(12, ' ')} ${s.ok ? s.items + ' 条' : s.error}`);
    });
    const noLoc = candidates.filter(c => !c.location).length;
    if (noLoc) console.log(`  ⚠ ${noLoc} 条候选未匹配到地名，需要智能体补充坐标或丢弃`);
    console.log(`\n输出：${outPath}`);
  }
  console.log(outPath);
}

main().catch(e => {
  console.error('抓取失败：', e.message);
  process.exit(1);
});
