/* ══════════════════════════════════════════════════════════
   RelGraph — 实体关系力导向图（Canvas2D · 零依赖）
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const TYPE_COLOR = {
    person: '#ffd166', org: '#5ee0b5', country: '#9db4d6',
    place: '#7d8ba0', topic: '#c9a6ff', event: '#4d8dff'
  };
  const REL_COLOR = {
    participate: '#4d8dff', stance: '#ffab2e', sanction: '#ff4d6a',
    cooperate: '#2fd6a4', cause: '#a06bff', located: '#5b6b80', related: '#6b7d95'
  };
  const LEVEL_COL = ['#4d8dff', '#a06bff', '#ffab2e'];

  class RelGraph {
    constructor(canvas, tipEl) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.tip = tipEl;
      this.nodes = [];
      this.links = [];
      this.cam = { x: 0, y: 0, k: 1 };
      this.alpha = 0;
      this.dragNode = null;
      this.hoverNode = null;
      this.focusId = null;
      this.filterFn = null;
      this.autoFit = true;
      this.timeFilter = null;
      this.cascade = null;
      this.scenario = null;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this._bind();
      this.resize();
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    resize() {
      const r = this.cv.getBoundingClientRect();
      this.w = r.width || 800; this.h = r.height || 320;
      this.cv.width = Math.round(this.w * this.dpr);
      this.cv.height = Math.round(this.h * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    setData(nodes, links) {
      this.nodes = nodes;
      this.links = links;
      // 初值：环形 + 抖动，避免完全重合
      const n = nodes.length;
      nodes.forEach((nd, i) => {
        const a = (i / n) * Math.PI * 2;
        const rr = 70 + (i % 7) * 26;
        nd.x = Math.cos(a) * rr + (Math.random() - 0.5) * 20;
        nd.y = Math.sin(a) * rr + (Math.random() - 0.5) * 20;
        nd.vx = 0; nd.vy = 0;
        nd.deg = 0;
      });
      const idx = new Map(nodes.map(nd => [nd.id, nd]));
      links.forEach(l => {
        l.s = idx.get(l.source); l.t = idx.get(l.target);
        if (l.s) l.s.deg++;
        if (l.t) l.t.deg++;
      });
      this.links = links.filter(l => l.s && l.t);
      nodes.forEach(nd => {
        nd.r = nd.type === 'event'
          ? 8 + Math.min(9, (nd.heat || 40) / 12)
          : 4.4 + Math.min(5.5, nd.deg * 1.1);
      });
      this.cam = { x: 0, y: 0, k: 1 };
      this.alpha = 1;
    }

    reheat() { this.alpha = 1; this.autoFit = true; }

    setFocus(id) {
      this.focusId = id;
      if (!id) return;
      const nd = this.nodes.find(n => n.id === id);
      if (nd) { this.cam.x = -nd.x; this.cam.y = -nd.y; }
      this.alpha = Math.max(this.alpha, 0.42);
    }

    setFilter(fn) { this.filterFn = fn; }
    setTimeFilter(fn) { this.timeFilter = fn; }
    setCascade(c) { this.cascade = c; }
    setScenario(s) { this.scenario = s; }

    /* 时间轴上"尚未发生"的事件不参与绘制与取景 */
    _hidden(nd) {
      return !!(this.timeFilter && nd.type === 'event' && !this.timeFilter(nd));
    }

    _neighbors(id) {
      const set = new Set([id]);
      this.links.forEach(l => {
        if (l.source === id) set.add(l.target);
        if (l.target === id) set.add(l.source);
      });
      return set;
    }

    /* 自动把整张图框进画布，避免节点溢出被裁切 */
    _fit() {
      const nodes = this.nodes;
      const focusSet = this.focusId ? this._neighbors(this.focusId) : null;
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, used = 0;
      for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i];
        if (focusSet && !focusSet.has(p.id)) continue;
        if (this._hidden(p)) continue;
        used++;
        if (p.x < minx) minx = p.x;
        if (p.x > maxx) maxx = p.x;
        if (p.y < miny) miny = p.y;
        if (p.y > maxy) maxy = p.y;
      }
      if (!used) return;
      const padX = 70, padY = 58;
      const bw = Math.max(140, maxx - minx + padX * 2);
      const bh = Math.max(120, maxy - miny + padY * 2);
      const tk = Math.max(0.42, Math.min(2.4, Math.min(this.w / bw, this.h / bh)));
      const tx = -(minx + maxx) / 2;
      const ty = -(miny + maxy) / 2;
      this.cam.k += (tk - this.cam.k) * 0.07;
      this.cam.x += (tx - this.cam.x) * 0.07;
      this.cam.y += (ty - this.cam.y) * 0.07;
    }

    _step() {
      const nodes = this.nodes;
      const a = this.alpha;
      if (a < 0.004) return;
      const REP = 5400, GRAV = 0.0075, DAMP = 0.86;

      for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const q = nodes[j];
          let dx = q.x - p.x, dy = q.y - p.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
          if (d2 > 90000) continue;
          const d = Math.sqrt(d2);
          const f = (REP * a) / d2;
          const ux = dx / d, uy = dy / d;
          p.vx -= ux * f; p.vy -= uy * f;
          q.vx += ux * f; q.vy += uy * f;
        }
      }

      for (let i = 0; i < this.links.length; i++) {
        const l = this.links[i];
        const p = l.s, q = l.t;
        let dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const rest = l.source === this.focusId || l.target === this.focusId ? 86 : 104;
        const f = ((d - rest) / d) * 0.055 * a;
        p.vx += dx * f; p.vy += dy * f;
        q.vx -= dx * f; q.vy -= dy * f;
      }

      for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i];
        // 各向异性重力：横向铺开，适配宽扁的抽屉画布
        p.vx -= p.x * GRAV * a * 0.38;
        p.vy -= p.y * GRAV * a * 2.3;
        if (p === this.dragNode) { p.vx = p.vy = 0; continue; }
        p.vx *= DAMP; p.vy *= DAMP;
        p.x += Math.max(-18, Math.min(18, p.vx));
        p.y += Math.max(-18, Math.min(18, p.vy));
      }
      this.alpha *= 0.984;
    }

    _sx(x) { return this.w * 0.5 + (x + this.cam.x) * this.cam.k; }
    _sy(y) { return this.h * 0.5 + (y + this.cam.y) * this.cam.k; }

    _loop() {
      requestAnimationFrame(this._loop);
      this._step();
      this._draw();
    }

    _draw() {
      const ctx = this.ctx, w = this.w, h = this.h;
      ctx.clearRect(0, 0, w, h);
      if (!this.nodes.length) {
        ctx.fillStyle = 'rgba(140,165,195,.4)';
        ctx.font = '12px -apple-system,"PingFang SC",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无关系数据', w / 2, h / 2);
        ctx.textAlign = 'left';
        return;
      }

      if (this.autoFit) this._fit();

      const focusSet = this.focusId ? this._neighbors(this.focusId) : null;
      const k = this.cam.k;

      // links
      ctx.lineCap = 'round';
      for (let i = 0; i < this.links.length; i++) {
        const l = this.links[i];
        // 聚焦模式：只画子图内部的边
        if (focusSet && !(focusSet.has(l.source) && focusSet.has(l.target))) continue;
        const lvA = this.cascade && this.cascade.levels ? this.cascade.levels.get(l.source) : undefined;
        const lvB = this.cascade && this.cascade.levels ? this.cascade.levels.get(l.target) : undefined;
        const inCascade = lvA !== undefined && lvB !== undefined;
        const damped = this.scenario && this.scenario.dampen &&
          (this.scenario.dampen.has(l.source) || this.scenario.dampen.has(l.target));
        const col = inCascade
          ? LEVEL_COL[Math.min(Math.max(lvA, lvB), 3) - 1]
          : (REL_COLOR[l.type] || REL_COLOR.related);
        ctx.strokeStyle = col;
        ctx.globalAlpha = damped ? 0.05 : inCascade ? 0.6 : (0.18 + Math.min(0.36, (l.weight || 1) * 0.1));
        ctx.lineWidth = Math.max(0.6, (l.weight || 1) * 0.8 * Math.min(1.6, k)) * (inCascade ? 1.5 : 1);
        const x1 = this._sx(l.s.x), y1 = this._sy(l.s.y);
        const x2 = this._sx(l.t.x), y2 = this._sy(l.t.y);
        // 轻微弧线，避免多边重叠成直线
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const nx = -(y2 - y1), ny = (x2 - x1);
        const nl = Math.hypot(nx, ny) || 1;
        const bow = Math.min(26, nl * 0.09) * (l.bow || 1);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(mx + nx / nl * bow, my + ny / nl * bow, x2, y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // nodes
      for (let i = 0; i < this.nodes.length; i++) {
        const nd = this.nodes[i];
        if (focusSet && !focusSet.has(nd.id)) continue;
        if (this._hidden(nd)) continue;
        const x = this._sx(nd.x), y = this._sy(nd.y);
        if (x < -60 || x > w + 60 || y < -60 || y > h + 60) continue;
        const col = nd.type === 'event' ? (nd.color || TYPE_COLOR.event) : (TYPE_COLOR[nd.type] || '#8a94a8');
        const r = nd.r * Math.min(1.5, Math.max(0.72, k));
        let role = 0;
        if (this.scenario) {
          if (this.scenario.dampen && this.scenario.dampen.has(nd.id)) role = -1;
          else if (this.scenario.amplify && this.scenario.amplify.has(nd.id)) role = 1;
        }
        ctx.globalAlpha = role === -1 ? 0.15 : 1;

        if (nd.type === 'event') {
          // 事件节点：发光环 + 实心核
          const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
          g.addColorStop(0, col + '55');
          g.addColorStop(1, col + '00');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, 6.2832); ctx.fill();
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
          ctx.fillStyle = col + 'aa';
          ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, 6.2832); ctx.fill();
        } else {
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
          ctx.fillStyle = 'rgba(6,10,16,.55)';
          ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, 6.2832); ctx.fill();
        }

        if (nd.id === this.hoverNode || nd.id === this.focusId) {
          ctx.strokeStyle = 'rgba(255,255,255,.85)';
          ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 6.2832); ctx.stroke();
        }
        // L2 传导链层级
        if (this.cascade && this.cascade.levels && this.cascade.levels.has(nd.id)) {
          const lv = this.cascade.levels.get(nd.id);
          ctx.strokeStyle = LEVEL_COL[Math.min(lv, 3) - 1];
          ctx.lineWidth = 1.4;
          ctx.setLineDash([3, 2.4]);
          ctx.beginPath(); ctx.arc(x, y, r + 6 + lv, 0, 6.2832); ctx.stroke();
          ctx.setLineDash([]);
        }
        // L2 情景增强
        if (role === 1) {
          ctx.strokeStyle = 'rgba(160,107,255,.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 6.2832); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // labels
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const showAll = k > 1.15;
      const placed = [];
      for (let i = 0; i < this.nodes.length; i++) {
        const nd = this.nodes[i];
        const isKey = nd.type === 'event' || nd.deg >= 3 || nd.id === this.hoverNode || nd.id === this.focusId;
        if (!showAll && !isKey) continue;
        if (focusSet && !focusSet.has(nd.id) && nd.id !== this.focusId) continue;
        if (this._hidden(nd)) continue;
        const x = this._sx(nd.x), y = this._sy(nd.y) + nd.r * Math.min(1.5, k) + 5;
        if (x < 0 || x > w || y < 0 || y > h) continue;
        const txt = nd.name.length > 12 ? nd.name.slice(0, 12) + '…' : nd.name;
        ctx.font = (nd.type === 'event' ? '600 10.5px' : '400 10px') + ' -apple-system,"PingFang SC",sans-serif';
        const tw = ctx.measureText(txt).width;
        const box = [x - tw / 2 - 2, y - 1, tw + 4, 12];
        let hit = false;
        for (let j = 0; j < placed.length; j++) {
          const o = placed[j];
          if (box[0] < o[0] + o[2] && box[0] + box[2] > o[0] && box[1] < o[1] + o[3] && box[1] + box[3] > o[1]) { hit = true; break; }
        }
        const force = nd.id === this.focusId || nd.id === this.hoverNode;
        if (hit && !force) continue;
        placed.push(box);
        ctx.fillStyle = 'rgba(4,8,14,.72)';
        ctx.fillRect(box[0], box[1], box[2], box[3]);
        ctx.fillStyle = nd.type === 'event' ? 'rgba(232,242,255,.96)' : 'rgba(178,196,216,.86)';
        ctx.fillText(txt, x, y);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    _pos(ev) {
      const r = this.cv.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    _pick(mx, my) {
      let best = null, bd = 400;
      for (const nd of this.nodes) {
        const x = this._sx(nd.x), y = this._sy(nd.y);
        const d = (x - mx) * (x - mx) + (y - my) * (y - my);
        const rr = Math.max(12, nd.r * this.cam.k + 6);
        if (d < rr * rr && d < bd) { bd = d; best = nd; }
      }
      return best;
    }

    _bind() {
      const cv = this.cv;
      let panning = false, last = null, moved = 0;

      cv.addEventListener('pointerdown', (ev) => {
        const p = this._pos(ev);
        const nd = this._pick(p.x, p.y);
        moved = 0;
        if (nd) {
          this.dragNode = nd;
          this.alpha = Math.max(this.alpha, 0.5);
        } else {
          panning = true;
          cv.classList.add('grabbing');
        }
        last = p;
        cv.setPointerCapture(ev.pointerId);
      });

      cv.addEventListener('pointermove', (ev) => {
        const p = this._pos(ev);
        if (this.dragNode) {
          const dx = (p.x - last.x) / this.cam.k, dy = (p.y - last.y) / this.cam.k;
          this.dragNode.x += dx; this.dragNode.y += dy;
          this.dragNode.vx = this.dragNode.vy = 0;
          moved += Math.abs(dx) + Math.abs(dy);
          last = p;
          return;
        }
        if (panning) {
          this.autoFit = false;
          this.cam.x += (p.x - last.x) / this.cam.k;
          this.cam.y += (p.y - last.y) / this.cam.k;
          moved += Math.abs(p.x - last.x) + Math.abs(p.y - last.y);
          last = p;
          return;
        }
        const nd = this._pick(p.x, p.y);
        this.hoverNode = nd ? nd.id : null;
        cv.style.cursor = nd ? 'pointer' : 'grab';
        if (nd && this.tip) {
          this.tip.classList.add('on');
          this.tip.style.left = p.x + 'px';
          this.tip.style.top = p.y + 'px';
          const desc = nd.desc ? '<div class="tt-m">' + nd.desc + '</div>' : '';
          this.tip.innerHTML = '<b style="color:' + (TYPE_COLOR[nd.type] || '#8a94a8') + '">' +
            (nd.typeLabel || '') + '</b>' + nd.name + desc;
        } else if (this.tip) {
          this.tip.classList.remove('on');
        }
      });

      const up = (ev) => {
        if (this.dragNode && moved < 5 && this.onSelect) this.onSelect(this.dragNode);
        else if (!this.dragNode && moved < 5 && this.onBlank) this.onBlank();
        this.dragNode = null;
        panning = false;
        cv.classList.remove('grabbing');
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', () => {
        if (this.tip) this.tip.classList.remove('on');
        this.hoverNode = null;
      });
      cv.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        this.autoFit = false;
        const p = this._pos(ev);
        const before = this.cam.k;
        this.cam.k = Math.max(0.42, Math.min(2.6, this.cam.k * Math.exp(-ev.deltaY * 0.0013)));
        // 以鼠标位置为缩放锚点
        const dx = (p.x - this.w / 2) / before - (p.x - this.w / 2) / this.cam.k;
        const dy = (p.y - this.h / 2) / before - (p.y - this.h / 2) / this.cam.k;
        this.cam.x += dx; this.cam.y += dy;
      }, { passive: false });
    }
  }

  window.RelGraph = RelGraph;
  window.ATLAS_TYPE_COLOR = TYPE_COLOR;
  window.ATLAS_REL_COLOR = REL_COLOR;
})();
