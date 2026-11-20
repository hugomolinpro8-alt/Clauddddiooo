import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App";
import { AppProvider } from "./lib/store";
import { UIProvider } from "./ui-state";

class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Un écran a planté.</h1>
          <p>Tes données sont enregistrées. Recharge la page ; si ça recommence, retourne à l'accueil.</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.7 }}>{this.state.err.message}</pre>
          <button onClick={() => { location.hash = "accueil"; this.setState({ err: null }); }} style={{ marginTop: 12, padding: "8px 14px", border: "1px solid", borderRadius: 8 }}>Retour à l'accueil</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary>
      <AppProvider>
        <UIProvider>
          <App />
        </UIProvider>
      </AppProvider>
    </Boundary>
  </React.StrictMode>,
);
