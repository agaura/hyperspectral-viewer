import * as THREE from 'three';
import { fromUrl } from 'https://esm.sh/geotiff@2.1.3';

const d3 = window.d3;

const imageWrapper = document.getElementById('image-wrapper');
const imageCanvas = document.getElementById('image-canvas');
const stripWrapper = document.getElementById('strip-wrapper');
const stripCanvas = document.getElementById('strip-canvas');
const stripAxisContainer = document.getElementById('strip-axis');
const chartWrapper = document.querySelector('.chart-wrapper');
const chartSvgElement = document.getElementById('spectrum-chart');
const loadingOverlay = document.getElementById('loading');

const bandMinSlider = document.getElementById('band-min-slider');
const bandMaxSlider = document.getElementById('band-max-slider');
const bandMinValueLabel = document.getElementById('band-min-value');
const bandMaxValueLabel = document.getElementById('band-max-value');
const autoRangeToggle = document.getElementById('band-auto-toggle');
const selectionIndicator = document.getElementById('selection-indicator');

const infoWavelength = document.getElementById('info-wavelength');
const infoPosition = document.getElementById('info-position');
const infoReflectance = document.getElementById('info-reflectance');

// --- renderer setup ---
const mainContext = imageCanvas.getContext('webgl2', { antialias: true, alpha: true }) || undefined;
const rendererMain = new THREE.WebGLRenderer({
  canvas: imageCanvas,
  context: mainContext,
  antialias: true,
  alpha: true,
});
rendererMain.outputColorSpace = THREE.DisplayP3ColorSpace;
rendererMain.setPixelRatio(window.devicePixelRatio);
rendererMain.setClearColor(0x000000, 0);

const stripContext = stripCanvas.getContext('webgl2', { antialias: true, alpha: true }) || undefined;
const rendererStrip = new THREE.WebGLRenderer({
  canvas: stripCanvas,
  context: stripContext,
  antialias: true,
  alpha: true,
});
rendererStrip.outputColorSpace = THREE.DisplayP3ColorSpace;
rendererStrip.setPixelRatio(window.devicePixelRatio);
rendererStrip.setClearColor(0x000000, 0);

const isWebGL2 = rendererMain.capabilities.isWebGL2;

const sceneMain = new THREE.Scene();
const cameraMain = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
cameraMain.position.z = 2;

const sceneStrip = new THREE.Scene();
const cameraStrip = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
cameraStrip.position.z = 2;

// --- shaders ---
const vertexShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const mainFragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uTexture;
  uniform sampler2D uSpectralTexture;
  uniform float uSpectralScale;
  uniform float uSpectralCoord;
  uniform float uMinValue;
  uniform float uMaxValue;

  const float ALPHA = 0.38130632325908215;
  const float GRAY = 0.3340893499109253;

  mat3 xyz_to_p3() {
    return mat3(
      2.4934969, -0.8294890,  0.0358458,
     -0.9313836,  1.7626641, -0.0761724,
     -0.4027108,  0.0236247,  0.9568845
    );
  }

  float normalizeValue(float value) {
    float span = max(uMaxValue - uMinValue, 1e-6);
    return clamp((value - uMinValue) / span, 0.0, 1.0);
  }

  float srgb_transfer_function(float a) {
    return a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 1.0 / 2.4) - 0.055;
  }

  vec3 srgb_transfer_function(vec3 a) {
    return vec3(
      srgb_transfer_function(a.x),
      srgb_transfer_function(a.y),
      srgb_transfer_function(a.z)
    );
  }

  vec3 spectralBandColor() {
    vec3 xyzSpectral = texture2D(uSpectralTexture, vec2(uSpectralCoord, 0.5)).rgb * uSpectralScale;
    return xyz_to_p3() * xyzSpectral;
  }

  void main() {
    float value = texture2D(uTexture, vUv).r;
    float norm = normalizeValue(value);
    vec3 bandColor = spectralBandColor();
    vec3 p3LinearGray = vec3(GRAY) * (1.0 - ALPHA);
    vec3 p3LinearProjectedBandColor = p3LinearGray + ALPHA * bandColor;
    //vec3 projected = mix(p3LinearGray, p3LinearProjectedBandColor, norm);
    vec3 projected = mix(vec3(0.), p3LinearProjectedBandColor, norm);
    bool outOfGamut = any(greaterThan(projected, vec3(1.0))) || any(lessThan(projected, vec3(0.0)));
    if (outOfGamut) {
      gl_FragColor = vec4(vec3(0.0), 1.0);
    } else {
      vec3 display = srgb_transfer_function(clamp(projected, 0.0, 1.0));
      gl_FragColor = vec4(display, 1.0);
    }
  }
