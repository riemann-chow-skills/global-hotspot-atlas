/* ══════════════════════════════════════════════════════════
   Timeline / Story — L1「过程感」的两个控制器
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const fmt = (t) => {
    const d = new Date(t);
    const p = n => String(n).padStart(2, '0');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  /* ── 时间轴 ─────────────────────────────────────────── */
  class Timeline {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts || {};
      this.events = [];
      this.min = 0;
      this.max = 1;
      this.t = 1;
      this.playing = false;
      this.speed = 1;          // 每秒推进的毫秒数占比
      this._raf = null;
      this.track = root.querySelector('#tl-track');
      this.fill = root.querySelector('#tl-fill');
      this.handle = root.querySelector('#tl-handle');
      this.ticks = root.querySelector('#tl-ticks');
      this.label = root.querySelector('#tl-label');
      this.playBtn = root.querySelector('#tl-play');
      this._bind();
    }

    setData(events) {
      this.events = events.filter(e => e.time && isFinite(new Date(e.time).getTime()));
      if (!this.events.length) { this.root.style.display = 'none'; return; }
      const ts = this.events.map(e => new Date(e.time).getTime());
      this.min = Math.min.apply(null, ts);
      this.max = Math.max.apply(null, ts);
      // 给一点尾部余量，让最后一个事件也能"出现"
      const pad = Math.max(3600000, (this.max - this.min) * 0.06);
      this.min -= pad;
      this.max += pad;
      this.t = this.max;
      this._renderTicks();
      this._paint();
    }

    _renderTicks() {
      const span = this.max - this.min || 1;
      const frag = document.createDocumentFragment();
      this.events.forEach(e => {
        const t = new Date(e.time).getTime();
        const pct = ((t - this.min) / span) * 100;
        const i = document.createElement('i');
        i.style.left = pct + '%';
        i.style.background = (window.ATLAS_CAT || {})[e.category] || '#7d8ba0';
        i.title = e.short || e.title;
        frag.appendChild(i);
      });
      this.ticks.innerHTML = '';
      this.ticks.appendChild(frag);
    }

    _paint() {
      const span = this.max - this.min || 1;
      const pct = Math.max(0, Math.min(100, ((this.t - this.min) / span) * 100));
      this.fill.style.width = pct + '%';
      this.handle.style.left = pct + '%';
      const active = this.events.filter(e => new Date(e.time).getTime() <= this.t).length;
      this.label.innerHTML = '<b>' + fmt(this.t) + '</b><em>' + active + '/' + this.events.length + ' 已发生</em>';
    }

    setTime(t, silent) {
      this.t = Math.max(this.min, Math.min(this.max, t));
      this._paint();
      if (!silent && this.opts.onTime) this.opts.onTime(this.t, this.t >= this.max - 1);
    }

    play() {
      if (this.playing) return;
      this.playing = true;
      this.playBtn.setAttribute('aria-pressed', 'true');
      if (this.t >= this.max - 1) this.setTime(this.min, false);
      let last = performance.now();
      const step = (now) => {
        if (!this.playing) return;
        const dt = now - last;
        last = now;
        const span = this.max - this.min;
        // 全程约 14 秒播完
        this.t = Math.min(this.max, this.t + (span / 14000) * dt);
        this._paint();
        if (this.opts.onTime) this.opts.onTime(this.t, this.t >= this.max - 1);
        if (this.t >= this.max - 1) {
          this.playing = false;
          this.playBtn.setAttribute('aria-pressed', 'false');
          return;
        }
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    }

    pause() {
      this.playing = false;
      this.playBtn.setAttribute('aria-pressed', 'false');
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    toggle() { this.playing ? this.pause() : this.play(); }

    showAll() {
      this.pause();
      this.setTime(this.max, false);
    }

    _bind() {
      const seek = (ev) => {
        const r = this.track.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        this.pause();
        this.setTime(this.min + (this.max - this.min) * p, false);
      };
      let dragging = false;
      this.track.addEventListener('pointerdown', (ev) => {
        dragging = true;
        this.track.setPointerCapture(ev.pointerId);
        seek(ev);
      });
      this.track.addEventListener('pointermove', (ev) => { if (dragging) seek(ev); });
      this.track.addEventListener('pointerup', () => { dragging = false; });
      this.playBtn.addEventListener('click', () => this.toggle());
      const all = this.root.querySelector('#tl-all');
      if (all) all.addEventListener('click', () => this.showAll());
    }
  }

  /* ── 叙事导览 ───────────────────────────────────────── */
  class Story {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts || {};
      this.steps = [];
      this.idx = 0;
      this.playing = false;
      this.duration = this.opts.duration || 8200;
      this._timer = null;
      this._raf = null;
      this.elStep = root.querySelector('#story-step');
      this.elTxt = root.querySelector('#story-txt');
      this.elDots = root.querySelector('#story-dots');
      this.elProg = root.querySelector('#story-prog');
      root.querySelector('#story-x').addEventListener('click', () => this.stop());
      root.querySelector('#story-prev').addEventListener('click', () => this.go(this.idx - 1));
      root.querySelector('#story-next').addEventListener('click', () => this.go(this.idx + 1));
    }

    setSteps(steps) {
      this.steps = (steps || []).filter(s => s && s.eventId);
      this.elDots.innerHTML = this.steps.map((s, i) =>
        '<i data-i="' + i + '"' + (i === 0 ? ' class="on"' : '') + '></i>').join('');
      this.elDots.querySelectorAll('i').forEach(d => {
        d.addEventListener('click', () => this.go(+d.dataset.i));
      });
      return this.steps.length;
    }

    start() {
      if (!this.steps.length) return false;
      this.root.classList.add('on');
      this.playing = true;
      this.go(0);
      return true;
    }

    stop() {
      this.playing = false;
      this.root.classList.remove('on');
      clearTimeout(this._timer);
      if (this._raf) cancelAnimationFrame(this._raf);
      this.elProg.style.width = '0%';
      if (this.opts.onExit) this.opts.onExit();
    }

    go(i) {
      if (i < 0) i = 0;
      if (i >= this.steps.length) { this.stop(); return; }
      this.idx = i;
      const s = this.steps[i];
      this.elStep.textContent = (i + 1) + ' / ' + this.steps.length;
      this.elTxt.textContent = s.narration || '';
      this.elDots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
      if (this.opts.onStep) this.opts.onStep(s, i);
      this._restartTimer();
    }

    _restartTimer() {
      clearTimeout(this._timer);
      if (this._raf) cancelAnimationFrame(this._raf);
      if (!this.playing) { this.elProg.style.width = '0%'; return; }
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / this.duration);
        this.elProg.style.width = (k * 100) + '%';
        if (k < 1 && this.playing) this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
      this._timer = setTimeout(() => { if (this.playing) this.go(this.idx + 1); }, this.duration);
    }
  }

  window.ATLAS_TIMELINE = Timeline;
  window.ATLAS_STORY = Story;
})();
