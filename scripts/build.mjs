#!/usr/bin/env node
/**
 * build.mjs — 把「事件数据 JSON」编译为单文件 3D 地球图谱 HTML。
 *
 * 用法：
 *   node scripts/build.mjs --data atlas.json --out out/atlas.html
 *   node scripts/build.mjs --data atlas.json --check        # 仅校验
 *
 * 设计要点：
 *   - 输出是**完全自包含**的单文件 HTML（内联 CSS/JS/数据/陆地掩膜），
 *     无 CDN、无网络请求、可离线双击打开、可直接拖进浏览器分享。
 *   - 数据通过 <script type="application/json"> 注入，并对 "</" 做转义，
 *     避免正文里的 </script> 提前闭合标签。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ASSETS = join(ROOT, 'assets', 'atlas');

const CATS = ['conflict', 'politics', 'economy', 'tech', 'climate', 'society'];
const ENTS = ['person', 'org', 'country', 'place', 'topic'];

/* ── 参数 ─────────────────────────────────────────────── */
function parseArgs(argv) {
  const out = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') out.check = true;
    else if (a === '--data') out.data = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--title') out.title = argv[++i];
    else if (a === '--quiet') out.quiet = true;
  }
  return out;
}

/* ── 校验 ─────────────────────────────────────────────── */
function validate(data) {
  const errors = [];
  const warns = [];

  if (!data || typeof data !== 'object') return { errors: ['根节点不是对象'], warns };
  if (!data.meta || typeof data.meta !== 'object') errors.push('缺少 meta 对象');
  if (!Array.isArray(data.events) || !data.events.length) errors.push('events 必须是非空数组');
  if (!Array.isArray(data.entities)) warns.push('缺少 entities 数组（关系图谱将只剩事件节点）');
  if (!Array.isArray(data.relations)) warns.push('缺少 relations 数组（关系图谱将为空）');

  const evIds = new Set();
  (data.events || []).forEach((e, i) => {
    const tag = `events[${i}]`;
    if (!e || typeof e !== 'object') { errors.push(`${tag} 不是对象`); return; }
    if (!e.id) errors.push(`${tag} 缺少 id`);
    else if (evIds.has(e.id)) errors.push(`${tag} id 重复: ${e.id}`);
    else evIds.add(e.id);
    if (!e.title) errors.push(`${tag} 缺少 title`);
    if (e.category && !CATS.includes(e.category)) {
      warns.push(`${tag} category="${e.category}" 不在枚举内，将回落为 society`);
    }
    if (e.location) {
      if (!isFinite(e.location.lat) || !isFinite(e.location.lng)) {
        warns.push(`${tag} location 经纬度非法，该事件将不会出现在地球上`);
      } else if (Math.abs(e.location.lat) > 90 || Math.abs(e.location.lng) > 180) {
        errors.push(`${tag} location 超出经纬度范围`);
      }
    } else {
      warns.push(`${tag} 无 location，只出现在列表与图谱中`);
    }
    if (!e.summary) warns.push(`${tag} 缺少 summary（详情面板会显得单薄）`);
    if (e.heat != null && (e.heat < 0 || e.heat > 100)) warns.push(`${tag} heat 超出 0-100`);
  });

  const entIds = new Set();
  (data.entities || []).forEach((en, i) => {
    const tag = `entities[${i}]`;
    if (!en.id) errors.push(`${tag} 缺少 id`);
    else if (entIds.has(en.id)) errors.push(`${tag} id 重复: ${en.id}`);
    else entIds.add(en.id);
    if (!en.name) errors.push(`${tag} 缺少 name`);
    if (en.type && !ENTS.includes(en.type)) warns.push(`${tag} type="${en.type}" 不在枚举内，将回落为 topic`);
  });

  let dangling = 0;
  (data.relations || []).forEach((r, i) => {
    const tag = `relations[${i}]`;
    if (!r.source || !r.target) { errors.push(`${tag} 缺少 source/target`); return; }
    [r.source, r.target].forEach(id => {
      if (!evIds.has(id) && !entIds.has(id)) { dangling++; if (dangling <= 6) warns.push(`${tag} 引用了不存在的节点: ${id}`); }
    });
  });
  if (dangling > 6) warns.push(`…… 共 ${dangling} 条关系引用了不存在的节点（将被丢弃）`);

  // 孤立实体提示
  const used = new Set();
  (data.relations || []).forEach(r => { used.add(r.source); used.add(r.target); });
  (data.events || []).forEach(e => (e.actors || []).forEach(a => used.add(typeof a === 'string' ? a : a && a.id)));
  const orphan = (data.entities || []).filter(en => en.id && !used.has(en.id));
  if (orphan.length) warns.push(`${orphan.length} 个实体没有任何关系边，会成为图谱里的游离点：` +
    orphan.slice(0, 5).map(o => o.name).join('、'));

  return { errors, warns };
}

