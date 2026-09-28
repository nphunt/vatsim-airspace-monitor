import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./ui/theme/eram.css";
import { App } from "./App";
import { AccessGate } from "./auth/AccessGate";
import { requiredPage } from "./auth/access";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

// The development site (/dev/) only opens for CIDs the admins allow; the live site is open.
const page = requiredPage();

createRoot(root).render(
  <StrictMode>
    {page ? (
      <AccessGate page={page}>
        <App />
      </AccessGate>
    ) : (
      <App />
    )}
  </StrictMode>,
);
