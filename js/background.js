(function () {
    'use strict';

    const canvas = document.createElement('canvas');
    canvas.id = 'bgCanvas';
    document.body.prepend(canvas);

    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---------------------------------------------------------------------
    // Tunables
    // ---------------------------------------------------------------------
    const SERVICE_DENSITY = 42000;      // px² per service node
    const LINK_DIST = 280;              // longer reach = bigger, sparser connections
    const LINK_DIST_HOLD = LINK_DIST * 1.3;
    const CELL_SIZE = LINK_DIST;
    const MAX_LINKS_PER_NODE = 3;
    const EDGE_SPAWN_CHANCE = 0.0016;   // slower churn, connections live longer
    const EDGE_DROP_CHANCE = 0.0012;
    const FADE_SPEED = 0.03;
    const BASE_SPEED = 0.045;           // slow, steady drift — long trajectories, not jitter

    let width, height, dpr;
    let services = [];
    let grid = new Map();
    let edges = new Map();
    let rafId = null;
    let lastTime = null;

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    // ---------------------------------------------------------------------
    // Setup / layout
    // ---------------------------------------------------------------------
    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = document.documentElement.scrollHeight;

        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        initServices();
    }

    function initServices() {
        const count = Math.max(16, Math.floor((width * height) / SERVICE_DENSITY));
        services = Array.from({ length: count }, (_, i) => {
            const isHub = Math.random() < 0.22;
            const angle = Math.random() * Math.PI * 2;
            return {
                id: i,
                x: Math.random() * width,
                y: Math.random() * height,
                vx: Math.cos(angle) * BASE_SPEED,
                vy: Math.sin(angle) * BASE_SPEED,
                r: isHub ? 3.6 : 1.8,
                active: isHub,
                pulse: Math.random() * Math.PI * 2,
                links: 0,
            };
        });
        grid = new Map();
        edges = new Map();
    }

    function edgeKey(i, j) { return i < j ? `${i}-${j}` : `${j}-${i}`; }

    // ---------------------------------------------------------------------
    // Spatial grid — neighbor lookups without an O(n²) scan every frame
    // ---------------------------------------------------------------------
    function cellKey(cx, cy) { return `${cx},${cy}`; }

    function rebuildGrid() {
        grid.clear();
        for (let i = 0; i < services.length; i++) {
            const n = services[i];
            const key = cellKey(Math.floor(n.x / CELL_SIZE), Math.floor(n.y / CELL_SIZE));
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(i);
        }
    }

    function forEachNearby(i, callback) {
        const n = services[i];
        const cx = Math.floor(n.x / CELL_SIZE);
        const cy = Math.floor(n.y / CELL_SIZE);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const bucket = grid.get(cellKey(cx + dx, cy + dy));
                if (!bucket) continue;
                for (const j of bucket) if (j > i) callback(j);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Physics — plain, slow, straight-line drift with wall bounces.
    // No mouse interaction, no jitter: that's what gives the long, calm
    // trajectories instead of small nervous movement.
    // ---------------------------------------------------------------------
    function updateServices(dt) {
        if (reduceMotion) return;
        services.forEach((n) => {
            n.x += n.vx * dt;
            n.y += n.vy * dt;
            if (n.x < 0 || n.x > width) n.vx *= -1;
            if (n.y < 0 || n.y > height) n.vy *= -1;
            n.x = Math.max(0, Math.min(width, n.x));
            n.y = Math.max(0, Math.min(height, n.y));
            n.pulse += 0.015 * dt;
        });
    }

    function updateEdges(dt) {
        rebuildGrid();

        for (let i = 0; i < services.length; i++) {
            const a = services[i];
            if (a.links >= MAX_LINKS_PER_NODE) continue;

            forEachNearby(i, (j) => {
                const b = services[j];
                const key = edgeKey(i, j);
                if (edges.has(key)) return;
                if (a.links >= MAX_LINKS_PER_NODE || b.links >= MAX_LINKS_PER_NODE) return;

                const dx = a.x - b.x, dy = a.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < LINK_DIST && Math.random() < EDGE_SPAWN_CHANCE * dt) {
                    edges.set(key, {
                        a, b, alpha: 0, state: 'in',
                        packetT: Math.random(),
                        packetSpeed: 0.09 + Math.random() * 0.09,
                    });
                    a.links++; b.links++;
                }
            });
        }

        edges.forEach((e, key) => {
            const dx = e.a.x - e.b.x, dy = e.a.y - e.b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (e.state === 'in') {
                e.alpha = Math.min(1, e.alpha + FADE_SPEED * dt);
                if (e.alpha >= 1) e.state = 'hold';
            } else if (e.state === 'hold') {
                if (dist > LINK_DIST_HOLD || Math.random() < EDGE_DROP_CHANCE * dt) e.state = 'out';
            } else if (e.state === 'out') {
                e.alpha = Math.max(0, e.alpha - FADE_SPEED * dt);
                if (e.alpha <= 0) {
                    e.a.links = Math.max(0, e.a.links - 1);
                    e.b.links = Math.max(0, e.b.links - 1);
                    edges.delete(key);
                }
            }

            if (!reduceMotion) {
                e.packetT += e.packetSpeed * 0.01 * dt;
                if (e.packetT > 1) e.packetT -= 1;
            }
        });
    }

    // ---------------------------------------------------------------------
    // Render — kept deliberately simple (straight lines, flat dots) but with
    // enough opacity and a soft glow that it reads clearly on light OR dark
    // backgrounds, rather than relying on one theme's contrast.
    // ---------------------------------------------------------------------
    function draw() {
        const lineColor = cssVar('--line') || 'rgba(128,128,128,0.5)';
        const accent = cssVar('--accent') || '#5b9dff';
        ctx.clearRect(0, 0, width, height);

        edges.forEach((e) => {
            ctx.globalAlpha = e.alpha * 0.55;
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(e.a.x, e.a.y);
            ctx.lineTo(e.b.x, e.b.y);
            ctx.stroke();

            if (e.state !== 'in' || e.alpha > 0.4) {
                const px = e.a.x + (e.b.x - e.a.x) * e.packetT;
                const py = e.a.y + (e.b.y - e.a.y) * e.packetT;
                ctx.globalAlpha = e.alpha;
                ctx.fillStyle = accent;
                ctx.shadowColor = accent;
                ctx.shadowBlur = 6;
                ctx.beginPath();
                ctx.arc(px, py, 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        });

        services.forEach((n) => {
            const glow = reduceMotion ? 0.5 : (Math.sin(n.pulse) + 1) / 2;
            const color = n.active ? accent : lineColor;

            if (n.active) {
                ctx.globalAlpha = 0.25 + glow * 0.15;
                ctx.fillStyle = accent;
                ctx.shadowColor = accent;
                ctx.shadowBlur = 14 + glow * 6;
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }

            ctx.globalAlpha = n.active ? 0.85 + glow * 0.15 : 0.45 + glow * 0.25;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.globalAlpha = 1;
    }

    // ---------------------------------------------------------------------
    // Loop
    // ---------------------------------------------------------------------
    function step(timestamp) {
        if (lastTime === null) lastTime = timestamp;
        const dt = Math.min(3, (timestamp - lastTime) / 16.67);
        lastTime = timestamp;

        updateServices(dt);
        updateEdges(dt);
        draw();

        rafId = reduceMotion ? null : requestAnimationFrame(step);
    }

    function startLoop() {
        if (rafId !== null || reduceMotion) return;
        lastTime = null;
        rafId = requestAnimationFrame(step);
    }

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 200);
    });

    const themeObserver = new MutationObserver(() => { if (reduceMotion) draw(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) startLoop();
    });

    resize();
    if (reduceMotion) {
        draw();
    } else {
        startLoop();
    }
})();