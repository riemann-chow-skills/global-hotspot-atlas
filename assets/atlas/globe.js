/* ══════════════════════════════════════════════════════════
   Globe — 点阵地球（正射投影 · Canvas2D · 零依赖）
   坐标系约定：y 为朝向观察者的深度轴，z 为极轴，x 为屏幕横轴
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const RAD = Math.PI / 180;
  const D2R = RAD;
  const CAT = {
    conflict: '#ff4d6a', politics: '#ffab2e', economy: '#2fd6a4',
    tech: '#4d8dff', climate: '#a06bff', society: '#ff6fae'
  };
  const LEVEL_COL = ['#4d8dff', '#a06bff', '#ffab2e'];

  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function decodeMask(b64) {
    const bin = atob(String(b64).replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes: bytes, W: 720, H: 360 };
  }

  function makeLandTest(m) {
    return function (lat, lng) {
      let r = Math.floor((90 - lat) / 180 * m.H);
      let c = Math.floor((lng + 180) / 360 * m.W);
      if (r < 0) r = 0; else if (r > m.H - 1) r = m.H - 1;
      if (c < 0) c = 0; else if (c > m.W - 1) c = m.W - 1;
      const p = r * m.W + c;
      return (m.bytes[p >> 3] >> (p & 7)) & 1;
    };
  }

  class Globe {
    constructor(canvas, maskB64, opts) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.opts = opts || {};
      this.mask = decodeMask(maskB64);
      this.isLand = makeLandTest(this.mask);

      this.rot = { lon: 12, lat: 16 };
      this.zoom = 1;
      this.zoomTarget = 1;
      this.cx = 0; this.cy = 0; this.R = 300;
      this.offsetX = 0; this.offsetXTarget = 0;
      this.vpScale = 1; this.vpScaleT = 1;
      this.vpShift = 0; this.vpShiftT = 0;

      this.autoRotate = true;
      this.idleSince = 0;
      this.dragging = false;
      this.moved = 0;
      this.vel = { lon: 0, lat: 0 };
      this.hoverId = null;
      this.selectedId = null;
      this.events = [];
      this.arcs = [];
      this.filter = null;
      this.timeFilter = null;
      this.cascade = null;
      this.scenario = null;
      this.blind = false;
      this.density = [];
      this.placedLabels = [];
      this.stars = [];
      this._buildStars();
      this._buildDots();
      this._bindEvents();
      this.resize();
      this.t0 = performance.now();
      this._raf = null;
      this.start();
    }

    /* ── 静态点阵 ─────────────────────────────────────── */
    _buildDots() {
      const N = 30000;
      const golden = Math.PI * (3 - Math.sqrt(5));
      const xs = [], ys = [], zs = [];
      for (let i = 0; i < N; i++) {
        const z = 1 - (i / (N - 1)) * 2;
        const rr = Math.sqrt(Math.max(0, 1 - z * z));
        const th = golden * i;
        const x = Math.cos(th) * rr;
        const y = Math.sin(th) * rr;
        const lat = Math.asin(z) / D2R;
        const lng = Math.atan2(x, y) / D2R;
        if (this.isLand(lat, lng)) { xs.push(x); ys.push(y); zs.push(z); }
      }
      this.dx = Float32Array.from(xs);
      this.dy = Float32Array.from(ys);
      this.dz = Float32Array.from(zs);
      this.dotCount = xs.length;
    }

    _buildStars() {
      const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(20261025);
      for (let i = 0; i < 420; i++) {
        this.stars.push({
          x: rnd(), y: rnd(), r: 0.3 + rnd() * 1.1,
          a: 0.12 + rnd() * 0.5, p: rnd() * Math.PI * 2, s: 0.4 + rnd() * 1.4
        });
      }
    }

    /* ── 数据 ─────────────────────────────────────────── */
    setData(events) {
      this.events = (events || []).filter(e => e.location && isFinite(e.location.lat) && isFinite(e.location.lng));
      this.events.forEach(e => {
        const la = e.location.lat * D2R, lo = e.location.lng * D2R;
        e._v = [Math.cos(la) * Math.sin(lo), Math.cos(la) * Math.cos(lo), Math.sin(la)];
        e._col = CAT[e.category] || CAT.society;
        e._rgb = hexToRgb(e._col);
      });
      this._sorted = this.events.slice().sort((a, b) => (b.heat || 0) - (a.heat || 0));
      this._byId = new Map(this.events.map(e => [e.id, e]));
    }

    setFilter(fn) { this.filter = fn; }

    /* L1 时间轴：只显示"已经发生"的事件 */
    setTimeFilter(fn) { this.timeFilter = fn; }

    /* L2 传导链：{levels: Map<id,level>, edges: [{from,to,level}]} */
    setCascade(c) { this.cascade = c; }

    /* L2 情景推演：{dampen:Set, amplify:Set} */
    setScenario(s) { this.scenario = s; }

    /* L3 报道盲区：密度气泡 + 低覆盖事件提示 */
    setBlind(on, density, blindIds) {
      this.blind = !!on;
      this.density = density || [];
      this.blindIds = blindIds || null;
    }

    setSelected(id) {
      this.selectedId = id;
      this.arcs = [];
      if (!id) return;
      const ev = this.events.find(e => e.id === id);
      if (!ev || !this.opts.getRelated) return;
      const rel = this.opts.getRelated(id) || [];
      rel.forEach(r => {
        const t = this.events.find(e => e.id === r.id);
        if (t && t !== ev) this.arcs.push({ a: ev, b: t, type: r.type });
      });
    }

    focusOn(lat, lng) {
      this.idleSince = performance.now();
      let targetLon = lng;
      // 取最短旋转路径
      let d = targetLon - this.rot.lon;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      this._anim = {
        t: performance.now(), dur: 820,
        from: { lon: this.rot.lon, lat: this.rot.lat },
        to: { lon: this.rot.lon + d, lat: Math.max(-72, Math.min(72, lat * 0.85)) }
      };
    }

    reset() {
      this._anim = {
        t: performance.now(), dur: 700,
        from: { lon: this.rot.lon, lat: this.rot.lat },
        to: { lon: 12, lat: 16 }
      };
      this.zoomTarget = 1;
    }

    setPanelOffset(px) { this.offsetXTarget = -px * 0.42; }

    /* ── 投影 ─────────────────────────────────────────── */
    project(v) {
      const cR = this._cR, sR = this._sR, cP = this._cP, sP = this._sP;
      const x1 = v[0] * cR - v[1] * sR;
      const y1 = v[1] * cR + v[0] * sR;
      const y2 = y1 * cP + v[2] * sP;
      if (y2 <= 0.0015) return null;
      const z2 = -y1 * sP + v[2] * cP;
      return [this.cx + this.R * x1, this.cy - this.R * z2, y2];
    }

    projectLL(lat, lng) {
      const la = lat * D2R, lo = lng * D2R;
      return this.project([Math.cos(la) * Math.sin(lo), Math.cos(la) * Math.cos(lo), Math.sin(la)]);
    }

    /* ── 主循环 ───────────────────────────────────────── */
    start() {
      const loop = () => {
        this._raf = requestAnimationFrame(loop);
        this._tick();
        this._draw();
      };
      this._raf = requestAnimationFrame(loop);
    }

    stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

    _tick() {
      const now = performance.now();

      if (this._anim) {
        const k = Math.min(1, (now - this._anim.t) / this._anim.dur);
        const e = 1 - Math.pow(1 - k, 3);
        this.rot.lon = this._anim.from.lon + (this._anim.to.lon - this._anim.from.lon) * e;
        this.rot.lat = this._anim.from.lat + (this._anim.to.lat - this._anim.from.lat) * e;
        if (k >= 1) this._anim = null;
      } else if (!this.dragging) {
        if (Math.abs(this.vel.lon) > 0.002 || Math.abs(this.vel.lat) > 0.002) {
          this.rot.lon += this.vel.lon;
          this.rot.lat = Math.max(-72, Math.min(72, this.rot.lat + this.vel.lat));
          this.vel.lon *= 0.94; this.vel.lat *= 0.94;
        } else if (this.autoRotate && now - this.idleSince > 2200) {
          this.rot.lon += 0.042;
        }
      }

      this.zoom += (this.zoomTarget - this.zoom) * 0.12;
      this.offsetX += (this.offsetXTarget - this.offsetX) * 0.12;
      this.vpScale += (this.vpScaleT - this.vpScale) * 0.11;
      this.vpShift += (this.vpShiftT - this.vpShift) * 0.11;
    }

    _draw() {
      const ctx = this.ctx, w = this.w, h = this.h, now = performance.now();
      this._cR = Math.cos(this.rot.lon * D2R);
      this._sR = Math.sin(this.rot.lon * D2R);
      this._cP = Math.cos(this.rot.lat * D2R);
      this._sP = Math.sin(this.rot.lat * D2R);

      ctx.clearRect(0, 0, w, h);

      // 星空
      for (let i = 0; i < this.stars.length; i++) {
        const s = this.stars[i];
        const a = s.a * (0.55 + 0.45 * Math.sin(now * 0.0009 * s.s + s.p));
        ctx.fillStyle = 'rgba(190,215,245,' + a.toFixed(3) + ')';
        ctx.fillRect(s.x * w, s.y * h, s.r, s.r);
      }

      const R = this.R;
      // 大气辉光
      const ag = ctx.createRadialGradient(this.cx, this.cy, R * 0.94, this.cx, this.cy, R * 1.26);
      ag.addColorStop(0, 'rgba(70,150,255,.22)');
      ag.addColorStop(0.45, 'rgba(60,120,220,.09)');
      ag.addColorStop(1, 'rgba(60,120,220,0)');
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(this.cx, this.cy, R * 1.26, 0, 6.2832); ctx.fill();

      // 海洋球体
      const og = ctx.createRadialGradient(
        this.cx - R * 0.34, this.cy - R * 0.38, R * 0.05,
        this.cx, this.cy, R * 1.04
      );
      og.addColorStop(0, '#16374f');
      og.addColorStop(0.42, '#0d2136');
      og.addColorStop(0.78, '#081524');
      og.addColorStop(1, '#04090f');
      ctx.fillStyle = og;
      ctx.beginPath(); ctx.arc(this.cx, this.cy, R, 0, 6.2832); ctx.fill();

      this._drawGraticule(ctx);
      this._drawDots(ctx);
      if (this.blind) this._drawDensity(ctx);
      this._drawRim(ctx);
      this._drawArcs(ctx, now);
      if (this.cascade) this._drawCascadeArcs(ctx, now);
      this._drawMarkers(ctx, now);
    }

    _drawGraticule(ctx) {
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(110,175,235,.075)';
      ctx.beginPath();
      for (let lng = -180; lng < 180; lng += 30) {
        let pen = false;
        for (let lat = -84; lat <= 84; lat += 4) {
          const p = this.projectLL(lat, lng);
          if (!p) { pen = false; continue; }
          if (!pen) { ctx.moveTo(p[0], p[1]); pen = true; }
          else ctx.lineTo(p[0], p[1]);
        }
      }
      for (let lat = -60; lat <= 60; lat += 15) {
        let pen = false;
        for (let lng = -180; lng <= 180; lng += 4) {
          const p = this.projectLL(lat, lng);
          if (!p) { pen = false; continue; }
          if (!pen) { ctx.moveTo(p[0], p[1]); pen = true; }
          else ctx.lineTo(p[0], p[1]);
        }
      }
      ctx.stroke();
    }

    _drawDots(ctx) {
      const n = this.dotCount, R = this.R;
      const cR = this._cR, sR = this._sR, cP = this._cP, sP = this._sP;
      const cx = this.cx, cy = this.cy;
      const BUCKETS = 5;
      const bx = this._bx || (this._bx = []), by = this._by || (this._by = []);
      for (let b = 0; b < BUCKETS; b++) {
        if (!bx[b]) { bx[b] = []; by[b] = []; }
        bx[b].length = 0; by[b].length = 0;
      }

      const dx = this.dx, dy = this.dy, dz = this.dz;
      for (let i = 0; i < n; i++) {
        const x0 = dx[i], y0 = dy[i], z0 = dz[i];
        const x1 = x0 * cR - y0 * sR;
        const y1 = y0 * cR + x0 * sR;
        const y2 = y1 * cP + z0 * sP;
        if (y2 <= 0.02) continue;
        const z2 = -y1 * sP + z0 * cP;
        const b = (y2 * BUCKETS) | 0;
        const k = b >= BUCKETS ? BUCKETS - 1 : b;
        bx[k].push(cx + R * x1);
        by[k].push(cy - R * z2);
      }

      const alphas = [0.2, 0.4, 0.6, 0.78, 0.95];
      const size = Math.max(1, Math.min(1.7, R / 210));
      for (let b = 0; b < BUCKETS; b++) {
        const px = bx[b], py = by[b];
        if (!px.length) continue;
        ctx.fillStyle = 'rgba(142,208,248,' + alphas[b] + ')';
        ctx.beginPath();
        for (let i = 0; i < px.length; i++) ctx.rect(px[i], py[i], size, size);
        ctx.fill();
      }
    }

    _drawRim(ctx) {
      const R = this.R;
      const g = ctx.createLinearGradient(this.cx - R, this.cy - R, this.cx + R, this.cy + R);
      g.addColorStop(0, 'rgba(150,215,255,.42)');
      g.addColorStop(0.5, 'rgba(90,160,230,.14)');
      g.addColorStop(1, 'rgba(60,110,190,.3)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(this.cx, this.cy, R - 0.5, 0, 6.2832); ctx.stroke();
    }

    /* L3：报道注意力分布气泡 */
    _drawDensity(ctx) {
      const cells = this.density;
      if (!cells || !cells.length) return;
      const R = this.R;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const p = this.projectLL(c.lat, c.lng);
        if (!p) continue;
        const r = (5 + c.ratio * 21) * (0.5 + 0.5 * p[2]) * (R / 330);
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
        g.addColorStop(0, 'rgba(120,190,255,' + (0.2 + 0.15 * c.ratio).toFixed(3) + ')');
        g.addColorStop(0.62, 'rgba(90,160,240,0.065)');
        g.addColorStop(1, 'rgba(90,160,240,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.2832); ctx.fill();
      }
    }

    /* L2：传导链的因果弧线 */
    _drawCascadeArcs(ctx, now) {
      const c = this.cascade;
      if (!c || !c.edges || !c.edges.length) return;
      const byId = this._byId;
      if (!byId) return;
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < c.edges.length; i++) {
        const ed = c.edges[i];
        const a = byId.get(ed.from), b = byId.get(ed.to);
        if (!a || !b || !a._v || !b._v) continue;
        const col = LEVEL_COL[Math.min(ed.level, 3) - 1];
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        let drawing = false;
        const N = 34;
        for (let j = 0; j <= N; j++) {
          const p = this.project(this._slerp(a._v, b._v, j / N, 0.2));
          if (!p) { drawing = false; continue; }
          if (!drawing) { ctx.moveTo(p[0], p[1]); drawing = true; }
          else ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();
        const tp = this.project(this._slerp(a._v, b._v, (now * 0.0006 + i * 0.13) % 1, 0.2));
        if (tp) {
          const g = ctx.createRadialGradient(tp[0], tp[1], 0, tp[0], tp[1], 6);
          g.addColorStop(0, col);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(tp[0], tp[1], 6, 0, 6.2832); ctx.fill();
        }
      }
      ctx.restore();
    }

    /* 大圆插值 */
    _slerp(a, b, t, lift) {
      const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      const om = Math.acos(d);
      let x, y, z;
      if (om < 1e-4) { x = a[0]; y = a[1]; z = a[2]; }
      else {
        const s = Math.sin(om), s1 = Math.sin((1 - t) * om) / s, s2 = Math.sin(t * om) / s;
        x = a[0] * s1 + b[0] * s2; y = a[1] * s1 + b[1] * s2; z = a[2] * s1 + b[2] * s2;
      }
      const k = 1 + (lift || 0) * Math.sin(Math.PI * t);
      return [x * k, y * k, z * k];
    }

    _drawArcs(ctx, now) {
      if (!this.arcs.length) return;
      const sel = this.events.find(e => e.id === this.selectedId);
      if (!sel || !sel._v) return;
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < this.arcs.length; i++) {
        const arc = this.arcs[i];
        const bv = arc.b._v;
        if (!bv) continue;
        const N = 44;
        let prev = null;
        const col = CAT[arc.b.category] || CAT.society;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let drawing = false;
        for (let j = 0; j <= N; j++) {
          const t = j / N;
          const v = this._slerp(sel._v, bv, t, 0.16);
          const p = this.project(v);
          if (!p) { drawing = false; prev = null; continue; }
          if (!drawing) { ctx.moveTo(p[0], p[1]); drawing = true; }
          else ctx.lineTo(p[0], p[1]);
          prev = p;
        }
        ctx.stroke();

        // 流光
        const ph = ((now * 0.00055 + i * 0.17) % 1);
        const tv = this._slerp(sel._v, bv, ph, 0.16);
        const tp = this.project(tv);
        if (tp) {
          const g = ctx.createRadialGradient(tp[0], tp[1], 0, tp[0], tp[1], 7);
          g.addColorStop(0, col);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(tp[0], tp[1], 7, 0, 6.2832); ctx.fill();
        }
      }
      ctx.restore();
    }

    _drawMarkers(ctx, now) {
      const list = this._sorted || [];
      this.placedLabels = [];
      const vis = [];

      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (this.filter && !this.filter(e)) continue;
        if (this.timeFilter && !this.timeFilter(e)) continue;
        const p = this.project(e._v);
        if (!p) continue;
        vis.push({ e: e, p: p });
      }

      // 背光点先画
      for (let i = 0; i < vis.length; i++) {
        const v = vis[i], e = v.e, p = v.p;
        const heat = Math.max(0, Math.min(100, e.heat || 30));
        const base = 1.8 + heat / 100 * 3.4;
        const depthFade = 0.35 + 0.65 * p[2];
        const isSel = e.id === this.selectedId;
        const isHov = e.id === this.hoverId;
        const s = base * (isSel ? 1.5 : isHov ? 1.3 : 1) * (0.7 + 0.3 * depthFade);
        const rgb = e._rgb;

        // L2 情景推演：被"减弱"的节点淡出，被"增强"的节点加脉冲
        let role = 0;
        if (this.scenario) {
          if (this.scenario.dampen && this.scenario.dampen.has(e.id)) role = -1;
          else if (this.scenario.amplify && this.scenario.amplify.has(e.id)) role = 1;
        }
        const am = role === -1 ? 0.16 : 1;

        const gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], s * 5.2);
        gr.addColorStop(0, 'rgba(' + rgb + ',' + (0.42 * am).toFixed(3) + ')');
        gr.addColorStop(0.42, 'rgba(' + rgb + ',' + (0.12 * am).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(' + rgb + ',0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(p[0], p[1], s * 5.2, 0, 6.2832); ctx.fill();

        ctx.fillStyle = 'rgba(' + rgb + ',' + ((0.75 + 0.25 * depthFade) * am).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p[0], p[1], s, 0, 6.2832); ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,' + (0.75 * depthFade * am).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p[0], p[1], s * 0.38, 0, 6.2832); ctx.fill();

        // 脉冲环：选中 / 前三热 / hover / 情景增强
        const rank = this._sorted.indexOf(e);
        const pulse = isSel || isHov || rank < 3 || role === 1;
        if (pulse) {
          const ph = ((now * 0.0007 + (rank % 5) * 0.2) % 1);
          const rr = s * (2.2 + ph * 5.5);
          ctx.strokeStyle = 'rgba(' + rgb + ',' + ((1 - ph) * (isSel ? 0.85 : role === 1 ? 0.72 : 0.5)).toFixed(3) + ')';
          ctx.lineWidth = isSel ? 1.6 : 1.1;
          ctx.beginPath(); ctx.arc(p[0], p[1], rr, 0, 6.2832); ctx.stroke();
        }
        if (isSel) {
          ctx.strokeStyle = 'rgba(255,255,255,.9)';
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(p[0], p[1], s * 2.1, 0, 6.2832); ctx.stroke();
        }

        // L2 传导链：层级虚线环
        if (this.cascade && this.cascade.levels && this.cascade.levels.has(e.id)) {
          const lv = this.cascade.levels.get(e.id);
          ctx.strokeStyle = LEVEL_COL[Math.min(lv, 3) - 1];
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 2.4]);
          ctx.beginPath(); ctx.arc(p[0], p[1], s * 2.9 + lv * 1.6, 0, 6.2832); ctx.stroke();
          ctx.setLineDash([]);
        }

        // L3 报道盲区：低覆盖高严重度
        if (this.blind && this.blindIds && this.blindIds.has(e.id)) {
          const ph2 = ((now * 0.0006) % 1);
          ctx.strokeStyle = 'rgba(255,77,106,' + (0.85 - ph2 * 0.55).toFixed(3) + ')';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.arc(p[0], p[1], s * 2.4 + ph2 * 11, 0, 6.2832); ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // 标签：仅前若干热事件 + hover/selected
      const labelCandidates = vis.filter(v =>
        v.e.id === this.selectedId || v.e.id === this.hoverId ||
        (this._sorted.indexOf(v.e) < 9 && !this.filter) ||
        (this._sorted.indexOf(v.e) < 9)
      ).sort((a, b) => {
        const sa = a.e.id === this.selectedId ? 1e6 : a.e.id === this.hoverId ? 1e5 : (a.e.heat || 0);
        const sb = b.e.id === this.selectedId ? 1e6 : b.e.id === this.hoverId ? 1e5 : (b.e.heat || 0);
        return sb - sa;
      });

      ctx.textBaseline = 'middle';
      ctx.font = '600 11px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      for (let i = 0; i < labelCandidates.length; i++) {
        const v = labelCandidates[i];
        const e = v.e, p = v.p;
        if (p[2] < 0.25) continue;
        const txt = e.short || e.title;
        if (!txt) continue;
        const label = txt.length > 15 ? txt.slice(0, 15) + '…' : txt;
        const wdt = ctx.measureText(label).width;
        const bx = p[0] + 10, by = p[1] - 8;
        const box = [bx - 2, by - 8, wdt + 6, 16];
        let hit = false;
        for (let j = 0; j < this.placedLabels.length; j++) {
          const o = this.placedLabels[j];
          if (box[0] < o[0] + o[2] && box[0] + box[2] > o[0] && box[1] < o[1] + o[3] && box[1] + box[3] > o[1]) { hit = true; break; }
        }
        if (hit && e.id !== this.selectedId && e.id !== this.hoverId) continue;
        this.placedLabels.push(box);

        const isSel = e.id === this.selectedId;
        ctx.globalAlpha = isSel ? 1 : 0.55 + 0.45 * p[2];
        ctx.fillStyle = 'rgba(4,8,14,.55)';
        ctx.beginPath();
        const rx = box[0], ry = box[1], rw = box[2], rh = box[3], r = 4;
        ctx.moveTo(rx + r, ry); ctx.lineTo(rx + rw - r, ry); ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
        ctx.lineTo(rx + rw, ry + rh - r); ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
        ctx.lineTo(rx + r, ry + rh); ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
        ctx.lineTo(rx, ry + r); ctx.quadraticCurveTo(rx, ry, rx + r, ry);
        ctx.fill();
        ctx.fillStyle = isSel ? '#ffffff' : 'rgba(226,238,252,.94)';
        ctx.fillText(label, bx + 1, by);
        ctx.globalAlpha = 1;
      }
      this._vis = vis;
    }

    /* ── 交互 ─────────────────────────────────────────── */
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = this.cv.getBoundingClientRect();
      this.w = r.width; this.h = r.height;
      this.cv.width = Math.round(r.width * dpr);
      this.cv.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.baseUnit = Math.min(r.width * 0.42, r.height * 0.37);
      this.baseR = this.baseUnit * this.vpScale;
      this.R = this.baseR * this.zoom;
      this.cx = r.width * 0.5 + this.offsetX;
      this.cy = r.height * (0.5 + this.vpShift);
    }

    _syncCenter() {
      this.cx = this.w * 0.5 + this.offsetX;
      this.cy = this.h * (0.5 + this.vpShift);
      this.baseR = this.baseUnit * this.vpScale;
      this.R = this.baseR * this.zoom;
    }

    /* 抽屉/面板打开时压缩视野，保证地球完整可见 */
    setViewport(scale, shift) {
      this.vpScaleT = scale;
      this.vpShiftT = shift;
    }

    hitTest(mx, my) {
      const vis = this._vis || [];
      let best = null, bd = 16 * 16;
      for (let i = 0; i < vis.length; i++) {
        const p = vis[i].p;
        const d = (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my);
        if (d < bd) { bd = d; best = vis[i].e; }
      }
      return best;
    }

    _bindEvents() {
      const cv = this.cv;
      let last = null;

      const onDown = (ev) => {
        const p = this._pos(ev);
        last = p; this.dragging = true; this.moved = 0;
        this.vel.lon = this.vel.lat = 0;
        this._anim = null;
        this.idleSince = performance.now();
        cv.classList.add('drag');
      };
      const onMove = (ev) => {
        const p = this._pos(ev);
        if (this.dragging && last) {
          const dx = p.x - last.x, dy = p.y - last.y;
          this.moved += Math.abs(dx) + Math.abs(dy);
          this.rot.lon -= dx * 0.28;
          this.rot.lat = Math.max(-72, Math.min(72, this.rot.lat + dy * 0.28));
          this.vel.lon = -dx * 0.28; this.vel.lat = dy * 0.28;
          last = p;
          this.idleSince = performance.now();
        } else {
          const e = this.hitTest(p.x, p.y);
          const nid = e ? e.id : null;
          if (nid !== this.hoverId) {
            this.hoverId = nid;
            if (this.opts.onHover) this.opts.onHover(e, p.x, p.y);
          } else if (e && this.opts.onHoverMove) {
            this.opts.onHoverMove(p.x, p.y);
          }
          cv.style.cursor = e ? 'pointer' : '';
        }
      };
      const onUp = (ev) => {
        if (!this.dragging) return;
        this.dragging = false;
        cv.classList.remove('drag');
        if (this.moved < 5) {
          const p = this._pos(ev);
          const e = this.hitTest(p.x, p.y);
          if (e && this.opts.onSelect) this.opts.onSelect(e);
          else if (!e && this.opts.onBlank) this.opts.onBlank();
        }
        this.idleSince = performance.now();
      };

      cv.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp);
      cv.addEventListener('pointerleave', () => {
        this.hoverId = null;
        if (this.opts.onHover) this.opts.onHover(null);
      });
      cv.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        this.zoomTarget = Math.max(0.78, Math.min(2.7, this.zoomTarget * Math.exp(-ev.deltaY * 0.0011)));
      }, { passive: false });
    }

    _pos(ev) {
      const r = this.cv.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }
  }

  // 每帧同步一次圆心（offsetX 平滑变化时）
  const _origDraw = Globe.prototype._draw;
  Globe.prototype._draw = function () {
    this._syncCenter();
    _origDraw.call(this);
  };

  window.Globe = Globe;
  window.ATLAS_CAT = CAT;
  window.ATLAS_HEX2RGB = hexToRgb;
})();
