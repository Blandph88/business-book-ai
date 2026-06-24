// A simple stand-in panel used by every tab during the scaffold phase.
// Each real tab replaces this with its own content in a later increment.
type PlaceholderProps = {
  title: string;
  note: string;
};

export function Placeholder({ title, note }: PlaceholderProps) {
  return (
    <section className="placeholder">
      <h2>{title}</h2>
      <p>{note}</p>
      <p className="placeholder-tag">Coming in a later increment.</p>
    </section>
  );
}
