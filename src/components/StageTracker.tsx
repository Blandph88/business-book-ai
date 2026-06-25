// The networking funnel as a compact flag row: Messaged → Responded → Agreed to meet → Met.
// Green ✓ for a stage that's been reached, grey ✗ for one not yet reached. Shown on the
// drill-down contact list and at the top of the Contact + Meeting forms (under the name/org).
import "./StageTracker.css";

type Props = {
  messaged: boolean;
  responded: boolean;
  agreed: boolean; // agreed to meet
  met: boolean;
  className?: string;
};

export function StageTracker({ messaged, responded, agreed, met, className }: Props) {
  const stages: [string, boolean][] = [
    ["Messaged", messaged],
    ["Responded", responded],
    ["Agreed to meet", agreed],
    ["Met", met],
  ];
  return (
    <div className={`stage-track${className ? ` ${className}` : ""}`}>
      {stages.map(([label, on]) => (
        <span key={label} className={`stage-flag${on ? " stage-flag--on" : " stage-flag--off"}`}>
          {on ? "✓" : "✗"} {label}
        </span>
      ))}
    </div>
  );
}
