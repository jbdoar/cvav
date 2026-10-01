#version 300 es
precision highp float;
uniform sampler2D image;
out vec4 outputColor;
void main() {
    vec3 value = texelFetch(image, ivec2(gl_FragCoord.xy), 0).rgb;
    outputColor = vec4(value * .5 + .5, 1);
}
