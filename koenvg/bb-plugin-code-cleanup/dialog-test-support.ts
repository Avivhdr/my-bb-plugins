import { beforeAll } from "vitest";

// jsdom does not implement native modality. Browser checks must verify focus containment/inertness.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
