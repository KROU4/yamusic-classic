// Generative animation for My Wave: a soft glowing orb of drifting colour layers with light rays,
// modelled on the look of the official 2024 client (own shader, not its code).
// Custom WebGL shader; reacts to music via the audio graph analyzer, colors follow the wave's mood.
// Modes: full (shader), lite (light CSS animation), off (static gradient). Without WebGL — lite.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { vibeMode, vibeFps, vibeReact } from "../lib/ui.js";
import { windowVisible } from "../lib/desktop.js";
import { theme } from "../lib/theme.js";
import { api } from "../lib/api.js";
import * as graph from "../player/audiograph.js";
import * as p from "../player/engine.js";

const PALETTES = {
  // core (center) → mid → rim → edge glow, as in the official orb: yellow heart, orange/red body, magenta fringe
  default: ["#fff34d", "#ff8a1c", "#ff2a3d", "#c42fb3"],
  active: ["#ffd23f", "#ff7a1a", "#ff3b2f", "#d6246e"],
  fun: ["#fff15c", "#9be15d", "#ff5fa8", "#ffb13b"],
  calm: ["#9ff3ff", "#35d0c6", "#2f6bff", "#6b4dff"],
  sad: ["#d4b8ff", "#8a6bff", "#4b3fd1", "#2a2f97"],
  "wake-up": ["#fff1a8", "#ffb36b", "#ff6f91", "#d45cff"],
  workout: ["#ffe14d", "#ff7a1a", "#ff2e4d", "#b5179e"],
  "road-trip": ["#ffe066", "#ff8a3d", "#36bfff", "#3d5cff"],
  "work-background": ["#e0ff8a", "#a3e05c", "#47c2a8", "#3f7cff"],
  "study-background": ["#f0ff9e", "#c6f06b", "#5ad1b0", "#4a6bff"],
  party: ["#ffe14d", "#ff3fa4", "#a42fff", "#4b2fff"],
  "fall-asleep": ["#b8c4ff", "#6f5cff", "#3b3f9e", "#1e8bc3"],
};

/** Colors from the wave settings: mood outranks activity; with no settings, the signature warm ones. */
export function paletteFor(settings) {
  const s = settings || {};
  if (s.moodEnergy && s.moodEnergy !== "all" && PALETTES[s.moodEnergy]) return PALETTES[s.moodEnergy];
  if (s.activity && s.activity !== "any" && PALETTES[s.activity]) return PALETTES[s.activity];
  return PALETTES.default;
}

