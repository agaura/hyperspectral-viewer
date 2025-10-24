import * as THREE from 'three';
import { createInitialState } from './state.js';
import { createRenderingContext } from './rendering.js';
import { createChart } from './chart.js';
import { createLayoutManager, clearPending, pointerListenerOptions } from './dom.js';
import { loadShaderSources } from './shaders.js';
import { loadTiff, loadWavelengthsCSV, loadCieTexture } from './dataLoaders.js';
import {
  clamp,
  clamp01,
  normaliseTypedArray,
  updateGlobalMaxFromArray,
  updateGlobalMaxCandidate,
  nearestBand,
  formatRadianceLabel,
  formatPixelInfo,
  formatDualRadiance,
  defaultBandIndex,
} from './utils.js';

export class HyperspectralViewer {
  constructor(elements) {
    this.elements = elements;
    this.state = createInitialState();
    this.shaderSources = null;
    this.rendering = null;
    this.chart = null;
    this.layout = null;
    this.resizeObserver = null;
  }

  async init() {
    try {
      this.shaderSources = await loadShaderSources();
      this.rendering = createRenderingContext(this.elements, this.shaderSources);
      this.chart = createChart(this.elements, this.state);
      this.layout = createLayoutManager(this.elements);
      this.attachEventListeners();
      this.updateBandSliderLabels();
      await this.loadInitialData();
    } catch (error) {
      console.error('Failed to initialize hyperspectral viewer', error);
      clearPending(this.elements);
      if (this.elements.loadingOverlay) {
        this.elements.loadingOverlay.textContent = 'Failed to load data';
      }
    }
  }

