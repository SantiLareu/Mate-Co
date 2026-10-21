import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import "./styles/admin-lab.css";

// L10: las rutas de laboratorio se cargan perezosas; el enrutado por
// pathname se preserva tal cual (sin editor ni importador afectados).
// /admin es la entrada administrativa oficial para producción (siempre
// publicada detrás de Cloudflare Access); /admin-lab queda como alias de
// desarrollo. Una sola implementación del panel: AdminLab.
const AdminLab = lazy(() => import("./admin-lab/AdminLab"));
const VectorLab = lazy(() => import("./vector-lab/VectorLab"));
const ProductionLab = lazy(() => import("./production-lab/ProductionLab"));

const routePath = window.location.pathname.replace(/\/$/, "");
const isVectorLab = routePath === "/vector-lab";
const isProductionLab = routePath === "/production-lab";
const isAdmin = routePath === "/admin" || routePath === "/admin-lab";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<main className="admin-lab" aria-busy="true" />}>
      {isAdmin ? (
        <AdminLab />
      ) : isVectorLab ? (
        <VectorLab />
      ) : isProductionLab ? (
        <ProductionLab />
      ) : (
        <App />
      )}
    </Suspense>
  </React.StrictMode>,
);
