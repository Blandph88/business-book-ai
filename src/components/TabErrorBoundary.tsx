import { Component, type ReactNode } from "react";

// Last-resort guard around each view panel. Without one, a single render crash unmounts React's
// whole subtree and the app looks DEAD — a blank panel with no message (how F6, the vault
// type-mangle bug, presented). Catching here keeps the nav alive and shows what broke, so a
// data-shape bug becomes a visible, reportable card instead of a silent blank screen.
type Props = { area: string; children: ReactNode };
type State = { error: Error | null };

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Console keeps the full stack for a bug report; the card shows the message.
    console.error(`[Business Book] Render crash in ${this.props.area}:`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="tab-error-card" role="alert">
          <h2>This view hit a problem</h2>
          <p>
            The rest of the app is fine — your data is safe. Try again below, or switch tab.
            If it keeps happening, flag it with the details underneath.
          </p>
          <pre className="tab-error-detail">{String(this.state.error.message || this.state.error)}</pre>
          <button type="button" className="tab-error-retry" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