`;

const stripFragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uTexture;
  uniform float uScale;

  const float DIMMING_FACTOR = 2.1230881684358494;
  const float ALPHA = 0.7715569276056665;
  const float GRAY = 0.8015956245904453;

  mat3 xyz_to_p3() {
    return mat3(
      2.4934969, -0.8294890,  0.0358458,
     -0.9313836,  1.7626641, -0.0761724,
     -0.4027108,  0.0236247,  0.9568845
    );
  }

  float srgb_transfer_function(float a) {
    return a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 1.0 / 2.4) - 0.055;
  }

  vec3 srgb_transfer_function(vec3 a) {
    return vec3(
      srgb_transfer_function(a.x),
      srgb_transfer_function(a.y),
      srgb_transfer_function(a.z)
    );
  }

  void main() {
    vec3 xyzSpectral = texture2D(uTexture, vec2(vUv.x, 0.5)).rgb * uScale;
    vec3 xyzDimmed = xyzSpectral / DIMMING_FACTOR;
    vec3 p3LinearIdeal = xyz_to_p3() * xyzDimmed;

    vec3 p3LinearGray = vec3(GRAY) * (1.0 - ALPHA);
    vec3 p3LinearProjected = p3LinearGray + ALPHA * p3LinearIdeal;

    bool outOfGamut = any(greaterThan(p3LinearProjected, vec3(1.0))) || any(lessThan(p3LinearProjected, vec3(0.0)));

    if (outOfGamut) {
      gl_FragColor = vec4(vec3(0.0), 1.0);
    } else {
      vec3 display = srgb_transfer_function(clamp(p3LinearProjected, 0.0, 1.0));
      gl_FragColor = vec4(display, 1.0);
    }
  }
`;
// --- chart + axis scaffolding ---
const axisSvg = d3.select(stripAxisContainer).append('svg');
const axisGroup = axisSvg.append('g').attr('class', 'axis');
const axisLabel = axisSvg
  .append('text')
  .attr('class', 'axis-label')
  .attr('text-anchor', 'middle')
  .text('Wavelength (nm)');
const axisPointer = axisSvg.append('line').attr('class', 'strip-highlight').style('display', 'none');

const chartSvg = d3.select(chartSvgElement);
const chartGroup = chartSvg.append('g');
const xAxisGroup = chartGroup.append('g').attr('class', 'chart-axis chart-axis-x');
const yAxisGroup = chartGroup.append('g').attr('class', 'chart-axis chart-axis-y');
const selectedSpectrumPath = chartGroup.append('path').attr('class', 'spectrum-line spectrum-line--selected');
const hoverSpectrumPath = chartGroup
  .append('path')
  .attr('class', 'spectrum-line spectrum-line--hover')
  .style('display', 'none');
const selectedHighlightGroup = chartGroup.append('g').attr('class', 'chart-highlight chart-highlight--selected');
const selectedHighlightLine = selectedHighlightGroup.append('line');
const selectedHighlightDot = selectedHighlightGroup.append('circle').attr('r', 3.8);
const hoverHighlightGroup = chartGroup.append('g').attr('class', 'chart-highlight chart-highlight--hover');
const hoverHighlightLine = hoverHighlightGroup.append('line');
const hoverHighlightDot = hoverHighlightGroup.append('circle').attr('r', 3.8);
selectedHighlightGroup.style('display', 'none');
hoverHighlightGroup.style('display', 'none');
const xAxisLabel = chartGroup
  .append('text')
  .attr('class', 'chart-axis-label')
  .attr('text-anchor', 'middle')
  .text('Wavelength (nm)');
const yAxisLabel = chartGroup
  .append('text')
  .attr('class', 'chart-axis-label')
  .attr('text-anchor', 'middle')
  .text('TOA Radiance');

const chartMargin = { top: 16, right: 12, bottom: 48, left: 58 };
const xScale = d3.scaleLinear();
const yScale = d3.scaleLinear();
const lineGenerator = d3
  .line()
  .defined((d) => Number.isFinite(d.value))
  .curve(d3.curveMonotoneX)
  .x((d) => xScale(d.wl))
  .y((d) => yScale(d.value));

let chartWidth = 0;
let chartHeight = 0;

// --- textures ---
const mainMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTexture: { value: null },
    uSpectralTexture: { value: null },
    uSpectralScale: { value: 1 },
    uSpectralCoord: { value: 0.5 },
    uMinValue: { value: 0 },
    uMaxValue: { value: 1 },
  },
  vertexShader,
  fragmentShader: mainFragmentShader,
});

const stripMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTexture: { value: null },
    uScale: { value: 1 },
  },
  vertexShader,
  fragmentShader: stripFragmentShader,
});

const quadGeometry = new THREE.PlaneGeometry(2, 2);
const mainPlane = new THREE.Mesh(quadGeometry, mainMaterial);
sceneMain.add(mainPlane);

const stripPlane = new THREE.Mesh(quadGeometry, stripMaterial);
sceneStrip.add(stripPlane);

