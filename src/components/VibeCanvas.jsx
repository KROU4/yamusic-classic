// Generative animation for My Wave: soft flowing colors and expanding ripples.
// Custom WebGL shader; reacts to music via the audio graph analyzer, colors follow the wave's mood.
// Modes: full (shader), lite (light CSS animation), off (static gradient). Without WebGL — lite.
import { useEffect, useRef } from "preact/hooks";
import { vibeMode } from "../lib/ui.js";
import { windowVisible } from "../lib/desktop.js";
import * as graph from "../player/audiograph.js";
import * as p from "../player/engine.js";

const PALETTES = {
  default: ["#ffcf3a", "#ff5a36", "#b23cff"],
  active: ["#ff9a1f", "#ff3b2f", "#ffd23f"],
  fun: ["#ffe14d", "#3fd46b", "#ff5fa8"],
  calm: ["#35d0c6", "#2f6bff", "#86e3ff"],
  sad: ["#6a5cff", "#2b2f97", "#c08bff"],
  "wake-up": ["#ffb36b", "#ff6f91", "#ffe08a"],
  workout: ["#ff7a1a", "#ff2e4d", "#ffd23f"],
  "road-trip": ["#ff8a3d", "#36bfff", "#ffd84d"],
  "work-background": ["#47c2a8", "#3f7cff", "#a3e05c"],
  "study-background": ["#5ad1b0", "#4a6bff", "#c6f06b"],
  party: ["#ff3fa4", "#7b2fff", "#ffcf3f"],
  "fall-asleep": ["#3b3f9e", "#6f5cff", "#1e8bc3"],
};

/** Colors from the wave settings: mood outranks activity; with no settings, the signature warm ones. */
export function paletteFor(settings) {
  const s = settings || {};
  if (s.moodEnergy && s.moodEnergy !== "all" && PALETTES[s.moodEnergy]) return PALETTES[s.moodEnergy];
  if (s.activity && s.activity !== "any" && PALETTES[s.activity]) return PALETTES[s.activity];
  return PALETTES.default;
}

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
const FRAG = `precision mediump float;
uniform vec2 uRes;uniform float uTime,uEnergy,uBass,uPulse,uPlay;
uniform vec3 uC0,uC1,uC2,uBg;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
 float t=uTime*(.05+.05*uPlay);
 vec2 q=vec2(fbm(uv*1.5+t),fbm(uv*1.5-t+3.1));
 vec2 w=uv+(q-.5)*(.24+uEnergy*.2);
 float m=fbm(w*2.1+vec2(t*1.4,-t));
 float d=length(w)*(.88+.24*m);
 // glowing ring around the title: radius and thickness breathe with the bass, the middle stays dark for the text
 float R=.40+.03*sin(uTime*.7)+uBass*.07+uPulse*.08;
 float W=.10+.07*uEnergy+.05*uPulse;
 float glow=exp(-pow((d-R)/W,2.));
 float halo=exp(-pow((d-R)/(W*2.6),2.))*.16;
 float inner=smoothstep(R,0.,d)*.06;
 float ripple=0.;
 for(int i=0;i<3;i++){float ph=fract(uTime*(.05+.06*uPlay)+float(i)/3.);
  ripple+=exp(-pow((d-(R+ph*.75))/.012,2.))*(1.-ph)*(1.-ph);}
 vec3 col=mix(uC0,uC1,smoothstep(.25,.8,m));
 col=mix(col,uC2,smoothstep(.35,.95,q.x*m*1.6+.15*sin(uTime*.25)));
 float a=clamp(glow*(.5+.32*uEnergy)+halo+inner+ripple*(.10+.25*uEnergy),0.,1.);
 vec3 c=mix(uBg,col,a);
 c=mix(c,uBg,smoothstep(.55,1.25,length(uv))*.85);
 gl_FragColor=vec4(c,1.);
}`;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const cssBg = () => {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--vibe-bg").trim() || "#141414";
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
    u = Object.fromEntries(["uRes", "uTime", "uEnergy", "uBass", "uPulse", "uPlay", "uC0", "uC1", "uC2", "uBg"].map((k) => [k, gl.getUniformLocation(prog, k)]));
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
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const st = getState();
    const lv = st.playing ? graph.levels() : null;
    // without an analyzer (browser, paused) — a calm "breathing", slightly livelier while playing
    const target = lv || { energy: st.playing ? 0.35 + 0.1 * Math.sin(now / 900) : 0.12, bass: st.playing ? 0.15 + 0.08 * Math.sin(now / 430) : 0.04 };
    const k = 1 - Math.exp(-dt * 7);
    sm.energy += (target.energy - sm.energy) * k;
    sm.bass += (target.bass - sm.bass) * (1 - Math.exp(-dt * 12));
    sm.play += ((st.playing ? 1 : 0) - sm.play) * (1 - Math.exp(-dt * 2));
    sm.pulse = Math.max(0, sm.pulse - dt * 1.6);
    if (st.pulseAt && st.pulseAt !== sm.pulseAt) {
      sm.pulseAt = st.pulseAt;
      sm.pulse = 1;
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

/**
 * colors — a three-color palette; active — the wave is playing now (the animation reacts to sound).
 * pulseAt — timestamp of an event (like) that the animation answers with a flash.
 * paused — the owner is covered (e.g. by Now Playing): stop rendering until it is visible again.
 */
export function VibeCanvas({ colors, active, pulseAt, paused = false }) {
  const ref = useRef(null);
  const state = useRef({});
  const ctrl = useRef(null);
  const mode = reducedMotion.matches && vibeMode.value === "full" ? "lite" : vibeMode.value;
  state.current = { colors, playing: !!active && p.playing.value, pulseAt, paused };

  useEffect(() => {
    if (mode !== "full" || glBroken || !ref.current) return;
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
    ref.current?.classList.add("vibe-fallback");
  }, [mode]);

  // resuming after the cover (Now Playing) is closed
  useEffect(() => {
    if (!paused) ctrl.current?.kick();
  }, [paused]);

  const style = { "--c0": colors[0], "--c1": colors[1], "--c2": colors[2] };
  if (mode === "full" && !glBroken)
    return (
      <div class={`vibe-canvas ${active && p.playing.value ? "is-playing" : ""}`} style={style} aria-hidden="true">
        <canvas ref={ref} />
        {/* fallback: visible only if the shader failed to build (the canvas gets .vibe-fallback) */}
        <div class="vibe-lite">
          <i />
          <i />
          <i />
        </div>
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
