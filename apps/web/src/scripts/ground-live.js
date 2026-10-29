// Home's living ground (ADR 0021; design-system.md, "Page geometry"): the contour drawing behind
// the hero, drawn again on the GPU so it moves. One WebGL2 fragment shader draws the contour lines
// of a field on a plane seen in perspective, and the field turns from terrain into a circuit board
// into cells and back, while the plane turns with it. The pointer raises a soft hill under itself,
// so the lines bend around it. src/scripts/motion.js loads this module after the page has painted,
// on Home only, without a reduced-motion preference and without Save-Data. Without WebGL2, or when
// the context is lost, the drawing the build made stays, as it does with no JavaScript.
//
// Every line is --ground, the token every text token reads on at 4.5:1, over the page's own
// background, so no word over a line loses contrast, as with the drawing it replaces. It moves for
// more than 5 s, so the header carries a button that pauses it (SC 2.2.2); the choice lasts for
// the tab (sessionStorage key "motion"), like the theme's.

/** How long each picture holds, and how long one takes to turn into the next, in seconds. */
export const HOLD_S = 9;
export const TURN_S = 3;
/** Terrain, the circuit board, the cells, then terrain again. */
export const PICTURES = 3;
export const CYCLE_S = PICTURES * (HOLD_S + TURN_S);

/**
 * Each picture's share of the field `seconds` into the cycle: one picture alone while it holds,
 * then a smooth hand-over to the next. The shares always add up to 1.
 */
export function shares(seconds) {
  const span = HOLD_S + TURN_S;
  const at = ((seconds % CYCLE_S) + CYCLE_S) % CYCLE_S;
  const index = Math.floor(at / span);
  const into = at - index * span;
  const t = into <= HOLD_S ? 0 : (into - HOLD_S) / TURN_S;
  const eased = t * t * (3 - 2 * t);
  const out = [0, 0, 0];
  out[index] = 1 - eased;
  out[(index + 1) % PICTURES] += eased;
  return out;
}

/** Where the camera stands for each picture: its tilt from straight down and its turn about the
 *  plane's normal, in radians. A relief map, a board seen corner-on, cells seen from above. */
export const VIEWS = [
  { tilt: 0.92, turn: -0.35 },
  { tilt: 0.86, turn: 0.55 },
  { tilt: 0.28, turn: 0.05 },
];

/** The camera for some shares: each view weighted by its picture's share. */
export function viewFor(weights) {
  let tilt = 0;
  let turn = 0;
  weights.forEach((w, i) => {
    tilt += w * VIEWS[i].tilt;
    turn += w * VIEWS[i].turn;
  });
  return { tilt, turn };
}

/** Frames a second: the field drifts slowly, and 60 would double the GPU's work for nothing. */
export const FPS = 30;
/** The finest pixel ratio it draws at: 1 px lines stay crisp, with 44% fewer pixels than 2. */
export const MAX_RATIO = 1.5;
/** A mean frame longer than this, over a second or two, means the GPU cannot keep up. */
export const SLOW_S = 0.05;
/** Frames between two looks at the mean. */
export const WINDOW = 60;

/**
 * The pixel ratio to draw at next, given the mean frame over the last window: the same while frames
 * keep up; 1 if they do not; 0, which pauses it, as the button would, if they do not keep up even
 * at 1. Load shedding, on the visitor's own machine.
 */
export function nextRatio(meanFrameS, ratio) {
  if (meanFrameS <= SLOW_S) return ratio;
  return ratio > 1 ? 1 : 0;
}

/** A step of `value` toward `target`, `rate` per second over `dt` seconds, the same at any frame
 *  rate, and the target itself once the step would be too small to see. */
export function ease(value, target, rate, dt, near = 1e-3) {
  const next = target + (value - target) * Math.exp(-rate * dt);
  return Math.abs(next - target) < near ? target : next;
}