// --- application state ---
const state = {
  initialized: false,
  image: null,
  width: 0,
  height: 0,
  bands: 0,
  wavelengths: [],
  cie: null,
  stripScale: null,
  stripAxisBaseline: 12,
  bandCache: new Map(),
  spectrumCache: new Map(),
  fullRaster: null,
  pendingBandRequestId: 0,
  pendingSpectrumRequestId: 0,
  pendingSpectrumKey: null,
  currentSpectrum: [],
  currentSpectrumKey: null,
  activeBandIndex: 0,
  displayBandIndex: 0,
  hoverBandIndex: null,
  activePixel: null,
  displayPixel: null,
  hoverPixel: null,
  displayMin: 0,
  displayMax: 1,
  autoRange: true,
  selectedSpectrum: null,
  hoverSpectrum: null,
  globalMax: 0,
  globalYAxisMax: 10,
};

if (bandMinSlider && bandMaxSlider) {
  bandMinSlider.addEventListener('input', () => {
    handleMinSliderInput(parseFloat(bandMinSlider.value));
  });
  bandMaxSlider.addEventListener('input', () => {
    handleMaxSliderInput(parseFloat(bandMaxSlider.value));
  });
}

if (autoRangeToggle) {
  state.autoRange = autoRangeToggle.checked;
  autoRangeToggle.addEventListener('change', () => {
    state.autoRange = autoRangeToggle.checked;
    const entry = state.bandCache.get(state.displayBandIndex);
    if (entry) {
      configureBandSliders(entry);
      applyDisplayRange();
    }
  });
}

updateBandSliderLabels();

init();

// --- initialization ---
async function init() {
  try {
    const [tiffInfo, wavelengths, cieInfo] = await Promise.all([
      loadTiff('hyperspectral.tif'),
      loadWavelengthsCSV('hyperspectral.csv'),
      loadCieTexture('cie1931xyz2e.csv'),
    ]);

    state.image = tiffInfo.image;
    state.width = tiffInfo.width;
    state.height = tiffInfo.height;
    state.bands = tiffInfo.bands;
    state.wavelengths = wavelengths;
    state.cie = cieInfo;

    const fullRaster = await state.image.readRasters({ interleave: true });
    state.fullRaster = normaliseTypedArray(fullRaster);
    updateGlobalMaxFromArray(state.fullRaster);

    stripMaterial.uniforms.uTexture.value = cieInfo.texture;
    stripMaterial.uniforms.uScale.value = cieInfo.scale;
    mainMaterial.uniforms.uSpectralTexture.value = cieInfo.texture;
    mainMaterial.uniforms.uSpectralScale.value = cieInfo.scale;
    rendererStrip.render(sceneStrip, cameraStrip);

    state.activeBandIndex = defaultBandIndex(wavelengths);
    state.displayBandIndex = state.activeBandIndex;

    state.activePixel = {
      x: Math.floor(state.width / 2),
      y: Math.floor(state.height / 2),
    };
    state.displayPixel = { ...state.activePixel };

    state.initialized = true;
    updateMainPlaneScale();
    handleResize();

    await setDisplayBand(state.activeBandIndex);
    await ensureSpectrumForPixel(state.activePixel, { force: true, target: 'selected' });
    updateSelectionIndicator();

    loadingOverlay.style.display = 'none';
  } catch (error) {
    console.error('Failed to initialize hyperspectral viewer', error);
    loadingOverlay.textContent = 'Failed to load data';
  }
}

// --- loaders ---
async function loadTiff(url) {
  const tiff = await fromUrl(url);
  const image = await tiff.getImage();
  return {
    image,
    width: image.getWidth(),
    height: image.getHeight(),
    bands: image.getSamplesPerPixel(),
  };
}

async function loadWavelengthsCSV(url) {
  const text = await fetch(url).then((r) => r.text());
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const parts = line.split(',');
      return parseFloat(parts[1]);
    })
    .filter((value) => Number.isFinite(value));
}

async function loadCieTexture(url) {
  const text = await fetch(url).then((r) => r.text());
  const rows = text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [wavelength, x, y, z] = line.split(',');
      return {
        wavelength: parseFloat(wavelength),
        X: parseFloat(x),
        Y: parseFloat(y),
        Z: parseFloat(z),
      };
    })
    .filter((row) => row.wavelength >= 390 && row.wavelength <= 710);

  const width = rows.length;
  const array = new Float32Array(width * 3);
  let maxValue = 0;
  rows.forEach((row, index) => {
    const offset = index * 3;
    array[offset + 0] = row.X;
    array[offset + 1] = row.Y;
    array[offset + 2] = row.Z;
    maxValue = Math.max(maxValue, row.X, row.Y, row.Z);
  });

  const texture = new THREE.DataTexture(array, width, 1, THREE.RGBFormat, THREE.FloatType);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  if (isWebGL2) {
    texture.internalFormat = 'RGB32F';
  }

  return {
    texture,
    wavelengths: rows.map((row) => row.wavelength),
    scale: maxValue > 0 ? 1 / maxValue : 1,
  };
}

