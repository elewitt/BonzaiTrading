// Drag-to-dismiss for the mobile bottom-sheet modal (styles.css's
// @media(max-width:768px) .modal-box rules — see Phase 1's CSS-only
// bottom-sheet transformation). No <Modal> wrapper component exists (that
// migration was deliberately skipped, see App.jsx's own modal call sites),
// so this attaches globally via event delegation instead of per-component
// wiring — works at all ~19 call sites automatically, nothing to miss.
//
// On a successful swipe, it dispatches a real "click" event AT the
// .modal-overlay element itself (never a child) — every call site in this
// codebase closes on `onClick={(e) => e.target === e.currentTarget && onClose()}`,
// so a click whose target IS the overlay reuses each call site's own real
// close handler (including any busy-state guards) rather than reaching into
// React state from outside it.
//
// Caveat: only verified via static (non-interactive) rendering this
// session — there's no live browser/device here to test touch gestures.
// Worth a real-device check after deploy.

const DISMISS_DISTANCE = 120; // px dragged down before a release counts as "dismiss"
const DISMISS_VELOCITY = 0.5; // px/ms — a fast flick dismisses even under the distance threshold
const HANDLE_ZONE = 44; // px from the top of the sheet a drag must start in (matches the visible drag-handle dot), so it never hijacks scrolling/tapping inside the sheet's real content

let drag = null;

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function onPointerDown(e) {
  if (e.pointerType === "mouse" || !isMobile()) return;
  const box = e.target.closest(".modal-box");
  if (!box) return;
  const overlay = box.closest(".modal-overlay");
  if (!overlay) return;
  const top = box.getBoundingClientRect().top;
  if (e.clientY - top > HANDLE_ZONE) return;
  drag = { box, overlay, startY: e.clientY, startT: performance.now() };
  box.style.transition = "none";
  box.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e) {
  if (!drag) return;
  e.preventDefault();
  const dy = Math.max(0, e.clientY - drag.startY);
  drag.box.style.transform = `translateY(${dy}px)`;
}

function onPointerUp(e) {
  if (!drag) return;
  const { box, overlay, startY, startT } = drag;
  const dy = Math.max(0, e.clientY - startY);
  const velocity = dy / Math.max(1, performance.now() - startT);
  box.style.transition = "transform .18s ease-out";
  if (dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
    box.style.transform = "translateY(100%)";
    setTimeout(() => overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })), 180);
  } else {
    box.style.transform = "";
  }
  drag = null;
}

function onPointerCancel() {
  if (!drag) return;
  drag.box.style.transition = "transform .18s ease-out";
  drag.box.style.transform = "";
  drag = null;
}

document.addEventListener("pointerdown", onPointerDown, { passive: true });
document.addEventListener("pointermove", onPointerMove, { passive: false });
document.addEventListener("pointerup", onPointerUp, { passive: true });
document.addEventListener("pointercancel", onPointerCancel, { passive: true });
