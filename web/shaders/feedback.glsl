#version 300 es
precision highp float;
precision highp int;
uniform sampler2D previous;
uniform sampler2D blurred;
uniform sampler2D source;
uniform float persistence, gain, diffusion, zoom, angle, injection, brightness, color_cycle, saturation;
uniform bool invert, color;
out vec4 outputColor;
vec3 pixel(ivec2 p) {
    ivec2 size = textureSize(previous, 0);
    if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size))) return vec3(0);
    return texelFetch(previous, p, 0).rgb;
}
vec3 sampleFeedback(vec2 p) {
    ivec2 base = ivec2(floor(p));
    vec2 f = fract(p);
    return mix(mix(pixel(base), pixel(base + ivec2(1, 0)), f.x),
               mix(pixel(base + ivec2(0, 1)), pixel(base + ivec2(1, 1)), f.x), f.y);
}
void main() {
    vec2 size = vec2(textureSize(previous, 0));
    vec2 p = gl_FragCoord.xy - size * .5;
    float a = radians(angle);
    // Inverse image transform, with upward-positive framebuffer y.
    vec2 q = vec2(cos(a)*p.x + sin(a)*p.y, -sin(a)*p.x + cos(a)*p.y) / zoom;
    vec3 warped = sampleFeedback(q + size * .5 - .5);
    if (color) {
        vec3 shifted = color_cycle >= 0.0 ? warped.brg : warped.gbr;
        warped = mix(warped, shifted, abs(color_cycle));
        float luma = dot(warped, vec3(.299, .587, .114));
        warped = vec3(luma) + saturation * (warped - luma);
    }
    vec3 incoming = texture(source, gl_FragCoord.xy / size).rgb;
    if (!color) incoming = vec3(dot(incoming, vec3(.299, .587, .114)));
    incoming = incoming * 2.0 - 1.0;
    ivec2 xy = ivec2(gl_FragCoord.xy);
    vec3 result = persistence * texelFetch(previous, xy, 0).rgb
                + diffusion * texelFetch(blurred, xy, 0).rgb
                + (invert ? -gain : gain) * warped + injection * incoming + brightness;
    outputColor = vec4(clamp(result, -1.0, 1.0), 1);
}
