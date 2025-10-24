export async function loadShaderSources() {
  const [vertexShaderSource, mainFragmentShaderSource, stripFragmentShaderSource] = await Promise.all([
    loadShader('shaders/vertex.glsl'),
    loadShader('shaders/main.frag.glsl'),
    loadShader('shaders/strip.frag.glsl'),
  ]);

  return {
    vertexShaderSource,
    mainFragmentShaderSource,
    stripFragmentShaderSource,
  };
}

async function loadShader(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load shader from ${path}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}
