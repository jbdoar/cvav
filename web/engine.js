// GPU-only feedback state: two alternating framebuffers and two blur buffers.
export class FeedbackEngine {
  static async create(canvas) {
    const files = ['vertex', 'blur', 'feedback', 'display'];
    const sources = await Promise.all(files.map(async name => {
      const response = await fetch(new URL(`./shaders/${name}.glsl`, import.meta.url));
      if (!response.ok) throw new Error(`Could not load ${name} shader (${response.status}).`);
      return response.text();
    }));
    return new FeedbackEngine(canvas, Object.fromEntries(files.map((name, i) => [name, sources[i]])));
  }

  constructor(canvas, sources) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {alpha:false, antialias:false, depth:false, preserveDrawingBuffer:true});
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('This demo needs WebGL 2 with floating-point rendering. Try a current browser with hardware acceleration enabled.');
    }
    this.gl = gl;
    gl.disable(gl.DITHER);
    this.programs = {};
    this.locations = new Map();
    for (const name of ['blur', 'feedback', 'display']) {
      const program = gl.createProgram();
      for (const [type, code] of [[gl.VERTEX_SHADER,sources.vertex], [gl.FRAGMENT_SHADER,sources[name]]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, code); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader); gl.deleteShader(shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      this.programs[name] = program;
    }
    gl.bindVertexArray(gl.createVertexArray());
    this.states = [this.target(),this.target()];
    this.blurBuffers = [this.target(),this.target()];
    this.input = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.input);
    this.textureSettings(gl.LINEAR);
    this.current = 0;
    this.reset();
  }

  textureSettings(filter) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  }

  target() {
    const gl = this.gl;
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
    this.textureSettings(gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,this.canvas.width,this.canvas.height,0,gl.RGBA,gl.HALF_FLOAT,null);
    const framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Floating-point framebuffer is unavailable.');
    return {texture,framebuffer};
  }

  location(name) {
    const key = `${this.active}:${name}`;
    if (!this.locations.has(key)) this.locations.set(key,this.gl.getUniformLocation(this.programs[this.active],name));
    return this.locations.get(key);
  }

  begin(name, target = null) {
    const gl = this.gl;
    this.active = name;
    gl.useProgram(this.programs[name]); gl.bindFramebuffer(gl.FRAMEBUFFER,target?.framebuffer ?? null);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
  }

  bind(name, texture, unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.uniform1i(this.location(name),unit);
  }

  reset() {
    const gl = this.gl;
    for (const target of [...this.states,...this.blurBuffers]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);
      gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.display();
  }

  step(source, p, color) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.input);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
    const previous = this.states[this.current];
    let smooth = previous;
    if (p.diffusion > 0 && p.sigma > 0) {
      const radius = Math.min(40,Math.round(p.sigma*4));
      if (this.lastSigma !== p.sigma) {
        this.weights = new Float32Array(41);
        let total = 0;
        for (let i=0;i<=radius;i++) { this.weights[i] = Math.exp(-i*i/(2*p.sigma*p.sigma)); total += this.weights[i]*(i ? 2 : 1); }
        for (let i=0;i<=radius;i++) this.weights[i] /= total;
        this.lastSigma = p.sigma;
      }
      for (let pass=0;pass<2;pass++) {
        this.begin('blur',this.blurBuffers[pass]);
        this.bind('image',smooth.texture,0);
        gl.uniform2i(this.location('direction'),pass===0 ? 1 : 0,pass===0 ? 0 : 1);
        gl.uniform1i(this.location('radius'),radius);
        gl.uniform1fv(this.location('weights[0]'),this.weights);
        gl.drawArrays(gl.TRIANGLES,0,3);
        smooth = this.blurBuffers[pass];
      }
    }
    const next = this.states[1-this.current];
    this.begin('feedback',next);
    this.bind('previous',previous.texture,0); this.bind('blurred',smooth.texture,1); this.bind('source',this.input,2);
    for (const name of ['persistence','gain','diffusion','zoom','angle','injection','brightness','color_cycle','saturation']) gl.uniform1f(this.location(name),p[name]);
    gl.uniform1i(this.location('color'),color ? 1 : 0); gl.uniform1i(this.location('invert'),p.invert ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    this.current = 1-this.current;
  }

  display() {
    this.begin('display'); this.bind('image',this.states[this.current].texture,0);
    this.gl.drawArrays(this.gl.TRIANGLES,0,3);
  }
}
