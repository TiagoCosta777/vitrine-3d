// Camera-independent selection for the six photographed views.
const DIRECTIONS = {
  front: [0, 0, 1], right: [1, 0, 0], back: [0, 0, -1],
  left: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0],
};

/** Pick the photograph nearest the viewing direction, with a small dead band. */
export function faceForDirection({x = 0, y = 0, z = 0} = {}, previous = null, hysteresis = .08) {
  if (![x, y, z].every(Number.isFinite)) return previous in DIRECTIONS ? previous : 'front';
  const length = Math.hypot(x, y, z);
  if (!length) return previous in DIRECTIONS ? previous : 'front';
  const scores = Object.entries(DIRECTIONS).map(([face, [dx, dy, dz]]) => [face, (x * dx + y * dy + z * dz) / length]);
  const best = scores.reduce((winner, item) => item[1] > winner[1] ? item : winner);
  const old = scores.find(([face]) => face === previous);
  const margin = Number.isFinite(hysteresis) ? Math.max(0, hysteresis) : .08;
  return old && old[1] >= best[1] - margin ? previous : best[0];
}

/** Preserve the photographed object's proportions; the units are illustrative. */
export function cutoutPlaneSize(width, height, maxDimension = 2.9) {
  if (![width, height, maxDimension].every(value => Number.isFinite(value) && value > 0)) {
    return {width: 2.9, height: 2.9};
  }
  const scale = maxDimension / Math.max(width, height);
  return {width: width * scale, height: height * scale};
}

/** Sanitize saved or live proportion controls without accepting non-finite data. */
export function normalizeShapeOptions(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const scale = (number, min, max) => Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : 1;
  return {
    form: ['auto', 'round', 'box', 'cylinder', 'ellipsoid'].includes(value.form) ? value.form : 'auto',
    widthScale: scale(value.widthScale, .5, 1.75),
    depthScale: scale(value.depthScale, .25, 2.5),
  };
}

/**
 * Fit the bounding sphere inside both perspective half-FOVs. The sphere makes
 * the fit independent of the object's orbit angle, including portrait screens.
 * The minimum orbit distance stays outside that sphere, avoiding clipping into
 * a closed reconstructed mesh when zooming or changing the view.
 */
export function fitModelCamera(dimensions = {}, aspect = 1, options = {}) {
  const positive = (value, fallback, min = .001, max = 10000) =>
    Number.isFinite(value) && value > 0 ? Math.min(max, Math.max(min, value)) : fallback;
  const size = dimensions && typeof dimensions === 'object' ? dimensions : {};
  const opts = options && typeof options === 'object' ? options : {};
  const width = positive(size.width, 2.9);
  const height = positive(size.height, 2.9);
  const depth = positive(size.depth, 2.9);
  const radius = Math.hypot(width, height, depth) / 2;
  const fov = positive(opts.fov, 36, 5, 150);
  const padding = positive(opts.padding, 1.2, 1, 3);
  const ratio = positive(aspect, 1, .001, 1000);
  const vertical = fov * Math.PI / 360;
  const horizontal = Math.atan(Math.tan(vertical) * ratio);
  const limitingAngle = Math.min(vertical, horizontal);
  const minDistance = Math.max(.15, radius * 1.05 + .08);
  let distance = Math.max(radius * padding / Math.sin(limitingAngle), minDistance * 1.05);
  const fallbackDirection = {x: 4.5, y: 2.8, z: 6.8};
  const direction = opts.direction && typeof opts.direction === 'object' ? opts.direction : fallbackDirection;
  let x = Number.isFinite(direction.x) ? direction.x : 0;
  let y = Number.isFinite(direction.y) ? direction.y : 0;
  let z = Number.isFinite(direction.z) ? direction.z : 0;
  let length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length === 0) {
    ({x, y, z} = fallbackDirection);
    length = Math.hypot(x, y, z);
  }
  x /= length; y /= length; z /= length;
  // A box fit gives tall products more screen space at their starting angle.
  // Keep sphere fitting as the default for callers needing every-angle safety.
  if (opts.framing === 'bounds') {
    const horizontalLength = Math.hypot(x, z);
    const right = horizontalLength > 1e-8 ? [z / horizontalLength, 0, -x / horizontalLength] : [1, 0, 0];
    const up = [y * right[2] - z * right[1], z * right[0] - x * right[2], x * right[1] - y * right[0]];
    distance = minDistance * 1.05;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const corner = [sx * width / 2, sy * height / 2, sz * depth / 2];
      const along = corner[0] * x + corner[1] * y + corner[2] * z;
      const across = corner.reduce((sum, value, index) => sum + value * right[index], 0);
      const above = corner.reduce((sum, value, index) => sum + value * up[index], 0);
      distance = Math.max(distance, along + padding * Math.abs(across) / Math.tan(horizontal), along + padding * Math.abs(above) / Math.tan(vertical));
    }
  }
  return {
    position: {x: x * distance, y: y * distance, z: z * distance},
    distance,
    minDistance,
    maxDistance: distance * 3,
    target: {x: 0, y: 0, z: 0},
    radius,
  };
}
