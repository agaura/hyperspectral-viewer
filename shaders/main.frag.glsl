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
