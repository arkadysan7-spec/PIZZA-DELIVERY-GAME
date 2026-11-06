// Draws the technician placement sketch over the photo. The same drawing is shown live in the
// editor and sent to the image model as "Image 2" (placement guide).

export const FINISH_COLORS = {
  black_matte: '#1b1b1b', chrome: '#d4d7dc', nickel: '#b3ab9c', gold: '#c9a65a', brushed_steel: '#a9adb2', white: '#f2f2f2',
};

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * quad: normalized [tl, tr, br, bl]; spec: layout/fixedSide/widthCm/doorWidthCm/fixing/stabilizer/hinge/finish.
 */
export function drawSketch(ctx, W, H, quad, spec) {
  const [tl, tr, br, bl] = quad.map((p) => ({ x: p.x * W, y: p.y * H }));
  const unit = Math.max(W, H) / 1000; // line-width unit
  // u = 0 at the left edge, 1 at the right edge (as seen in the photo)
  const top = (u) => lerp(tl, tr, u);
  const bot = (u) => lerp(bl, br, u);
  const vert = (u, t) => lerp(top(u), bot(u), t); // t=0 top, 1 bottom

  const width = Math.max(1, spec.widthCm);
  const doorFrac = spec.layout === 'fixed_door' ? Math.min(0.85, Math.max(0.15, spec.doorWidthCm / width)) : 0;
  const wallU = spec.fixedSide === 'left' ? 0 : 1;
  const freeU = 1 - wallU;
  // fixed panel spans [wallU .. split], door spans [split .. freeU]
  const split = spec.layout === 'fixed_door' ? (wallU === 0 ? 1 - doorFrac : doorFrac) : freeU;

  const poly = (u0, u1, fill, stroke, dash) => {
    ctx.beginPath();
    const a = top(u0), b = top(u1), c = bot(u1), d = bot(u0);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.setLineDash(dash || []); ctx.lineWidth = 2 * unit; ctx.strokeStyle = stroke; ctx.stroke(); ctx.setLineDash([]);
  };

  const metal = FINISH_COLORS[spec.finish] || '#222';
  const outline = spec.finish === 'black_matte' ? '#ffffff' : '#222222';

  if (spec.layout === 'door') {
    poly(0, 1, 'rgba(80,170,255,0.26)', 'rgba(20,110,220,0.95)', [10 * unit, 6 * unit]);
  } else {
    poly(wallU, split, 'rgba(80,170,255,0.36)', 'rgba(20,110,220,0.95)');
    if (spec.layout === 'fixed_door') poly(split, freeU, 'rgba(80,170,255,0.22)', 'rgba(20,110,220,0.95)', [10 * unit, 6 * unit]);
  }

  const box = (p, s) => {
    ctx.fillStyle = metal; ctx.strokeStyle = outline; ctx.lineWidth = 1.5 * unit;
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s); ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
  };
  const thick = (a, b, w) => {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineCap = 'butt'; ctx.lineWidth = w + 3 * unit; ctx.strokeStyle = outline; ctx.stroke();
    ctx.lineWidth = w; ctx.strokeStyle = metal; ctx.stroke();
  };
  const panelH = Math.hypot(top(wallU).x - bot(wallU).x, top(wallU).y - bot(wallU).y);
  const sq = Math.max(8 * unit, panelH * 0.03);

  if (spec.layout !== 'door') {
    // fixed-panel fixing on the wall edge
    if (spec.fixing === 'wall_angles') {
      box(vert(wallU, 0.1), sq);
      box(vert(wallU, 0.9), sq);
    } else {
      thick(top(wallU), bot(wallU), 6 * unit);
      if (spec.fixing === 'u_wall_floor') thick(bot(wallU), bot(split), 6 * unit);
    }
    // stabilizer from the free top corner of the fixed panel
    const anchor = top(split);
    if (spec.stabilizer === 'ceiling') thick(anchor, { x: anchor.x, y: Math.max(0, anchor.y - H * 0.12) }, 4 * unit);
    if (spec.stabilizer === 'wall') {
      const dir = wallU === 0 ? -1 : 1; // lean back toward the wall the panel is fixed to
      thick(anchor, { x: anchor.x + dir * W * 0.06, y: anchor.y - H * 0.03 }, 4 * unit);
    }
  }
  if (spec.layout === 'fixed_door' || spec.layout === 'door') {
    // hinges on the hinge edge; handle on the opposite edge
    let hingeU, handleU;
    if (spec.layout === 'door') { hingeU = wallU; handleU = freeU; }
    else if (spec.hinge === 'wall') { hingeU = freeU; handleU = split; }
    else { hingeU = split; handleU = freeU; }
    for (const t of [0.12, 0.88]) {
      const p = vert(hingeU, t);
      ctx.fillStyle = metal; ctx.strokeStyle = outline; ctx.lineWidth = 1.5 * unit;
      ctx.fillRect(p.x - sq * 0.8, p.y - sq * 0.45, sq * 1.6, sq * 0.9);
      ctx.strokeRect(p.x - sq * 0.8, p.y - sq * 0.45, sq * 1.6, sq * 0.9);
    }
    const hu = handleU + (hingeU > handleU ? 0.06 : -0.06) * (spec.layout === 'door' ? 1 : doorFrac);
    thick(vert(hu, 0.42), vert(hu, 0.58), 5 * unit);
  }
}
