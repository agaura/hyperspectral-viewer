export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function normaliseTypedArray(array) {
  if (array instanceof Float32Array) {
    return array;
  }
  if (ArrayBuffer.isView(array)) {
    return Float32Array.from(array);
  }
  return Float32Array.from(array);
}

export function updateGlobalMaxFromArray(array, state) {
  if (!array || !array.length) {
    return;
  }
  let max = -Infinity;
  for (let i = 0; i < array.length; i += 1) {
    const value = array[i];
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  if (!Number.isFinite(max)) {
    return;
  }
  state.globalMax = max;
  state.globalYAxisMax = computeYAxisCeil(max);
}

export function updateGlobalMaxCandidate(value, state) {
  if (!Number.isFinite(value)) {
    return;
  }
  if (!Number.isFinite(state.globalMax) || value > state.globalMax) {
    state.globalMax = value;
    state.globalYAxisMax = computeYAxisCeil(value);
  }
}

export function computeYAxisCeil(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 10;
  }
  let rounded = Math.ceil(value / 10) * 10;
  if (rounded <= value) {
    rounded += 10;
  }
  return rounded;
}

export function nearestBand(target, wavelengths) {
  let index = 0;
  let best = Infinity;
  for (let i = 0; i < wavelengths.length; i += 1) {
    const diff = Math.abs(wavelengths[i] - target);
    if (diff < best) {
      best = diff;
      index = i;
    }
  }
  return index;
}

export function defaultBandIndex(wavelengths) {
  if (!wavelengths.length) {
    return 0;
  }
  const visibleStart = 450;
  const visibleEnd = 650;
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < wavelengths.length; i += 1) {
    const wl = wavelengths[i];
    if (!Number.isFinite(wl)) {
      continue;
    }
    let distance = 0;
    if (wl < visibleStart) {
      distance = visibleStart - wl;
    } else if (wl > visibleEnd) {
      distance = wl - visibleEnd;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function formatRadianceLabel(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return value.toExponential(2);
  }
  if (abs >= 10) {
    return value.toFixed(1);
  }
  if (abs >= 1) {
    return value.toFixed(2);
  }
  return value.toPrecision(3);
}

export function formatPixelInfo(selected, hover) {
  const selectedText = selected ? `Sel x ${selected.x}, y ${selected.y}` : 'Sel —';
  const hoverText = hover ? `Hover x ${hover.x}, y ${hover.y}` : 'Hover —';
  return `${selectedText} | ${hoverText}`;
}

export function formatDualRadiance(selected, hover) {
  const selLabel = `Sel ${formatRadianceLabel(selected)}`;
  const hoverLabel = `Hover ${formatRadianceLabel(hover)}`;
  return `${selLabel} | ${hoverLabel}`;
}
