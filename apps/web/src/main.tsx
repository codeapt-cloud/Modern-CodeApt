import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { ToastProvider } from "./components/ui/toast.js";
import { AuthProvider } from "./providers/AuthProvider.js";
import { ThemeProvider } from "./providers/ThemeProvider.js";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <TooltipProvider delayDuration={200}>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </TooltipProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