// --- interactions ---
stripCanvas.addEventListener('pointermove', handleStripPointerMove);
stripCanvas.addEventListener('pointerleave', handleStripPointerLeave);
stripCanvas.addEventListener('pointerdown', handleStripPointerDown);

imageCanvas.addEventListener('pointermove', handleImagePointerMove);
imageCanvas.addEventListener('pointerleave', handleImagePointerLeave);
imageCanvas.addEventListener('pointerdown', handleImagePointerDown);

const resizeObserver = new ResizeObserver(handleResize);
[imageWrapper, stripWrapper, chartWrapper].forEach((el) => {
  if (el) {
    resizeObserver.observe(el);
  }
});
window.addEventListener('resize', handleResize);

function handleStripPointerMove(event) {
  if (!state.initialized || !state.cie) {
    return;
  }
  const rect = stripCanvas.getBoundingClientRect();
  if (!rect.width) {
    return;
  }
  const ratio = (event.clientX - rect.left) / rect.width;
  const clamped = clamp01(ratio);
  const cieWavelengths = state.cie.wavelengths;
  const minWl = cieWavelengths[0];
  const maxWl = cieWavelengths[cieWavelengths.length - 1];
  const target = minWl + clamped * (maxWl - minWl);
  const bandIndex = nearestBand(target, state.wavelengths);
  state.hoverBandIndex = bandIndex;
  setDisplayBand(bandIndex).catch((error) => {
    console.error('Unable to update band on hover', error);
  });
}

function handleStripPointerLeave() {
  if (!state.initialized) {
    return;
  }
  state.hoverBandIndex = null;
  setDisplayBand(state.activeBandIndex).catch((error) => {
    console.error('Unable to restore band after hover', error);
  });
}

function handleStripPointerDown() {
  if (!state.initialized) {
    return;
  }
  state.activeBandIndex = state.displayBandIndex;
  updateInfoPanel();
}

function handleImagePointerMove(event) {
  if (!state.initialized) {
    return;
  }
  const pixel = eventToPixel(event);
  if (!pixel) {
    return;
  }
  state.hoverPixel = pixel;
  state.displayPixel = pixel;
  updateInfoPanel();
  ensureSpectrumForPixel(pixel, { target: 'hover' }).catch((error) => {
    console.error('Unable to update hover spectrum', error);
  });
}

function handleImagePointerLeave() {
  if (!state.initialized) {
    return;
  }
  state.hoverPixel = null;
  state.displayPixel = state.activePixel;
  updateInfoPanel();
  state.hoverSpectrum = null;
  renderSpectrumChart(state.selectedSpectrum, state.hoverSpectrum, state.displayBandIndex);
  ensureSpectrumForPixel(state.activePixel, { target: 'selected' }).catch((error) => {
    console.error('Unable to restore spectrum after hover', error);
  });
}

function handleImagePointerDown(event) {
  if (!state.initialized) {
    return;
  }
  const pixel = eventToPixel(event);
  if (!pixel) {
    return;
  }
  state.activePixel = pixel;
  state.displayPixel = pixel;
  updateInfoPanel();
  ensureSpectrumForPixel(pixel, { force: true, target: 'selected' }).catch((error) => {
    console.error('Unable to update spectrum after click', error);
  });
  updateSelectionIndicator();
}

// --- rendering helpers ---
async function setDisplayBand(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.bands) {
    return;
  }
  if (state.displayBandIndex === index && state.bandCache.has(index)) {
    updateStripHighlight(index);
    updateInfoPanel();
    applyDisplayRange();
    renderStrip();
    renderSpectrumChart(state.selectedSpectrum, state.hoverSpectrum, index);
    return;
  }

  const requestId = ++state.pendingBandRequestId;
  const entry = await getBandTexture(index);
  if (requestId !== state.pendingBandRequestId) {
    return;
  }

  configureBandSliders(entry);

  state.displayBandIndex = index;
  mainMaterial.uniforms.uTexture.value = entry.texture;
  if (mainMaterial.uniforms.uSpectralCoord) {
    mainMaterial.uniforms.uSpectralCoord.value = spectralCoordForWavelength(
      state.wavelengths[index]
    );
  }
  applyDisplayRange();
  updateSelectionIndicator();
  updateStripHighlight(index);
  renderStrip();
  updateInfoPanel();
  renderSpectrumChart(state.selectedSpectrum, state.hoverSpectrum, index);
}

