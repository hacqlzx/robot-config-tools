/** 点云着色器 — PRIMITIVE_POINTS 渲染 */

export const pointcloudVert = /* glsl */ `
attribute vec3 vertex_position;
attribute vec4 vertex_texCoord0;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
uniform float uPointSize;
uniform float uDisplayRatio;
varying vec4 vColor;
void main(void) {
    gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
    float rnd = fract(sin(dot(vertex_position, vec3(12.9898, 78.233, 45.5432))) * 43758.5453);
    gl_PointSize = rnd < uDisplayRatio ? uPointSize : 0.0;
    vColor = vertex_texCoord0;
}
`;

export const pointcloudFrag = /* glsl */ `
precision mediump float;
varying vec4 vColor;
void main(void) {
    vec2 c = gl_PointCoord - vec2(0.5);
    if (length(c) > 0.5) discard;
    gl_FragColor = vColor;
}
`;
