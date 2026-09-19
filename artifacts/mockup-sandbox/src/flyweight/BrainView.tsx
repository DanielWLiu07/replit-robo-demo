import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { NeuronModule } from "@workspace/contract";
import { buildBrainGeometry } from "@workspace/sim";
import { MODULES } from "./modules";
import {
  CLASS_BRIGHTNESS,
  CLOUD_MODULES,
  loadConnectome,
  type ConnectomeCloud,
} from "./connectomeCloud";

/**
 * The brain, drawn as the brain: 139,248 neurons at their real FlyWire FAFB
 * v783 coordinates, one point per cell, the whole adult fly.
 *
 * What replaced what: this used to draw one bezier per *counted* cell in an
 * arrangement that was anatomical by hand, honest about the counts, invented
 * about the positions. Every coordinate here is measured. The six circuits the
 * simulation drives sit inside the real brain and light where they actually
 * are, so a Giant Fiber spike lights two cells in the right place rather than
 * two lines in a plausible place.
 *
 * Firing is brightness, not colour: the app is black and white, and the usual
 * blue-sensory / red-motor scheme would fight every other surface on the page.
 */
const COUNTS = buildBrainGeometry();

const DIM = new THREE.Color(0x3a3b45);
const LIT = new THREE.Color(0xf6f6f1);

/** Index into the uniform array, 0 unused so a non-simulated cell reads 0 glow. */
const GLOW_SLOTS = 7;

const VERT = `
  attribute float aBright;
  attribute float aModule;
  uniform float uGlow[${GLOW_SLOTS}];
  uniform float uPixelRatio;
  varying float vI;
  void main() {
    float g = 0.0;
    int m = int(aModule + 0.5);
    for (int i = 1; i < ${GLOW_SLOTS}; i++) {
      if (i == m) g = uGlow[i];
    }
    vI = max(aBright, g);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // a firing cell swells as well as brightens, so four cells out of 139,248
    // are still findable when the Giant Fiber goes off
    gl_PointSize = uPixelRatio * (1.0 + g * 4.5) * (1.6 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = `
  uniform vec3 uDim;
  uniform vec3 uLit;
  varying float vI;
  void main() {
    // round the square point off, cheaper than a texture
    vec2 d = gl_PointCoord - vec2(0.5);
    if (dot(d, d) > 0.25) discard;
    gl_FragColor = vec4(mix(uDim, uLit, vI), 0.45 + vI * 0.55);
  }`;

export function BrainView({
  equipped,
  spiked,
  height = 190,
}: {
  equipped: NeuronModule[];
  spiked: NeuronModule[];
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [cloud, setCloud] = useState<ConnectomeCloud | null>(null);
  const [failed, setFailed] = useState(false);
  const equippedRef = useRef(equipped);
  const spikedRef = useRef(spiked);
  useEffect(() => { equippedRef.current = equipped; }, [equipped]);
  useEffect(() => { spikedRef.current = spiked; }, [spiked]);

  useEffect(() => {
    let alive = true;
    loadConnectome()
      .then((c) => { if (alive) setCloud(c); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element || !cloud) return;
    let disposed = false;
    let raf = 0;
    let visible = true;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    } catch {
      return;
    }
    const pixelRatio = Math.min(devicePixelRatio, 2);
    renderer.setPixelRatio(pixelRatio);
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // The brain is wide and shallow, x spans the full normalised unit, y only
    // ~0.42 of it, so the panel is filled by fitting height, not width.
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 40);
    camera.position.set(0, 0.06, 0.92);
    camera.lookAt(0, 0, 0);

    const root = new THREE.Group();
    // FlyWire's y runs down the head; flip it so the brain is the right way up
    root.scale.set(1, -1, 1);
    scene.add(root);

    const bright = new Float32Array(cloud.count);
    const modules = new Float32Array(cloud.count);
    for (let i = 0; i < cloud.count; i++) {
      bright[i] = CLASS_BRIGHTNESS[cloud.classNames[cloud.classes[i]!] ?? "other"] ?? 0.25;
      modules[i] = cloud.modules[i]!;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
    geometry.setAttribute("aBright", new THREE.BufferAttribute(bright, 1));
    geometry.setAttribute("aModule", new THREE.BufferAttribute(modules, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uGlow: { value: new Array(GLOW_SLOTS).fill(0) },
        uPixelRatio: { value: pixelRatio },
        uDim: { value: new THREE.Color(DIM) },
        uLit: { value: new THREE.Color(LIT) },
      },
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    root.add(points);

    const resize = () => {
      const { width } = element.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const intersection = new IntersectionObserver((e) => { visible = e[0]!.isIntersecting; });
    intersection.observe(element);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // one decaying glow per simulated circuit
    const glow = new Array(GLOW_SLOTS).fill(0) as number[];
    let last = 0;
    const draw = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(draw);
      if (!visible || document.hidden) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
      last = now;
      if (!reducedMotion) root.rotation.y = now * 0.00013;
      root.rotation.x = -0.12;

      for (let slot = 1; slot < GLOW_SLOTS; slot++) {
        const module = CLOUD_MODULES[slot - 1]!;
        const on = equippedRef.current.includes(module);
        if (on && spikedRef.current.includes(module)) glow[slot] = 1;
        else glow[slot] = Math.max(0, glow[slot]! - dt * 2.6);
        // an unequipped circuit is still anatomy, it just never fires
        material.uniforms.uGlow!.value[slot] = on ? glow[slot] : 0;
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [height, cloud]);

  const shown = COUNTS.filter((p) => equipped.includes(p.module));
  const cells = shown.reduce((sum, p) => sum + p.cells, 0);

  return (
    <div className="brainview">
      <div className="section-label">
        <span>CONNECTOME / FLYWIRE FAFB v783</span>
        <span className="mono">{cells.toLocaleString()} CELLS EQUIPPED</span>
      </div>
      <div className="brainview-canvas" ref={host} style={{ height }} role="img"
        aria-label={`The fly brain, ${cloud?.count.toLocaleString() ?? ""} neurons at their measured positions`}>
        {!cloud && !failed && <span className="brainview-loading mono">LOADING CONNECTOME…</span>}
        {failed && <span className="brainview-loading mono">CONNECTOME UNAVAILABLE</span>}
      </div>
      <ul className="brainview-key mono">
        {shown.map((p) => (
          <li key={p.module}>
            <i className={p.neurotransmitter === "glutamate" ? "glu" : ""} />
            {MODULES[p.module].circuit}
            <span>{p.cells}</span>
          </li>
        ))}
      </ul>
      <p className="brainview-note">
        Every neuron in the adult fly at its measured position ,{" "}
        {cloud?.count.toLocaleString() ?? "139,248"} cells, FlyWire FAFB v783. The equipped
        circuits light where they actually sit.
      </p>
    </div>
  );
}
