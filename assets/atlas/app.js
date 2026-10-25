/* ══════════════════════════════════════════════════════════
   App — 数据规范化 · 视图装配 · 交互编排
   L0 快照 / L1 过程（时间轴·导览）/ L2 推演（传导链·情景）/ L3 判断（分歧·盲区·可解释热度）
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CAT_LABEL = {
    conflict: '冲突', politics: '政治', economy: '经济',
    tech: '科技', climate: '气候灾害', society: '社会'
  };
  const CAT = window.ATLAS_CAT;
  const INS = window.ATLAS_INSIGHT;
  const LEVEL_COL = ['#4d8dff', '#a06bff', '#ffab2e'];
  const TYPE_LABEL = {
    person: '人物', org: '组织', country: '国家/地区',
    place: '地点', topic: '议题', event: '事件'
  };
  const REL_LABEL = {
    participate: '参与', stance: '表态', sanction: '制裁',
    cooperate: '合作', cause: '引发', located: '位于', related: '关联'
  };

  const REL_RULES = [
    [/制裁|封锁|禁运|sanction|embargo/i, 'sanction'],
    [/表态|声明|谴责|支持|反对|呼吁|警告|批评|承认|拒绝|stance|condemn|statement|urge|warn|back/i, 'stance'],
    [/合作|会谈|协议|签署|访问|磋商|谈判|cooperat|meet|agree|sign|visit|talk|deal/i, 'cooperate'],
    [/导致|引发|造成|促成|trigger|caus|lead to|spark|result/i, 'cause'],
    [/位于|发生于|发生在|located|based in/i, 'located'],
    [/参与|参加|主导|发动|领导|负责|negotiat|participat|involve|lead|head/i, 'participate']
  ];

  function normRel(t) {
    if (!t) return 'related';
    const s = String(t);
    if (window.ATLAS_REL_COLOR[s]) return s;
    for (const [re, key] of REL_RULES) if (re.test(s)) return key;
    return 'related';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function ago(iso) {
    const t = new Date(iso).getTime();
    if (!isFinite(t)) return '';
    const d = Math.max(0, Date.now() - t) / 1000;
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' 分钟前';
    if (d < 86400) return Math.round(d / 3600) + ' 小时前';
    if (d < 86400 * 7) return Math.round(d / 86400) + ' 天前';
    return new Date(t).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  }

  function absTime(iso) {
    const t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) +
      ' ' + p(t.getHours()) + ':' + p(t.getMinutes());
  }

  const shortTime = iso => {
    const t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return p(t.getMonth() + 1) + '/' + p(t.getDate()) + ' ' + p(t.getHours()) + ':' + p(t.getMinutes());
  };

  /* ── 数据规范化 ─────────────────────────────────────── */
  function normalize(raw) {
    const meta = raw.meta || {};
    const events = (raw.events || []).map((e, i) => {
      const id = e.id || 'evt_' + i;
      const cat = CAT[e.category] ? e.category : 'society';
      const time = e.time || meta.generated_at || new Date().toISOString();
      return {
        id: id,
        title: e.title || '未命名事件',
        short: e.short || e.title || '',
        summary: e.summary || '',
        category: cat,
        heat: Math.max(0, Math.min(100, Number(e.heat) || 40)),
        severity: Number(e.severity) || 3,
        time: time,
        _ts: new Date(time).getTime() || 0,
        location: e.location && isFinite(e.location.lat) && isFinite(e.location.lng) ? {
          name: e.location.name || '', lat: +e.location.lat, lng: +e.location.lng
        } : null,
        actors: Array.isArray(e.actors) ? e.actors : [],
        topics: Array.isArray(e.topics) ? e.topics : [],
        sources: Array.isArray(e.sources) ? e.sources : [],
        timeline: Array.isArray(e.timeline) ? e.timeline.filter(x => x && x.t) : [],
        disputes: Array.isArray(e.disputes) ? e.disputes.filter(x => x && x.claim) : [],
        heat_reasons: Array.isArray(e.heat_reasons) ? e.heat_reasons : []
      };
    });

    const entMap = new Map();
    (raw.entities || []).forEach((en, i) => {
      const id = en.id || 'ent_' + i;
      entMap.set(id, {
        id: id,
        name: en.name || id,
        type: TYPE_LABEL[en.type] ? en.type : 'topic',
        desc: en.desc || '',
        aliases: en.aliases || []
      });
    });
    events.forEach(ev => {
      ev.actors.forEach(a => {
        if (typeof a === 'string' && !entMap.has(a)) {
          entMap.set(a, { id: a, name: a, type: 'topic', desc: '', aliases: [] });
        }
      });
    });

    const rels = [];
    const seen = new Set();
    const pushRel = (s, t, type, label, weight) => {
      if (!s || !t || s === t) return;
      const key = s + '>' + t + '>' + type;
      if (seen.has(key)) return;
      seen.add(key);
      rels.push({ source: s, target: t, type: type, label: label || '', weight: weight || 1 });
    };
    (raw.relations || []).forEach(r => {
      pushRel(r.source, r.target, normRel(r.type), r.label, r.weight);
    });
    events.forEach(ev => {
      ev.actors.forEach(a => {
        const aid = typeof a === 'string' ? a : a && a.id;
        if (aid) pushRel(aid, ev.id, 'participate', '', 1.2);
      });
    });

    // L1 叙事导览：过滤掉指向不存在事件的步骤
    const evIds = new Set(events.map(e => e.id));
    const story = (Array.isArray(raw.story) ? raw.story : [])
      .filter(s => s && evIds.has(s.eventId))
      .map((s, i) => ({ step: i + 1, eventId: s.eventId, narration: s.narration || '', graph: !!s.graph }));

    // L2 情景推演
    const scenarios = (Array.isArray(raw.scenarios) ? raw.scenarios : [])
      .filter(s => s && s.id && s.label)
      .map(s => ({
        id: s.id, label: s.label, note: s.note || '',
        dampen: Array.isArray(s.dampen) ? s.dampen : [],
        amplify: Array.isArray(s.amplify) ? s.amplify : []
      }));

    return {
      meta: meta, events: events,
      entities: Array.from(entMap.values()),
      relations: rels, story: story, scenarios: scenarios
    };
  }

  /* ── 装配 ───────────────────────────────────────────── */
  const DATA = normalize(JSON.parse(document.getElementById('atlas-data').textContent || '{}'));
  const MASK = document.getElementById('landmask').textContent;

  const state = {
    cat: 'all',
    selected: null,
    drawer: false,
    cascade: false,
    blind: false,
    scenario: null,
    time: Infinity,
    cascadeData: null,
    _activeCount: -1
  };

  const $ = s => document.querySelector(s);

  const evById = new Map(DATA.events.map(e => [e.id, e]));
  const entById = new Map(DATA.entities.map(e => [e.id, e]));
  const relByEvent = new Map();
  DATA.relations.forEach(r => {
    [r.source, r.target].forEach(id => {
      if (!relByEvent.has(id)) relByEvent.set(id, []);
      relByEvent.get(id).push(r);
    });
  });

  function relatedEvents(evId) {
    const ev = evById.get(evId);
    if (!ev) return [];
    const score = new Map();
    const myEnts = new Set(ev.actors.filter(a => typeof a === 'string'));
    (relByEvent.get(evId) || []).forEach(r => {
      const other = r.source === evId ? r.target : r.source;
      if (evById.has(other)) score.set(other, (score.get(other) || 0) + 2);
    });
    DATA.events.forEach(o => {
      if (o.id === evId) return;
      let shared = 0;
      o.actors.forEach(a => { if (myEnts.has(a)) shared++; });
      if (shared) score.set(o.id, (score.get(o.id) || 0) + shared);
    });
    return Array.from(score.entries())
      .map(([id, s]) => ({ ev: evById.get(id), s: s }))
      .filter(x => x.ev)
      .sort((a, b) => b.s - a.s || (b.ev.heat || 0) - (a.ev.heat || 0))
      .slice(0, 5);
  }

  function entitiesOf(ev) {
    return (ev.actors || [])
      .map(a => (typeof a === 'string' ? entById.get(a) : null))
      .filter(Boolean);
  }

  /* ── 头部 ───────────────────────────────────────────── */
  function renderHeader() {
    const m = DATA.meta;
    const sub = [];
    if (m.window) sub.push(m.window);
    if (m.generated_at) sub.push('生成于 ' + absTime(m.generated_at));
    if (m.scope) sub.push(m.scope);
    $('#subtitle').textContent = sub.join(' · ') || '实时全球事件态势';

    $('#stats').innerHTML = [
      ['事件', DATA.events.length],
      ['实体', DATA.entities.length],
      ['关系', DATA.relations.length],
      ['区域', new Set(DATA.events.filter(e => e.location).map(e => e.location.name)).size]
    ].map(([k, v]) => '<div class="stat"><b>' + v + '</b><span>' + k + '</span></div>').join('');

    const srcs = new Set();
    DATA.events.forEach(e => (e.sources || []).forEach(s => s && s.name && srcs.add(s.name)));
    (m.sources || []).forEach(s => srcs.add(s));
    $('#sources').innerHTML = srcs.size
      ? '数据来源 · <b>' + Array.from(srcs).slice(0, 6).map(esc).join(' / ') + '</b>'
      : '数据来源 · <b>综合公开报道</b>';

    const cats = new Set(DATA.events.map(e => e.category));
    const present = ['conflict', 'politics', 'economy', 'tech', 'climate', 'society'].filter(c => cats.has(c));
    $('#legend').innerHTML = present.map(c =>
      '<div class="lg-row"><i style="background:' + CAT[c] + ';box-shadow:0 0 8px ' + CAT[c] + '"></i>' + CAT_LABEL[c] + '</div>'
    ).join('');

    const relTypes = new Set(DATA.relations.map(r => r.type));
    const REL_LABEL_LONG = {
      participate: '参与/主导', stance: '表态/施压', sanction: '制裁/对抗',
      cooperate: '合作/接触', cause: '因果/引发', located: '发生于', related: '其他关联'
    };
    $('#rel-legend').innerHTML = Array.from(relTypes).slice(0, 5).map(t =>
      '<i><b style="border-color:' + (window.ATLAS_REL_COLOR[t] || '#6b7d95') + '"></b>' + (REL_LABEL_LONG[t] || t) + '</i>'
    ).join('');
  }

  /* ── 左栏 ───────────────────────────────────────────── */
  function renderFilters() {
    const cats = new Set(DATA.events.map(e => e.category));
    const order = ['conflict', 'politics', 'economy', 'tech', 'climate', 'society'].filter(c => cats.has(c));
    const items = [['all', '全部', '#8fa6c0']].concat(order.map(c => [c, CAT_LABEL[c], CAT[c]]));
    $('#filters').innerHTML = items.map(([k, label, col]) =>
      '<button class="chip' + (state.cat === k ? ' on' : '') + '" data-cat="' + k + '" type="button">' +
      (k === 'all' ? '' : '<i style="color:' + col + '"></i>') + label + '</button>'
    ).join('');
    $('#filters').querySelectorAll('.chip').forEach(b => {
      b.onclick = () => {
        state.cat = b.dataset.cat;
        renderFilters(); renderList(); applyFilter();
      };
    });
  }

  function visibleEvents() {
    let list = DATA.events.slice().sort((a, b) => (b.heat || 0) - (a.heat || 0));
    if (state.cat !== 'all') list = list.filter(e => e.category === state.cat);
    if (state.time !== Infinity) list = list.filter(e => e._ts <= state.time);
    return list;
  }

  function renderList() {
    const list = visibleEvents();
    const total = DATA.events.length;
    const suffix = state.time !== Infinity ? ' · 截至时间轴' : '';
    $('#rail-count').textContent = list.length + ' / ' + total + ' 个事件' + suffix;
    $('#list').innerHTML = list.map(e => {
      const c = CAT[e.category];
      const loc = e.location ? e.location.name : '全球';
      const blind = INS.isBlind(e);
      const flags = (blind ? '<span class="flag flag-blind">低覆盖</span>' : '') +
        (e.disputes.length ? '<span class="flag flag-disp">分歧 ' + e.disputes.length + '</span>' : '');
      return '<article class="item' + (state.selected === e.id ? ' on' : '') + '" data-id="' + e.id + '" style="--c:' + c + '">' +
        '<div class="item-hd">' +
        '<span class="item-tag">' + (CAT_LABEL[e.category] || '') + '</span>' +
        '<span class="item-flags">' + flags + '</span>' +
        '<span class="item-time">' + ago(e.time) + '</span>' +
        '</div>' +
        '<div class="item-t">' + esc(e.title) + '</div>' +
        '<div class="item-ft">' +
        '<span class="item-loc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>' +
        '<span>' + esc(loc) + '</span></span>' +
        '<span class="heat"><span class="heat-bar"><i style="width:' + Math.max(6, e.heat) + '%"></i></span>' +
        '<em>' + Math.round(e.heat) + '</em></span>' +
        '</div></article>';
    }).join('') || '<div style="padding:30px 12px;color:#5d6f87;font-size:12px;text-align:center">该条件下暂无事件</div>';

    $('#list').querySelectorAll('.item').forEach(el => {
      el.onclick = () => {
        selectEvent(el.dataset.id, true);
        if (window.innerWidth <= 880) $('.rail').classList.remove('open');
      };
    });
  }

  /* ── 详情面板 ───────────────────────────────────────── */
  function renderPanel(ev) {
    const c = CAT[ev.category];
    const ents = entitiesOf(ev);
    const related = relatedEvents(ev.id);

    const rels = (relByEvent.get(ev.id) || [])
      .map(r => {
        const otherId = r.source === ev.id ? r.target : r.source;
        const oe = evById.get(otherId);
        const oen = entById.get(otherId);
        if (oe) return { type: r.type, name: oe.title, sub: CAT_LABEL[oe.category] + ' · ' + ago(oe.time), ev: oe.id };
        if (oen) return { type: r.type, name: oen.name, sub: oen.desc || TYPE_LABEL[oen.type], ev: null };
        return null;
      })
      .filter(Boolean)
      .filter((() => {
        const seen = new Set();
        return r => { if (seen.has(r.name)) return false; seen.add(r.name); return true; };
      })());

    /* L3 可解释热度 */
    const reasons = INS.heatReasons(ev, { relatedCount: related.length });
    const heatBlock =
      '<div class="p-sec"><div class="p-sec-h">热度</div>' +
      '<div class="p-heat"><b>' + Math.round(ev.heat) + '</b><span>／100 · 严重度 ' + ev.severity + '/5</span></div>' +
      (reasons.length ? '<div class="p-why">' + reasons.map((r, i) =>
        '<i' + (i === 0 ? ' class="hot"' : '') + '>' + esc(r) + '</i>').join('') + '</div>' : '') +
      '</div>';

    /* L1 演化节点 */
    const tlBlock = ev.timeline.length
      ? '<div class="p-sec"><div class="p-sec-h">演化节点</div><div class="cascade-list">' +
        ev.timeline.map(x =>
          '<div class="cascade-lv"><em style="background:rgba(77,163,255,.14);color:#8fc4ff">' + esc(shortTime(x.t)) + '</em>' +
          '<span><b style="color:#eaf3ff;font-weight:500">' + esc(x.state || '进展') + '</b>' +
          (x.note ? ' · ' + esc(x.note) : '') + '</span></div>').join('') +
        '</div></div>'
      : '';

    /* L2 传导链 */
    let casBlock = '';
    const cd = state.cascadeData;
    if (state.cascade && cd && cd.levels.size) {
      const groups = INS.groupByLevel(cd.levels, id => {
        const e2 = evById.get(id), n2 = entById.get(id);
        return e2 ? (e2.short || e2.title) : (n2 ? n2.name : id);
      });
      casBlock = '<div class="p-sec"><div class="p-sec-h">传导链</div><div class="cascade-list">' +
        groups.map((g, gi) =>
          '<div class="cascade-lv"><em style="background:' + LEVEL_COL[gi] + '22;color:' + LEVEL_COL[gi] + '">' +
          (gi + 1) + ' 级</em><span>' + g.map(x => esc(x.name)).join('、') + '</span></div>').join('') +
        '</div></div>';
    }

    /* L3 信源分歧 */
    const dispBlock = ev.disputes.length
      ? '<div class="p-sec"><div class="p-sec-h">信源分歧</div>' +
        ev.disputes.map(d =>
          '<div class="disp"><div class="disp-claim">' + esc(d.claim) + '</div>' +
          (d.sources || []).map(s =>
            '<div class="disp-row"><span class="disp-src">' + esc(s.name || '—') + '</span>' +
            '<span class="disp-st"><b>' + esc(s.stance || '') + '</b>' + (s.note ? ' · ' + esc(s.note) : '') + '</span></div>'
          ).join('') + '</div>').join('') +
        '</div>'
      : '';

    const html =
      '<span class="p-cat" style="--c:' + c + '"><i></i>' + (CAT_LABEL[ev.category] || '') + '</span>' +
      '<h2 class="p-title">' + esc(ev.title) + '</h2>' +
      '<div class="p-meta">' +
      (ev.location ? '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>' + esc(ev.location.name) + '</span>' : '') +
      '<span>' + absTime(ev.time) + '</span>' +
      '<span>' + INS.coverage(ev) + ' 家来源</span>' +
      '</div>' +
      (ev.summary ? '<div class="p-sec"><div class="p-sec-h">事件概要</div><p class="p-sum">' + esc(ev.summary) + '</p></div>' : '') +
      heatBlock +
      tlBlock +
      casBlock +
      (ents.length ? '<div class="p-sec"><div class="p-sec-h">关键实体</div><div class="ent-wrap">' +
        ents.map(en => '<button class="ent" data-ent="' + en.id + '" type="button">' +
          '<i style="background:' + (window.ATLAS_TYPE_COLOR[en.type] || '#8a94a8') + '"></i>' +
          esc(en.name) + '<em>' + (TYPE_LABEL[en.type] || '') + '</em></button>').join('') +
        '</div></div>' : '') +
      (rels.length ? '<div class="p-sec"><div class="p-sec-h">关系脉络</div><div class="rel-list">' +
        rels.slice(0, 8).map(r => '<div class="rel-item"' + (r.ev ? ' data-ev="' + r.ev + '"' : '') + '>' +
          '<span class="rt" style="color:' + (window.ATLAS_REL_COLOR[r.type] || '#9db0c8') + '">' +
          (REL_LABEL[r.type] || '关联') +
          '</span><span class="rn">' + esc(r.name) + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</span></div>').join('') +
        '</div></div>' : '') +
      dispBlock +
      (related.length ? '<div class="p-sec"><div class="p-sec-h">关联事件</div><div class="rel-list">' +
        related.map(x => '<div class="rel-item" data-ev="' + x.ev.id + '">' +
          '<span class="rt" style="color:' + CAT[x.ev.category] + '">' + (CAT_LABEL[x.ev.category] || '') + '</span>' +
          '<span class="rn">' + esc(x.ev.title) + '<small>' + esc(x.ev.location ? x.ev.location.name : '全球') + ' · ' + ago(x.ev.time) + '</small></span>' +
          '</div>').join('') + '</div></div>' : '') +
      (ev.sources.length ? '<div class="p-sec"><div class="p-sec-h">信息来源</div><div class="src-list">' +
        ev.sources.slice(0, 6).map(s => s.url
          ? '<a class="src-a" href="' + esc(s.url) + '" target="_blank" rel="noopener"><span>' + esc(s.title || s.name || s.url) + '</span><em>' + esc(s.name || '') + '</em></a>'
          : '<div class="src-a"><span>' + esc(s.title || s.name || '') + '</span></div>').join('') +
        '</div></div>' : '') +
      '<div class="p-acts">' +
      '<button class="btn" id="p-graph" type="button">在图谱中展开</button>' +
      '<button class="btn" id="p-cascade" type="button">' + (state.cascade ? '关闭传导链' : '看传导链') + '</button>' +
      '</div>';

    $('#panel-body').innerHTML = html;
    $('#panel').classList.add('open');
    $('#panel').setAttribute('aria-hidden', 'false');

    $('#panel-body').querySelectorAll('[data-ev]').forEach(el => {
      el.onclick = () => selectEvent(el.dataset.ev, true);
    });
    $('#panel-body').querySelectorAll('[data-ent]').forEach(el => {
      el.onclick = () => { openDrawer(); setGraphFocus(el.dataset.ent); };
    });
    const pg = $('#p-graph'); if (pg) pg.onclick = () => { openDrawer(); setGraphFocus(ev.id); };
    const pc = $('#p-cascade'); if (pc) pc.onclick = () => toggleCascade();
  }

  function closePanel() {
    $('#panel').classList.remove('open');
    $('#panel').setAttribute('aria-hidden', 'true');
    state.selected = null;
    globe.setSelected(null);
    globe.setPanelOffset(0);
    setGraphFocus(null);
    setCascadeState(false);
    renderList();
  }

  /* ── 选中 ───────────────────────────────────────────── */
  function selectEvent(id, fly) {
    const ev = evById.get(id);
    if (!ev) return;
    state.selected = id;
    globe.setSelected(id);
    globe.setPanelOffset(window.innerWidth > 880 ? 376 : 0);
    renderList();
    applyCascade();
    renderPanel(ev);
    setGraphFocus(id);
    if (fly && ev.location) locate(ev);
    const el = $('#list').querySelector('.item[data-id="' + id + '"]');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function locate(ev) {
    if (!ev.location) return;
    globe.focusOn(ev.location.lat, ev.location.lng);
    globe.zoomTarget = Math.max(1.12, globe.zoomTarget);
  }

  /* ── L2 传导链 ──────────────────────────────────────── */
  function applyCascade() {
    if (!state.cascade || !state.selected) {
      state.cascadeData = null;
      globe.setCascade(null);
      graph.setCascade(null);
      return;
    }
    const c = INS.cascade(state.selected, DATA.relations, 3);
    state.cascadeData = c;
    const on = c.levels.size > 0;
    globe.setCascade(on ? c : null);
    graph.setCascade(on ? c : null);
  }

  function toggleCascade() {
    if (!state.selected) {
      const top = visibleEvents()[0];
      if (!top) return;
      state.cascade = true;
      $('#btn-cascade').setAttribute('aria-pressed', 'true');
      selectEvent(top.id, true);
      return;
    }
    setCascadeState(!state.cascade);
  }

  function setCascadeState(on) {
    state.cascade = on;
    $('#btn-cascade').setAttribute('aria-pressed', String(on));
    applyCascade();
    if (state.selected) renderPanel(evById.get(state.selected));
  }

  /* ── L2 情景推演 ────────────────────────────────────── */
  function renderScenarioBar() {
    const bar = $('#scenario-bar');
    if (!DATA.scenarios.length) { bar.innerHTML = ''; return; }
    bar.innerHTML = '<span class="sc-label">情景</span>' +
      '<button class="sc-chip' + (state.scenario ? '' : ' on') + '" data-sc="" type="button">基准</button>' +
      DATA.scenarios.map(s =>
        '<button class="sc-chip' + (state.scenario === s.id ? ' on' : '') + '" data-sc="' + esc(s.id) + '" type="button">' +
        esc(s.label) + '</button>').join('');
    bar.querySelectorAll('.sc-chip').forEach(b => {
      b.onclick = () => applyScenario(b.dataset.sc || null);
    });
  }

  function applyScenario(id) {
    state.scenario = id;
    const sc = DATA.scenarios.find(s => s.id === id);
    if (!sc) {
      globe.setScenario(null);
      graph.setScenario(null);
      scNote.classList.remove('on');
    } else {
      const o = { dampen: new Set(sc.dampen), amplify: new Set(sc.amplify) };
      globe.setScenario(o);
      graph.setScenario(o);
      scNote.innerHTML = '<b>' + esc(sc.label) + '</b>' + (sc.note ? ' · ' + esc(sc.note) : '');
      scNote.classList.add('on');
    }
    renderScenarioBar();
  }

  /* ── L3 报道盲区 ────────────────────────────────────── */
  function applyBlind(on) {
    state.blind = on;
    $('#btn-blind').setAttribute('aria-pressed', String(on));
    const card = $('#blind-card');
    if (!on) {
      globe.setBlind(false);
      card.classList.remove('on');
      return;
    }
    const cells = INS.densityGrid(DATA.events, 15);
    const ids = new Set(DATA.events.filter(INS.isBlind).map(e => e.id));
    globe.setBlind(true, cells, ids);
    if (ids.size) {
      const names = DATA.events.filter(e => ids.has(e.id)).slice(0, 3).map(e => e.short || e.title);
      card.innerHTML = '<h4>报道盲区</h4><p><b>' + ids.size + ' 个高严重度事件</b>来源不足 3 家：' +
        esc(names.join('、')) + (ids.size > 3 ? ' 等' : '') + '。气泡越大表示该区域报道越密集。</p>';
      card.classList.add('on');
    } else {
      card.innerHTML = '<h4>报道盲区</h4><p>当前数据中没有"高严重度但低覆盖"的事件。</p>';
      card.classList.add('on');
    }
  }

  /* ── 过滤 / 时间 ────────────────────────────────────── */
  function applyFilter() {
    const cat = state.cat;
    globe.setFilter(cat === 'all' ? null : (e => e.category === cat));
    graph.setFilter(cat === 'all' ? null : (nd => nd.type === 'event' ? nd.category === cat : true));
  }

  function applyTime(t) {
    state.time = t;
    const f = ev => ev._ts <= t;
    globe.setTimeFilter(f);
    graph.setTimeFilter(f);
    const n = DATA.events.filter(f).length;
    if (n !== state._activeCount) {
      state._activeCount = n;
      renderList();
    }
  }

  /* ── 抽屉 ───────────────────────────────────────────── */
  function openDrawer() {
    state.drawer = true;
    $('#drawer').classList.add('open');
    document.body.classList.add('drawer-open');
    $('#btn-graph').setAttribute('aria-pressed', 'true');
    globe.setViewport(0.56, -0.21);
    setTimeout(() => graph.resize(), 320);
  }
  function closeDrawer() {
    state.drawer = false;
    $('#drawer').classList.remove('open');
    document.body.classList.remove('drawer-open');
    $('#btn-graph').setAttribute('aria-pressed', 'false');
    globe.setViewport(1, 0);
  }

  function setGraphFocus(id) {
    graph.setFocus(id);
    const nd = id ? graph.nodes.find(n => n.id === id) : null;
    $('#graph-sub').textContent = nd
      ? '聚焦 · ' + nd.name + ' ｜ 点击空白返回全图'
      : DATA.entities.length + ' 实体 · ' + DATA.relations.length + ' 条关系';
  }

  /* ── 启动 ───────────────────────────────────────────── */
  const globe = new window.Globe(document.getElementById('globe'), MASK, {
    onSelect: (e) => selectEvent(e.id, false),
    onBlank: () => { if (state.selected) closePanel(); },
    onHover: (e, x, y) => {
      const tip = $('#tooltip');
      if (!e) { tip.classList.remove('on'); return; }
      tip.classList.add('on');
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
      const flags = (INS.isBlind(e) ? ' · 低覆盖' : '') + (e.disputes.length ? ' · 分歧 ' + e.disputes.length : '');
      tip.innerHTML = '<b style="color:' + CAT[e.category] + '">' + (CAT_LABEL[e.category] || '') + '</b>' +
        esc(e.short || e.title) +
        '<div class="tt-m">' + esc(e.location ? e.location.name : '') + ' · 热度 ' + Math.round(e.heat) + flags + '</div>';
    },
    onHoverMove: (x, y) => {
      const tip = $('#tooltip');
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    },
    getRelated: (id) => relatedEvents(id).map(x => ({ id: x.ev.id, type: 'related' }))
  });
  globe.setData(DATA.events);

  const graph = new window.RelGraph(document.getElementById('graph'), document.getElementById('gtip'));
  const gNodes = DATA.events.map(e => ({
    id: e.id, name: e.short || e.title, type: 'event', typeLabel: '事件',
    category: e.category, color: CAT[e.category], heat: e.heat, desc: e.location ? e.location.name : ''
  })).concat(DATA.entities.map(en => ({
    id: en.id, name: en.name, type: en.type, typeLabel: TYPE_LABEL[en.type], desc: en.desc
  })));
  const gLinks = DATA.relations.map(r => ({
    source: r.source, target: r.target, type: r.type, weight: r.weight
  }));
  graph.setData(gNodes, gLinks);
  graph.onSelect = (nd) => {
    if (nd.type === 'event') selectEvent(nd.id, false);
    else setGraphFocus(nd.id);
  };
  graph.onBlank = () => { if (graph.focusId) setGraphFocus(null); };

  /* 情景提示条（动态创建，避免模板里堆太多空壳） */
  const scNote = document.createElement('div');
  scNote.className = 'sc-note';
  document.getElementById('stage').appendChild(scNote);

  const timeline = new window.ATLAS_TIMELINE($('#timeline'), {
    onTime: (t) => applyTime(t)
  });
  timeline.setData(DATA.events);

  const story = new window.ATLAS_STORY($('#story'), {
    onStep: (s) => {
      if (s.graph) openDrawer();
      selectEvent(s.eventId, true);
    },
    onExit: () => $('#btn-story').setAttribute('aria-pressed', 'false')
  });
  const storyCount = story.setSteps(DATA.story);
  if (!storyCount) $('#btn-story').style.display = 'none';

  renderHeader();
  renderFilters();
  renderList();
  renderScenarioBar();
  applyFilter();
  window.__atlas = { globe, graph, data: DATA, state, timeline, story, INS };

  /* ── 交互绑定 ───────────────────────────────────────── */
  $('#btn-graph').onclick = () => state.drawer ? closeDrawer() : openDrawer();
  $('#btn-graph-close').onclick = closeDrawer;
  $('#btn-relayout').onclick = () => { graph.setData(gNodes, gLinks); graph.reheat(); graph.autoFit = true; };
  $('#panel-x').onclick = closePanel;

  $('#btn-story').onclick = () => {
    if (story.playing) { story.stop(); return; }
    const ok = story.start();
    $('#btn-story').setAttribute('aria-pressed', ok ? 'true' : 'false');
    if (ok) closeDrawer();
  };

  $('#btn-cascade').onclick = () => toggleCascade();
  $('#btn-blind').onclick = () => applyBlind(!state.blind);

  const railBtn = $('#btn-rail');
  if (railBtn) railBtn.onclick = () => $('.rail').classList.toggle('open');

  $('#btn-rotate').onclick = (e) => {
    globe.autoRotate = !globe.autoRotate;
    e.currentTarget.setAttribute('aria-pressed', String(globe.autoRotate));
  };
  $('#btn-reset').onclick = () => {
    globe.reset(); closePanel();
    state.cascade = false; state.blind = false; state.scenario = null;
    $('#btn-cascade').setAttribute('aria-pressed', 'false');
    $('#btn-blind').setAttribute('aria-pressed', 'false');
    globe.setBlind(false); globe.setScenario(null); globe.setCascade(null);
    graph.setScenario(null); graph.setCascade(null);
    $('#blind-card').classList.remove('on');
    scNote.classList.remove('on');
    renderScenarioBar();
    if (timeline) timeline.showAll();
  };
  $('#btn-focus').onclick = () => {
    const top = visibleEvents()[0];
    if (top) selectEvent(top.id, true);
  };

  document.addEventListener('keydown', (ev) => {
    if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
    if (ev.key === 'Escape') {
      if (story.playing) story.stop();
      else if (state.selected) closePanel();
      else if (state.drawer) closeDrawer();
    } else if (ev.key === 'g' || ev.key === 'G') {
      state.drawer ? closeDrawer() : openDrawer();
    } else if (ev.key === ' ') {
      ev.preventDefault();
      timeline.toggle();
    }
  });

  /* 自适应 */
  const ro = new ResizeObserver(() => {
    globe.resize();
    if (state.drawer) graph.resize();
  });
  ro.observe(document.getElementById('stage'));
  window.addEventListener('resize', () => { globe.resize(); graph.resize(); });

  setTimeout(() => {
    const hint = $('#hint');
    if (hint) setTimeout(() => hint.classList.add('hide'), 9000);
  }, 400);

  if (DATA.events.length) {
    const top = DATA.events.slice().sort((a, b) => b.heat - a.heat)[0];
    if (top && top.location) globe.focusOn(top.location.lat, top.location.lng);
  }
})();
