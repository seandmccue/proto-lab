import crabProof from './crabProof.json';
import './CrabProofPanel.css';

export const crabProofPair = { beforeId: crabProof.beforeId, afterId: crabProof.afterId };

const runs = [
  { name: 'New stance only', setup: 'V4 leg positions · V3 step timing', result: crabProof.stance },
  { name: 'New timing only', setup: 'V3 leg positions · V4 step timing', result: crabProof.timing },
];

export default function CrabProofPanel() {
  const { test } = crabProof;
  return (
    <details className="crab-proof">
      <summary>
        <span>Prove the fix</span>
        <span>What made the crab pass?</span>
      </summary>
      <div className="crab-proof-body">
        <p>We reran v3 twice, changing one thing each time. Both runs used the same {test.duration_s}-second test with a <strong>{test.maxTilt_deg}° tilt limit</strong> and a <strong>{test.minDistance_m * 100} cm distance target</strong>.</p>
        <div className="crab-proof-runs">
          {runs.map(({ name, setup, result }) => (
            <div className="crab-proof-run" key={name}>
              <div className="crab-proof-run-title">
                <h3>{name}</h3>
                <span className="crab-proof-verdict" data-passed={result.passed}>{result.passed ? 'Pass' : 'Fail'}</span>
              </div>
              <p>{setup}</p>
              <dl>
                <div><dt>Peak tilt</dt><dd>{result.maxTilt_deg.toFixed(2)}°</dd></div>
                <div><dt>Distance</dt><dd>{(result.distance_m * 100).toFixed(1)} cm</dd></div>
              </dl>
            </div>
          ))}
        </div>
        <p><strong>The new leg stance was enough to pass.</strong> Muse’s saved v4 uses both changes. These are separate controlled runs.</p>
      </div>
    </details>
  );
}
