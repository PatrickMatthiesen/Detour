// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StrictMode } from "react";
import { AddPlaceModal } from "./PlaceModals";

afterEach(cleanup);
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

describe("AddPlaceModal", () => {
  it("uses a native dialog, locks page scrolling, and restores focus on close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Add";
    document.body.append(trigger);
    trigger.focus();
    const view = render(<StrictMode><AddPlaceModal onClose={() => view.unmount()} onAdd={() => {}} /></StrictMode>);
    const dialog = screen.getByRole("dialog");

    expect(dialog.tagName).toBe("DIALOG");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));

    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(document.body.style.overflow).toBe("");
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(trigger);
  });
});
