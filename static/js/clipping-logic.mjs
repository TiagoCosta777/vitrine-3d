// A view-only half-space cut. World-space points with n.p + c < 0 are hidden.
export function normalizeClippingOptions(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    enabled: value.enabled === true,
    axis: ['x', 'y', 'z'].includes(value.axis) ? value.axis : 'x',
    position: Number.isFinite(value.position) ? Math.min(1, Math.max(0, value.position)) : .5,
    inverted: value.inverted === true,
  };
}

export function clippingPlaneForBounds(bounds = {}, options = {}) {
  const settings = normalizeClippingOptions(options), minimum = {}, maximum = {};
  const safeCoordinate = (value, fallback) => Number.isFinite(value) ? Math.min(1e6, Math.max(-1e6, value)) : fallback;
  for (const axis of ['x', 'y', 'z']) {
    const first = safeCoordinate(bounds?.min?.[axis], -1);
    const last = safeCoordinate(bounds?.max?.[axis], 1);
    minimum[axis] = Math.min(first, last); maximum[axis] = Math.max(first, last);
  }
  const coordinate = minimum[settings.axis] + (maximum[settings.axis] - minimum[settings.axis]) * settings.position;
  const normal = {x: 0, y: 0, z: 0}; normal[settings.axis] = settings.inverted ? -1 : 1;
  return {
    ...settings, normal, constant: -normal[settings.axis] * coordinate, coordinate,
    helperSize: Math.max(.1, ...['x', 'y', 'z'].map(axis => maximum[axis] - minimum[axis])) * 1.15,
  };
}