  attachEventListeners() {
    const { bandMinSlider, bandMaxSlider, autoRangeToggle, stripCanvas, imageCanvas } = this.elements;

    if (bandMinSlider) {
      bandMinSlider.addEventListener('input', () => {
        this.handleMinSliderInput(parseFloat(bandMinSlider.value));
      });
    }
    if (bandMaxSlider) {
      bandMaxSlider.addEventListener('input', () => {
        this.handleMaxSliderInput(parseFloat(bandMaxSlider.value));
      });
    }

    if (autoRangeToggle) {
      this.state.autoRange = autoRangeToggle.checked;
      autoRangeToggle.addEventListener('change', () => {
        this.state.autoRange = autoRangeToggle.checked;
        const entry = this.state.bandCache.get(this.state.displayBandIndex);
        if (entry) {
          this.configureBandSliders(entry);
          this.applyDisplayRange();
        }
      });
    }

    if (stripCanvas) {
      stripCanvas.addEventListener('pointermove', (event) => this.handleStripPointerMove(event), pointerListenerOptions);
      stripCanvas.addEventListener('pointerleave', () => this.handleStripPointerLeave());
      stripCanvas.addEventListener('pointerdown', (event) => this.handleStripPointerDown(event), pointerListenerOptions);
      stripCanvas.addEventListener('pointerup', (event) => this.handleStripPointerUp(event));
      stripCanvas.addEventListener('pointercancel', (event) => this.handleStripPointerCancel(event));
    }

    if (imageCanvas) {
      imageCanvas.addEventListener('pointermove', (event) => this.handleImagePointerMove(event), pointerListenerOptions);
      imageCanvas.addEventListener('pointerleave', () => this.handleImagePointerLeave());
      imageCanvas.addEventListener('pointerdown', (event) => this.handleImagePointerDown(event), pointerListenerOptions);
      imageCanvas.addEventListener('pointerup', (event) => this.handleImagePointerUp(event));
      imageCanvas.addEventListener('pointercancel', (event) => this.handleImagePointerCancel(event));
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    [this.elements.imageWrapper, this.elements.stripWrapper, this.elements.chartWrapper].forEach((element) => {
      if (element) {
        this.resizeObserver.observe(element);
      }
    });
    window.addEventListener('resize', () => this.handleResize());
  }

  async loadInitialData() {
    const { mainMaterial, stripMaterial, rendererStrip, sceneStrip, cameraStrip, isWebGL2, updateMainPlaneScale } = this.rendering;
    try {
      const [tiffInfo, wavelengths, cieInfo] = await Promise.all([
        loadTiff('hyperspectral.tif'),
        loadWavelengthsCSV('hyperspectral.csv'),
        loadCieTexture('cie1931xyz2e.csv', isWebGL2),
      ]);

      this.state.image = tiffInfo.image;
      this.state.width = tiffInfo.width;
      this.state.height = tiffInfo.height;
      this.state.bands = tiffInfo.bands;
      this.state.wavelengths = wavelengths;
      this.state.cie = cieInfo;

      const fullRaster = await this.state.image.readRasters({ interleave: true });
      this.state.fullRaster = normaliseTypedArray(fullRaster);
      updateGlobalMaxFromArray(this.state.fullRaster, this.state);

      stripMaterial.uniforms.uTexture.value = cieInfo.texture;
      stripMaterial.uniforms.uScale.value = cieInfo.scale;
      mainMaterial.uniforms.uSpectralTexture.value = cieInfo.texture;
      mainMaterial.uniforms.uSpectralScale.value = cieInfo.scale;
      rendererStrip.render(sceneStrip, cameraStrip);

      this.state.activeBandIndex = defaultBandIndex(wavelengths);
      this.state.displayBandIndex = this.state.activeBandIndex;

      this.state.activePixel = {
        x: Math.floor(this.state.width / 2),
        y: Math.floor(this.state.height / 2),
      };
      this.state.displayPixel = { ...this.state.activePixel };

      this.state.initialized = true;
      updateMainPlaneScale(this.state);
      this.handleResize();

      clearPending(this.elements);

      await this.setDisplayBand(this.state.activeBandIndex);
      await this.ensureSpectrumForPixel(this.state.activePixel, { force: true, target: 'selected' });
      this.updateSelectionIndicator();

      if (this.elements.loadingOverlay) {
        this.elements.loadingOverlay.style.display = 'none';
      }
    } catch (error) {
      throw error;
    }
  }

  async setDisplayBand(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.state.bands) {
      return;
    }
    if (this.state.displayBandIndex === index && this.state.bandCache.has(index)) {
      this.chart.updateStripHighlight(index);
      this.updateInfoPanel();
      this.applyDisplayRange();
      this.rendering.renderStrip();
      this.chart.renderSpectrumChart(this.state.selectedSpectrum, this.state.hoverSpectrum, index);
      return;
    }

    const requestId = ++this.state.pendingBandRequestId;
    const entry = await this.getBandTexture(index);
    if (requestId !== this.state.pendingBandRequestId) {
      return;
    }

    this.configureBandSliders(entry);

    this.state.displayBandIndex = index;
    this.rendering.mainMaterial.uniforms.uTexture.value = entry.texture;
    if (this.rendering.mainMaterial.uniforms.uSpectralCoord) {
      this.rendering.mainMaterial.uniforms.uSpectralCoord.value = this.spectralCoordForWavelength(this.state.wavelengths[index]);
    }
    this.applyDisplayRange();
    this.updateSelectionIndicator();
    this.chart.updateStripHighlight(index);
    this.rendering.renderStrip();
    this.updateInfoPanel();
    this.chart.renderSpectrumChart(this.state.selectedSpectrum, this.state.hoverSpectrum, index);
  }

