import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "../ui/theme/eram.css";
import { AccessGate } from "../auth/AccessGate";
import { AdminPage } from "./AdminPage";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from admin/index.html");

createRoot(root).render(
  <StrictMode>
    <AccessGate page="admin">
      <AdminPage />
    </AccessGate>
  </StrictMode>,
);
