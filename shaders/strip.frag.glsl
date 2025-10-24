precision highp float;
varying vec2 vUv;

uniform sampler2D uTexture;
uniform float uScale;

const float ALPHA = 0.38130632325908215;
const float GRAY = 0.3340893499109253;

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
  vec3 p3LinearIdeal = xyz_to_p3() * xyzSpectral;

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