async function getBandTexture(index) {
  if (state.bandCache.has(index)) {
    return state.bandCache.get(index);
  }
  let typed;
  let min = Infinity;
  let max = -Infinity;

  if (state.fullRaster) {
    const pixelCount = state.width * state.height;
    typed = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i += 1) {
      const value = state.fullRaster[i * state.bands + index];
      typed[i] = value;
      if (!Number.isFinite(value)) {
        continue;
      }
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
  } else {
    const data = await state.image.readRasters({ samples: [index], interleave: true });
    typed = normaliseTypedArray(data);
    for (let i = 0; i < typed.length; i += 1) {
      const value = typed[i];
      if (!Number.isFinite(value)) {
        continue;
      }
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
  }
  if (!Number.isFinite(min)) {
    min = 0;
  }
  if (!Number.isFinite(max)) {
    max = min + 1;
  }

  const type = typed instanceof Float32Array ? THREE.FloatType : THREE.HalfFloatType;
  const format = isWebGL2 ? THREE.RedFormat : THREE.LuminanceFormat;
  const texture = new THREE.DataTexture(typed, state.width, state.height, format, type);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = true;
  if (isWebGL2) {
    texture.internalFormat = type === THREE.FloatType ? 'R32F' : 'R16F';
  }

  const entry = { texture, data: typed, min, max };
  state.bandCache.set(index, entry);
  updateGlobalMaxCandidate(max);
  return entry;
}

async function ensureSpectrumForPixel(pixel, { force = false, target = 'selected' } = {}) {
  if (!pixel) {
    return;
  }
  const key = `${pixel.x},${pixel.y}`;
  if (!force && state.currentSpectrumKey === key && state.currentSpectrum.length) {
    propagateSpectrum(target, state.currentSpectrum);
    renderSpectrumChart(state.selectedSpectrum, state.hoverSpectrum, state.displayBandIndex);
    updateInfoPanel();
    return;
  }
  if (!force && state.pendingSpectrumKey === key) {
    return;
  }

  state.pendingSpectrumKey = key;
  const requestId = ++state.pendingSpectrumRequestId;
  const spectrum = await fetchSpectrum(pixel);
  if (requestId !== state.pendingSpectrumRequestId) {
    return;
  }

  state.pendingSpectrumKey = null;
  state.currentSpectrumKey = key;
  state.currentSpectrum = spectrum;
  propagateSpectrum(target, spectrum);
  renderSpectrumChart(state.selectedSpectrum, state.hoverSpectrum, state.displayBandIndex);
  updateInfoPanel();
}

async function fetchSpectrum(pixel) {
  const key = `${pixel.x},${pixel.y}`;
  if (state.spectrumCache.has(key)) {
    return state.spectrumCache.get(key);
  }
  let spectrum;
  if (state.fullRaster) {
    const base = (pixel.y * state.width + pixel.x) * state.bands;
    spectrum = new Array(state.bands);
    for (let i = 0; i < state.bands; i += 1) {
      spectrum[i] = state.fullRaster[base + i];
    }
  } else {
    const values = await state.image.readRasters({
      window: [pixel.x, pixel.y, pixel.x + 1, pixel.y + 1],
      interleave: true,
    });
    spectrum = Array.from(values);
  }
  state.spectrumCache.set(key, spectrum);
  return spectrum;
}

function updateMainPlaneScale() {
  if (!state.width || !state.height) {
    return;
  }
  const aspect = state.width / state.height;
  if (aspect >= 1) {
    mainPlane.scale.set(1, 1 / aspect, 1);
  } else {
    mainPlane.scale.set(aspect, 1, 1);
  }
}

function renderMain() {
  if (!state.initialized || !mainMaterial.uniforms.uTexture.value) {
    return;
  }
  rendererMain.render(sceneMain, cameraMain);
}

function renderStrip() {
  rendererStrip.render(sceneStrip, cameraStrip);
}

function handleResize() {
  if (!state.initialized) {
    return;
  }

  resizeRenderer(rendererMain, imageCanvas);
  resizeRenderer(rendererStrip, stripCanvas);
  renderMain();
  renderStrip();

  updateStripAxis();
  updateChartSize();
  renderSpectrumChart(state.selectedSpectrum, state.hoverSpectrum, state.displayBandIndex);
  updateSelectionIndicator();
}

function resizeRenderer(renderer, canvas) {
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  renderer.setSize(width, height, false);
}

function updateStripAxis() {
  if (!state.cie) {
    return;
  }
  const width = Math.max(1, Math.round(stripCanvas.clientWidth));
  const height = Math.max(28, Math.round(stripAxisContainer.clientHeight || 34));

  axisSvg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

  const domain = [state.cie.wavelengths[0], state.cie.wavelengths[state.cie.wavelengths.length - 1]];
  const scale = d3.scaleLinear().domain(domain).range([0, width]);
  state.stripScale = scale;

  const tickStep = width > 520 ? 25 : 50;
  let ticks = [];
  for (let value = 400; value <= 700; value += tickStep) {
    if (value >= domain[0] && value <= domain[1]) {
      ticks.push(value);
    }
  }
  if (!ticks.length) {
    ticks = [domain[0], domain[1]].filter((value) => Number.isFinite(value));
  }
  const uniqueTicks = Array.from(new Set(ticks)).sort((a, b) => a - b);

  const axis = d3.axisBottom(scale).tickValues(uniqueTicks).tickSizeInner(6).tickSizeOuter(0).tickPadding(6);
  axisGroup.attr('transform', 'translate(0, 0)').call(axis);
  axisGroup.select('.domain').style('display', 'none');

  axisLabel.attr('x', width / 2).attr('y', Math.min(height + 4, 38)).attr('text-anchor', 'middle');
  state.stripAxisBaseline = 0;
  updateStripHighlight(state.displayBandIndex);
}

function updateStripHighlight(index) {
  if (!state.stripScale || index == null || index < 0 || index >= state.wavelengths.length) {
    axisPointer.style('display', 'none');
    return;
  }
  const wavelength = state.wavelengths[index];
  if (!Number.isFinite(wavelength)) {
    axisPointer.style('display', 'none');
    return;
  }
  const x = state.stripScale(wavelength);
  const base = state.stripAxisBaseline;
  axisPointer
    .attr('x1', x)
    .attr('x2', x)
    .attr('y1', base - 8)
    .attr('y2', base + 10)
    .style('display', null);
}

function updateChartSize() {
  const rect = chartWrapper.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  chartSvg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

  chartWidth = Math.max(1, width - chartMargin.left - chartMargin.right);
  chartHeight = Math.max(1, height - chartMargin.top - chartMargin.bottom);

  chartGroup.attr('transform', `translate(${chartMargin.left}, ${chartMargin.top})`);
  xAxisGroup.attr('transform', `translate(0, ${chartHeight})`);

  xAxisLabel.attr('x', chartWidth / 2).attr('y', chartHeight + chartMargin.bottom - 5);
  yAxisLabel.attr('transform', `translate(${-chartMargin.left + 10}, ${chartHeight / 2}) rotate(-90)`);
}

function renderSpectrumChart(selectedSpectrum, hoverSpectrum, highlightIndex) {
  if (!chartWidth || !chartHeight || !state.wavelengths.length) {
    selectedSpectrumPath.attr('d', null);
    hoverSpectrumPath.attr('d', null).style('display', 'none');
    selectedHighlightGroup.style('display', 'none');
    hoverHighlightGroup.style('display', 'none');
    xAxisGroup.selectAll('*').remove();
    yAxisGroup.selectAll('*').remove();
    return;
  }

  const wavelengths = state.wavelengths;
  const hasSelected = Array.isArray(selectedSpectrum) && selectedSpectrum.length === wavelengths.length;
  const hasHover = Array.isArray(hoverSpectrum) && hoverSpectrum.length === wavelengths.length;

  if (!hasSelected && !hasHover) {
    selectedSpectrumPath.attr('d', null);
    hoverSpectrumPath.attr('d', null).style('display', 'none');
    selectedHighlightGroup.style('display', 'none');
    hoverHighlightGroup.style('display', 'none');
    xAxisGroup.selectAll('*').remove();
    yAxisGroup.selectAll('*').remove();
    return;
  }

  const selectedData = hasSelected
    ? wavelengths.map((wl, index) => ({ wl, value: selectedSpectrum[index] }))
    : null;
  const hoverData = hasHover
    ? wavelengths.map((wl, index) => ({ wl, value: hoverSpectrum[index] }))
    : null;

  const wavelengthExtent = d3.extent(wavelengths);
  xScale.domain(wavelengthExtent).range([0, chartWidth]);

  let maxValue = 0;
  if (hasSelected) {
    const mv = d3.max(selectedData, (d) => d.value);
    if (Number.isFinite(mv) && mv > maxValue) {
      maxValue = mv;
    }
  }
  if (hasHover) {
    const mv = d3.max(hoverData, (d) => d.value);
    if (Number.isFinite(mv) && mv > maxValue) {
      maxValue = mv;
    }
  }
  updateGlobalMaxCandidate(maxValue);
  const yMax = state.globalYAxisMax || computeYAxisCeil(maxValue || 0);
  yScale.domain([0, yMax]).range([chartHeight, 0]);

  const step = chartWidth > 520 ? 25 : 50;
  let tickValues = [];
  for (let wl = 400; wl <= 700; wl += step) {
    if (wl >= wavelengthExtent[0] && wl <= wavelengthExtent[1]) {
      tickValues.push(wl);
    }
  }
  if (!tickValues.length) {
    tickValues = [wavelengthExtent[0], wavelengthExtent[1]].filter((v) => Number.isFinite(v));
  }
  tickValues = Array.from(new Set(tickValues)).sort((a, b) => a - b);

  const xAxis = d3.axisBottom(xScale).tickValues(tickValues).tickSizeOuter(0).tickPadding(8);
  const yAxis = d3.axisLeft(yScale).ticks(5).tickSizeOuter(0).tickPadding(10);

  xAxisGroup.call(xAxis);
  yAxisGroup.call(yAxis);

  if (hasSelected) {
    selectedSpectrumPath.datum(selectedData).attr('d', lineGenerator).style('display', null);
  } else {
    selectedSpectrumPath.attr('d', null).style('display', 'none');
  }

  if (hasHover) {
    hoverSpectrumPath.datum(hoverData).attr('d', lineGenerator).style('display', null);
  } else {
    hoverSpectrumPath.attr('d', null).style('display', 'none');
  }

  if (Number.isInteger(highlightIndex) && highlightIndex >= 0 && highlightIndex < wavelengths.length) {
    const wl = wavelengths[highlightIndex];

    if (hasSelected && Number.isFinite(selectedSpectrum[highlightIndex])) {
      const value = selectedSpectrum[highlightIndex];
      const x = xScale(wl);
      const y = yScale(value);
      selectedHighlightGroup.style('display', null);
      selectedHighlightLine.attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', chartHeight);
      selectedHighlightDot.attr('cx', x).attr('cy', y);
    } else {
      selectedHighlightGroup.style('display', 'none');
    }

    if (hasHover && Number.isFinite(hoverSpectrum[highlightIndex])) {
      const value = hoverSpectrum[highlightIndex];
      const x = xScale(wl);
      const y = yScale(value);
      hoverHighlightGroup.style('display', null);
      hoverHighlightLine.attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', chartHeight);
      hoverHighlightDot.attr('cx', x).attr('cy', y);
    } else {
      hoverHighlightGroup.style('display', 'none');
    }
  } else {
    selectedHighlightGroup.style('display', 'none');
    hoverHighlightGroup.style('display', 'none');
  }
}
function updateInfoPanel() {
  const bandIndex = state.displayBandIndex;
  const wavelength = state.wavelengths[bandIndex];
  infoWavelength.textContent = Number.isFinite(wavelength) ? `${wavelength.toFixed(1)} nm` : '—';

  const selectedPixel = state.activePixel;
  const hoverPixel = state.hoverPixel;

  infoPosition.textContent = formatPixelInfo(selectedPixel, hoverPixel);

  const selectedValue = selectedPixel ? lookupReflectance(bandIndex, selectedPixel) : null;
  const hoverValue = hoverPixel ? lookupReflectance(bandIndex, hoverPixel) : null;
  infoReflectance.textContent = formatDualRadiance(selectedValue, hoverValue);
}

function lookupReflectance(bandIndex, pixel) {
  if (state.fullRaster && pixel) {
    const offset = (pixel.y * state.width + pixel.x) * state.bands + bandIndex;
    const value = state.fullRaster[offset];
    return Number.isFinite(value) ? value : null;
  }
  const entry = state.bandCache.get(bandIndex);
  if (!entry || !pixel) {
    return null;
  }
  const index = pixel.y * state.width + pixel.x;
  if (index < 0 || index >= entry.data.length) {
    return null;
  }
  return entry.data[index];
}

function eventToPixel(event) {
  const rect = imageCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: clamp(Math.round(x), 0, state.width - 1),
    y: clamp(Math.round(y), 0, state.height - 1),
  };
}

