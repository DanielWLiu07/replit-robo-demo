/**
 * The compositor runtime: renders the scene into a linear target, runs each
 * materialisation stage in dependency order, then blits the final expression to
 * the screen (or a target of the caller's choosing).
 *
 * This is the "engine" half of the domain: everything that decides WHAT a pixel
 * is lives in the graph; this class only decides WHEN buffers get filled. The
 * scene target and every stage are scene-linear half-float; the renderer's
 * output colour transform (sRGB, tone mapping) applies once, on the final blit
 * to the canvas, which is where Blender applies its display transform too.
 *
 * Usage (R3F):
 *   const comp = new Compositor(gl, scene, camera, graphOutput)
 *   useFrame(() => comp.render(), 1)   // priority > 0: R3F stops rendering itself
 */
import { Camera, FloatType, HalfFloatType, LinearFilter, LinearSRGBColorSpace, Matrix4, NearestFilter, NoToneMapping, RenderTarget, Scene, Vector2, type ToneMapping } from 'three';
import { positionWorld, vec4 } from 'three/tsl';
import { MeshBasicNodeMaterial, QuadMesh, type Renderer } from 'three/webgpu';
import type { TSLNode } from '../graph/compile';
import { compileComp, type CompiledComp } from './compile';
import { skipsPosition } from './decal';
import { collectOverlays, drawOverlays } from './overlay';
import type { CompInput } from './types';

export interface CompositorOptions {
  /** MSAA samples for the scene target (0 = off). */
  samples?: number;
  /** Clear alpha of the scene target: 0 lets transparent background reach the graph. */
  clearAlpha?: number;
  /**
   * Write the graph's output to the canvas RAW: no tone mapping, no sRGB
   * encoding. This is what a custom GLSL post pass without the colour-space
   * chunks does (pomme's WatercolorPass), and it is a look: linear values shown
   * as sRGB crush the darks and boost saturation. Default false = the
   * renderer's display transform, which is Blender's behaviour.
   */
  rawOutput?: boolean;
  /**
   * Internal resolution as a fraction of the drawing buffer (default 1). The
   * scene and every stage render at this size; the final blit upsamples.
   * Painterly graphs hide 0.6 to 0.8 completely, and cost scales with pixels.
   */
  renderScale?: number;
  /**
   * When to re-render the Position pass (only if the graph reads it):
   * 'always' every frame; 'onChange' only when the camera moved or the app
   * called invalidatePosition() (objects that move must invalidate).
   */
  positionPass?: 'always' | 'onChange';
}

export class Compositor {
  readonly sceneTarget: RenderTarget;
  /** World-position pass (Blender's Position AOV), rendered only if the graph reads it. */
  readonly positionTarget: RenderTarget;
  private usesPosition = false;
  private positionDirty = true;
  private positionValid = false;
  private readonly lastCam = { world: new Matrix4(), proj: new Matrix4() };
  private readonly positionMaterial: MeshBasicNodeMaterial;
  readonly compiled: CompiledComp;
  /** Runtime uniforms by name (from compGraph.uniform); set `.value`. */
  readonly uniforms: Record<string, TSLNode & { value: number }>;

  private readonly stageQuads: { quad: QuadMesh; target: RenderTarget }[] = [];
  private readonly outQuad: QuadMesh;
  private readonly size = new Vector2();
  private readonly opts: Required<CompositorOptions>;
  private readonly savedOutput: { toneMapping: ToneMapping; colorSpace: string } | null = null;

