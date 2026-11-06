// Builds the image-model instruction from the user's selections.
// Written in English: image models follow English constraints most reliably.

import { FINISHES } from './extract.js';

const clampNum = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

const WALL_STYLES = {
  keep: null,
  'large-white': 'large-format 60x120 cm glossy white porcelain tiles with thin light-grey grout',
  'marble': 'large-format 60x120 cm white Calacatta-look marble porcelain tiles, book-matched veining, thin grout',
  'concrete': 'large-format 60x120 cm warm grey concrete-look matte porcelain tiles',
  'subway-white': 'white glossy 7.5x15 cm subway tiles in running bond with white grout',
  'terrazzo': 'light terrazzo-look porcelain tiles 60x60 cm',
  'wood': 'warm oak wood-look porcelain planks on the walls',
};
const FLOOR_STYLES = {
  keep: null,
  'concrete': 'large-format 60x60 cm grey concrete-look matte anti-slip porcelain floor tiles',
  'marble': '60x60 cm white marble-look matte anti-slip porcelain floor tiles',
  'dark': '60x60 cm anthracite dark grey matte anti-slip porcelain floor tiles',
  'wood': 'oak wood-look porcelain floor planks, matte, anti-slip',
  'hex': 'small matte white hexagon mosaic floor tiles',
};
export const RENOVATION_OPTIONS = { walls: Object.keys(WALL_STYLES), floor: Object.keys(FLOOR_STYLES) };

/** Sanitise client options into a fully-specified spec. */
export function normalizeSpec(o = {}) {
  const layout = ['fixed', 'fixed_door', 'door'].includes(o.layout) ? o.layout : 'fixed_door';
  const width = clampNum(o.widthCm, 30, 300, 120);
  return {
    layout,
    fixedSide: o.fixedSide === 'left' ? 'left' : 'right',
    widthCm: width,
    heightCm: clampNum(o.heightCm, 150, 260, 195),
    doorWidthCm: clampNum(o.doorWidthCm, 40, Math.max(40, width - (layout === 'door' ? 0 : 20)), 60),
    glassMm: clampNum(o.glassMm, 4, 12, 8),
    glassType: ['clear', 'extra_clear', 'frosted', 'fluted', 'grey'].includes(o.glassType) ? o.glassType : 'clear',
    finish: FINISHES[o.finish] ? o.finish : 'black_matte',
    fixing: ['wall_angles', 'u_wall', 'u_wall_floor'].includes(o.fixing) ? o.fixing : 'wall_angles',
    stabilizer: ['none', 'wall', 'ceiling'].includes(o.stabilizer) ? o.stabilizer : 'wall',
    hinge: o.hinge === 'wall' ? 'wall' : 'glass',
    walls: WALL_STYLES[o.walls] !== undefined ? o.walls : 'keep',
    floor: FLOOR_STYLES[o.floor] !== undefined ? o.floor : 'keep',
    productName: String(o.productName || '').slice(0, 120),
    notes: String(o.notes || '').slice(0, 400),
  };
}

