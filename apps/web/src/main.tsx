import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App.js";
import { AssistantPanel } from "./components/assistant/AssistantPanel.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { ToastProvider } from "./components/ui/toast.js";
import { AssistantProvider } from "./providers/AssistantProvider.js";
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
              {/* Assistant conversation lives above the router so it survives
                  navigating anywhere in the admin area; the panel is rendered
                  once here (launchers in each shell open it). */}
              <AssistantProvider>
                <App />
                <AssistantPanel />
              </AssistantProvider>
            </AuthProvider>
          </ToastProvider>
        </TooltipProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
