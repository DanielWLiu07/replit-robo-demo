import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ArenaBotState, BotSpec, Chassis, MatchFrame } from "@workspace/contract";
import { ARM_REST, MAX_SQUAD } from "@workspace/contract";
import { DISPLAY, bindChassis, buildSkinnedBot, poseSkinnedBot, type SkinnedBot } from "./skinnedBot";
import { rigHeight } from "@workspace/sim";
import { buildWordmark } from "./wordmark";
import { MoonEditor, makeProp } from "./moonEditor";
import { ADDED_PROPS, RING_CENTRE, SCENE_LAYOUT, STATIONS, applyLayout, applyPlacement, groundY, type StationName } from "./moonLayout";
import { MoonOutliner } from "./MoonOutliner";

/**
 * The gacha reveal's moon, imported as the landing.
 *
 * Source: the UWDSC gacha prototype (`feat/gacha-reveal-prototype`,
 * `prototype/index.html`). The shaders below are that file's `moonMat` and
 * `propMat` **verbatim** — same GLSL, same crater placements, same camera and
 * key light. That is why this stage runs its own `WebGLRenderer` instead of
 * joining the WebGPU one the rest of the site uses: those are raw GLSL
 * `ShaderMaterial`s, and WebGPU cannot compile them. A second renderer on one
 * route is a much smaller price than reimplementing a shader that already works.
 *
 * What is ours: the FLYWEIGHT wordmark and the fly standing on the surface.
 */
const MAXC = 32;
const CRATERS: [number, number, number][] = [
  [-15.4,-8.94,2.4],[2.08,-10.36,3],[-8.57,-2.62,1.8],[8.53,-15.35,3.6],[-11.97,-15.51,2],
  [0.95,-22.77,2.2],[13.06,-7.84,2.5],[-5.8,-18.65,3.2],[6.99,-3.31,2],[-20.57,-16.38,2.6],
  [-0.83,-5,1.4],[-6.43,-10.56,3.3],[19.25,-12.57,1.8],[-6.91,3.89,2.5],[-2.06,0.11,2.4],
  [8.44,2.87,1.5],[3.69,1.73,2.1],[12.58,-2,1.6],
];

/** baked in the prototype's prop editor: [size,x,y,z,rx,ry,rz] */
const STARS: number[][] = [
  [0.9,-7,3,-6,-2.10,-1.20,-13.00],[0.6,9,2.5,-9,2.70,-1.80,0.00],
  [0.8,4,3.5,-11,1.20,-2.20,-7.00],[0.9,-14,4,-10,-4.20,-2.00,-24.00],
  [0.8,7,5,-14,2.10,-2.80,-7.00],[0.7,-9,5,-13,-2.70,-2.60,-22.00],
  [0.6,2,4,-12,0.60,-2.40,-10.00],[0.8,15,4,-12,4.50,-2.40,3.00],
  [0.8,12.26,3,-10.90,0,-0.60,-3.00],
];

/** the prototype's five-point star, extruded */
function starGeo(r: number) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * 6.2832 - 1.5708;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
    if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
  }
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, {
    depth: r * 0.4, bevelEnabled: true,
    bevelThickness: r * 0.07, bevelSize: r * 0.07, bevelSegments: 1,
  });
}

const MOON_VERT = `varying vec3 vN;varying vec3 vWp;void main(){vN=normalize(mat3(modelMatrix)*normal);vWp=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

const MOON_FRAG = `precision highp float;uniform sampler2D hatchTex,paperTex;uniform vec3 uL1;uniform float uTime,uHscale,uRelief,uCratersOn,uGrainOn,uMariaOn;uniform vec3 uCraters[32];uniform int uNumC;varying vec3 vN;varying vec3 vWp;
    float h(vec3 p){p=fract(p*0.3183+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
    float n3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);}
    float prof(float d,float R){return -0.5*(1.0-smoothstep(0.0,R,d))+0.5*exp(-pow((d-R)/(R*0.30),2.0));}
    float hgt(vec2 p){return n3(vec3(p*0.16,0.0));}
    void main(){
      vec2 P=vWp.xz;float eh=0.3;
      vec3 Nu=(uRelief>0.5)?normalize(vec3(-(hgt(P+vec2(eh,0.0))-hgt(P-vec2(eh,0.0)))/(2.0*eh)*0.7,1.0,-(hgt(P+vec2(0.0,eh))-hgt(P-vec2(0.0,eh)))/(2.0*eh)*0.7)):vec3(0.0,1.0,0.0);
      vec2 gr=vec2(0.0);float aoc=0.0;
      if(uCratersOn>0.5){for(int i=0;i<32;i++){ if(i>=uNumC) break; vec3 cr=uCraters[i]; vec2 rv=P-cr.xy; float R=cr.z; float dd2=dot(rv,rv);
        if(dd2<R*R*2.89){ float dd=sqrt(dd2); float ec=R*0.04; float dH=(prof(dd+ec,R)-prof(dd-ec,R))/(2.0*ec); gr+=dH*normalize(rv+vec2(1e-5)); aoc+=(1.0-smoothstep(0.0,R*0.7,dd))*0.3; } }}
      vec3 Nb=normalize(Nu+vec3(-gr.x*1.6,0.0,-gr.y*1.6));
      float ndl=max(dot(Nb,normalize(uL1)),0.0);
      float grain=(uGrainOn>0.5)?n3(vWp*7.5)*0.10:0.0;
      float shade=clamp(ndl*0.9+0.16-grain,0.0,1.0)*(1.0-clamp(aoc,0.0,0.4));
      float maria=(uMariaOn>0.5)?smoothstep(0.5,0.62,n3(vWp*0.11)):0.0;shade*=(1.0-maria*0.4);float t=1.0-shade;
      float fr=floor(uTime*8.0);float ja=fr*1.7;mat2 R=mat2(cos(ja),-sin(ja),sin(ja),cos(ja));vec2 off=vec2(fract(sin(fr*91.7)*4373.0),fract(sin(fr*47.3)*7919.0))*1200.0;
      vec3 hx=texture2D(hatchTex,(R*gl_FragCoord.xy+off)/uHscale).rgb;
      float i0=smoothstep(0.10,0.42,t),i1=smoothstep(0.32,0.66,t),i2=smoothstep(0.58,0.95,t);
      float m0=mix(1.0,hx.r,i0);float m1=m0*mix(1.0,hx.g,i1);float m2=m1*mix(1.0,hx.b,i2);
      vec3 paper=vec3(0.93)*mix(vec3(1.0),texture2D(paperTex,gl_FragCoord.xy/620.0).rgb,0.14);
      gl_FragColor=vec4(mix(vec3(0.05),paper,clamp(m2,0.0,1.0)),1.0);}`;

/**
 * Prop / chassis vertex shader — WITH SKINNING.
 *
 * This used to transform `position` directly, which is the BIND POSE vertex. A raw
 * ShaderMaterial gets no skinning unless it asks for it, so every skinned body on
 * screen was rendered rigid: the skeleton animated correctly in memory and none of
 * it reached the GPU. Bodies slid and turned (that is the object transform) while
 * the limbs never moved.
 *
 * It hid well. `SkinnedMesh.applyBoneTransform` is a CPU re-implementation of the
 * skinning maths, so every measurement taken through it — bone quaternions, swept
 * vertex range, joint amplitudes against the goose — was correct AND blind to this.
 * The only thing that would have caught it is looking at rendered pixels.
 *
 * The chunks are `#ifdef USE_SKINNING`, which the renderer defines per-object, so
 * the same material still works on the static props and stars.
 */
