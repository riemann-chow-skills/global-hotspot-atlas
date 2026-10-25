/* ══════════════════════════════════════════════════════════
   Insight — 图谱上的"推理"能力：传导链 / 报道密度 / 可解释热度
   纯计算，不碰 DOM，方便单独验证
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* 参与传导的边：因果边必选；强关联边（weight ≥ 1.3）次之 */
  function isCauseEdge(r) {
    if (r.type === 'cause') return true;
    return r.type === 'related' && (r.weight || 1) >= 1.3;
  }

  /**
   * 从起点沿因果边做 BFS，返回层级与边
   * @returns {{levels: Map<string, number>, edges: Array<{from:string,to:string,level:number}>}}
   */
  function cascade(startId, relations, depth) {
    const maxDepth = depth || 3;
    const adj = new Map();
    for (const r of relations) {
      if (!isCauseEdge(r)) continue;
      if (!adj.has(r.source)) adj.set(r.source, []);
      adj.get(r.source).push(r);
    }
    const levels = new Map([[startId, 0]]);
    const edges = [];
    let frontier = [startId];
    for (let d = 1; d <= maxDepth; d++) {
      const next = [];
      for (const id of frontier) {
        for (const r of (adj.get(id) || [])) {
          const to = r.target;
          if (levels.has(to)) continue;
          levels.set(to, d);
          edges.push({ from: id, to: to, level: d });
          next.push(to);
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    levels.delete(startId);
    return { levels: levels, edges: edges };
  }

  /** 把层级 Map 按层聚合成可读的列表 */
  function groupByLevel(levels, nameOf) {
    const out = [];
    levels.forEach((lv, id) => {
      if (!out[lv - 1]) out[lv - 1] = [];
      out[lv - 1].push({ id: id, name: nameOf(id) });
    });
    return out.filter(Boolean);
  }

  /**
   * 报道密度网格：按 stepDeg 度划分经纬网格，统计每格事件数
   * 只用于画"注意力分布"气泡，不绘制任何行政边界
   */
  function densityGrid(events, stepDeg) {
    const step = stepDeg || 15;
    const cells = new Map();
    for (const e of events) {
      if (!e.location) continue;
      const cx = Math.floor((e.location.lng + 180) / step);
      const cy = Math.floor((90 - e.location.lat) / step);
      const key = cy + ':' + cx;
      let c = cells.get(key);
      if (!c) {
        c = { lat: 90 - (cy + 0.5) * step, lng: -180 + (cx + 0.5) * step, n: 0, heat: 0 };
        cells.set(key, c);
      }
      c.n++;
      c.heat += (e.heat || 40);
    }
    const arr = Array.from(cells.values());
    const max = arr.reduce((m, c) => Math.max(m, c.n), 1);
    arr.forEach(c => { c.ratio = c.n / max; });
    return arr;
  }

  /** 报道覆盖度：来源条数 */
  function coverage(ev) {
    return (ev.sources || []).length + ((ev.also_from || []).length || 0);
  }

  /** 报道盲区：严重度高但来源少 —— 值得单独提醒的事件 */
  function isBlind(ev) {
    return (ev.severity || 0) >= 4 && coverage(ev) <= 2;
  }

  /**
   * 可解释热度：把黑箱分数拆成几条人能读的理由
   * 数据里给了 heat_reasons 就用给定的，否则从结构特征自动推导
   */
  function heatReasons(ev, ctx) {
    if (Array.isArray(ev.heat_reasons) && ev.heat_reasons.length) {
      return ev.heat_reasons.slice(0, 4);
    }
    const out = [];
    const ents = (ev.actors || []).length;
    if (ents) out.push('关联 ' + ents + ' 个实体');
    const cov = coverage(ev);
    if (cov) out.push(cov + ' 家媒体报道');
    if ((ev.severity || 0) >= 4) out.push('严重度 ' + ev.severity + '/5');
    const relN = ctx && ctx.relatedCount ? ctx.relatedCount : 0;
    if (relN) out.push('牵连 ' + relN + ' 个事件');
    if (ev.timeline && ev.timeline.length >= 2) out.push(ev.timeline.length + ' 个演化节点');
    if (ev.disputes && ev.disputes.length) out.push(ev.disputes.length + ' 处信源分歧');
    return out.slice(0, 4);
  }

  /** 场景推演的判定：某节点在给定场景下是"减弱"还是"增强" */
  function scenarioRole(sc, id) {
    if (!sc) return 0;
    if ((sc.dampen || []).indexOf(id) >= 0) return -1;
    if ((sc.amplify || []).indexOf(id) >= 0) return 1;
    return 0;
  }

  window.ATLAS_INSIGHT = {
    cascade: cascade,
    groupByLevel: groupByLevel,
    densityGrid: densityGrid,
    coverage: coverage,
    isBlind: isBlind,
    heatReasons: heatReasons,
    scenarioRole: scenarioRole,
    isCauseEdge: isCauseEdge
  };
})();
