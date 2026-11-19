// Approximate a closed volume from orthogonal alpha silhouettes.
// This recovers an outer profile, not calibrated photogrammetry or real units.
const FACES = ['front', 'right', 'back', 'left', 'top', 'bottom'];
const ALPHA = 64;
const HEIGHT = 2.9;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function alphaBounds(view, face) {
  const {width, height, data} = view || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
      width * height > 24000000 || !data || data.length !== width * height * 4) {
    throw new Error(`A vista ${face} não contém uma imagem RGBA válida.`);
  }
  const columns = new Uint32Array(width), lines = new Uint32Array(height);
  let count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] >= ALPHA) { columns[x]++; lines[y]++; count++; }
  }
  if (count < 4) throw new Error(`O contorno da vista ${face} está vazio. Capture o objeto inteiro novamente.`);
  let maxColumn = 0, maxLine = 0;
  for (const value of columns) maxColumn = Math.max(maxColumn, value);
  for (const value of lines) maxLine = Math.max(maxLine, value);
  // Ignore isolated alpha specks without requiring one connected component:
  // a cap or fine part may be separated from the body by segmentation.
  const columnLimit = Math.max(1, Math.floor(maxColumn * .01));
  const lineLimit = Math.max(1, Math.floor(maxLine * .01));
  let left = 0, right = width - 1, top = 0, bottom = height - 1;
  while (left < width && columns[left] < columnLimit) left++;
  while (right >= left && columns[right] < columnLimit) right--;
  while (top < height && lines[top] < lineLimit) top++;
  while (bottom >= top && lines[bottom] < lineLimit) bottom--;
  const boxWidth = right - left + 1, boxHeight = bottom - top + 1;
  if (boxWidth < 1 || boxHeight < 1) throw new Error(`Não foi possível obter o contorno da vista ${face}.`);
  let inside = 0;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (data[(y * width + x) * 4 + 3] >= ALPHA) inside++;
  }
  if (inside / (boxWidth * boxHeight) < .005) throw new Error(`O contorno da vista ${face} não é suficiente para estimar o volume.`);
  return {
    x:left, y:top, width:boxWidth, height:boxHeight, imageWidth:width, imageHeight:height,
    uv:[left / width, 1 - (top + boxHeight) / height, (left + boxWidth) / width, 1 - top / height],
    coverage:inside / (boxWidth * boxHeight),
  };
}

function silhouetteProfile(view, bounds, rows) {
  const profile = new Array(rows), {width, data} = view;
  for (let index = 0; index < rows; index++) {
    const target = bounds.y + index / (rows - 1) * (bounds.height - 1);
    const radius = Math.max(0, Math.floor(bounds.height / rows / 2));
    const first = Math.max(bounds.y, Math.round(target) - radius);
    const last = Math.min(bounds.y + bounds.height - 1, Math.round(target) + radius);
    const starts = [], ends = [];
    for (let y = first; y <= last; y++) {
      let left = -1, right = -1;
      for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
        if (data[(y * width + x) * 4 + 3] < ALPHA) continue;
        if (left < 0) left = x; right = x;
      }
      if (left >= 0) { starts.push(left); ends.push(right + 1); }
    }
    if (starts.length) {
      const left = median(starts), right = median(ends);
      profile[index] = {width:(right - left) / bounds.width,
        center:((left + right) / 2 - bounds.x) / bounds.width - .5};
    } else profile[index] = null;
  }
  // A missing strip is an occlusion/segmentation gap, not evidence of zero volume.
  for (let index = 0; index < rows; index++) if (!profile[index]) {
    let before = index - 1, after = index + 1;
    while (before >= 0 && !profile[before]) before--;
    while (after < rows && !profile[after]) after++;
    if (before < 0 && after === rows) throw new Error('Um dos perfis do objeto está vazio.');
    if (before < 0) profile[index] = {...profile[after]};
    else if (after === rows) profile[index] = {...profile[before]};
    else {
      const t = (index - before) / (after - before);
      profile[index] = {width:profile[before].width * (1 - t) + profile[after].width * t,
        center:profile[before].center * (1 - t) + profile[after].center * t};
    }
  }
  // Short mask spikes otherwise become rings and kinks in the solid. A median
  // removes those isolated strips while leaving sustained steps (a neck, cap,
  // shoulder or box edge) in place. Clamp the window to retain the end profiles.
  const cleaned = profile.map((item, index) => {
    const neighborhood = [-2,-1,0,1,2].map(offset => profile[clamp(index + offset, 0, rows - 1)]);
    return {width:median(neighborhood.map(sample => sample.width)),
      center:median(neighborhood.map(sample => sample.center))};
  });
  // Smooth small sampling stair-steps without averaging across a large change
  // of silhouette. Width and center both constrain the edge-aware weights.
  const widthSigma = Math.max(.05, 2 / bounds.width), centerSigma = Math.max(.03, 1 / bounds.width);
  const spatial = [1,4,6,4,1];
  return cleaned.map((item, index) => {
    let width = 0, center = 0, weight = 0;
    for (let offset = -2; offset <= 2; offset++) {
      const sample = cleaned[clamp(index + offset, 0, rows - 1)];
      const difference = ((sample.width - item.width) / widthSigma) ** 2 +
        ((sample.center - item.center) / centerSigma) ** 2;
      const contribution = spatial[offset + 2] * Math.exp(-difference / 2);
      width += sample.width * contribution; center += sample.center * contribution; weight += contribution;
    }
    return {width:width / weight, center:center / weight};
  });
}