  async getBandTexture(index) {
    if (this.state.bandCache.has(index)) {
      return this.state.bandCache.get(index);
    }

    let typed;
    let min = Infinity;
    let max = -Infinity;

    if (this.state.fullRaster) {
      const pixelCount = this.state.width * this.state.height;
      typed = new Float32Array(pixelCount);
      for (let i = 0; i < pixelCount; i += 1) {
        const value = this.state.fullRaster[i * this.state.bands + index];
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
      const data = await this.state.image.readRasters({ samples: [index], interleave: true });
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
    const format = this.rendering.isWebGL2 ? THREE.RedFormat : THREE.LuminanceFormat;
    const texture = new THREE.DataTexture(typed, this.state.width, this.state.height, format, type);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = true;
    if (this.rendering.isWebGL2) {
      texture.internalFormat = type === THREE.FloatType ? 'R32F' : 'R16F';
    }

    const entry = { texture, data: typed, min, max };
    this.state.bandCache.set(index, entry);
    updateGlobalMaxCandidate(max, this.state);
    return entry;
  }

  spectralCoordForWavelength(wavelength) {
    if (!this.state.cie || !this.state.cie.wavelengths?.length) {
      return 0.5;
    }
    const idx = nearestBand(wavelength, this.state.cie.wavelengths);
    const width = this.state.cie.wavelengths.length;
    return width > 0 ? (idx + 0.5) / width : 0.5;
  }

  async ensureSpectrumForPixel(pixel, { force = false, target = 'selected' } = {}) {
    if (!pixel) {
      return;
    }
    const key = `${pixel.x},${pixel.y}`;
    if (!force && this.state.currentSpectrumKey === key && this.state.currentSpectrum.length) {
      this.propagateSpectrum(target, this.state.currentSpectrum);
      this.chart.renderSpectrumChart(this.state.selectedSpectrum, this.state.hoverSpectrum, this.state.displayBandIndex);
      this.updateInfoPanel();
      return;
    }
    if (!force && this.state.pendingSpectrumKey === key) {
      return;
    }

    this.state.pendingSpectrumKey = key;
    const requestId = ++this.state.pendingSpectrumRequestId;
    const spectrum = await this.fetchSpectrum(pixel);
    if (requestId !== this.state.pendingSpectrumRequestId) {
      return;
    }

    this.state.pendingSpectrumKey = null;
    this.state.currentSpectrumKey = key;
    this.state.currentSpectrum = spectrum;
    this.propagateSpectrum(target, spectrum);
    this.chart.renderSpectrumChart(this.state.selectedSpectrum, this.state.hoverSpectrum, this.state.displayBandIndex);
    this.updateInfoPanel();
  }

  async fetchSpectrum(pixel) {
    const key = `${pixel.x},${pixel.y}`;
    if (this.state.spectrumCache.has(key)) {
      return this.state.spectrumCache.get(key);
    }
    let spectrum;
    if (this.state.fullRaster) {
      const base = (pixel.y * this.state.width + pixel.x) * this.state.bands;
      spectrum = new Array(this.state.bands);
      for (let i = 0; i < this.state.bands; i += 1) {
        spectrum[i] = this.state.fullRaster[base + i];
      }
    } else {
      const values = await this.state.image.readRasters({
        window: [pixel.x, pixel.y, pixel.x + 1, pixel.y + 1],
        interleave: true,
      });
      spectrum = Array.from(values);
    }
    this.state.spectrumCache.set(key, spectrum);
    return spectrum;
  }

  propagateSpectrum(target, spectrum) {
    if (target === 'hover') {
      this.state.hoverSpectrum = spectrum;
    } else if (target === 'selected') {
      this.state.selectedSpectrum = spectrum;
    } else {
      this.state.currentSpectrum = spectrum;
    }
  }

  applyDisplayRange() {
    if (!this.rendering.mainMaterial || !this.rendering.mainMaterial.uniforms) {
      return;
    }
    this.rendering.mainMaterial.uniforms.uMinValue.value = this.state.displayMin;
    this.rendering.mainMaterial.uniforms.uMaxValue.value = this.state.displayMax;
    this.updateBandSliderLabels();
    this.rendering.renderMain();
  }

  configureBandSliders(entry) {
    const { bandMinSlider, bandMaxSlider } = this.elements;
    const sliderMin = Number.isFinite(entry.min) ? entry.min : 0;
    const sliderMax = Number.isFinite(entry.max) ? entry.max : sliderMin + 1;
    const span = sliderMax - sliderMin;
    const step = computeSliderStep(sliderMin, sliderMax);

    if (bandMinSlider) {
      bandMinSlider.min = sliderMin.toString();
      bandMinSlider.max = sliderMax.toString();
      bandMinSlider.step = step;
    }
    if (bandMaxSlider) {
      bandMaxSlider.min = sliderMin.toString();
      bandMaxSlider.max = sliderMax.toString();
      bandMaxSlider.step = step;
    }

    if (this.state.autoRange) {
      this.state.displayMin = clamp(Number(entry.min), sliderMin, sliderMax);
      this.state.displayMax = clamp(Number(entry.max), sliderMin, sliderMax);
      if (this.state.displayMin > this.state.displayMax) {
        this.state.displayMin = sliderMin;
      }
    } else {
      this.state.displayMin = clamp(this.state.displayMin, sliderMin, sliderMax);
      this.state.displayMax = clamp(this.state.displayMax, sliderMin, sliderMax);
      if (this.state.displayMin >= this.state.displayMax) {
        this.state.displayMax = Math.min(sliderMax, this.state.displayMin + step);
      }
    }

    if (bandMinSlider) {
      bandMinSlider.value = this.state.displayMin;
    }
    if (bandMaxSlider) {
      bandMaxSlider.value = this.state.displayMax;
    }
    this.updateBandSliderLabels();
  }

  handleMinSliderInput(value) {
    if (!Number.isFinite(value)) {
      return;
    }
    if (this.state.autoRange) {
      this.state.autoRange = false;
      if (this.elements.autoRangeToggle) {
        this.elements.autoRangeToggle.checked = false;
      }
    }
    const epsilon = Math.max(Math.abs(this.state.displayMax) * 1e-6, 1e-6);
    this.state.displayMin = value;
    if (this.state.displayMin >= this.state.displayMax) {
      this.state.displayMax = Math.min(
        Number(this.elements.bandMaxSlider?.max ?? this.state.displayMin + epsilon),
        this.state.displayMin + epsilon,
      );
      if (this.elements.bandMaxSlider) {
        this.elements.bandMaxSlider.value = this.state.displayMax;
      }
    }
    this.updateBandSliderLabels();
    this.applyDisplayRange();
  }

  handleMaxSliderInput(value) {
    if (!Number.isFinite(value)) {
      return;
    }
    if (this.state.autoRange) {
      this.state.autoRange = false;
      if (this.elements.autoRangeToggle) {
        this.elements.autoRangeToggle.checked = false;
      }
    }
    const epsilon = Math.max(Math.abs(this.state.displayMax) * 1e-6, 1e-6);
    this.state.displayMax = value;
    if (this.state.displayMax <= this.state.displayMin) {
      this.state.displayMin = Math.max(
        Number(this.elements.bandMinSlider?.min ?? this.state.displayMax - epsilon),
        this.state.displayMax - epsilon,
      );
      if (this.elements.bandMinSlider) {
        this.elements.bandMinSlider.value = this.state.displayMin;
      }
    }
    this.updateBandSliderLabels();
    this.applyDisplayRange();
  }

  updateBandSliderLabels() {
    if (this.elements.bandMinValueLabel) {
      this.elements.bandMinValueLabel.textContent = formatRadianceLabel(this.state.displayMin);
    }
    if (this.elements.bandMaxValueLabel) {
      this.elements.bandMaxValueLabel.textContent = formatRadianceLabel(this.state.displayMax);
    }
  }

  updateSelectionIndicator() {
    const { selectionIndicator } = this.elements;
    if (!selectionIndicator || !this.state.activePixel || !this.state.width || !this.state.height) {
      if (selectionIndicator) {
        selectionIndicator.style.display = 'none';
      }
      return;
    }
    const left = ((this.state.activePixel.x + 0.5) / this.state.width) * 100;
    const top = ((this.state.activePixel.y + 0.5) / this.state.height) * 100;
    selectionIndicator.style.left = `${left}%`;
    selectionIndicator.style.top = `${top}%`;
    selectionIndicator.style.display = 'block';
  }

  updateInfoPanel() {
    const { infoWavelength, infoPosition, infoReflectance } = this.elements;
    const bandIndex = this.state.displayBandIndex;
    const wavelength = this.state.wavelengths[bandIndex];
    if (infoWavelength) {
      infoWavelength.textContent = Number.isFinite(wavelength) ? `${wavelength.toFixed(1)} nm` : '—';
    }

    if (infoPosition) {
      infoPosition.textContent = formatPixelInfo(this.state.activePixel, this.state.hoverPixel);
    }

    const selectedValue = this.state.activePixel ? this.lookupReflectance(bandIndex, this.state.activePixel) : null;
    const hoverValue = this.state.hoverPixel ? this.lookupReflectance(bandIndex, this.state.hoverPixel) : null;
    if (infoReflectance) {
      infoReflectance.textContent = formatDualRadiance(selectedValue, hoverValue);
    }
  }

  lookupReflectance(bandIndex, pixel) {
    if (this.state.fullRaster && pixel) {
      const offset = (pixel.y * this.state.width + pixel.x) * this.state.bands + bandIndex;
      const value = this.state.fullRaster[offset];
      return Number.isFinite(value) ? value : null;
    }
    const entry = this.state.bandCache.get(bandIndex);
    if (!entry || !pixel) {
      return null;
    }
    const index = pixel.y * this.state.width + pixel.x;
    if (index < 0 || index >= entry.data.length) {
      return null;
    }
    return entry.data[index];
  }

  handleResize() {
    if (!this.state.initialized) {
      return;
    }
    this.resizeRenderer(this.rendering.rendererMain, this.elements.imageCanvas);
    this.resizeRenderer(this.rendering.rendererStrip, this.elements.stripCanvas);
    this.rendering.renderMain();
    this.rendering.renderStrip();

    this.chart.updateStripAxis();
    this.chart.updateChartSize();
    this.chart.renderSpectrumChart(this.state.selectedSpectrum, this.state.hoverSpectrum, this.state.displayBandIndex);
    this.updateSelectionIndicator();
  }

  resizeRenderer(renderer, canvas) {
    if (!renderer || !canvas) {
      return;
    }
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    renderer.setSize(width, height, false);
  }

  eventToPixel(event) {
    const rect = this.elements.imageCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * this.state.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * this.state.height);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return {
      x: clamp(Math.round(x), 0, this.state.width - 1),
      y: clamp(Math.round(y), 0, this.state.height - 1),
    };
  }

  handleStripPointerMove(event) {
    if (!this.state.initialized || !this.state.cie) {
      return null;
    }
    if (event && event.pointerType === 'touch') {
      event.preventDefault();
    }
    const rect = this.elements.stripCanvas.getBoundingClientRect();
    if (!rect.width) {
      return null;
    }
    const ratio = (event.clientX - rect.left) / rect.width;
    const clamped = clamp01(ratio);
    const cieWavelengths = this.state.cie.wavelengths;
    const minWl = cieWavelengths[0];
    const maxWl = cieWavelengths[cieWavelengths.length - 1];
    const target = minWl + clamped * (maxWl - minWl);
    const bandIndex = nearestBand(target, this.state.wavelengths);
    this.state.hoverBandIndex = bandIndex;
    if (this.state.isStripPointerActive && Number.isInteger(bandIndex)) {
      this.state.activeBandIndex = bandIndex;
      this.updateInfoPanel();
    }
    this.setDisplayBand(bandIndex).catch((error) => {
      console.error('Unable to update band on hover', error);
    });
    return bandIndex;
  }

  handleStripPointerLeave() {
    if (!this.state.initialized) {
      return;
    }
    this.state.hoverBandIndex = null;
    this.state.isStripPointerActive = false;
    this.setDisplayBand(this.state.activeBandIndex).catch((error) => {
      console.error('Unable to restore band after hover', error);
    });
  }

  handleStripPointerDown(event) {
    if (!this.state.initialized) {
      return;
    }
    let bandIndex = null;
    if (event && event.pointerType === 'touch') {
      this.capturePointer(this.elements.stripCanvas, event);
      this.state.isStripPointerActive = true;
      event.preventDefault();
      bandIndex = this.handleStripPointerMove(event);
    } else if (event) {
      bandIndex = this.handleStripPointerMove(event);
    }
    if (Number.isInteger(bandIndex)) {
      this.state.activeBandIndex = bandIndex;
    } else {
      this.state.activeBandIndex = this.state.displayBandIndex;
    }
    this.updateInfoPanel();
  }

  handleStripPointerUp(event) {
    if (!this.state.initialized) {
      return;
    }
    if (event && event.pointerType === 'touch') {
      if (!this.state.isStripPointerActive) {
        return;
      }
      this.releasePointerCaptureSafe(this.elements.stripCanvas, event);
      this.state.isStripPointerActive = false;
      this.handleStripPointerLeave();
    }
  }

  handleStripPointerCancel(event) {
    this.handleStripPointerUp(event);
  }

  handleImagePointerMove(event) {
    if (!this.state.initialized) {
      return;
    }
    if (event && event.pointerType === 'touch') {
      event.preventDefault();
    }
    const pixel = this.eventToPixel(event);
    if (!pixel) {
      return;
    }
    this.state.hoverPixel = pixel;
    this.state.displayPixel = pixel;
    if (this.state.isImagePointerActive) {
      this.state.activePixel = pixel;
      this.updateSelectionIndicator();
    }
    this.updateInfoPanel();
    this.ensureSpectrumForPixel(pixel, { target: 'hover' }).catch((error) => {
      console.error('Unable to update hover spectrum', error);
    });
  }

  handleImagePointerLeave() {
    if (!this.state.initialized) {
      return;
    }
    this.state.isImagePointerActive = false;
    this.state.hoverPixel = null;
    this.state.displayPixel = this.state.activePixel;
    this.updateInfoPanel();
    this.state.hoverSpectrum = null;
    this.chart.renderSpectrumChart(this.state.selectedSpectrum, this.state.hoverSpectrum, this.state.displayBandIndex);
    this.ensureSpectrumForPixel(this.state.activePixel, { target: 'selected' }).catch((error) => {
      console.error('Unable to restore spectrum after hover', error);
    });
  }

  handleImagePointerDown(event) {
    if (!this.state.initialized) {
      return;
    }
    if (event && event.pointerType === 'touch') {
      this.capturePointer(this.elements.imageCanvas, event);
      this.state.isImagePointerActive = true;
      event.preventDefault();
      this.handleImagePointerMove(event);
    }
    const pixel = this.eventToPixel(event);
    if (!pixel) {
      return;
    }
    this.state.activePixel = pixel;
    this.state.displayPixel = pixel;
    this.updateInfoPanel();
    this.ensureSpectrumForPixel(pixel, { force: true, target: 'selected' }).catch((error) => {
      console.error('Unable to update spectrum after click', error);
    });
    this.updateSelectionIndicator();
  }

  handleImagePointerUp(event) {
    if (!this.state.initialized) {
      return;
    }
    if (event && event.pointerType === 'touch') {
      if (!this.state.isImagePointerActive) {
        return;
      }
      this.releasePointerCaptureSafe(this.elements.imageCanvas, event);
      this.state.isImagePointerActive = false;
      this.handleImagePointerLeave();
    }
  }

  handleImagePointerCancel(event) {
    this.handleImagePointerUp(event);
  }

  capturePointer(element, event) {
    if (!element || typeof element.setPointerCapture !== 'function') {
      return;
    }
    try {
      element.setPointerCapture(event.pointerId);
    } catch (error) {
      // ignore
    }
  }

  releasePointerCaptureSafe(element, event) {
    if (!element || typeof element.releasePointerCapture !== 'function') {
      return;
    }
    try {
      if (typeof element.hasPointerCapture !== 'function' || element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      // ignore
    }
  }
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
