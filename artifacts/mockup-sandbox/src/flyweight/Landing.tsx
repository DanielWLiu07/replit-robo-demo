/** The hook. Unchanged from the single-page build, only the CTAs are routes now. */
export function Landing() {
  return (
    <>
      <section className="landing-stage">
        <h1 className="landing-title" data-text="FLYWEIGHT">FLYWEIGHT</h1>
        <div className="landing-entry">
          <p className="mono">REAL FLY CIRCUITS. UNREASONABLY COMPETITIVE ROBOTS.</p>
          <a href="#/select" className="button primary">
            Enter the arena <span>↗</span>
          </a>
        </div>
      </section>

      <div className="ticker mono">
        <span>01 / BUILD A BOT</span>
        <span>02 / WIRE ITS BRAIN</span>
        <span>03 / LET INSTINCT FIGHT</span>
        <span>60 Hz · SPIKING NEURAL NETWORKS</span>
      </div>

      <section id="science" className="science-section">
        <div className="section-label">
          <span>03 / UNDER THE CHASSIS</span>
          <span>INSPIRED BY A REAL NERVOUS SYSTEM</span>
        </div>
        <div className="science-grid">
          <h2>
            Nature already
            <br />
            wrote the reflex.
          </h2>
          <div>
            <p className="science-lede">
              A fruit fly doesn’t stop to think.
              <br />
              Neither does your robot.
            </p>
            <p>
              FLYWEIGHT models a small selection of studied <i>Drosophila</i> visual and
              descending circuits with leaky integrate-and-fire neurons. Pursuit, steering,
              arousal and escape become swappable pieces of a robot’s brain.
            </p>
            <p>
              The battle behaviours are an interpretation. This is a circuit-inspired model,
              not a simulation of the entire fly connectome.
            </p>
            <div className="science-facts">
              <div>
                <strong>06</strong>
                <span>NEURAL MODULES</span>
              </div>
              <div>
                <strong>60</strong>
                <span>TICKS / SECOND</span>
              </div>
              <div>
                <strong>01</strong>
                <span>SPIKE TO REACT</span>
              </div>
            </div>
            <a href="#/select" className="button primary science-cta">
              Choose a fighter <span>↗</span>
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
