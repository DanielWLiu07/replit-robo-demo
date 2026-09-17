import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { NeuronModule } from "@workspace/contract";
import { BRAIN_EXTENT, buildBrainGeometry, totalFibres } from "@workspace/sim";
import { MODULES } from "./modules";

/**
 * The brain, drawn one line per counted cell.
 *
 * Every fibre here is a real neuron from the FlyWire 783 counts — LC10a is 234
 * threads because there are 234 LC10a cells, and the Giant Fiber is two lines
 * because there are two Giant Fibers. That is the whole argument for drawing it
 * at all: the shape of the table is the interesting part, and you can see it.
 * Arrangement is anatomical, not traced: visual projections run in from the
 * optic lobes, descending neurons head down toward the nerve cord.
 */
const GEOMETRY = buildBrainGeometry();
const FIBRE_TOTAL = totalFibres(GEOMETRY);
/** samples per fibre along its bezier */
const SEG = 7;

const DIM = new THREE.Color(0x3a3b45);
const LIT = new THREE.Color(0xf4f4ef);

function fibrePositions(pop: (typeof GEOMETRY)[number]): Float32Array {
  const out = new Float32Array(pop.fibres.length * SEG * 2 * 3);
  let o = 0;
  const point = (f: (typeof pop.fibres)[number], t: number) => {
    const u = 1 - t;
    return [
      u * u * f.from[0] + 2 * u * t * f.ctrl[0] + t * t * f.to[0],
      u * u * f.from[1] + 2 * u * t * f.ctrl[1] + t * t * f.to[1],
      u * u * f.from[2] + 2 * u * t * f.ctrl[2] + t * t * f.to[2],
    ];
  };
  for (const f of pop.fibres) {
    for (let s = 0; s < SEG; s++) {
      const a = point(f, s / SEG);
      const b = point(f, (s + 1) / SEG);
      out[o++] = a[0]; out[o++] = a[1]; out[o++] = a[2];
      out[o++] = b[0]; out[o++] = b[1]; out[o++] = b[2];
    }
  }
  return out;
}

export function BrainView({
  equipped,
  spiked = [],
  height = 300,
}: {
  equipped: NeuronModule[];
  spiked?: NeuronModule[];
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const equippedRef = useRef(equipped);
  const spikedRef = useRef(spiked);
  useEffect(() => { equippedRef.current = equipped; }, [equipped]);
  useEffect(() => { spikedRef.current = spiked; }, [spiked]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let raf = 0;
    let visible = true;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
    camera.position.set(0.12, 0.36, 1.95);
    camera.lookAt(0, 0, 0);

    const root = new THREE.Group();
    scene.add(root);

    // a faint anatomical envelope so the fibres read as sitting inside a brain
    const shell = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(BRAIN_EXTENT.x * 1.55, BRAIN_EXTENT.y * 1.75, BRAIN_EXTENT.z * 1.8),
      ),
      new THREE.LineBasicMaterial({ color: 0x2b2c34, transparent: true, opacity: 0.8 }),
    );
    root.add(shell);

    const layers = GEOMETRY.map((pop) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(fibrePositions(pop), 3));
      const material = new THREE.LineBasicMaterial({
        color: DIM.clone(),
        transparent: true,
        opacity: 0.62,
      });
      const lines = new THREE.LineSegments(geometry, material);
      root.add(lines);
      return { module: pop.module, lines, material, glow: 0 };
    });

    const resize = () => {
      const { width } = element.getBoundingClientRect();
      const h = height;
      renderer.setSize(width, h);
      camera.aspect = width / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const intersection = new IntersectionObserver((e) => { visible = e[0].isIntersecting; });
    intersection.observe(element);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let last = 0;
    const draw = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(draw);
      if (!visible || document.hidden) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
      last = now;
      if (!reducedMotion) root.rotation.y = now * 0.00016;
      root.rotation.x = -0.18;

      for (const layer of layers) {
        const on = equippedRef.current.includes(layer.module);
        layer.lines.visible = on;
        if (!on) continue;
        // a spike lights the whole population, then it decays back to rest
        if (spikedRef.current.includes(layer.module)) layer.glow = 1;
        else layer.glow = Math.max(0, layer.glow - dt * 3.2);
        layer.material.color.copy(DIM).lerp(LIT, layer.glow);
        layer.material.opacity = 0.55 + layer.glow * 0.45;
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      for (const layer of layers) {
        layer.lines.geometry.dispose();
        layer.material.dispose();
      }
      shell.geometry.dispose();
      (shell.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [height]);

  const shown = GEOMETRY.filter((p) => equipped.includes(p.module));
  const cells = shown.reduce((sum, p) => sum + p.cells, 0);

  return (
    <div className="brainview">
      <div className="section-label">
        <span>CONNECTOME / ONE LINE PER CELL</span>
        <span className="mono">{cells.toLocaleString()} CELLS EQUIPPED</span>
      </div>
      <div className="brainview-canvas" ref={host} style={{ height }} role="img"
        aria-label={`Three-dimensional brain with ${cells} fibres, one per counted cell`} />
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
        Arranged anatomically from the FlyWire 783 counts — not traced from the connectome.
        {" "}{FIBRE_TOTAL.toLocaleString()} fibres available across all six populations.
      </p>
    </div>
  );
}
