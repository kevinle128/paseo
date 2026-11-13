import { afterEach, describe, expect, it } from "vitest";
import {
  COMPOSER_FOCUS_REQUEST_TTL_MS,
  cancelComposerFocusRequest,
  requestComposerFocus,
  takeComposerFocusRequest,
} from "./composer-focus-request";

describe("composer focus request", () => {
  afterEach(() => {
    cancelComposerFocusRequest();
  });

  it("is taken once", () => {
    requestComposerFocus(1000);
    expect(takeComposerFocusRequest(1001)).toBe(true);
    expect(takeComposerFocusRequest(1002)).toBe(false);
  });

  it("is not taken when nothing was requested", () => {
    expect(takeComposerFocusRequest(1000)).toBe(false);
  });

  it("expires when no composer takes it in time", () => {
    requestComposerFocus(1000);
    expect(takeComposerFocusRequest(1000 + COMPOSER_FOCUS_REQUEST_TTL_MS)).toBe(false);
  });

  it("is dropped by a cancel", () => {
    requestComposerFocus(1000);
    cancelComposerFocusRequest();
    expect(takeComposerFocusRequest(1001)).toBe(false);
  });
});
