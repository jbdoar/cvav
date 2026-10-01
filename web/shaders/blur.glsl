#version 300 es
precision highp float;
precision highp int;
uniform sampler2D image;
uniform ivec2 direction;
uniform int radius;
uniform float weights[41];
out vec4 outputColor;
// OpenCV BORDER_REFLECT_101: ... c b | a b c ... | b a ...
int reflect101(int i, int n) {
    if (n <= 1) return 0;
    int period = 2 * (n - 1);
    i = ((i % period) + period) % period;
    return i < n ? i : period - i;
}
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(image, 0);
    vec3 sum = texelFetch(image, p, 0).rgb * weights[0];
    for (int i = 1; i <= 40; i++) {
        if (i > radius) break;
        ivec2 a = p + direction * i;
        ivec2 b = p - direction * i;
        a = ivec2(reflect101(a.x, size.x), reflect101(a.y, size.y));
        b = ivec2(reflect101(b.x, size.x), reflect101(b.y, size.y));
        sum += weights[i] * (texelFetch(image, a, 0).rgb + texelFetch(image, b, 0).rgb);
    }
    outputColor = vec4(sum, 1);
}
