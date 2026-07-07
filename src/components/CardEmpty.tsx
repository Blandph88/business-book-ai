// A guiding empty-state for a card whose data category has no records YET (e.g. no opportunities on a
// fresh import). Keeps the card's title/context shell and replaces the empty chart / interactive filters
// with a one-line prompt + an optional CTA — so a sparse-but-real book reads as "here's your next step",
// not a broken zero-height graph. Gate on the card's OWN dataset (never a category-level assumption).
import "./CardEmpty.css";

export function CardEmpty({ message, ctaLabel, onCta }: { message: string; ctaLabel?: string; onCta?: () => void }) {
  return (
    <div className="card-empty">
      <p className="card-empty-msg">{message}</p>
      {ctaLabel && onCta && (
        <button type="button" className="card-empty-cta" onClick={onCta}>{ctaLabel}</button>
      )}
    </div>
  );
}