const PROP_VERT = `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN;
void main(){
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  vN = normalize(mat3(modelMatrix) * objectNormal);
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
}`;

const PROP_FRAG = `precision highp float;uniform sampler2D hatchTex,paperTex;uniform vec3 uL1;uniform float uTime,uHscale;varying vec3 vN;
    void main(){vec3 N=normalize(vN);float ndl=max(dot(N,normalize(uL1)),0.0);float shade=clamp(ndl*0.85+0.17,0.0,1.0);float t=1.0-shade;
      float fr=floor(uTime*8.0);float ja=fr*1.7;mat2 R=mat2(cos(ja),-sin(ja),sin(ja),cos(ja));vec2 off=vec2(fract(sin(fr*91.7)*4373.0),fract(sin(fr*47.3)*7919.0))*1200.0;
      vec3 hx=texture2D(hatchTex,(R*gl_FragCoord.xy+off)/uHscale).rgb;
      float i0=smoothstep(0.10,0.42,t),i1=smoothstep(0.32,0.66,t),i2=smoothstep(0.58,0.95,t);
      float m0=mix(1.0,hx.r,i0);float m1=m0*mix(1.0,hx.g,i1);float m2=m1*mix(1.0,hx.b,i2);
      vec3 paper=vec3(0.93)*mix(vec3(1.0),texture2D(paperTex,gl_FragCoord.xy/620.0).rgb,0.14);
      gl_FragColor=vec4(mix(vec3(0.05),paper,clamp(m2,0.0,1.0)),1.0);}`;


/**
 * Screen-space ink outline.
 *
 * A normal-inflate hull needs a CLOSED mesh: you render its back faces and see
 * only the silhouette. The rigged chassis is not closed — it is separate plates —
 * so back faces show all over the body and read as black wedges that move with
 * the limbs. A depth Sobel has no such requirement: it finds the edge in the
 * DEPTH BUFFER, so it outlines whatever is actually on screen, manifold or not,
 * and it costs one full-screen pass instead of a second skinned body per figure.
 */
const OUTLINE_FRAG = `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear, uFar, uStrength, uWidth;
varying vec2 vUv;

// depth buffer is non-linear; differencing it raw makes the edge width vary
// with distance, so linearise before the gradient
float linearDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float c  = linearDepth(vUv);
  vec2 o = uTexel * uWidth;
  float l  = linearDepth(vUv - vec2(o.x, 0.0));
  float r  = linearDepth(vUv + vec2(o.x, 0.0));
  float d  = linearDepth(vUv - vec2(0.0, o.y));
  float u  = linearDepth(vUv + vec2(0.0, o.y));
  // the diagonals too, or a thick edge breaks up on slanted silhouettes
  float dl = linearDepth(vUv - o);
  float dr = linearDepth(vUv + vec2(o.x, -o.y));
  float ul = linearDepth(vUv + vec2(-o.x, o.y));
  float ur = linearDepth(vUv + o);
  // scale the gradient by depth so a far edge is not thinner than a near one
  float g = (abs(c - l) + abs(c - r) + abs(c - d) + abs(c - u)
           + 0.7 * (abs(c - dl) + abs(c - dr) + abs(c - ul) + abs(c - ur))) / max(c, 0.001);
  float edge = smoothstep(0.010, 0.040, g) * uStrength;
  vec3 ink = vec3(0.03, 0.03, 0.04);
  gl_FragColor = vec4(mix(base.rgb, ink, edge), max(base.a, edge));
}`;

/**
 * The moon is a sphere of radius 70 centred at (0, -70, 0), so its surface passes
 * through the origin. Anything standing on it has to be placed ON that sphere and
 * stood up along ITS normal, not along world up.
 */
