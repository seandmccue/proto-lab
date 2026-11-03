import { useEffect, useState } from 'react';
import type { Assembly } from '@protolab/schema';
import { api } from '../api.ts';
import IsoPreview from './IsoPreview.tsx';
import './PartInventory.css';

const samples = [
  { id: 'chassis-quad-160', category: 'Structure', name: 'Chassis', use: 'Gives a walking prototype a frame for mounting its legs.' },
  { id: 'hinge-30', category: 'Joints', name: 'Hinge', use: 'Lets two connected parts pivot around a shared axis.' },
  { id: 'servo-mg996r', category: 'Motors', name: 'Servo', use: 'Drives a joint to a chosen angle within a torque limit.' },
  { id: 'gear-40t-m1', category: 'Transmission', name: 'Spur gear', use: 'Gives rotating mechanisms a toothed wheel to build around.' },
  { id: 'wing-butterfly-120', category: 'Wings', name: 'Butterfly wing', use: 'Provides a shaped panel with a hinge at its root.' },
  { id: 'gripper-finger-50', category: 'Grippers', name: 'Gripper finger', use: 'Adds a padded contact surface for holding a payload.' },
];

function InventoryCard({ sample }: { sample: typeof samples[number] }) {
  const [assembly, setAssembly] = useState<Assembly>();
  useEffect(() => {
    let active = true;
    api.part(sample.id).then(({ part }) => {
      if (!active) return;
      setAssembly({
        schemaVersion: 2,
        parts: [part],
        instances: [{ id: 'part', partId: part.id, label: part.name, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, anchored: false, free: false }],
        joints: [],
        controller: { drives: [] },
        family: 'custom',
        familyParams: {},
        familyConfig: {},
      });
    }).catch(() => {});
    return () => { active = false; };
  }, [sample.id]);

  return (
    <li className="part-inventory-card">
      <div className="part-inventory-illustration" aria-hidden="true">
        <span className="lab-label">{sample.category}</span>
        {assembly ? <IsoPreview assembly={assembly} blueprint /> : <span className="part-inventory-marker">+</span>}
      </div>
      <div className="part-inventory-detail">
        <h3>{assembly?.parts[0].name ?? sample.name}</h3>
        <p>{sample.use}</p>
      </div>
    </li>
  );
}

export default function PartInventory() {
  return (
    <section id="parts" className="lab-section part-inventory" aria-labelledby="part-inventory-title">
      <div className="lab-section-heading">
        <div>
          <span className="lab-label part-inventory-kicker">Inside the parts library</span>
          <h2 id="part-inventory-title">Part inventory</h2>
          <p>These are some of the parts Muse uses to prototype. It picks components with compatible mounts and can design a custom part when the library lacks the shape it needs.</p>
        </div>
      </div>
      <ul className="part-inventory-grid">
        {samples.map((sample) => <InventoryCard key={sample.id} sample={sample} />)}
      </ul>
    </section>
  );
}