  constructor(
    private readonly renderer: Renderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
    graphOutput: CompInput,
    options: CompositorOptions = {},
  ) {
    this.opts = {
      samples: options.samples ?? 4,
      clearAlpha: options.clearAlpha ?? 0,
      rawOutput: options.rawOutput ?? false,
      renderScale: options.renderScale ?? 1,
      positionPass: options.positionPass ?? 'always',
    };
    if (this.opts.rawOutput) {
      // set once for the session (toggling per frame would rebuild the output pass every frame)
      this.savedOutput = { toneMapping: renderer.toneMapping, colorSpace: renderer.outputColorSpace };
      renderer.toneMapping = NoToneMapping;
      renderer.outputColorSpace = LinearSRGBColorSpace;
    }
    this.sceneTarget = new RenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: true,
      samples: this.opts.samples,
    });
    this.sceneTarget.texture.name = 'comp:scene';
    this.sceneTarget.texture.minFilter = LinearFilter;
    this.sceneTarget.texture.magFilter = LinearFilter;
    this.sceneTarget.texture.generateMipmaps = false;

    this.positionTarget = new RenderTarget(1, 1, { type: FloatType, depthBuffer: true });
    this.positionTarget.texture.name = 'comp:position';
    this.positionTarget.texture.minFilter = NearestFilter;
    this.positionTarget.texture.magFilter = NearestFilter;
    this.positionTarget.texture.generateMipmaps = false;
    this.positionMaterial = new MeshBasicNodeMaterial();
    this.positionMaterial.name = 'comp:position';
    this.positionMaterial.fragmentNode = vec4(positionWorld, 1);

    this.compiled = compileComp(graphOutput, {
      sceneTexture: this.sceneTarget.texture,
      positionTexture: this.positionTarget.texture,
      onUsesPosition: () => {
        this.usesPosition = true;
      },
    });
    this.uniforms = this.compiled.uniforms;

    for (const stage of this.compiled.stages) {
      const mat = new MeshBasicNodeMaterial();
      mat.name = `comp:${stage.name}`;
      mat.fragmentNode = stage.node;
      mat.depthTest = false;
      mat.depthWrite = false;
      mat.transparent = false;
      this.stageQuads.push({ quad: new QuadMesh(mat), target: stage.target });
    }
    const outMat = new MeshBasicNodeMaterial();
    outMat.name = 'comp:output';
    outMat.fragmentNode = this.compiled.output;
    outMat.depthTest = false;
    outMat.depthWrite = false;
    outMat.transparent = false;
    this.outQuad = new QuadMesh(outMat);
  }

  /** Change the internal resolution at runtime (0.5 .. 1). */
  setRenderScale(scale: number): void {
    this.opts.renderScale = Math.min(1, Math.max(0.25, scale));
  }

  /** Objects moved: the Position pass must re-render next frame ('onChange' mode). */
  invalidatePosition(): void {
    this.positionDirty = true;
  }

  /** Match every target to the drawing buffer times renderScale. Called from render(); cheap when unchanged. */
  private syncSize(): void {
    const s = this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(s.x * this.opts.renderScale));
    const h = Math.max(1, Math.floor(s.y * this.opts.renderScale));
    if (this.sceneTarget.width === w && this.sceneTarget.height === h) return;
    this.sceneTarget.setSize(w, h);
    this.positionTarget.setSize(w, h);
    for (const st of this.stageQuads) st.target.setSize(w, h);
    this.positionDirty = true;
  }

  private cameraMoved(): boolean {
    const c = this.camera;
    if (this.lastCam.world.equals(c.matrixWorld) && this.lastCam.proj.equals(c.projectionMatrix)) return false;
    this.lastCam.world.copy(c.matrixWorld);
    this.lastCam.proj.copy(c.projectionMatrix);
    return true;
  }

  /** Render the scene, run the stages, blit to `finalTarget` (null = screen). */
  render(finalTarget: RenderTarget | null = null): void {
    this.syncSize();
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAlpha = r.getClearAlpha();

    // Overlay objects (userData.compOverlay: gizmos, helpers, debug lines) skip the
    // graph entirely: hidden for the scene and position passes, drawn plainly on
    // top after the final blit. Add them at the scene root.
    const overlays = collectOverlays(this.scene);
    for (const o of overlays) o.visible = false;

    r.setClearAlpha(this.opts.clearAlpha);
    r.setRenderTarget(this.sceneTarget);
    r.render(this.scene, this.camera);

    const moved = this.usesPosition && this.cameraMoved();
    const needPosition =
      this.usesPosition && (this.opts.positionPass === 'always' || this.positionDirty || moved || !this.positionValid);
    if (needPosition) {
      this.positionDirty = false;
      this.positionValid = true;
      // Position pass: every mesh writes its world position, background stays 0
      // with alpha 0. Objects the pass must not stamp (shadow catchers, helpers,
      // and transparent decals, which would stamp their whole quad) are hidden
      // for this pass only. See skipsPosition.
      const prevOverride = this.scene.overrideMaterial;
      const hidden: { visible: boolean }[] = [];
      this.scene.traverse((o) => {
        if (o.visible && skipsPosition(o)) {
          o.visible = false;
          hidden.push(o);
        }
      });
      this.scene.overrideMaterial = this.positionMaterial;
      r.setClearAlpha(0);
      r.setRenderTarget(this.positionTarget);
      r.render(this.scene, this.camera);
      this.scene.overrideMaterial = prevOverride;
      for (const o of hidden) o.visible = true;
    }

    for (const st of this.stageQuads) {
      r.setRenderTarget(st.target);
      st.quad.render(r);
    }

    r.setRenderTarget(finalTarget);
    this.outQuad.render(r);

    drawOverlays(r, this.scene, this.camera, overlays);

    r.setRenderTarget(prevTarget);
    r.setClearAlpha(prevAlpha);
  }

  dispose(): void {
    if (this.savedOutput) {
      this.renderer.toneMapping = this.savedOutput.toneMapping;
      this.renderer.outputColorSpace = this.savedOutput.colorSpace;
    }
    this.sceneTarget.dispose();
    this.positionTarget.dispose();
    this.positionMaterial.dispose();
    for (const st of this.stageQuads) {
      st.target.dispose();
      (st.quad.material as MeshBasicNodeMaterial).dispose();
    }
    (this.outQuad.material as MeshBasicNodeMaterial).dispose();
  }
}
