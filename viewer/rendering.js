import * as THREE from 'three';

export function createRenderingContext(elements, shaderSources) {
  const { imageCanvas, stripCanvas } = elements;

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

  const mainMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTexture: { value: null },
      uSpectralTexture: { value: null },
      uSpectralScale: { value: 1 },
      uSpectralCoord: { value: 0.5 },
      uMinValue: { value: 0 },
      uMaxValue: { value: 1 },
    },
    vertexShader: shaderSources.vertexShaderSource,
    fragmentShader: shaderSources.mainFragmentShaderSource,
  });

  const stripMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTexture: { value: null },
      uScale: { value: 1 },
    },
    vertexShader: shaderSources.vertexShaderSource,
    fragmentShader: shaderSources.stripFragmentShaderSource,
  });

  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const mainPlane = new THREE.Mesh(quadGeometry, mainMaterial);
  sceneMain.add(mainPlane);

  const stripPlane = new THREE.Mesh(quadGeometry, stripMaterial);
  sceneStrip.add(stripPlane);

  function updateMainPlaneScale(state) {
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
    if (!mainMaterial.uniforms.uTexture.value) {
      return;
    }
    rendererMain.render(sceneMain, cameraMain);
  }

  function renderStrip() {
    rendererStrip.render(sceneStrip, cameraStrip);
  }

  return {
    rendererMain,
    rendererStrip,
    sceneMain,
    sceneStrip,
    cameraMain,
    cameraStrip,
    mainMaterial,
    stripMaterial,
    isWebGL2,
    updateMainPlaneScale,
    renderMain,
    renderStrip,
  };
}
