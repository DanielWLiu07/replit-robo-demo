import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Chassis } from "@workspace/contract";
import { buildWordmark } from "./wordmark";
import { MoonEditor, makeProp } from "./moonEditor";
import { ADDED_PROPS, CAMERA, SCENE_LAYOUT, applyLayout, applyPlacement } from "./moonLayout";
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

const PROP_VERT = `varying vec3 vN;void main(){vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

const PROP_FRAG = `precision highp float;uniform sampler2D hatchTex,paperTex;uniform vec3 uL1;uniform float uTime,uHscale;varying vec3 vN;
    void main(){vec3 N=normalize(vN);float ndl=max(dot(N,normalize(uL1)),0.0);float shade=clamp(ndl*0.85+0.17,0.0,1.0);float t=1.0-shade;
      float fr=floor(uTime*8.0);float ja=fr*1.7;mat2 R=mat2(cos(ja),-sin(ja),sin(ja),cos(ja));vec2 off=vec2(fract(sin(fr*91.7)*4373.0),fract(sin(fr*47.3)*7919.0))*1200.0;
      vec3 hx=texture2D(hatchTex,(R*gl_FragCoord.xy+off)/uHscale).rgb;
      float i0=smoothstep(0.10,0.42,t),i1=smoothstep(0.32,0.66,t),i2=smoothstep(0.58,0.95,t);
      float m0=mix(1.0,hx.r,i0);float m1=m0*mix(1.0,hx.g,i1);float m2=m1*mix(1.0,hx.b,i2);
      vec3 paper=vec3(0.93)*mix(vec3(1.0),texture2D(paperTex,gl_FragCoord.xy/620.0).rgb,0.14);
      gl_FragColor=vec4(mix(vec3(0.05),paper,clamp(m2,0.0,1.0)),1.0);}`;

export function MoonStage({ chassis = "DRONE" as Chassis }: { chassis?: Chassis }) {
  const host = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [editor, setEditor] = useState<MoonEditor | null>(null);

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
    const inkTextures: THREE.CanvasTexture[] = [];
    const inkMaterials: THREE.MeshBasicMaterial[] = [];
    let enterMesh: THREE.Mesh | null = null;
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

      const tint = (color: string) => {
        const t = layer();
        t.x.drawImage(art.c, 0, 0);
        t.x.globalCompositeOperation = "source-in";
        t.x.fillStyle = color;
        t.x.fillRect(0, 0, w, h);
        return t.c;
      };
      const blackCopy = tint("#08080a");
      const whiteCopy = tint("#f6f6f2");

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
        const face = new FontFace("KatieRoze", `url(${base}fonts/KatieRoze-display-512.woff2)`);
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
    flyRoot.position.set(4.2, 0, 4.0);
    flyRoot.rotation.y = -0.5;
    scene.add(flyRoot);
    new GLTFLoader().load(`${base}models/${chassis.toLowerCase()}.glb`, (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const s = 5.4 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(s);
      model.position.set(-centre.x * s, -box.min.y * s, -centre.z * s);
      model.traverse((o) => { if (o instanceof THREE.Mesh) o.material = propMat; });
      // same ink hull as the title, so the fly reads against a bright moon
      // instead of disappearing into it
      const hull = model.clone(true);
      hull.traverse((o) => { if (o instanceof THREE.Mesh) o.material = outlineMat; });
      hull.scale.multiplyScalar(1.035);
      flyRoot.add(hull);
      flyRoot.add(model);
    }, undefined, () => {});

    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      const h = Math.max(height, 1);
      // NOT setSize(w, h, false): without the style update the canvas lays out
      // at its drawing-buffer size (2560 wide inside a 1920 window), and every
      // pointer-to-NDC conversion is then wrong by the DPR.
      renderer.setSize(width, h);
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
    if (CAMERA) { CAM_MOON.fromArray(CAMERA.position); CAM_TGT.fromArray(CAMERA.target); }

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

    // ENTER is geometry, so it needs its own hit test. Only in view mode — while
    // editing, a click belongs to selection and gesture confirmation.
    const enterRay = new THREE.Raycaster();
    const hitEnter = (e: PointerEvent | MouseEvent) => {
      if (moonEditor || !enterMesh) return false;
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
      document.body.style.cursor = hitEnter(e) ? "pointer" : "";
    };
    window.addEventListener("pointerdown", onEnterClick);
    window.addEventListener("pointermove", onEnterHover, { passive: true });

    let skT = 0, skS = 1;
    const RESEED_HZ = 9;
    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      shared.uTime.value = now / 1000;
      if (!reducedMotion && now - skT > 1000 / RESEED_HZ) {
        skT = now;
        skS = (skS % 37) + 1;
        turb.setAttribute("seed", String(skS));
      }
      if (!camPinned) camera.position.copy(CAM_MOON);
      camera.lookAt(CAM_TGT);
      // The fly holds its authored pose: a per-frame write to rotation.y would
      // overwrite an R gesture every frame and make the object un-editable.
      // The moon keeps the prototype's drift, but only when nothing is editing.
      if (!reducedMotion && !moonEditor) moon.rotation.y += 0.0003;
      renderer.render(scene, camera);
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
      svg.remove();
      (window as unknown as { fwEditor: MoonEditor | null }).fwEditor = null;
      moonEditor?.dispose();
      setEditor(null);
      delete (window as unknown as Record<string, unknown>).fw;
      for (const t of inkTextures) t.dispose();
      for (const m of inkMaterials) m.dispose();
      moonMat.dispose(); propMat.dispose(); outlineMat.dispose();
      hatchTex.dispose(); paperTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
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