// --- utilities ---
function normaliseTypedArray(array) {
  if (array instanceof Float32Array) {
    return array;
  }
  if (ArrayBuffer.isView(array)) {
    return Float32Array.from(array);
  }
  return Float32Array.from(array);
}

function updateGlobalMaxFromArray(array) {
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

function updateGlobalMaxCandidate(value) {
  if (!Number.isFinite(value)) {
    return;
  }
  if (!Number.isFinite(state.globalMax) || value > state.globalMax) {
    state.globalMax = value;
    state.globalYAxisMax = computeYAxisCeil(value);
  }
}

function computeYAxisCeil(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 10;
  }
  let rounded = Math.ceil(value / 10) * 10;
  if (rounded <= value) {
    rounded += 10;
  }
  return rounded;
}

function nearestBand(target, wavelengths) {
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

function defaultBandIndex(wavelengths) {
  if (!wavelengths.length) {
    return 0;
  }
  return nearestBand(550, wavelengths);
}

function configureBandSliders(entry) {
  if (!bandMinSlider || !bandMaxSlider) {
    return;
  }
  const sliderMin = 0;
  let sliderMax = Number.isFinite(state.globalYAxisMax) && state.globalYAxisMax > 0
    ? state.globalYAxisMax
    : Math.max(Number(entry.max) || 1, 1);
  if (sliderMax <= sliderMin) {
    sliderMax = sliderMin + 1;
  }
  const step = computeSliderStep(sliderMin, sliderMax);

  bandMinSlider.min = sliderMin;
  bandMinSlider.max = sliderMax;
  bandMaxSlider.min = sliderMin;
  bandMaxSlider.max = sliderMax;
  bandMinSlider.step = step;
  bandMaxSlider.step = step;

  if (state.autoRange) {
    state.displayMin = clamp(Number(entry.min), sliderMin, sliderMax);
    state.displayMax = clamp(Number(entry.max), sliderMin, sliderMax);
    if (state.displayMin > state.displayMax) {
      state.displayMin = sliderMin;
    }
  } else {
    state.displayMin = clamp(state.displayMin, sliderMin, sliderMax);
    state.displayMax = clamp(state.displayMax, sliderMin, sliderMax);
    if (state.displayMin >= state.displayMax) {
      state.displayMax = Math.min(sliderMax, state.displayMin + step);
    }
  }

  bandMinSlider.value = state.displayMin;
  bandMaxSlider.value = state.displayMax;
  updateBandSliderLabels();
}

function computeSliderStep(min, max) {
  const span = Math.abs(max - min);
  if (!Number.isFinite(span) || span === 0) {
    return 0.001;
  }
  const raw = span / 500;
  const magnitude = Math.pow(10, Math.floor(Math.log10(span)) - 3);
  return Math.max(raw, magnitude, 1e-6);
}

function handleMinSliderInput(value) {
  if (!Number.isFinite(value)) {
    return;
  }
  if (state.autoRange) {
    state.autoRange = false;
    if (autoRangeToggle) {
      autoRangeToggle.checked = false;
    }
  }
  const epsilon = Math.max(Math.abs(state.displayMax) * 1e-6, 1e-6);
  state.displayMin = value;
  if (state.displayMin >= state.displayMax) {
    state.displayMax = Math.min(Number(bandMaxSlider?.max ?? state.displayMin + epsilon), state.displayMin + epsilon);
    if (bandMaxSlider) {
      bandMaxSlider.value = state.displayMax;
    }
  }
  updateBandSliderLabels();
  applyDisplayRange();
}

function handleMaxSliderInput(value) {
  if (!Number.isFinite(value)) {
    return;
  }
  if (state.autoRange) {
    state.autoRange = false;
    if (autoRangeToggle) {
      autoRangeToggle.checked = false;
    }
  }
  const epsilon = Math.max(Math.abs(state.displayMax) * 1e-6, 1e-6);
  state.displayMax = value;
  if (state.displayMax <= state.displayMin) {
    state.displayMin = Math.max(Number(bandMinSlider?.min ?? state.displayMax - epsilon), state.displayMax - epsilon);
    if (bandMinSlider) {
      bandMinSlider.value = state.displayMin;
    }
  }
  updateBandSliderLabels();
  applyDisplayRange();
}

function applyDisplayRange() {
  if (!mainMaterial || !mainMaterial.uniforms) {
    return;
  }
  mainMaterial.uniforms.uMinValue.value = state.displayMin;
  mainMaterial.uniforms.uMaxValue.value = state.displayMax;
  updateBandSliderLabels();
  renderMain();
}

function updateSelectionIndicator() {
  if (!selectionIndicator || !state.activePixel || !state.width || !state.height) {
    if (selectionIndicator) {
      selectionIndicator.style.display = 'none';
    }
    return;
  }
  const left = ((state.activePixel.x + 0.5) / state.width) * 100;
  const top = ((state.activePixel.y + 0.5) / state.height) * 100;
  selectionIndicator.style.left = `${left}%`;
  selectionIndicator.style.top = `${top}%`;
  selectionIndicator.style.display = 'block';
}

function updateBandSliderLabels() {
  if (bandMinValueLabel) {
    bandMinValueLabel.textContent = formatRadianceLabel(state.displayMin);
  }
  if (bandMaxValueLabel) {
    bandMaxValueLabel.textContent = formatRadianceLabel(state.displayMax);
  }
}

function formatRadianceLabel(value) {
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

function formatPixelInfo(selected, hover) {
  const selectedText = selected
    ? `Sel x ${selected.x}, y ${selected.y}`
    : 'Sel —';
  const hoverText = hover
    ? `Hover x ${hover.x}, y ${hover.y}`
    : 'Hover —';
  return `${selectedText} | ${hoverText}`;
}

function formatDualRadiance(selected, hover) {
  const selLabel = `Sel ${formatRadianceLabel(selected)}`;
  const hoverLabel = `Hover ${formatRadianceLabel(hover)}`;
  return `${selLabel} | ${hoverLabel}`;
}

function spectralCoordForWavelength(wavelength) {
  if (!state.cie || !state.cie.wavelengths?.length) {
    return 0.5;
  }
  const idx = nearestBand(wavelength, state.cie.wavelengths);
  const width = state.cie.wavelengths.length;
  return width > 0 ? (idx + 0.5) / width : 0.5;
}

function propagateSpectrum(target, spectrum) {
  if (target === 'hover') {
    state.hoverSpectrum = spectrum;
  } else if (target === 'selected') {
    state.selectedSpectrum = spectrum;
  } else {
    state.currentSpectrum = spectrum;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value) {
  return clamp(value, 0, 1);
}