export function buildPrompt(spec, { hasProductImage = false } = {}) {
  const f = FINISHES[spec.finish];
  const finish = f.en;
  const wallSide = spec.fixedSide; // fixed panel is mounted to the wall on this side (as seen in the photo)
  const otherSide = wallSide === 'left' ? 'right' : 'left';
  const fixedWidth = spec.layout === 'fixed_door' ? spec.widthCm - spec.doorWidthCm : spec.widthCm;

  const glass = {
    clear: 'clear tempered safety glass',
    extra_clear: 'extra-clear low-iron tempered glass (no green tint)',
    frosted: 'satin acid-etched frosted tempered glass (translucent, blurs what is behind it)',
    fluted: 'fluted / reeded tempered glass with fine vertical ribs',
    grey: 'smoked grey tinted tempered glass',
  }[spec.glassType];

  const L = [];
  L.push('Edit the bathroom photo (Image 1) to show it AFTER a professional glass shower enclosure has been installed. The result must look like a real, unretouched photo taken from the exact same spot with the same phone.');
  L.push('');
  L.push('INPUT IMAGES');
  L.push('- Image 1: the original photo. It is the ground truth for the room, the camera and the light.');
  L.push('- Image 2: the same photo with a rough technician sketch. The translucent blue quadrilateral marks EXACTLY where the glass plane stands (its bottom edge sits on the floor/shower tray line, its vertical edges are the panel edges). Darker lines mark profiles, small squares mark wall brackets, small bars mark hinges. It is a placement guide only: do NOT reproduce any blue tint, outline, dot, handle or sketch line.');
  if (hasProductImage) L.push(`- Image 3: catalog photo of the chosen product${spec.productName ? ` ("${spec.productName}")` : ''}. Match its design language, proportions and hardware style; ignore its background and the room it is shown in.`);
  L.push('');
  L.push('HARD CONSTRAINTS – PRESERVE THE ORIGINAL');
  L.push('- Same camera position, lens, perspective, vanishing points, framing, crop and aspect ratio as Image 1. Do not zoom, rotate, straighten, widen or re-frame.');
  L.push('- Every existing fixture stays exactly where it is, same size, shape and color: toilet, sink, vanity, faucets, shower mixer and shower head, drain, niche, window, door, mirror, radiator, pipes, switches, lamps, towels and accessories. Do not add, remove, move, resize or restyle any of them.');
  L.push(spec.walls === 'keep'
    ? '- Walls: keep the existing wall tiles/paint exactly (same pattern, color, size and grout lines).'
    : `- Walls: re-clad all visible walls with ${WALL_STYLES[spec.walls]}. Keep wall geometry, corners, openings and all fixtures in place; tiles must follow the correct perspective.`);
  L.push(spec.floor === 'keep'
    ? '- Floor: keep the existing floor exactly.'
    : `- Floor: replace the floor finish with ${FLOOR_STYLES[spec.floor]}, in correct perspective; keep the drain position.`);
  L.push('- Keep the original lighting direction, white balance, exposure, noise and sharpness. Glass must pick up believable reflections of THIS room only.');
  L.push('');
  L.push('THE SHOWER ENCLOSURE (install it precisely in the sketched area)');
  L.push(`- Overall size: about ${spec.widthCm} cm wide x ${spec.heightCm} cm high, standing on the floor, frameless.`);
  L.push(`- Glass: ${spec.glassMm} mm ${glass}, polished edges; the ${spec.glassMm} mm edge thickness is visible on exposed edges.`);
  L.push(`- ALL metal hardware is ${finish}, one consistent finish.`);

  if (spec.layout !== 'door') {
    L.push(`- Fixed glass panel ${fixedWidth} cm wide, on the ${wallSide} side of the sketched area, mounted to the ${wallSide} wall.`);
    if (spec.fixing === 'wall_angles') {
      L.push('- Fixed-panel fixing: exactly TWO small 90° wall-to-glass angle clamps on the wall edge of the panel – one near the top, one near the bottom (about 20 cm from each end). From outside only a small neat square plate about 4x4 cm is visible for each clamp. NO continuous profile along the wall.');
    } else {
      L.push('- Fixed-panel fixing: a slim U-channel profile, 10x10 mm (1x1 cm), running the full height of the wall edge, gripping the glass edge, flush and minimal.');
      if (spec.fixing === 'u_wall_floor') L.push(`- A second identical 10x10 mm U-channel runs along the bottom edge of the fixed panel on the floor.`);
    }
    if (spec.stabilizer === 'wall') L.push('- Stabilizer: one thin round stabilizer bar (Ø about 16–19 mm) from the top of the fixed panel\'s free edge back to the wall behind, at 90° to the glass, horizontal, with small round end fittings.');
    if (spec.stabilizer === 'ceiling') L.push('- Stabilizer: one thin round stabilizer bar (Ø about 16–19 mm) from the top of the fixed panel\'s free edge vertically up to the ceiling, with small round end fittings.');
  }
  if (spec.layout === 'fixed_door' || spec.layout === 'door') {
    const hingeTo = spec.layout === 'door' || spec.hinge === 'wall'
      ? `hinged to the ${spec.layout === 'door' ? wallSide : otherSide} wall with two glass-to-wall hinges`
      : 'hinged to the fixed panel with two glass-to-glass 180° hinges (top and bottom)';
    L.push(`- Hinged glass door about ${spec.doorWidthCm} cm wide on the ${spec.layout === 'door' ? 'sketched area' : otherSide + ' side'}, ${hingeTo}. The door is closed, flush with the fixed panel, opens outward, with a slim vertical pull handle (about 30 cm) or knob in the same finish and a clear magnetic/seal strip on its edges.`);
  } else {
    L.push(`- No door: walk-in panel; the ${otherSide} edge of the glass is free, with an open entrance beside it.`);
  }
  L.push('- Nothing else: no extra frames, bars, shelves, towel bars, curtain, logo or text.');
  if (spec.notes) L.push(`- Installer note (secondary to the constraints above): ${spec.notes}`);
  L.push('');
  L.push('OUTPUT: one photorealistic image, same aspect ratio as Image 1, high detail, physically correct glass refraction and reflections, contact shadows where hardware meets the wall and floor. No text, no watermark, no borders, no split view.');
  return L.join('\n');
}