/**
 * views: {front,right,back,left,top,bottom}, each {width,height,data: RGBA bytes}.
 * World axes: +X right, +Y top, +Z front. Positions are scene units, not meters.
 * Bounds.uv uses Three.js UV coordinates [uMin,vMin,uMax,vMax].
 */
export function buildObjectShape(views, {form = 'auto', rows = 80, segments = 80} = {}) {
  if (!['auto','round','box','cylinder','ellipsoid'].includes(form)) throw new Error('Formato de objeto inválido.');
  rows = clamp(Number.isFinite(rows) ? Math.floor(rows) : 80, 8, 96);
  segments = clamp(Number.isFinite(segments) ? Math.round(segments / 4) * 4 : 80, 12, 96);
  const bounds = {};
  for (const face of FACES) bounds[face] = alphaBounds(views?.[face], face);
  const aspects = Object.fromEntries(FACES.map(face => [face, bounds[face].width / bounds[face].height]));
  const widthRatio = mean([aspects.front, aspects.back]);
  const depthRatio = mean([aspects.right, aspects.left]);
  const width = clamp(widthRatio, .04, 3) * HEIGHT;
  const depth = clamp(depthRatio, .04, 3) * HEIGHT;
  const scaleX = width / (widthRatio * HEIGHT), scaleZ = depth / (depthRatio * HEIGHT);
  const topFill = mean([bounds.top.coverage, bounds.bottom.coverage]);
  const profiles = Object.fromEntries(['front','back','right','left'].map(face => [face, silhouetteProfile(views[face], bounds[face], rows)]));
  // A hand or retained surface around a cap can make a top mask look square.
  // Corroborate that evidence with the sustained neck/body profile instead of
  // turning a clearly necked container into a box because of one noisy view.
  const neckViews = Object.values(profiles).filter(profile => {
    const neck = median(profile.slice(Math.max(1, Math.floor(rows * .04)), Math.ceil(rows * .22)).map(item => item.width));
    const body = median(profile.slice(Math.floor(rows * .38), Math.ceil(rows * .78)).map(item => item.width));
    return body >= .5 && neck < body * .78;
  }).length;
  const resolvedForm = form === 'auto' ? (topFill >= .9 && neckViews < 3 ? 'box' : 'round') : form;
  const exponent = resolvedForm === 'box' ? 8 : 2;
  const ellipsoid = resolvedForm === 'ellipsoid', cylinder = resolvedForm === 'cylinder';
  // Ellipsoids use intermediate latitude rings and one vertex per pole. A
  // zero-radius ring with a flat cap would produce degenerate triangles.
  const rings = ellipsoid ? rows - 1 : rows;
  const positions = new Float32Array((rings * segments + (ellipsoid ? 2 : 2 * (segments + 1))) * 3);
  const indices = new Uint32Array(((rings - 1) * segments * 2 + segments * 2) * 3);
  let offset = 0;
  const put = (x, y, z) => { positions[offset++] = x; positions[offset++] = y; positions[offset++] = z; };
  for (let row = 0; row < rings; row++) {
    const front = profiles.front[row], back = profiles.back[row], right = profiles.right[row], left = profiles.left[row];
    const latitude = ellipsoid ? (row + 1) / rows * Math.PI : 0;
    const rowWidth = ellipsoid ? width * Math.sin(latitude) : cylinder ? width : mean([front.width * aspects.front, back.width * aspects.back]) * HEIGHT * scaleX;
    const rowDepth = ellipsoid ? depth * Math.sin(latitude) : cylinder ? depth : mean([right.width * aspects.right, left.width * aspects.left]) * HEIGHT * scaleZ;
    const radiusX = ellipsoid ? rowWidth / 2 : Math.max(HEIGHT * .002, rowWidth / 2);
    const radiusZ = ellipsoid ? rowDepth / 2 : Math.max(HEIGHT * .002, rowDepth / 2);
    // Explicit primitives regularize the shape; auto/round/box still follow
    // the photographed profiles and their asymmetric centers unchanged.
    const centerX = cylinder || ellipsoid ? 0 : (front.center * aspects.front - back.center * aspects.back) / 2 * HEIGHT * scaleX;
    const centerZ = cylinder || ellipsoid ? 0 : (left.center * aspects.left - right.center * aspects.right) / 2 * HEIGHT * scaleZ;
    const y = ellipsoid ? HEIGHT / 2 * Math.cos(latitude) : HEIGHT * (.5 - row / (rows - 1));
    for (let segment = 0; segment < segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      const rawCosine = Math.cos(angle), rawSine = Math.sin(angle);
      const cosine = Math.abs(rawCosine) < 1e-12 ? 0 : rawCosine, sine = Math.abs(rawSine) < 1e-12 ? 0 : rawSine;
      put(centerX + radiusX * Math.sign(cosine) * Math.abs(cosine) ** (2 / exponent), y,
          centerZ + radiusZ * Math.sign(sine) * Math.abs(sine) ** (2 / exponent));
    }
  }
  let indexOffset = 0;
  const triangle = (a, b, c) => { indices[indexOffset++] = a; indices[indexOffset++] = b; indices[indexOffset++] = c; };
  for (let row = 0; row < rings - 1; row++) for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    const a = row * segments + segment, b = row * segments + next;
    const c = (row + 1) * segments + segment, d = (row + 1) * segments + next;
    triangle(a, b, c); triangle(b, d, c);
  }
  // Cylinders and photographed profiles retain flat caps. Ellipsoid fans join
  // existing rings directly to unique poles, maintaining a closed smooth solid.
  for (const row of [0, rings - 1]) {
    const center = offset / 3;
    let centerX = 0, centerZ = 0;
    for (let segment = 0; segment < segments; segment++) {
      centerX += positions[(row * segments + segment) * 3];
      centerZ += positions[(row * segments + segment) * 3 + 2];
    }
    put(ellipsoid ? 0 : centerX / segments, row === 0 ? HEIGHT / 2 : -HEIGHT / 2, ellipsoid ? 0 : centerZ / segments);
    // Duplicate cap rims only for flat caps so their normals stay distinct.
    if (!ellipsoid) for (let segment = 0; segment < segments; segment++) {
      const start = (row * segments + segment) * 3;
      put(positions[start], positions[start + 1], positions[start + 2]);
    }
    for (let segment = 0; segment < segments; segment++) {
      const rim = ellipsoid ? row * segments : center + 1;
      const current = rim + segment, next = rim + (segment + 1) % segments;
      if (row === 0) triangle(center, next, current); else triangle(center, current, next);
    }
  }
  const disagreement = (a, b) => Math.abs(a - b) / Math.max((a + b) / 2, .001);
  const frontBackDifference = disagreement(aspects.front, aspects.back);
  const sideDifference = disagreement(aspects.right, aspects.left);
  const warnings = [];
  if (frontBackDifference > .3 || sideDifference > .3) warnings.push('As proporções das vistas opostas diferem. Confira o enquadramento e o lado fotografado.');
  if (widthRatio < .04 || widthRatio > 3 || depthRatio < .04 || depthRatio > 3) warnings.push('As proporções foram limitadas para manter uma visualização utilizável.');
  return {
    positions, indices, dimensions:{width, height:HEIGHT, depth}, bounds,
    form:resolvedForm, exponent,
    diagnostics:{approximate:true, method:ellipsoid ? 'parametric-ellipsoid' : cylinder ? 'parametric-cylinder' : 'silhouette-profiles', requestedForm:form,
      alphaThreshold:ALPHA, rows, rings, segments, vertexCount:positions.length / 3, triangleCount:indices.length / 3,
      topFillRatio:topFill, neckViews, frontBackDifference, sideDifference, warnings},
  };
}
