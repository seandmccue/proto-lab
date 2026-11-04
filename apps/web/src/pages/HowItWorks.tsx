import { Navigate } from 'react-router-dom';
import { useModelInfo } from '../components/Header.tsx';
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
    detail: 'Spark searches a 100-plus-part component library (frames, gears, shafts, hinges, sliders, cranks, servos, gearmotors, springs, wings, propellers, grippers…) and designs missing parts itself from profiles, extrusions and revolves. It then mounts parts at real connectors with structured assembly operations; every op is validated before it runs. You watch it happen: the parts bin fills with every part Muse finds or designs, the first assembly drops into the 3D view one part at a time, and each test result lands as a pass/fail toast while the iteration ribbon grows a chip per version.',
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

/** The "How it works" content, rendered as a section of the home page (the old /how-it-works route redirects here). */
export function HowItWorksSection() {
  const model = useModelInfo();
  return (
    <section id="how-it-works" className="lab-section lab-how" aria-labelledby="lab-how-title">
      <div className="lab-section-heading">
        <div>
          <span className="lab-label">Inside the lab</span>
          <h2 id="lab-how-title">How it works</h2>
          <p>From an idea to a tested 3D prototype. Meta’s Muse models make design decisions through ProtoLab’s tools, and the Rapier physics simulator measures how each design moves.</p>
        </div>
        <a href="#parts" className="btn-secondary">Explore the parts <span aria-hidden="true">↓</span></a>
      </div>

      <div aria-labelledby="pipeline-models">
        <h3 id="pipeline-models" className="lab-label pipeline-section-label">The Meta Muse team</h3>
        <div className="pipeline-models">
          <article className="pipeline-model pipeline-spark">
            <p className="lab-label">01 / Default inventor</p>
            <h3>Meta Muse Spark 1.3</h3>
            <p>Leads the build. It turns the brief into design choices, calls tools to assemble parts, and revises from test measurements.</p>
          </article>
          <article className="pipeline-model pipeline-wonder">
            <p className="lab-label">02 / Optional specialist</p>
            <h3>Meta Muse Wonder 1.0</h3>
            <p>Steps in after three consecutive failed tests by default. It reviews the evidence and attempts a targeted revision before Spark resumes. If Wonder is unavailable, the log says so and Spark continues — nothing is swapped silently.</p>
          </article>
        </div>
        <p className="pipeline-note">
          ProtoLab calls these models through the Meta Model API. Without an API key, a deterministic planner runs the build.
        </p>
        {model && <p className="pipeline-status">
          <strong>This lab</strong> {model.label}{model.live ? ' · Tool-call check passed' : ''}
        </p>}
      </div>

      <div className="pipeline-flow" aria-labelledby="pipeline-steps">
        <h3 id="pipeline-steps">The invention pipeline</h3>
        <ol className="pipeline-steps">
          {steps.map((step, i) => (
            <li key={step.title}>
              <span className="pipeline-number lab-label" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <p className="lab-label pipeline-step-label">{step.label}</p>
                <h4>{step.title}</h4>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <p className="pipeline-footer">Simulation measures the virtual prototype. Physical buildability and safety require separate validation.</p>
    </section>
  );
}

export default function HowItWorks() {
  return <Navigate to="/#how-it-works" replace />;
}