const MOON_R = 70;
const MOON_C = new THREE.Vector3(0, -70, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
/**
 * Simulation metres to scene units.
 *
 * This has to be the SAME number for positions and for body height or the fight is
 * unreadable. It was 0.45 for positions while the bodies were scaled to 1.55 units
 * tall - but a bot is only 1.06 m, which at 0.45 is 0.48 units. The figures were
 * three times too big for the floor they stood on, so two fighters 11 m apart read
 * as two giants shoulder to shoulder, barely moving.
 */
const RING_SCALE = 0.64;
const _tiltQ = new THREE.Quaternion();
const _headQ = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _off = new THREE.Vector3();
const _vtx = new THREE.Vector3();

/** Display scale of the fly on the plinth, before the per-chassis correction. */
const FLY_FIT = 2.9;

/**
 * How much of the chassis size difference the SHOWCASE keeps.
 *
 * The ring shows fighters at true scale, because there the size difference is
 * information: a TANK really does have the reach and the hull to match. The
 * showcase is a portrait at a fixed camera, and at true scale a TANK is 1.44x a
 * DRONE and does not fit the shot — measured at 883px tall in a 937px frame with
 * its head 101px above the top edge, while the DRONE sat at 625px.
 *
 * So compress the spread rather than flattening it: the TANK still reads as the
 * heavy one, and all three are framed the same.
 *
 * Normalised on DRONE, not on the middle chassis, because DRONE is the default
 * build — it is what the landing shows, and that shot is already framed tight.
 * Anchoring here leaves it at exactly the size it was and only brings the other
 * two down to meet it.
 */
const SHOWCASE_SPREAD = 0.25;
const showcaseScale = (chassis: Chassis) => {
  const t = rigHeight(chassis) / rigHeight("DRONE");
  return (1 + (t - 1) * SHOWCASE_SPREAD) / t;
};

const OUTLINE_VERT = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;

export function MoonStage({
  chassis = "DRONE" as Chassis,
  station = "ARRIVAL" as StationName,
  frame = null as MatchFrame | null,
  fighters,
}: {
  chassis?: Chassis;
  station?: StationName;
  frame?: MatchFrame | null;
  fighters?: [BotSpec, BotSpec];
}) {
  const host = useRef<HTMLDivElement>(null);
  // The chassis is a live value like the frame: picking a different class must swap
  // the BODY, not tear down and rebuild the moon, the shaders and the wordmark. It
  // used to sit in the scene effect's dependency list, which rebuilt everything and
  // read on screen as the page reloading under you.
  const chassisRef = useRef(chassis);
  chassisRef.current = chassis;
  const swapChassis = useRef<((c: Chassis) => void) | null>(null);
  const loadedChassis = useRef<Chassis | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [editor, setEditor] = useState<MoonEditor | null>(null);
  // live values the frame loop reads; changing them must not rebuild the scene
  const stationRef = useRef(station);
  const frameRef = useRef(frame);
  const fightersRef = useRef(fighters);
  useEffect(() => { stationRef.current = station; }, [station]);
  useEffect(() => { frameRef.current = frame; }, [frame]);
  useEffect(() => { fightersRef.current = fighters; }, [fighters]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false, raf = 0, visible = true;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
    } catch { setUnavailable(true); return; }
    // their numbers: DPR capped at 1, and 0.7 of that outside the charge state
    const DPR = Math.min(devicePixelRatio, 1.0);
    const RS = 1.0;
    renderer.setPixelRatio(DPR * RS);
    // transparent: the dark page gradient behind the canvas IS the sky
    renderer.setClearColor(0x000000, 0);
    element.appendChild(renderer.domElement);

    // The morphing edge: feTurbulence into feDisplacementMap, applied to the
    // whole canvas, with the noise seed re-rolled 9 times a second. That boil is
    // what makes a rendered frame read as redrawn ink rather than a moving image.
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    const defs = document.createElementNS(NS, "defs");
    const filter = document.createElementNS(NS, "filter");
    filter.setAttribute("id", "fw-sketch");
    filter.setAttribute("x", "-8%"); filter.setAttribute("y", "-8%");
    filter.setAttribute("width", "116%"); filter.setAttribute("height", "116%");
    filter.setAttribute("color-interpolation-filters", "sRGB");
    const turb = document.createElementNS(NS, "feTurbulence");
    turb.setAttribute("type", "fractalNoise");
    turb.setAttribute("baseFrequency", "0.022");
    turb.setAttribute("numOctaves", "2");
    turb.setAttribute("seed", "1");
    turb.setAttribute("result", "n");
    const disp = document.createElementNS(NS, "feDisplacementMap");
    disp.setAttribute("in", "SourceGraphic"); disp.setAttribute("in2", "n");
    // 19 is their value, tuned against a 70-unit moon; our props are far smaller
    // and a 19px displacement shreds them, so this is dialled to where thin
    // geometry survives while the ink edge still boils.
    disp.setAttribute("scale", "6");
    disp.setAttribute("xChannelSelector", "R"); disp.setAttribute("yChannelSelector", "G");
    filter.appendChild(turb); filter.appendChild(disp);
    defs.appendChild(filter); svg.appendChild(defs);
    element.appendChild(svg);
    renderer.domElement.style.filter = "url(#fw-sketch)";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

    const depthTexture = new THREE.DepthTexture(1, 1);
    depthTexture.type = THREE.UnsignedIntType;
    const target = new THREE.WebGLRenderTarget(1, 1, {
      depthTexture,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const outlineMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: target.texture },
        tDepth: { value: depthTexture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uStrength: { value: 1.0 },
        uWidth: { value: 2.4 },
      },
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const postScene = new THREE.Scene();
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), outlineMaterial));
    const L1 = new THREE.Vector3(0.5, 0.85, 0.7).normalize();

    const base = import.meta.env.BASE_URL;
    const tl = new THREE.TextureLoader();
    const paperTex = tl.load(`${base}gacha/paper.jpg`);
    paperTex.colorSpace = THREE.SRGBColorSpace;
    paperTex.wrapS = paperTex.wrapT = THREE.RepeatWrapping;
    const hatchTex = tl.load(`${base}gacha/hatch.jpg`);
    hatchTex.colorSpace = THREE.NoColorSpace;
    hatchTex.wrapS = hatchTex.wrapT = THREE.RepeatWrapping;

    const cratersUniform: THREE.Vector3[] = [];
    for (let i = 0; i < MAXC; i++) {
      const c = CRATERS[i];
      cratersUniform.push(c ? new THREE.Vector3(c[0], c[1], c[2]) : new THREE.Vector3());
    }

    const shared = {
      hatchTex: { value: hatchTex }, paperTex: { value: paperTex },
      uL1: { value: L1 }, uTime: { value: 0 }, uHscale: { value: 300.0 * DPR * RS },
      uCraters: { value: cratersUniform }, uNumC: { value: CRATERS.length },
      uRelief: { value: 1 }, uCratersOn: { value: 1 }, uGrainOn: { value: 1 }, uMariaOn: { value: 1 },
    };

    const moonMat = new THREE.ShaderMaterial({ uniforms: shared, vertexShader: MOON_VERT, fragmentShader: MOON_FRAG });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(70, 96, 64), moonMat);
    moon.position.y = -70;
    scene.add(moon);

    const propMat = new THREE.ShaderMaterial({ uniforms: shared, vertexShader: PROP_VERT, fragmentShader: PROP_FRAG });
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0c, side: THREE.BackSide });

    const starGeos: THREE.BufferGeometry[] = [];
    const starMeshes: THREE.Mesh[] = [];
    for (const [size, x, y, z, rx, ry, rz] of STARS) {
      const g = starGeo(size!);
      starGeos.push(g);
      const m = new THREE.Mesh(g, propMat);
      m.position.set(x!, y!, z!);
      m.rotation.set(rx || 0, ry || 0, rz || 0);
      scene.add(m);
      starMeshes.push(m);
    }

    // The title has to survive a bright hatched moon behind it, so it gets a
    // dark back-face hull one step larger than itself: an ink outline, the
    // normal-inflate trick their animation plan specs for exactly this.
    // The title lives in the scene by default so it sits ON the moon in
    // perspective; ?title2d swaps it for the flat HTML heading instead.
    const use3dTitle = !new URLSearchParams(location.search).has("title2d");
    const inflatedGeometries: THREE.BufferGeometry[] = [];
    const inkTextures: THREE.CanvasTexture[] = [];
    const inkMaterials: THREE.MeshBasicMaterial[] = [];
    let enterMesh: THREE.Mesh | null = null;
    let enterHover = false;
    let enterEase = 0;
    const titleGroup = new THREE.Group();
    titleGroup.position.set(-3.6, 2.1, -0.6);
    titleGroup.rotation.y = 0.26;
    titleGroup.scale.setScalar(1.6);
    if (use3dTitle) scene.add(titleGroup);

    // ENTER sits below the title, in the same face, and is its own object so it
    // can be placed independently in the editor.
    const enterGroup = new THREE.Group();
    enterGroup.position.set(-5.1, 0.55, 0.4);
    enterGroup.rotation.set(-0.408, 0.226, 0.097);
    enterGroup.scale.setScalar(0.52);
    if (use3dTitle) scene.add(enterGroup);
    document.body.classList.toggle("title2d", !use3dTitle);

    // KatieRoze — the face the pomme/casino scene sets its titles in.
    //
    // It cannot be extruded: its `glyf` table holds only two-point placeholder
    // contours and the real letterforms live in the SVG/sbix tables as embedded
    // watercolour artwork. So this uses the portfolio's own technique for it —
    // draw the word to a canvas with the webfont and map that onto a plane —
    // which keeps the type IN the scene, in perspective, with the right face.
    //
    // Black outline, white inside — derived from the alpha, because a colour
    // font will not take a fillStyle or a strokeText.
    const inkTextPlane = (text: string, width: number) => {
      const pad = 96;
      const px = 320;
      const probe = document.createElement("canvas").getContext("2d");
      if (!probe) return null;
      probe.font = `${px}px KatieRoze, cursive`;
      const metrics = probe.measureText(text);
      // A script face overhangs its advance width, so `metrics.width` clips the
      // last glyph (the T went missing). Measure the real inked box instead.
      const left = metrics.actualBoundingBoxLeft || 0;
      const right = metrics.actualBoundingBoxRight || metrics.width;
      const inked = Math.max(right + left, metrics.width);
      const w = Math.ceil(inked) + pad * 2;
      const ascent = metrics.actualBoundingBoxAscent || px * 0.8;
      const descent = metrics.actualBoundingBoxDescent || px * 0.3;
      const h = Math.ceil(ascent + descent) + pad * 2;
      if (!(w > 1 && h > 1)) return null;

      const layer = () => {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        return { c, x: c.getContext("2d")! };
      };
      const art = layer();
      art.x.font = `${px}px KatieRoze, cursive`;
      art.x.textBaseline = "alphabetic";
      art.x.fillText(text, pad + left, pad + ascent);

      /**
       * `alphaGain` is what keeps the centre of the letter light.
       *
       * KatieRoze is watercolour, so its glyphs carry PARTIAL alpha across the
       * whole stroke, not just at the edge. Fill that with white and the black
       * ring stamped underneath reads straight through it, which is why the
       * middle of FLYWEIGHT came out closer to the outline than to the fill.
       * Lifting alpha before the tint makes the body opaque while leaving enough
       * variation to still look painted.
       */
      const tint = (color: string, alphaGain = 1) => {
        const t = layer();
        t.x.drawImage(art.c, 0, 0);
        if (alphaGain !== 1) {
          const px = t.x.getImageData(0, 0, w, h);
          const d = px.data;
          for (let i = 3; i < d.length; i += 4) d[i] = Math.min(255, d[i]! * alphaGain);
          t.x.putImageData(px, 0, 0);
        }
        t.x.globalCompositeOperation = "source-in";
        t.x.fillStyle = color;
        t.x.fillRect(0, 0, w, h);
        return t.c;
      };
      const blackCopy = tint("#08080a");
      const whiteCopy = tint("#fbfbf7", 2.8);

      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const ring = Math.max(3, Math.round(px * 0.045));
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        ctx.drawImage(blackCopy, Math.cos(a) * ring, Math.sin(a) * ring);
      }
      ctx.drawImage(whiteCopy, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const geometry = new THREE.PlaneGeometry(width, (width * h) / w);
      // alphaTest, not blending: a cutout stays opaque and depth-correct
      const material = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, alphaTest: 0.32, side: THREE.DoubleSide,
      });
      inkTextures.push(texture);
      inkMaterials.push(material);
      return new THREE.Mesh(geometry, material);
    };

    const fallbackTitle = () => {
      const outline = buildWordmark("FLYWEIGHT", outlineMat, { size: 1, depth: 2.4 });
      outline.scale.multiplyScalar(1.045);
      titleGroup.add(outline, buildWordmark("FLYWEIGHT", propMat, { size: 1, depth: 2.4 }));
    };

    const typeReady = (async () => {
      try {
        // One subset for every string the UI sets in this face. The old display cut
        // was missing F, G, H, I and Y, so five of FLYWEIGHT's nine letters were
        // silently falling back to `cursive` — a subset miss does not error, it
        // just quietly renders in the next font.
        const face = new FontFace("KatieRoze", `url(${base}fonts/katieroze-ui.woff2)`);
        await face.load();
        document.fonts.add(face);
      } catch {
        /* falls through to the stencil below */
      }
      if (disposed) return false;
      const title = inkTextPlane("FLYWEIGHT", 6.5);
      if (!title) return false;
      titleGroup.add(title);
      const enter = inkTextPlane("ENTER", 6.5);
      if (enter) {
        enterMesh = enter;
        enterGroup.add(enter);
      }
      return true;
    })();
    void typeReady.then((ok) => { if (!ok && !disposed) fallbackTitle(); }).catch(() => { if (!disposed) fallbackTitle(); });

    const flyRoot = new THREE.Group();
    flyRoot.position.set(3.1, 0, 3.6);
    // The rig maps bone space with toArena = [-z, y, x], a 90 degree turn, so the
    // posed mesh does not face the same way the raw .glb does. Measured by eye:
    // this is the value that puts its face toward the camera at [0, 9, 10].
    // NOTE: SCENE_LAYOUT's "fly" entry is applied by applyLayout() further down and
    // overwrites position, rotation and scale. Change it there, not here.
    flyRoot.rotation.y = -0.5 + Math.PI;
    scene.add(flyRoot);
    // bindChassis re-centres to unit height with the feet on y=0, so the display
    // scale lives here and the layout's `fly` transform stays what it was.
    const flyFit = new THREE.Group();
    // bindChassis normalises to UNIT HEIGHT, where the old path fitted the max
    // dimension (wings included). 4.6 stacked with the layout's 1.573 and made it
    // twice the size it had been.
    flyFit.scale.setScalar(FLY_FIT);
    flyRoot.add(flyFit);

    let flyRig: SkinnedBot | null = null;
    /**
     * Load one chassis and stand it up, replacing whatever body is there.
     *
     * Separated from the scene build so a class change costs a GLB fetch and a rebind
     * instead of a full teardown. `loadedChassis` doubles as the guard against a slow
     * fetch landing after a newer pick has already won the race.
     */
    const loadChassis = (name: Chassis) => {
      loadedChassis.current = name;
      new GLTFLoader().load(`${base}models/${name.toLowerCase()}.glb`, (gltf) => {
      if (disposed || loadedChassis.current !== name) { return; }
      let source: THREE.Mesh | undefined;
      gltf.scene.traverse((o) => { if (!source && o instanceof THREE.Mesh) source = o; });
      if (!source) return;
      // retire the body that is standing there now, and its ring copies
      if (flyRig) { flyFit.remove(flyRig.mesh); flyRig.mesh.geometry.dispose(); flyRig = null; }
      for (const pool of ringRigs) {
        for (const slot of pool) { ring.remove(slot.holder); slot.rig.mesh.geometry.dispose(); }
        pool.length = 0;
      }
      // One bind, two rigs: the inked body and the ink hull behind it. The hull has
      // to be skinned too — a static clone would stay rigid while the body deforms.
      const bind = bindChassis(source);
      // NO ink hull on the rigged bodies. A normal-inflate outline assumes a
      // CLOSED mesh: render its back faces and you see only the silhouette. This
      // chassis is not closed — it is plates and separate parts — so back faces
      // are visible all over the body and read as black wedges that change shape
      // as the limbs swing. The hatch shader already carries the figure against
      // the moon, so the outline is not paying for itself here.
      flyRig = buildSkinnedBot(bind, propMat, name);
      // buildSkinnedBot sizes the mesh at true scale for the ring; the portrait
      // wants the chassis spread compressed so every one of them fits the shot.
      flyFit.scale.setScalar(FLY_FIT * showcaseScale(name));
      flyFit.add(flyRig.mesh);
      buildSide(0, bind, name);
      buildSide(1, bind, name);
      snapFlyToGround();
      }, undefined, () => {});
    };
    /**
     * Feet on the floor, measured rather than authored.
     *
     * The layout's `fly` y is set by eye in the editor, and every chassis has a
     * different stance, so a hand-picked number sinks one body into the regolith
     * and floats the next. This reads the rig's real lowest vertex in world space
     * and lifts the root by however far it sits under the surface — and the
     * surface is a SPHERE, so the target height is the moon at this x/z, not zero.
     * Idempotent: measuring after a shift gives a delta of zero.
     */
    const snapFlyToGround = () => {
      const mesh = flyRig?.mesh;
      if (!mesh) return;

      // Walk the bind-pose vertices through the CURRENT world matrix.
      //
      // That looks like the naive reading and it is the only correct one here.
      // Verified by translating the root a known +5 and watching what each
      // candidate reports: this one moves by exactly 5, the other two do not.
      //   Box3.setFromObject() runs SkinnedMesh.computeBoundingBox(), whose result
      //   already carries the world transform, then applies matrixWorld on top of
      //   it — it called this body 63 units tall and flung the root 14 into the air.
      //   getVertexPosition() skins properly, but buildSkinnedBot binds BEFORE the
      //   mesh is parented, so bindMatrix is identity and the bone matrices already
      //   hold the world transform; times matrixWorld that counts the transform
      //   twice (root +5 moved it +10), and because the layout's fly rotation is
      //   most of a flip the error is nearly invariant to y — so a snap built on it
      //   has a fixed point at a nonsense height and converges happily to it.
      // The bind pose is also the honest reference: bindChassis puts the soles at
      // y=0 and the idle is a weight shift, not a jump, so this does not jitter.
      flyRoot.updateWorldMatrix(true, true);
      mesh.updateWorldMatrix(true, false);
      const pos = mesh.geometry.getAttribute("position");
      let lowest = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const y = _vtx.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld).y;
        if (y < lowest) lowest = y;
      }
      if (!Number.isFinite(lowest)) return;

      // The floor is a SPHERE, so the target is the moon's height at this x/z.
      flyRoot.position.y += groundY(flyRoot.position.x, flyRoot.position.z) - lowest;
    };

    loadChassis(chassisRef.current);
    swapChassis.current = loadChassis;

    /**
     * A synthetic ArenaBotState for the idle.
     *
     * `poseSkinnedBot` takes exactly what the simulation emits, so the idle is
     * authored in the same language as a real fight rather than as a separate
     * animation path. What it has to SAY, though, is "fighter waiting for the
     * bell", and the first pass said "someone standing around": feet welded flat
     * and square, both arms swinging +/-0.34 rad off `idleSwing`, and a guard of
     * 0.12 — which in fistLocal is an OPEN guard, so the fists hung by the hips.
     * Read as a person waiting for a bus, not a boxer.
     *
     * What it is now, in the sim's own terms:
     *  - `feet` are planted in a stance, not square: left foot forward and inside,
     *    right foot back and wider. That base is what makes the silhouette read as
     *    a fighter before anything moves at all.
     *  - the weight rocks between them at ~0.9 Hz, and the unloaded foot lifts a
     *    few per cent of body height as it comes off — a boxer's rock, not a step.
     *  - `gait` no longer walks. With the feet planted it only drives secondary
     *    motion (torso sway, shoulder ride, the |sin| bob), so it oscillates about
     *    zero instead of cycling 0..1, which used to march the figure on the spot.
     *  - `guard` is up at 0.9, which tucks both fists to the chin.
     *  - `lean` carries a small forward set with a slow weave, `tilt` rolls it.
     *  - every few seconds one arm throws, alternating. The punch is a SWING about
     *    the vertical axis because that is what the sim's arm model is: armL/armR
     *    are angles resting at +/-ARM_REST, and fistLocal extends the arm by how
     *    far the angle has travelled from rest. So the same excursion that lands a
     *    hit in the arena is the one that reads as a punch here.
     */
    const BOUNCE_HZ = 0.9;      // the rock between the feet
    const PUNCH_EVERY = 3.4;    // seconds
    const PUNCH_OUT = 0.11, PUNCH_HOLD = 0.05, PUNCH_BACK = 0.34;

    /** 0 -> 1 -> 0 across one punch: out fast, brief hold, recover slower. */
    const punchCurve = (dt: number): number => {
      if (dt < PUNCH_OUT) { const u = dt / PUNCH_OUT; return u * u * (3 - 2 * u); }
      if (dt < PUNCH_OUT + PUNCH_HOLD) return 1;
      const u = (dt - PUNCH_OUT - PUNCH_HOLD) / PUNCH_BACK;
      return u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
    };

    const idleState = (t: number): ArenaBotState => {
      const rock = Math.sin(t * BOUNCE_HZ * Math.PI * 2);

      const n = Math.floor(t / PUNCH_EVERY);
      const swing = punchCurve(t - n * PUNCH_EVERY);
      const throwL = n % 2 === 0 ? swing : 0;
      const throwR = n % 2 === 0 ? 0 : swing;
      const thrown = Math.max(throwL, throwR);

      // the foot losing the weight comes off the floor, the loaded one stays down
      const liftL = Math.max(0, -rock) * 0.04;
      const liftR = Math.max(0, rock) * 0.04;

      return {
        botId: "idle",
        x: 0, y: 0,
        // Zero, deliberately. `feet` are world coordinates that poseBot rotates
        // into the body frame by heading, and the showcase mesh's facing comes
        // from the layout rather than from state — so a heading sway here would
        // swivel the FEET under a body that never turned.
        heading: 0,
        vx: 0, vy: 0, hull: 100,
        spiked: [], potentials: {},
        arousal: 1, gfFatigue: 0,
        /**
         * Throw exactly to the punch axis, no further.
         *
         * `fistLocal` now measures a swing from the angle at which the fist points
         * STRAIGHT FORWARD, and pins extension at full once the arm reaches it. So
         * throwing ARM_REST lands the jab fully extended and pointing where it was
         * aimed, and the swing curve maps one-to-one onto the extension.
         *
         * Over-throwing past the axis (this was 0.66) spends the extra travel
         * swinging the fist ACROSS the body while extension is already pinned at
         * one — the arm hangs at full stretch through the retraction and then
         * snaps, and the fist drifts further forward as it comes back. Measured:
         * reach wandered 0.450 -> 0.473 m while the swing decayed from 1.0 to 0.54.
         */
        armL: ARM_REST - throwL * ARM_REST,
        armR: -ARM_REST + throwR * ARM_REST,
        armLv: 0, armRv: 0,
        gait: rock * 0.055,
        struck: false,
        guard: 0.9,
        recovery: 0,
        blocked: false, countered: false, stamina: 1,
        lean: 0.09 + Math.sin(t * 0.55) * 0.035 + thrown * 0.07,
        tilt: Math.sin(t * 0.37 + 1.1) * 0.045,
        down: 0,
        // [Lx, Ly, Lz, Rx, Ry, Rz] in world metres: +x is forward of the hips and
        // +y is the bot's left, so this is lead foot forward and inside, rear foot
        // back and wider — a stance, not a parade rest.
        feet: [0.13, -0.11, liftL, -0.10, 0.15, liftR],
      };
    };

    /**
     * An ink hull that survives a bent joint.
     *
     * Scaling the hull object uniformly inflates it from the MESH ORIGIN, so the
     * offset only points "outward" near the origin; at an elbow or a knee it
     * points the wrong way and the body punches through in chunks. Displacing
     * each vertex along its own normal BEFORE binding bakes the offset into bind
     * space, so it is carried by the same skin weights as the body and stays
     * outside it at every angle. No shader patch, so the plain BackSide material
     * still works.
     *
     * Keep the amount BELOW the narrowest gap on the model. This fly has thin
     * crevices — arm against torso, leg against leg — and an inflation wider than
     * a crevice pushes the hull's back faces in front of the body and fills it
     * with black. As the limbs swing those patches change shape, which reads as a
     * second figure animating out of sync rather than as an outline.
     */
    const inflatedBind = (bind: ReturnType<typeof bindChassis>, amount: number) => {
      const geometry = bind.geometry.clone();   // clone carries skinIndex/skinWeight
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const pos = geometry.attributes.position as THREE.BufferAttribute;
      const nor = geometry.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
          i,
          pos.getX(i) + nor.getX(i) * amount,
          pos.getY(i) + nor.getY(i) * amount,
          pos.getZ(i) + nor.getZ(i) * amount,
        );
      }
      pos.needsUpdate = true;
      geometry.computeBoundingSphere();
      inflatedGeometries.push(geometry);
      return { geometry, rest: bind.rest };
    };

    // ── THE RING ─────────────────────────────────────────────────────────
    // Built into this scene rather than stacked as a second canvas: Arena runs a
    // WebGPU renderer with node materials, so its scene cannot join this one —
    // but the rig and the pose function are material-agnostic, so the fighters
    // can be the same hatch-shaded bodies standing on the actual surface.
    const ring = new THREE.Group();
    // Snap the ring exactly onto the sphere and lie it FLAT ON THE SURFACE. It used
    // to sit at world-up, but the surface normal here is 16.8 degrees off vertical,
    // so the fighters stood bolt upright on ground that sloped away beneath them.
    const ringUp = new THREE.Vector3(...RING_CENTRE).sub(MOON_C).normalize();
    ring.position.copy(MOON_C).addScaledVector(ringUp, MOON_R);
    ring.quaternion.setFromUnitVectors(WORLD_UP, ringUp);
    scene.add(ring);
    const ringRigs: { rig: SkinnedBot; holder: THREE.Group }[][] = [[], []];
    const buildSide = (side: 0 | 1, bind: ReturnType<typeof bindChassis>, name: Chassis) => {
      for (let i = 0; i < MAX_SQUAD; i++) {
        const holder = new THREE.Group();
        holder.visible = false;
        // buildSkinnedBot ALREADY scales the mesh by rigHeight * DISPLAY, so applying
        // rigHeight here too squares it. Divide DISPLAY back out and the body ends up
        // exactly rigHeight * RING_SCALE tall — the same scale as its own footsteps.
        holder.scale.setScalar(RING_SCALE / DISPLAY);
        const rig = buildSkinnedBot(bind, propMat, name);
        holder.add(rig.mesh);
        ring.add(holder);
        ringRigs[side]!.push({ rig, holder });
      }
    };

    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      const h = Math.max(height, 1);
      // NOT setSize(w, h, false): without the style update the canvas lays out
      // at its drawing-buffer size (2560 wide inside a 1920 window), and every
      // pointer-to-NDC conversion is then wrong by the DPR.
      renderer.setSize(width, h);
      const dpr = renderer.getPixelRatio();
      target.setSize(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(h * dpr)));
      outlineMaterial.uniforms.uTexel.value.set(1 / Math.max(1, width * dpr), 1 / Math.max(1, h * dpr));
      camera.aspect = width / h;
      camera.updateProjectionMatrix();
      shared.uHscale.value = 300.0 * DPR * RS;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const intersection = new IntersectionObserver((e) => { visible = e[0].isIntersecting; });
    intersection.observe(element);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // the ?moonview pose: camera at CAM_MOON aimed at the relic, which is the
    // framing the reveal actually settles into (the editor view aims lower).
    const CAM_MOON = new THREE.Vector3(0, 9, 10);
    const CAM_TGT = new THREE.Vector3(0, 1.6, 0);
    // set fw.camPinned = true (or just move fw.camera) to fly the camera by hand
    let camPinned = false;
    Object.defineProperty(window, "fwPinCam", { configurable: true, set: (v: boolean) => { camPinned = v; } });

    // Dev-only live handles. Tweak in the console and the scene updates on the
    // next frame; `fw.dump()` prints the literals to paste back into this file.
    interface FwHandles { fly: THREE.Group; title: THREE.Group; enter: THREE.Group; camera: THREE.PerspectiveCamera; target: THREE.Vector3; dump: () => void }
    if (import.meta.env.DEV) {
      const r3 = (v: number) => Math.round(v * 100) / 100;
      (window as unknown as { fw: FwHandles }).fw = {
        fly: flyRoot,
        title: titleGroup,
        enter: enterGroup,
        camera,
        target: CAM_TGT,
        dump: () => {
          const f = flyRoot, t = titleGroup;
          console.log(
            `flyRoot.position.set(${r3(f.position.x)}, ${r3(f.position.y)}, ${r3(f.position.z)});\n` +
            `flyRoot.scale.setScalar(${r3(f.scale.x)});\n` +
            `titleGroup.position.set(${r3(t.position.x)}, ${r3(t.position.y)}, ${r3(t.position.z)});\n` +
            `titleGroup.scale.setScalar(${r3(t.scale.x)});\n` +
            `titleGroup.rotation.y = ${r3(t.rotation.y)};\n` +
            `CAM_MOON.set(${r3(camera.position.x)}, ${r3(camera.position.y)}, ${r3(camera.position.z)});\n` +
            `CAM_TGT.set(${r3(CAM_TGT.x)}, ${r3(CAM_TGT.y)}, ${r3(CAM_TGT.z)});`,
          );
        },
      };
      console.log("%cfw ready", "font-weight:bold", "— fw.fly.position.x=5 · fw.fly.scale.setScalar(2) · fw.title · fw.camera.position · fw.target · fw.dump()");
    }

    // Everything authorable, by id. Built before the editor exists because the
    // baked layout has to apply when simply viewing the page too.
    const registry = new Map<string, THREE.Object3D>();
    registry.set("moon", moon);
    if (use3dTitle) registry.set("title", titleGroup);
    if (use3dTitle) registry.set("enter", enterGroup);
    registry.set("fly", flyRoot);
    starMeshes.forEach((m, i) => registry.set(`star-${i}`, m));

    // props that were added in the editor and saved, rebuilt for everyone
    const restored: { id: string; object: THREE.Object3D; kind: (typeof ADDED_PROPS)[number]["kind"] }[] = [];
    for (const record of ADDED_PROPS) {
      const group = makeProp(record.kind, propMat, outlineMat);
      group.name = record.id;
      applyPlacement(group, record);
      scene.add(group);
      registry.set(record.id, group);
      restored.push({ id: record.id, object: group, kind: record.kind });
    }

    applyLayout(registry, SCENE_LAYOUT);
    // Station rig: the camera is never cut, it is eased. Exponential smoothing on
    // both the eye and the look-at, framerate-independent via dt.
    const camWant = new THREE.Vector3();
    const tgtWant = new THREE.Vector3();
    CAM_MOON.fromArray(STATIONS.ARRIVAL.position);
    CAM_TGT.fromArray(STATIONS.ARRIVAL.target);

    // the authored poses the idles animate around
    const enterBaseScale = enterGroup.scale.x;
    const enterBaseY = enterGroup.position.y;

    // ?edit turns the page into a viewport with an Outliner beside it. The
    // displacement filter is off while editing: it moves pixels by up to six,
    // so a click would otherwise land somewhere the object visibly is not.
    let moonEditor: MoonEditor | null = null;
    if (new URLSearchParams(location.search).has("edit")) {
      renderer.domElement.style.filter = "none";
      moonEditor = new MoonEditor({
        scene, camera, canvas: renderer.domElement, propMat, outlineMat,
      });
      const reg = (id: string, o: THREE.Object3D, name: string) => {
        moonEditor!.track(id, o);
        moonEditor!.register(id, o, name);
      };
      const label: Record<string, string> = { moon: "Moon surface", title: "FLYWEIGHT", enter: "ENTER", fly: "Fly" };
      const restoredIds = new Set(restored.map((r) => r.id));
      for (const [id, object] of registry) {
        if (restoredIds.has(id)) continue; // adopted below, with their kind
        reg(id, object, label[id] ?? `Star ${Number(id.replace("star-", "")) + 1}`);
      }
      for (const { id, object, kind } of restored) {
        moonEditor.adopt(id, object, kind, `${kind[0]!.toUpperCase()}${kind.slice(1)} ${id.replace(/^.*-add/, "")}`);
      }
      moonEditor.cameraTarget = CAM_TGT;
      setEditor(moonEditor);
      (window as unknown as { fwEditor: MoonEditor | null }).fwEditor = moonEditor;
    }

    // Idle motion for the sky dressing. Every term is an OFFSET from the pose
    // the layout authored, and none of it runs while the editor is mounted —
    // so "copy layout" always emits the authored numbers, never a frame of
    // animation, and a G/S/R gesture is never fought by the clock.
    interface Drift {
      object: THREE.Object3D;
      base: { p: THREE.Vector3; r: THREE.Euler; s: number };
      phase: number;
      flat: boolean;
      bob: number;
      spin: number;
      twinkle: number;
    }
    const drifting: Drift[] = [];
    if (!moonEditor) {
      // deterministic per-id, so the scene is the same on every load
      const hash = (str: string) => {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return ((h >>> 0) % 1000) / 1000;
      };
      for (const [id, object] of registry) {
        // Sky ids are prefixed `sky-<kind>-n`, hand-placed ones `<kind>-addN`,
        // and the nine code stars `star-n`; matching on the kind word covers all
        // three without a second table to keep in sync.
        const isStar = id.includes("star");
        const isCrescent = id.includes("crescent");
        const isPlanet = id.includes("planet");
        const isRock = id.includes("boulder");
        if (!isStar && !isCrescent && !isPlanet && !isRock) continue;
        const seed = hash(id);
        drifting.push({
          object,
          base: { p: object.position.clone(), r: object.rotation.clone(), s: object.scale.x },
          phase: seed * Math.PI * 2,
          flat: isStar || isCrescent,
          // The sky field sits 13-58 units out, where a bob tuned for props a few
          // units from the camera is invisible, so amplitude scales with depth.
          // Rocks tumble rather than bob: they read as debris, not decoration.
          bob: (isStar ? 0.2 + seed * 0.22 : isRock ? 0.12 + seed * 0.12 : 0.09 + seed * 0.1)
             * (1 + Math.max(0, object.position.length() - 12) * 0.075),
          spin: isStar ? 0.14 + seed * 0.2 : isRock ? 0.1 + seed * 0.14 : isPlanet ? 0.05 : 0.04,
          twinkle: isStar ? 0.05 + seed * 0.05 : 0,
        });
      }
    }

    // ENTER is geometry, so it needs its own hit test. Only in view mode — while
    // editing, a click belongs to selection and gesture confirmation.
    const enterRay = new THREE.Raycaster();
    const hitEnter = (e: PointerEvent | MouseEvent) => {
      // Raycaster.intersectObject does not check `visible`, so hiding ENTER is
      // not enough on its own to stop it being clicked from the bay or the ring.
      if (moonEditor || !enterMesh || stationRef.current !== "ARRIVAL") return false;
      const rect = renderer.domElement.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return false;
      enterRay.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      return enterRay.intersectObject(enterMesh, false).length > 0;
    };
    const onEnterClick = (e: PointerEvent) => {
      if (e.button === 0 && hitEnter(e)) location.hash = "#/select";
    };
    const onEnterHover = (e: PointerEvent) => {
      if (moonEditor || !enterMesh) return;
      enterHover = hitEnter(e);
      document.body.style.cursor = enterHover ? "pointer" : "";
    };
    window.addEventListener("pointerdown", onEnterClick);
    window.addEventListener("pointermove", onEnterHover, { passive: true });

    let skT = 0, skS = 1;
    const RESEED_HZ = 9;
    let prev = 0;
    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0.016;
      prev = now;
      shared.uTime.value = now / 1000;
      if (!reducedMotion && now - skT > 1000 / RESEED_HZ) {
        skT = now;
        skS = (skS % 37) + 1;
        turb.setAttribute("seed", String(skS));
      }
      if (!camPinned) {
        const st = STATIONS[stationRef.current] ?? STATIONS.ARRIVAL;
        camWant.fromArray(st.position);
        tgtWant.fromArray(st.target);

        /**
         * A fight camera, not a landscape shot.
         *
         * The static RING pose framed the whole 9-unit arena from 9 units away, so
         * two 0.68-unit fighters came out about forty pixels tall, low in frame and
         * behind the HUD glass — which is why the boxing looked like nothing was
         * happening. Track the midpoint of whoever is still standing and pull back
         * only as far as their separation actually needs: it closes on a clinch and
         * opens out when they break, and they stay the size of the shot.
         */
        const cf = frameRef.current;
        const live = cf ? cf.bots.filter((u) => u.hull > 0) : [];
        if (stationRef.current === "RING" && live.length) {
          /**
           * Low and side-on, because a punch is a HORIZONTAL movement.
           *
           * This was 0.86 rad (49 deg) to stop the far fighter dropping behind the
           * HUD, but looking down that hard foreshortens a thrown arm almost
           * entirely into the screen — the bots throw a punch every 1.2 s and you
           * simply could not see them. The both-axes fit below now handles keeping
           * the pair in frame, and dropping the angle also SHRINKS the vertical
           * spread a depth separation makes (it scales with sin of this), so the
           * camera can sit closer and the figures come up to the size of the model
           * on the landing page.
           */
          const el = 0.52;
          let cx = 0, cz = 0, spread = 0;
          for (const u of live) { cx += u.x * RING_SCALE; cz += u.y * RING_SCALE; }
          cx /= live.length; cz /= live.length;
          for (const u of live)
            spread = Math.max(spread, Math.hypot(u.x * RING_SCALE - cx, u.y * RING_SCALE - cz) * 2);

          // The pair, plus air either side — measured in BODIES, not in absolute
          // units. The margin used to be a flat 2.7 against a body only 0.58 units
          // tall, so once the collision geometry shrank to match the drawn torsos the
          // fighters were four body-heights of empty moon apart on screen: correct
          // framing of two specks. Scaling the margin to the figure keeps them the
          // size of the model on the landing page, trading fists.
          const bodyH = rigHeight(chassisRef.current) * RING_SCALE;
          const need = spread + bodyH * 1.25;
          // Separation in DEPTH becomes VERTICAL spread on screen at this elevation
          // (by sin of it), and the vertical field is much narrower than the
          // horizontal one — so fitting only the width let the far fighter slide out
          // of the bottom of the shot. Fit both axes and take whichever needs more
          // room.
          const tall = spread * Math.sin(el) + bodyH * 1.45;
          const halfV = (camera.fov / 2) * (Math.PI / 180);
          const halfH = Math.atan(Math.tan(halfV) * Math.max(1, camera.aspect));
          const dist = Math.max(bodyH * 2.3,
                                need / 2 / Math.tan(halfH),
                                tall / 2 / Math.tan(halfV));

          // midpoint, on the curved surface, in world space
          _mid.set(cx, -(cx * cx + cz * cz) / (2 * MOON_R), cz)
              .applyQuaternion(ring.quaternion).add(ring.position);
          // sit back along the ring's local +Z and above its local up

          _off.set(0, Math.sin(el), Math.cos(el)).multiplyScalar(dist).applyQuaternion(ring.quaternion);
          camWant.copy(_mid).add(_off);

          // Aim BELOW them so they ride high in the shot: the brain panels own the
          // bottom half of the screen, and a centred subject sits behind them.
          // Aim at chest height on the bodies themselves. The old bias was written
          // against a frame several times larger — subtracting a fraction of it from
          // a flat 0.5 aimed BELOW the feet once the shot tightened, which threw the
          // fighters up into the HUD.
          tgtWant.copy(_mid).addScaledVector(ringUp, bodyH * 0.62);
        }
        // 1 - exp(-k*dt): same settle time whatever the framerate.
        //
        // The ring gets a much lazier constant. A camera locked to the midpoint of two
        // fighters SUBTRACTS their movement from the shot: they stay pinned to the
        // centre at a constant size and the fight looks static even while every limb
        // is swinging. Following slowly lets them actually travel across the frame.
        const follow = stationRef.current === "RING" ? 0.55 : 2.1;
        const k = 1 - Math.exp(-follow * Math.min(dt, 0.1));
        CAM_MOON.lerp(camWant, k);
        CAM_TGT.lerp(tgtWant, k);
        camera.position.copy(CAM_MOON);
      }
      camera.lookAt(CAM_TGT);
      // The fly holds its authored pose: a per-frame write to rotation.y would
      // overwrite an R gesture every frame and make the object un-editable.
      // The moon keeps the prototype's drift, but only when nothing is editing.
      // The wordmark and ENTER are signage for the landing, not world dressing:
      // from the bay and the ring they sit behind the glass panels and bleed
      // through them. They exist only at ARRIVAL.
      const atArrival = stationRef.current === "ARRIVAL";
      titleGroup.visible = atArrival;
      enterGroup.visible = atArrival;

      if (!reducedMotion && !moonEditor) moon.rotation.y += 0.0003;

      if (!reducedMotion && !moonEditor) {
        const t = now / 1000;
        for (const d of drifting) {
          d.object.position.y = d.base.p.y + Math.sin(t * 0.75 + d.phase) * d.bob;
          d.object.position.x = d.base.p.x + Math.cos(t * 0.41 + d.phase) * d.bob * 0.55;
          if (d.flat) {
            // Stars and crescents are flat extruded shapes, baked with their face
            // aimed at the camera. Spinning them about world Y swings them edge-on
            // and they read as white slivers for half of every cycle — measured at
            // 25 of the 66 on screen. Euler XYZ applies Z FIRST, i.e. in the
            // object's own plane, so spinning that keeps the face toward the
            // camera and still turns the points of the star.
            d.object.rotation.z = d.base.r.z + t * d.spin;
          } else {
            d.object.rotation.z = d.base.r.z + Math.sin(t * d.spin * 2 + d.phase) * 0.3;
            d.object.rotation.y = d.base.r.y + t * d.spin * 0.6;
          }
          if (d.twinkle) {
            d.object.scale.setScalar(d.base.s * (1 + Math.sin(t * 1.7 + d.phase * 2) * d.twinkle));
          }
        }

        // ── fighters at the ring ───────────────────────────────────────
        // The frame the simulation emits drives the same rig type as the idle,
        // so the fight needs no second animation path: place each unit on the
        // ring floor, hand poseSkinnedBot the real state, hide the rest.
        const f = frameRef.current;
        const split = f?.teamSplit ?? 1;
        for (let side = 0; side < 2; side++) {
          const pool = ringRigs[side]!;
          for (let i = 0; i < pool.length; i++) {
            const slot = pool[i]!;
            const idx = side === 0 ? i : split + i;
            const unit = f && idx < f.bots.length && (side === 0 ? i < split : true) ? f.bots[idx] : undefined;
            const alive = !!unit && unit.hull > 0;
            // With no match running the ring still has to look inhabited, so the
            // lead of each side stands there on the same idle the landing uses.
            const idling = !f && i === 0;
            slot.holder.visible = alive || idling;
            if (!slot.holder.visible) continue;
            if (!unit) {
              const lx0 = side === 0 ? -2.2 : 2.2;
              slot.holder.position.set(lx0, (-lx0 * lx0) / (2 * MOON_R), 0);
              slot.holder.quaternion.identity();
              slot.holder.rotateY(side === 0 ? Math.PI / 2 : -Math.PI / 2);
              poseSkinnedBot(slot.rig, idleState(t), chassisRef.current);
              continue;
            }
            // Sim metres to ring units. The ring plane is tangent to the moon at
            // its centre, so the surface drops away as y = -r^2/2R - the sphere to
            // well under a millimetre out here, and it is what keeps the feet on the
            // ground at the edge of the arena instead of hovering above it.
            const lx = unit.x * RING_SCALE, lz = unit.y * RING_SCALE;
            const r2 = lx * lx + lz * lz, r = Math.sqrt(r2);
            slot.holder.position.set(lx, -r2 / (2 * MOON_R), lz);

            // Stand perpendicular to the ground actually underneath you: away from
            // the ring centre the normal tilts by r/R, about the axis at right
            // angles to the way you walked.
            _tiltQ.identity();
            if (r > 1e-6) _tiltQ.setFromAxisAngle(_axis.set(lz / r, 0, -lx / r), r / MOON_R);

            // THEN face where you are going. The simulation has streamed `heading`
            // since the first day and nothing ever read it, so the fighters slid
            // around the ring permanently facing one fixed direction - no turning,
            // and punches that landed sideways. The posed rig faces -Z (measured off
            // the head bone, not assumed), so heading h wants -h - pi/2.
            _headQ.setFromAxisAngle(WORLD_UP, -unit.heading - Math.PI / 2);
            slot.holder.quaternion.copy(_tiltQ).multiply(_headQ);

            poseSkinnedBot(slot.rig, unit, chassisRef.current);
          }
        }

        // The fly's idle comes off its own rig, not a root bob: the mesh is
        // skinned, so the legs shift weight at the joints instead of the whole
        // body translating. Only the authored pose is held here.
        if (flyRig) poseSkinnedBot(flyRig, idleState(t), chassisRef.current);
        // ENTER swells under the cursor; eased so it never snaps
        enterEase += ((enterHover ? 1 : 0) - enterEase) * 0.14;
        const k = 1 + enterEase * 0.16;
        enterGroup.scale.setScalar(enterBaseScale * k);
        enterGroup.position.y = enterBaseY + enterEase * 0.12;
      }
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", onEnterClick);
      window.removeEventListener("pointermove", onEnterHover);
      document.body.style.cursor = "";
      observer.disconnect();
      intersection.disconnect();
      scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      for (const g of starGeos) g.dispose();
      for (const g of inflatedGeometries) g.dispose();
      svg.remove();
      (window as unknown as { fwEditor: MoonEditor | null }).fwEditor = null;
      moonEditor?.dispose();
      setEditor(null);
      delete (window as unknown as Record<string, unknown>).fw;
      for (const t of inkTextures) t.dispose();
      for (const m of inkMaterials) m.dispose();
      moonMat.dispose(); propMat.dispose(); outlineMat.dispose();
      hatchTex.dispose(); paperTex.dispose();
      target.dispose();
      depthTexture.dispose();
      outlineMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the body when the class changes. Declared after the scene effect so on the
  // first mount that one has already loaded this chassis and this is a no-op.
  useEffect(() => {
    if (loadedChassis.current === null || loadedChassis.current === chassis) return;
    swapChassis.current?.(chassis);
  }, [chassis]);

  return (
    <div
      className={editor ? "arena-canvas editing" : "arena-canvas"}
      ref={host}
      role="img"
      aria-label="A fly standing on the moon, drawn in crosshatch ink"
    >
      {unavailable && <p className="render-fallback">3D rendering unavailable.</p>}
      {editor && <MoonOutliner editor={editor} />}
    </div>
  );
}