/* ── 主流程 ───────────────────────────────────────────── */
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.data) {
    console.error('用法: node scripts/build.mjs --data atlas.json [--out out/atlas.html] [--title "..."] [--check]');
    process.exit(2);
  }
  const dataPath = resolve(process.cwd(), args.data);
  if (!existsSync(dataPath)) {
    console.error(`找不到数据文件: ${dataPath}`);
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch (e) {
    console.error(`数据文件不是合法 JSON: ${e.message}`);
    process.exit(2);
  }

  const { errors, warns } = validate(data);
  if (!args.quiet) {
    warns.forEach(w => console.log('  ⚠ ' + w));
  }
  if (errors.length) {
    console.error('\n✗ 数据校验未通过：');
    errors.forEach(e => console.error('  · ' + e));
    process.exit(1);
  }
  if (args.check) {
    console.log(`✓ 校验通过：${data.events.length} 事件 / ${(data.entities || []).length} 实体 / ${(data.relations || []).length} 关系`);
    return;
  }

  const read = p => readFileSync(p, 'utf8');
  const css = read(join(ASSETS, 'atlas.css'));
  const js = [
    read(join(ASSETS, 'globe.js')),
    read(join(ASSETS, 'graph.js')),
    read(join(ASSETS, 'insight.js')),
    read(join(ASSETS, 'story.js')),
    read(join(ASSETS, 'app.js'))
  ].join('\n');
  const tpl = read(join(ASSETS, 'template.html'));
  const mask = read(join(ROOT, 'assets', 'landmask.b64')).trim();

  // 内联注入的护栏：资源里出现闭合标签会直接把页面打断
  if (/<\/script/i.test(js)) {
    console.error('✗ JS 源码中出现了 </script，内联后会提前闭合标签。请改写为 "<\\/script"。');
    process.exit(1);
  }
  if (/<\/style/i.test(css)) {
    console.error('✗ CSS 源码中出现了 </style，内联后会提前闭合标签。');
    process.exit(1);
  }

  const title = args.title || (data.meta && data.meta.title) || '全球热点图谱';
  // 安全注入：JSON 中的 "</" 必须转义，否则会提前闭合 <script>
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');

  let html = tpl;
  const put = (ph, val) => { html = html.split(ph).join(val); };
  put('__ATLAS_CSS__', css);
  put('__ATLAS_JS__', js);
  put('__ATLAS_DATA__', json);
  put('__LANDMASK_B64__', mask);
  put('__ATLAS_TITLE__', String(title).replace(/[<>]/g, ''));

  if (html.includes('__ATLAS_') || html.includes('__LANDMASK')) {
    console.error('✗ 模板占位符未完全替换，请检查 assets/atlas/template.html');
    process.exit(1);
  }

  const outPath = resolve(process.cwd(), args.out || 'atlas.html');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  if (!args.quiet) {
    console.log(`✓ 已生成 ${outPath}  (${kb} KB)`);
    console.log(`  ${data.events.length} 事件 · ${(data.entities || []).length} 实体 · ${(data.relations || []).length} 关系`);
  }
  console.log(outPath);
}

main();
