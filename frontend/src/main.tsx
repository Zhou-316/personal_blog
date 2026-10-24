import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { GlassProvider } from "./hooks/useGlassCapabilities";
import { GlassExperience } from "./components/glass/GlassExperience";
import "./styles.css";
import "./styles/glass.css";
import "./styles/media.css";
import "./styles/comments.css";
import "./styles/materials.css";
import "./styles/reader.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GlassProvider><App /><GlassExperience /></GlassProvider>
  </React.StrictMode>
);
