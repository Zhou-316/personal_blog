import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { GlassProvider } from "./hooks/useGlassCapabilities";
import "./styles.css";
import "./styles/glass.css";
import "./styles/media.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GlassProvider><App /></GlassProvider>
  </React.StrictMode>
);
