(function () {
    const canvas = document.createElement('canvas');
    canvas.id = 'bgCanvas';
    document.body.prepend(canvas);

    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width, height;
    let services = [];
    let edges = new Map(); // key: "i-j" -> edge state
    let mouseX = -9999, mouseY = -9999;

    const SERVICE_DENSITY = 42000; // px² per service node
    const LINK_DIST = 260;
    const EDGE_SPAWN_CHANCE = 0.0025;   // per pair, per frame, when in range and not connected
    const EDGE_DROP_CHANCE = 0.0035;    // per active edge, per frame
    const FADE_SPEED = 0.03;
    const MOUSE_RADIUS = 150;

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = document.documentElement.scrollHeight;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        initServices();
    }

    function initServices() {
        const count = Math.max(16, Math.floor((width * height) / SERVICE_DENSITY));
        services = Array.from({ length: count }, (_, i) => ({
            id: i,
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.1,
            vy: (Math.random() - 0.5) * 0.1,
            r: Math.random() < 0.2 ? 3.4 : 1.8,      // a minority are "bigger" services
            pulse: Math.random() * Math.PI * 2,
            active: Math.random() < 0.2,              // "bigger" services glow like hubs
        }));
        edges = new Map();
    }

    function edgeKey(i, j) { return i < j ? `${i}-${j}` : `${j}-${i}`; }

    function updateServices() {
        services.forEach((n) => {
            if (reduceMotion) return;
            n.x += n.vx;
            n.y += n.vy;
            if (n.x < 0 || n.x > width) n.vx *= -1;
            if (n.y < 0 || n.y > height) n.vy *= -1;
            n.pulse += 0.02;

            const dx = n.x - mouseX;
            const dy = n.y - mouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < MOUSE_RADIUS) {
                const force = (1 - dist / MOUSE_RADIUS) * 0.5;
                n.x += (dx / (dist || 1)) * force;
                n.y += (dy / (dist || 1)) * force;
            }
        });
    }

    function updateEdges() {
        // spawn new edges between nearby, unconnected services
        for (let i = 0; i < services.length; i++) {
            for (let j = i + 1; j < services.length; j++) {
                const key = edgeKey(i, j);
                if (edges.has(key)) continue;
                const dx = services[i].x - services[j].x;
                const dy = services[i].y - services[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < LINK_DIST && Math.random() < EDGE_SPAWN_CHANCE) {
                    edges.set(key, {
                        a: services[i], b: services[j],
                        alpha: 0, state: 'in',
                        packetT: Math.random(), packetSpeed: 0.006 + Math.random() * 0.008,
                    });
                }
            }
        }

        // update lifecycle of existing edges
        edges.forEach((e, key) => {
            const dx = e.a.x - e.b.x;
            const dy = e.a.y - e.b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (e.state === 'in') {
                e.alpha = Math.min(1, e.alpha + FADE_SPEED);
                if (e.alpha >= 1) e.state = 'hold';
            } else if (e.state === 'hold') {
                if (dist > LINK_DIST * 1.3 || Math.random() < EDGE_DROP_CHANCE) e.state = 'out';
            } else if (e.state === 'out') {
                e.alpha = Math.max(0, e.alpha - FADE_SPEED);
                if (e.alpha <= 0) edges.delete(key);
            }

            if (!reduceMotion) {
                e.packetT += e.packetSpeed;
                if (e.packetT > 1) e.packetT = 0;
            }
        });
    }

    function draw() {
        const lineColor = cssVar('--line');
        const accent = cssVar('--accent');
        ctx.clearRect(0, 0, width, height);

        // edges + traveling packets
        edges.forEach((e) => {
            ctx.globalAlpha = e.alpha * 0.4;
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(e.a.x, e.a.y);
            ctx.lineTo(e.b.x, e.b.y);
            ctx.stroke();

            if (e.state !== 'in' || e.alpha > 0.4) {
                const px = e.a.x + (e.b.x - e.a.x) * e.packetT;
                const py = e.a.y + (e.b.y - e.a.y) * e.packetT;
                ctx.globalAlpha = e.alpha * 0.85;
                ctx.fillStyle = accent;
                ctx.beginPath();
                ctx.arc(px, py, 1.8, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // service nodes
        services.forEach((n) => {
            const glow = reduceMotion ? 0.5 : (Math.sin(n.pulse) + 1) / 2;
            const color = n.active ? accent : lineColor;

            if (n.active) {
                const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 16 + glow * 8);
                grad.addColorStop(0, color);
                grad.addColorStop(1, 'transparent');
                ctx.globalAlpha = 0.15 + glow * 0.1;
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(n.x, n.y, 16 + glow * 8, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.globalAlpha = n.active ? 0.7 + glow * 0.3 : 0.22 + glow * 0.2;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.globalAlpha = 1;
    }

    function step() {
        updateServices();
        updateEdges();
        draw();
        if (!reduceMotion) requestAnimationFrame(step);
    }

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 200);
    });

    window.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY + window.scrollY;
    }, { passive: true });

    window.addEventListener('mouseleave', () => {
        mouseX = -9999;
        mouseY = -9999;
    });

    const themeObserver = new MutationObserver(() => { if (reduceMotion) draw(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !reduceMotion) requestAnimationFrame(step);
    });

    resize();
    step();
})();