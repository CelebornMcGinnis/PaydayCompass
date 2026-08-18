import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Browsers change a focused <input type="number">'s value on mouse-wheel
// scroll - a well-known footgun where scrolling the page while the
// cursor happens to be over a focused amount field silently edits it.
// One global listener covers every number input in the app (current and
// future) rather than an onWheel handler scattered across every form.
document.addEventListener(
  "wheel",
  () => {
    if (document.activeElement && document.activeElement.tagName === "INPUT" && document.activeElement.type === "number") {
      document.activeElement.blur();
    }
  },
  { passive: true }
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
