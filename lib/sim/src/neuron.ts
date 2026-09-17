/**
 * Leaky integrate-and-fire neuron.
 *
 * Current leaks away each tick, so a cell only fires when input arrives faster than
 * it forgets. That single property is why the Giant Fiber is a good collision reflex:
 * it ignores slow approach and fires on rapid looming, with fixed latency and no
 * deliberation. Same reason Pomme's e-stop lives on the MCU rather than behind the model.
 */
export class LifNeuron {
  /** membrane potential, arbitrary units above rest */
  v = 0;
  private refractoryLeft = 0;

  constructor(
    private readonly threshold: number,
    private readonly leak: number,
    private readonly refractoryTicks: number,
  ) {}

  /** Returns true on the tick the cell fires. */
  step(input: number): boolean {
    if (this.refractoryLeft > 0) {
      this.refractoryLeft--;
      this.v = 0;
      return false;
    }
    this.v += input - this.leak * this.v;
    if (this.v < 0) this.v = 0;
    if (this.v >= this.threshold) {
      this.v = 0;
      this.refractoryLeft = this.refractoryTicks;
      return true;
    }
    return false;
  }

  /** 0..1, for the membrane-potential trace in the UI. */
  get normalized(): number {
    return Math.max(0, Math.min(1, this.v / this.threshold));
  }
}
