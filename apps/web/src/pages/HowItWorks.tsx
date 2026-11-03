import { Link } from 'react-router-dom';
import Header, { useModelInfo } from '../components/Header.tsx';
import './HowItWorks.css';

const steps = [
  {
    title: 'Describe an idea',
    label: 'Your brief',
    detail: 'Tell ProtoLab what you want to build and how it should move: a butterfly, a Ferris wheel, a catapult, a walking robot, a crane. Muse writes an engineering plan: the recognisable features, the motions, the sub-assemblies, measurable success criteria, and what the physics cannot verify.',
  },
  {
    title: 'Pick parts and assemble',
    label: 'Muse Spark + parts catalog',
    detail: 'Spark searches a 100-part component library (frames, gears, shafts, hinges, sliders, cranks, servos, gearmotors, springs, wings, propellers, grippers…) and designs missing parts itself from profiles, extrusions and revolves. It then mounts parts at real connectors with structured assembly operations; every op is validated before it runs, and the 3D view shows the assembly taking shape before the first simulation.',
  },
  {
    title: 'Run the physics tests',
    label: 'Rapier simulator',
    detail: 'Rapier simulates the mechanism and measures what matters for that invention: stroke and flap rate for wings, revolutions and gondola clearance for a wheel, landing distance for a catapult, payload retention for a claw, distance and tilt for a walker. Motor demand is checked against each part’s rating.',
  },
  {
    title: 'Revise and retest',
    label: 'Muse Spark + Muse Wonder',
    detail: 'Spark reads the measurements and changes drives, geometry or parts before testing again. After repeated failures, Muse Wonder reviews the same history, diagnoses the mechanical cause, applies a targeted fix, and hands control back to Spark.',
  },
  {
    title: 'Explore the result in 3D',
    label: 'Invention workbench',
    detail: 'Replay the motion, inspect the bill of materials, and trace what changed between versions. The workspace shows which tests passed and which still fell short.',
  },
  {
    title: 'Publish or remix',
    label: 'ProtoLab gallery',
    detail: 'Publish your invention to the gallery when you’re ready, or open a shared design and remix it with a new brief.',
  },
];

export default function HowItWorks() {
  const model = useModelInfo();

  return (
    <div className="min-h-full">
      <Header />
      <main className="home-shell pipeline-page">
        <header className="pipeline-intro">
          <p className="lab-label lab-kicker"><span aria-hidden="true">✦</span> Inside the lab</p>
          <h1>How it works<span aria-hidden="true">.</span></h1>
          <p>From an idea to a tested 3D prototype. Meta’s Muse models make design decisions through ProtoLab’s tools, and the Rapier physics simulator measures how each design moves.</p>
        </header>

        <section aria-labelledby="pipeline-models">
          <h2 id="pipeline-models" className="lab-label pipeline-section-label">The Meta Muse team</h2>
          <div className="pipeline-models">
            <article className="pipeline-model pipeline-spark">
              <p className="lab-label">01 / Default inventor</p>
              <h3>Meta Muse Spark 1.3</h3>
              <p>Leads the build. It turns the brief into design choices, calls tools to assemble parts, and revises from test measurements.</p>
            </article>
            <article className="pipeline-model pipeline-wonder">
              <p className="lab-label">02 / Optional specialist</p>
              <h3>Meta Muse Wonder 1.0</h3>
              <p>Steps in after three consecutive failed walk tests by default. It reviews the evidence and attempts a targeted revision before Spark resumes.</p>
            </article>
          </div>
          <p className="pipeline-note">
            ProtoLab calls these models through the Meta Model API. Without an API key, a deterministic planner runs the build.
          </p>
          {model && <p className="pipeline-status">
            <strong>This lab</strong> {model.label}{model.live ? ' · Tool-call check passed' : ''}
          </p>}
        </section>

        <section className="pipeline-flow" aria-labelledby="pipeline-steps">
          <h2 id="pipeline-steps">The invention pipeline</h2>
          <ol className="pipeline-steps">
            {steps.map((step, i) => (
              <li key={step.title}>
                <span className="pipeline-number lab-label" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <p className="lab-label pipeline-step-label">{step.label}</p>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <footer className="pipeline-footer">
          <p>Simulation measures the virtual prototype. Physical buildability and safety require separate validation.</p>
          <div>
            <Link className="btn-primary" to="/">Start an invention <span aria-hidden="true">↗</span></Link>
            <Link className="btn-secondary" to="/gallery">Explore the gallery</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