export const VERTEX = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0,1);}`;

// S: the canvas in device pixels; T: seconds; W: the three pictures' shares; V: the camera's tilt
// and turn; P: the pointer in device pixels, its strength and the pixel ratio; C: the lines' color.
// Plane coordinates come from a ray through each pixel meeting the plane z = 0. Terrain is fractal
// value noise; the board is a Voronoi diagram under the chessboard distance, whose borders run at
// 0, 45 and 90 degrees like traces and whose points round off like vias; the cells are a Voronoi
// diagram under the usual distance with its points warped by noise, its borders the cell walls.
// Contours step outward over time, rings leaving each via like a signal and growing round each
// cell like wood. Every third contour is heavier, as on a survey map. Lines too close together to
// draw fade out, and so does the far plane.
export const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 S;uniform float T;uniform vec3 W;uniform vec2 V;uniform vec4 P;uniform vec3 C;
out vec4 o;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
vec2 h2(vec2 p){float n=h(p);return vec2(n,h(p+n+17.1));}
float vn(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+1.),u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;mat2 m=mat2(.8,.6,-.6,.8);
for(int k=0;k<4;k++){s+=a*vn(p);p=m*p*2.03+1.7;a*=.5;}return s;}
vec2 cell(vec2 p,float sq){vec2 i=floor(p),f=fract(p);float a=9.,b=9.;
for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(x,y),q=g+.15+.7*h2(i+g)-f;
float c=max(abs(q.x),abs(q.y)),d=mix(length(q),c,sq*smoothstep(.05,.14,c));
if(d<a){b=a;a=d;}else if(d<b)b=d;}return vec2(a,b-a);}
float line(float v,float w){float f=fwidth(v),d=abs(fract(v+.5)-.5);
return(1.-smoothstep(0.,max(f*w,1e-5),d))*(1.-smoothstep(.3,.7,f));}
float edge(float e,float w){return 1.-smoothstep(0.,max(fwidth(e)*w,1e-5),e);}
void main(){
vec2 uv=(gl_FragCoord.xy-.5*S)/S.y;
float t=V.x,y=V.y,D=3.2;
vec3 f=vec3(-sin(y)*sin(t),cos(y)*sin(t),-cos(t)),r=vec3(cos(y),sin(y),0.),u=cross(r,f);
vec3 c=-D*f,d=normalize(f+.73*(uv.x*r+uv.y*u));
if(d.z>-.02){o=vec4(0);return;}
float s=-c.z/d.z;vec2 q=(c+s*d).xy*1.3;
float v=0.;vec2 b=vec2(1),g=vec2(1);
if(W.x>0.)v+=W.x*1.6*fbm(q*.8+vec2(T*.021,T*.013)+.4*vn(q*.5-T*.01));
if(W.y>0.){b=cell(q*.9,1.);v+=W.y*1.5*(b.x-T*.03);}
if(W.z>0.){g=cell(q*1.1+.35*vec2(fbm(q+3.1),fbm(q-5.2)),0.);v+=W.z*1.5*(g.x-T*.012);}
vec2 pd=(gl_FragCoord.xy-P.xy)/(130.*P.w);
v+=P.z*.26*exp(-dot(pd,pd));
float L=v*7.,n=1.-smoothstep(.04,.12,length(fwidth(q)));
float a=max(line(L,1.2),.9*line(L/3.,2.4));
if(W.y>0.)a=max(a,W.y*n*edge(b.y,1.4));
if(W.z>0.)a=max(a,.8*W.z*n*edge(g.y,1.2));
a*=1.-smoothstep(D*1.2,D*3.,s);
o=vec4(C*a,a);}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/** The lines' color, as the build's drawing paints it: a 1×1 canvas resolves whatever syntax the
 *  stylesheet uses, oklch included, to the sRGB it paints. */
function inkOf(drawing) {
  const line = drawing?.querySelector('.ground-line');
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!line || !ctx) return [0.5, 0.5, 0.5];
  ctx.fillStyle = getComputedStyle(line).stroke;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

const KEY = 'motion';
const stored = () => {
  try {
    return sessionStorage.getItem(KEY) === 'paused';
  } catch {
    return false;
  }
};
const store = (paused) => {
  try {
    if (paused) sessionStorage.setItem(KEY, 'paused');
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage refused: the choice lasts until the page is left.
  }
};

/** Starts the living ground on `canvas`, over the build's drawing beside it. False if it cannot
 *  run here, and the drawing stays. */
export function boot(canvas) {
  const root = document.documentElement;
  const drawing = canvas.parentElement?.querySelector('svg.ground');
  const toggle = document.querySelector('[data-motion-toggle]');
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return false;
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (!program || !vs || !fs) return false;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);
  const at = Object.fromEntries(
    ['S', 'T', 'W', 'V', 'P', 'C'].map((name) => [name, gl.getUniformLocation(program, name)]),
  );

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const state = {
    paused: stored(),
    // Off: not drawing, under reduced motion or with the context lost. Spent: given back to the
    // build's drawing for good, by a lost context or a GPU that could not keep up.
    off: false,
    spent: false,
    seen: true,
    clock: 0,
    last: 0,
    frame: 0,
    // The pointer, eased: where it is on the canvas in device pixels, and how strongly it pulls.
    pointer: { x: 0, y: 0, pull: 0, toX: 0, toY: 0, toPull: 0 },
    // The pointer also leans the camera a little, eased the same way.
    lean: { tilt: 0, turn: 0, toTilt: 0, toTurn: 0 },
  };
  let ratio = 1;
  let cap = MAX_RATIO;
  let ink = inkOf(drawing);
  // The governor's window: frames drawn, and the seconds between them.
  const pace = { frames: 0, seconds: 0 };

  const fit = () => {
    ratio = Math.min(devicePixelRatio || 1, cap);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  };

  const draw = () => {
    const weights = shares(state.clock);
    const view = viewFor(weights);
    gl.uniform2f(at.S, canvas.width, canvas.height);
    gl.uniform1f(at.T, state.clock);
    gl.uniform3f(at.W, weights[0], weights[1], weights[2]);
    gl.uniform2f(at.V, view.tilt + state.lean.tilt, view.turn + state.lean.turn);
    gl.uniform4f(at.P, state.pointer.x, state.pointer.y, state.pointer.pull, ratio);
    gl.uniform3f(at.C, ink[0], ink[1], ink[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const tick = (now) => {
    state.frame = 0;
    // Every other frame at 60 Hz: wait for the next if this one comes too soon.
    if (state.last && now - state.last < 1000 / FPS - 4) {
      state.frame = requestAnimationFrame(tick);
      return;
    }
    const dt = state.last ? Math.min((now - state.last) / 1000, 0.1) : 0;
    state.last = now;
    if (dt && !state.paused) {
      pace.frames += 1;
      pace.seconds += dt;
      if (pace.frames === WINDOW) {
        const next = nextRatio(pace.seconds / WINDOW, ratio);
        pace.frames = 0;
        pace.seconds = 0;
        // Too slow even at 1: pause, as the button would, without storing it. The button stays
        // where it is, now saying Play, so nothing that may hold focus goes away.
        if (next === 0) {
          state.paused = true;
          show();
          halt();
          return;
        }
        if (next !== ratio) {
          cap = next;
          fit();
        }
      }
    }
    // Paused, the clock stands still; the pointer still moves what it moves, since a visitor's own
    // hand is not motion that starts by itself (SC 2.2.2).
    if (!state.paused) state.clock += dt;
    const p = state.pointer;
    p.x = ease(p.x, p.toX, 8, dt, 0.5);
    p.y = ease(p.y, p.toY, 8, dt, 0.5);
    p.pull = ease(p.pull, p.toPull, 4, dt);
    const l = state.lean;
    l.tilt = ease(l.tilt, l.toTilt, 2, dt);
    l.turn = ease(l.turn, l.toTurn, 2, dt);
    draw();
    schedule();
  };

  const settled = () => {
    const { pointer: p, lean: l } = state;
    return (
      p.x === p.toX &&
      p.y === p.toY &&
      p.pull === p.toPull &&
      l.tilt === l.toTilt &&
      l.turn === l.toTurn
    );
  };
  const running = () =>
    !state.off && (!state.paused || !settled()) && state.seen && !document.hidden;
  function schedule() {
    if (running() && !state.frame) state.frame = requestAnimationFrame(tick);
  }
  const halt = () => {
    cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.last = 0;
  };

  const show = () => {
    const paused = state.paused;
    root.dataset.motion = paused ? 'paused' : 'on';
    if (toggle) {
      const name = paused ? 'Play motion' : 'Pause motion';
      toggle.setAttribute('aria-label', name);
      toggle.title = name;
      toggle.dataset.state = paused ? 'paused' : 'on';
    }
  };

  const stop = (forGood = false) => {
    state.off = true;
    state.spent ||= forGood;
    halt();
    // The button hides with the motion; focus on it moves to its neighbour, the theme toggle.
    if (toggle && document.activeElement === toggle)
      document.querySelector('[data-theme-toggle]')?.focus();
    delete root.dataset.motion;
    delete root.dataset.groundLive;
  };

  toggle?.addEventListener('click', () => {
    state.paused = !state.paused;
    store(state.paused);
    show();
    state.last = 0;
    schedule();
  });

  addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch') return;
      const box = canvas.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      const p = state.pointer;
      p.toX = (event.clientX - box.left) * ratio;
      p.toY = (box.bottom - event.clientY) * ratio;
      p.toPull = inside ? 1 : 0;
      // Over the drawing, lean up to about 3 degrees toward the pointer; away from it, stand back.
      const across = (event.clientX - box.left) / box.width;
      const down = (event.clientY - box.top) / box.height;
      state.lean.toTurn = inside ? (across * 2 - 1) * 0.05 : 0;
      state.lean.toTilt = inside ? (down * 2 - 1) * -0.04 : 0;
      if (!p.pull) {
        p.x = p.toX;
        p.y = p.toY;
      }
      schedule();
    },
    { passive: true },
  );
  // Leaving the window is a pointerout with nowhere to go.
  addEventListener('pointerout', (event) => {
    if (event.relatedTarget) return;
    state.pointer.toPull = 0;
    state.lean.toTurn = 0;
    state.lean.toTilt = 0;
    schedule();
  });

  new IntersectionObserver(([entry]) => {
    state.seen = entry?.isIntersecting ?? true;
    if (state.seen) schedule();
    else halt();
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? halt() : schedule()));
  reduce.addEventListener('change', () => (reduce.matches ? stop() : start()));

  // The theme: the toggle sets data-theme on <html>, and the OS can change while System holds.
  const repaint = () => {
    ink = inkOf(drawing);
    if (!state.frame && !state.off) draw();
  };
  new MutationObserver(repaint).observe(root, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  dark.addEventListener('change', repaint);

  new ResizeObserver(() => {
    if (state.off) return;
    fit();
    if (!state.frame) draw();
  }).observe(canvas);

  canvas.addEventListener('webglcontextlost', () => stop(true));

  function start() {
    if (reduce.matches || state.spent) return;
    state.off = false;
    fit();
    draw();
    root.dataset.groundLive = '';
    show();
    schedule();
  }
  start();
  return true;
}