/** The frame-rate cap from the settings, one per render loop: skip(now) is true when this frame should be skipped. */
function makePacer() {
  let due = 0;
  return (now) => {
    const cap = vibeFps.peek();
    if (!(cap > 0)) return false;
    const step = 1000 / cap;
    if (now < due - 1) return true; // 1 ms of slack for timer jitter
    // the next slot follows the schedule, not this frame, so uneven screen rates still average out to the cap;
    // after a stall (hidden, paused) the schedule restarts from now
    due = now - due > step ? now + step : due + step;
    return false;
  };
}

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
// A soft, irregular glowing orb: four translucent colour layers drift around the centre and overlap
// (the overlaps make the "folds"), a bloom around it and a few long thin rays streaking out of the rim.
// Bass breathes the orb and stretches the rays; overall energy speeds up the drift.
const FRAG = `precision mediump float;
uniform vec2 uRes;uniform float uTime,uEnergy,uBass,uPulse,uPlay;
uniform vec3 uC0,uC1,uC2,uC3,uBg;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.07+vec2(1.7,9.2);a*=.5;}return v;}
// one soft blob: centre c, radius r, outline wobbling with low-frequency noise around the angle
float blob(vec2 uv,vec2 c,float r,float seed,float t){
 vec2 d=uv-c;float l=length(d);vec2 dir=d/max(l,1e-4);
 float wob=fbm(dir*1.6+vec2(seed,seed*1.7)+t*.22)-.5;
 float rr=r*(1.+.42*wob);
 // mostly soft, with a slightly firmer edge so overlaps read as folds
 return mix(smoothstep(rr,rr*.5,l),smoothstep(rr,rr*.9,l),.4);
}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
 float t=uTime;
 float R=.30*(1.+uBass*.08+uPulse*.12);
 float sp=.35+.25*uPlay+.5*uEnergy;
 vec3 c3=uC3,c2=uC2,c1=uC1,c0=uC0;
 // back to front: magenta fringe, red body, orange, yellow heart
 vec2 o3=R*.22*vec2(sin(t*.31*sp+1.),cos(t*.27*sp+2.));
 vec2 o2=R*.26*vec2(sin(t*.43*sp+4.),cos(t*.37*sp+.5));
 vec2 o1=R*.30*vec2(sin(t*.53*sp+2.5),cos(t*.47*sp+3.3));
 vec2 o0=R*.34*vec2(sin(t*.61*sp+5.),cos(t*.57*sp+1.2));
 float b3=blob(uv,o3,R*1.04,1.3,t*sp)*.6;
 float b2=blob(uv,o2,R*1.0,7.1,t*sp);
 float b1=blob(uv,o1,R*.95,3.7,t*sp);
 float b0=blob(uv,o0,R*.78,9.9,t*sp);
 // internal flow so the colour inside each layer isn't flat
 float flow=fbm(uv*3.+vec2(t*.12*sp,-t*.09*sp));
 vec3 col=c3;float a=b3;
 col=mix(col,mix(c2,c3,flow*.35),b2*.92);a=max(a,b2);
 col=mix(col,mix(c1,c2,flow*.45),b1*.9);a=max(a,b1);
 col=mix(col,mix(c0,c1,flow*.30),b0*.88);a=max(a,b0);
 float l=length(uv);vec2 dir=uv/max(l,1e-4);
 // bloom: a wide soft halo in the fringe colours
 float bloom=exp(-pow(max(l-R*.6,0.)/(R*.5),2.))*(.22+.2*uEnergy);
 // rays: sparse angular spikes with their own lengths, thinning with distance
 float ang=n(dir*13.+vec2(t*.05,-t*.04));
 float len=R*(.3+.5*n(dir*4.+11.+t*.03))*(1.+uBass*.7+uPulse*.5);
 float k=clamp((l-R*.7)/len,0.,1.);
 // wider at the base, needle-thin at the tip
 float spike=pow(smoothstep(mix(.5,.78,k),1.,ang),6.);
 float along=smoothstep(R*.6,R*.85,l)*(1.-smoothstep(R*.75,R*.8+len,l));
 float ray=spike*along*(.45+.4*uEnergy);
 vec3 rayCol=mix(c1,c0,.4);
 vec3 c=uBg;
 c=mix(c,mix(c3,c2,.5),clamp(bloom,0.,1.)*(1.-a));
 c=mix(c,col,a);
 c=mix(c,rayCol,clamp(ray,0.,1.)*(1.-a*.7));
 gl_FragColor=vec4(c,1.);
}`;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const cssBg = () => {
  let v = getComputedStyle(document.documentElement).getPropertyValue("--vibe-bg").trim();
  // the production CSS minifier shortens #ffffff to #fff
  if (/^#[0-9a-f]{3}$/i.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
  return /^#[0-9a-f]{6}$/i.test(v) ? v : "#141414";
};

// A shader that failed once (GPU/driver) is not retried on every remount: each attempt would cost a WebGL context
let glBroken = false;

function startGl(canvas, getState) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: "low-power" });
  if (!gl) return null;
  let u = null;

  // program, buffer and uniforms; rebuilt after the context is restored (driver reset, sleep/wake)
  const init = () => {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link failed");
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    u = Object.fromEntries(["uRes", "uTime", "uEnergy", "uBass", "uPulse", "uPlay", "uC0", "uC1", "uC2", "uC3", "uBg"].map((k) => [k, gl.getUniformLocation(prog, k)]));
    canvas.width = canvas.height = 0; // forces resize() to set the viewport again
  };
  try {
    init();
  } catch (e) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw e;
  }

  let raf = 0;
  let visible = true;
  let lost = false;
  let last = performance.now();
  const skip = makePacer();
  let time = Math.random() * 100;
  const sm = { energy: 0, bass: 0, pulse: 0, play: 0, colors: null };
  // re-read the theme background once a second: the "follow system" theme changes without re-rendering the component
  let bg = hex(cssBg());
  let bgAt = 0;

  const resize = () => {
    // half resolution: the image is blurry anyway, and the GPU does a quarter of the work
    const scale = Math.min(1, (window.devicePixelRatio || 1) * 0.5);
    const w = Math.max(1, Math.round(canvas.clientWidth * scale));
    const hgt = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
      gl.viewport(0, 0, w, hgt);
    }
  };

  // document.hidden stays false in the shell (backgroundThrottling is off for playback),
  // so the shell's own visibility flag and the explicit pause from the owner are checked too
  const canRun = () => visible && !lost && !document.hidden && !getState().paused && windowVisible.peek();

  const frame = (now) => {
    raf = 0;
    if (!canRun()) return;
    if (skip(now)) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const st = getState();
    const lv = st.playing && vibeReact.peek() ? graph.levels() : null;
    // without an analyzer (browser, paused) — a calm "breathing", slightly livelier while playing
    const target = lv || { energy: st.playing ? 0.35 + 0.1 * Math.sin(now / 900) : 0.12, bass: st.playing ? 0.15 + 0.08 * Math.sin(now / 430) : 0.04 };
    const k = 1 - Math.exp(-dt * 7);
    sm.energy += (target.energy - sm.energy) * k;
    sm.bass += (target.bass - sm.bass) * (1 - Math.exp(-dt * 12));
    sm.play += ((st.playing ? 1 : 0) - sm.play) * (1 - Math.exp(-dt * 2));
    sm.pulse = Math.max(0, sm.pulse - dt * 1.6);
    if (st.pulseAt && st.pulseAt !== sm.pulseAt) {
      sm.pulseAt = st.pulseAt;
      if (vibeReact.peek()) sm.pulse = 1;
    }
    // smooth palette change when the mood changes
    const target3 = st.colors.map(hex);
    sm.colors = sm.colors ? sm.colors.map((c, i) => c.map((v, j) => v + (target3[i][j] - v) * (1 - Math.exp(-dt * 3)))) : target3;
    time += dt * (0.6 + sm.play * 0.4 + sm.energy * 1.2);
    resize();
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uEnergy, Math.min(1, sm.energy));
    gl.uniform1f(u.uBass, Math.min(1, sm.bass));
    gl.uniform1f(u.uPulse, sm.pulse);
    gl.uniform1f(u.uPlay, sm.play);
    gl.uniform3fv(u.uC0, sm.colors[0]);
    gl.uniform3fv(u.uC1, sm.colors[1]);
    gl.uniform3fv(u.uC2, sm.colors[2]);
    gl.uniform3fv(u.uC3, sm.colors[3]);
    if (now - bgAt > 1000) {
      bg = hex(cssBg());
      bgAt = now;
    }
    gl.uniform3fv(u.uBg, bg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    window.__ymcVibeFrames = (window.__ymcVibeFrames || 0) + 1; // smoke tests check that hidden views stop rendering
    raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && canRun()) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  // the animation doesn't use the GPU when the block is scrolled off-screen or the window is minimized.
  // A batch may hold several entries for the canvas — the last one is the current state
  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    kick();
  });
  io.observe(canvas);
  const onLost = (e) => {
    e.preventDefault(); // allows the browser to restore the context
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const onRestored = () => {
    try {
      init();
      lost = false;
      kick();
    } catch {
      // stays blank until the next mount; the page itself keeps working
    }
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  document.addEventListener("visibilitychange", kick);
  const unsubscribe = windowVisible.subscribe(kick);
  kick();
  return {
    kick,
    stop() {
      cancelAnimationFrame(raf);
      io.disconnect();
      unsubscribe();
      document.removeEventListener("visibilitychange", kick);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// ---------- the official orb (looped video from the installed official app) ----------

// The official loop is warm (yellow core, red body, magenta fringe). Moods and activities are shown by
// rotating its hue, which keeps the original's light and motion while matching the wave's colours.
const HUE = {
  default: 0,
  active: -10,
  fun: 85,
  calm: 195,
  sad: 245,
  "wake-up": 15,
  workout: -12,
  "road-trip": 165,
  "work-background": 150,
  "study-background": 140,
  party: 285,
  "fall-asleep": 225,
};
const hueFor = (colors) => HUE[Object.keys(PALETTES).find((k) => PALETTES[k] === colors) || "default"] || 0;

let assetsP = null;
/** Official loop links from the backend; null when the official app isn't installed (then the own shader runs). */
export function officialAssets() {
  assetsP ||= api
    .get("/vibe/assets")
    .then((a) => (a?.available ? a : null))
    .catch(() => null);
  return assetsP;
}

// In-between frames for the 25 fps loop: the last two decoded frames are cross-faded on every screen
// refresh, so the orb moves at 60 fps (or the screen's rate) instead of stepping. The orb is soft and
// blurry, so a linear blend reads as motion; the cost is one frame (40 ms) of delay, which nobody sees here.
const BLEND_VERT = `attribute vec2 a;varying vec2 uv;void main(){uv=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}`;
const BLEND_FRAG = `precision mediump float;uniform sampler2D f0;uniform sampler2D f1;uniform float t;varying vec2 uv;
void main(){gl_FragColor=mix(texture2D(f0,uv),texture2D(f1,uv),t);}`;

/** Returns { draw(now), stop() } or null when WebGL or requestVideoFrameCallback is missing (the video shows as is). */
function startBlend(canvas, video, onFirstFrame, onLost) {
  if (!("requestVideoFrameCallback" in video)) return null;
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, BLEND_VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, BLEND_FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const tex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    // the loop is 1000×1000 (not a power of two): no mipmaps, clamped edges
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  let prev = tex();
  let cur = tex();
  gl.uniform1i(gl.getUniformLocation(prog, "f0"), 0);
  gl.uniform1i(gl.getUniformLocation(prog, "f1"), 1);
  const uT = gl.getUniformLocation(prog, "t");
  let frames = 0; // decoded frames so far (0, 1, 2+)
  let at = 0; // when the newest frame arrived
  let gap = 40; // smoothed interval between frames, ms (25 fps at 1×; longer when the loop slows down)
  let id = 0;
  let dead = false;
  const onFrame = (now) => {
    if (dead) return;
    [prev, cur] = [cur, prev];
    gl.bindTexture(gl.TEXTURE_2D, cur);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    if (!frames) onFirstFrame();
    if (frames < 2) frames++;
    const d = now - at;
    if (at && d > 8 && d < 250) gap += (d - gap) * 0.3;
    at = now;
    id = video.requestVideoFrameCallback(onFrame);
  };
  // a lost context (GPU reset, sleep) draws nothing: the owner shows the plain video again
  const lost = () => {
    dead = true;
    video.cancelVideoFrameCallback(id);
    onLost();
  };
  canvas.addEventListener("webglcontextlost", lost);
  id = video.requestVideoFrameCallback(onFrame);
  return {
    draw(now) {
      if (dead || !frames) return;
      // the loop is 1000 px: no point in a bigger canvas, and a smaller box gets a smaller one
      const side = Math.min(1000, Math.round(canvas.clientHeight * (window.devicePixelRatio || 1)));
      if (side > 0 && (canvas.width !== side || canvas.height !== side)) {
        canvas.width = canvas.height = side;
        gl.viewport(0, 0, side, side);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prev);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, cur);
      gl.uniform1f(uT, frames < 2 ? 1 : Math.min(1, (now - at) / gap));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      window.__ymcVibeFrames = (window.__ymcVibeFrames || 0) + 1;
    },
    stop() {
      // first: loseContext() below fires webglcontextlost later, which must not reach the next owner
      canvas.removeEventListener("webglcontextlost", lost);
      dead = true;
      video.cancelVideoFrameCallback(id);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function OfficialVibe({ assets, colors, active, pulseAt, paused }) {
  const box = useRef(null);
  const video = useRef(null);
  const canvas = useRef(null);
  const state = useRef({});
  const light = theme.value === "light" || (theme.value === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  // 30 fps is the economy setting: the plain video, no blending
  const smooth = vibeFps.value !== 30;
  const [blending, setBlending] = useState(false);
  state.current = { playing: !!active && p.playing.value, pulseAt, paused };

  // a new video/canvas (theme or mode change) must not inherit is-blend for even one painted frame
  useLayoutEffect(() => setBlending(false), [light, smooth]);

  // re-runs on a theme switch too: the video element is recreated then
  useEffect(() => {
    const el = box.current;
    const v = video.current;
    if (!el || !v) return;
    let raf = 0;
    let visible = true;
    let last = performance.now();
    let blend = null;
    // the video stays visible (with its poster) until the canvas has a frame to show
    setBlending(false);
    if (smooth && canvas.current) {
      try {
        blend = startBlend(
          canvas.current,
          v,
          () => setBlending(true),
          () => {
            blend = null;
            setBlending(false);
          },
        );
      } catch {
        blend = null; // the plain video stays
      }
    }
    const sm = { bass: 0, energy: 0, pulse: 0, rate: 1 };
    const skip = makePacer();
    const canRun = () => visible && !document.hidden && !state.current.paused && windowVisible.peek();
    const frame = (now) => {
      raf = 0;
      if (!canRun()) return;
      if (skip(now)) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = state.current;
      const react = vibeReact.peek();
      const lv = st.playing && react ? graph.levels() : null;
      const target = lv || { bass: st.playing && react ? 0.18 + 0.06 * Math.sin(now / 430) : 0, energy: st.playing && react ? 0.3 : 0 };
      sm.bass += (target.bass - sm.bass) * (1 - Math.exp(-dt * 10));
      sm.energy += (target.energy - sm.energy) * (1 - Math.exp(-dt * 5));
      if (st.pulseAt && st.pulseAt !== sm.pulseAt) {
        sm.pulseAt = st.pulseAt;
        if (react) sm.pulse = 1;
      }
      sm.pulse = Math.max(0, sm.pulse - dt * 1.4);
      // the orb breathes with the bass and flares on a like; the loop itself runs calmer while paused
      el.style.setProperty("--vibe-scale", (1 + sm.bass * 0.09 + sm.pulse * 0.08).toFixed(4));
      el.style.setProperty("--vibe-glow", (1 + sm.energy * 0.22 + sm.pulse * 0.25).toFixed(3));
      const rate = st.playing ? 1 + Math.round(sm.energy * 4) / 10 : 0.55;
      if (Math.abs(rate - sm.rate) > 0.05) v.playbackRate = sm.rate = rate;
      blend?.draw(now);
      raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      const run = canRun();
      if (run && v.paused) v.play().catch(() => {});
      if (!run && !v.paused) v.pause();
      if (run && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const io = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      kick();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", kick);
    const unsub = windowVisible.subscribe(kick);
    state.current.kick = kick;
    kick();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      unsub();
      document.removeEventListener("visibilitychange", kick);
      blend?.stop();
      v.pause();
    };
  }, [light, smooth]);

  useEffect(() => {
    state.current.kick?.();
  }, [paused]);

  return (
    <div class={`vibe-canvas vibe-official ${blending ? "is-blend" : ""} ${active && p.playing.value ? "is-playing" : ""}`} ref={box} style={{ "--vibe-hue": `${hueFor(colors)}deg` }} aria-hidden="true">
      {/* a WebGL context can't be reused after stop(): a new canvas per theme and mode */}
      {smooth && <canvas ref={canvas} key={`blend-${light ? "light" : "dark"}`} />}
      <video
        ref={video}
        key={light ? "light" : "dark"}
        src={light ? assets.light : assets.dark}
        poster={light ? assets.lightPoster : assets.darkPoster}
        muted
        loop
        playsinline
        disablepictureinpicture
        preload="auto"
      />
    </div>
  );
}

/**
 * colors — the mood palette; active — the wave is playing now (the animation reacts to sound).
 * pulseAt — timestamp of an event (like) that the animation answers with a flash.
 * paused — the owner is covered (e.g. by Now Playing): stop rendering until it is visible again.
 * Modes: official (the official app's own orb, when installed) → shader (own WebGL orb) → lite → off.
 */
export function VibeCanvas(props) {
  const [assets, setAssets] = useState(undefined);
  const want = reducedMotion.matches && vibeMode.value !== "off" ? "lite" : vibeMode.value;
  useEffect(() => {
    if (want !== "official") return;
    let on = true;
    officialAssets().then((a) => on && setAssets(a));
    return () => (on = false);
  }, [want]);
  if (want === "official") {
    if (assets === undefined) return <div class="vibe-canvas" aria-hidden="true" />;
    if (assets) return <OfficialVibe assets={assets} {...props} />;
  }
  return <ShaderVibe {...props} mode={want === "official" ? "shader" : want} />;
}

function ShaderVibe({ colors, active, pulseAt, paused = false, mode }) {
  const ref = useRef(null);
  const state = useRef({});
  const ctrl = useRef(null);
  // per instance: another canvas failing must not swap this one to lite under a live render loop
  const [broken, setBroken] = useState(glBroken);
  state.current = { colors, playing: !!active && p.playing.value, pulseAt, paused };

  useEffect(() => {
    if (mode !== "shader" || broken || !ref.current) return;
    try {
      const c = startGl(ref.current, () => state.current);
      if (c) {
        ctrl.current = c;
        return () => {
          ctrl.current = null;
          c.stop();
        };
      }
    } catch {
      // the shader failed to build on this GPU — the light animation remains
    }
    glBroken = true;
    setBroken(true);
  }, [mode, broken]);

  // resuming after the cover (Now Playing) is closed
  useEffect(() => {
    if (!paused) ctrl.current?.kick();
  }, [paused]);

  const style = { "--c0": colors[0], "--c1": colors[1], "--c2": colors[2], "--c3": colors[3] || colors[2] };
  if (mode === "shader" && !broken)
    return (
      <div class={`vibe-canvas ${active && p.playing.value ? "is-playing" : ""}`} style={style} aria-hidden="true">
        <canvas ref={ref} />
      </div>
    );
  return (
    <div class={`vibe-canvas is-${mode === "off" ? "static" : "lite"} ${active && p.playing.value ? "is-playing" : ""}`} style={style} aria-hidden="true">
      <div class="vibe-lite">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
