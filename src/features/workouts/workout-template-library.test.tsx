// @vitest-environment happy-dom
import "fake-indexeddb/auto";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkoutTemplateLibrary } from "./workout-template-library";
import {
  createExerciseRepository,
  createLiftLogDatabase,
  createWorkoutSessionRepository,
  createWorkoutTemplateRepository,
  type LiftLogDatabase,
  type WorkoutTemplate,
} from "@/db";
import { getMessages } from "@/i18n";

const messages = getMessages().workouts;
let root: Root;
let container: HTMLDivElement;
let database: LiftLogDatabase;

/** Finds an actionable button by its visible or explicitly accessible name. */
const button = (name: string): HTMLButtonElement => {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      !element.closest('[aria-hidden="true"]') &&
      (element.getAttribute("aria-label") ?? element.textContent?.trim()) === name,
  );
  if (!match) throw new Error(`Button not found: ${name}`);
  return match;
};

/** Clicks a control and flushes the resulting React updates. */
const click = async (name: string) => {
  await act(async () => {
    button(name).click();
  });
};

/** Waits for repository work and flushes queued React updates before checking the screen. */
const waitForScreen = async (assertion: () => void) => {
  await vi.waitFor(async () => {
    await act(async () => {});
    assertion();
  });
};

/** Changes a controlled input through the same native input event used by typing. */
const fillName = async (value: string) => {
  const input = [...document.querySelectorAll("label")]
    .find((label) => label.textContent?.trim() === messages.nameLabel)
    ?.querySelector("input");
  if (!input) throw new Error("Plan name input not found");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** Creates a realistic library backed by an isolated IndexedDB database. */
const setupLibrary = async () => {
  const exercises = createExerciseRepository({ database });
  const plans = createWorkoutTemplateRepository({ database });
  const sessions = createWorkoutSessionRepository({ database });
  const squat = await exercises.create({
    name: "Squat",
    muscleGroups: ["quadriceps"],
    equipment: "Barbell",
  });
  const plank = await exercises.create({
    name: "Plank",
    muscleGroups: ["core"],
    trackingMode: "timed",
  });
  const plan = await plans.create({
    name: "Full body",
    exercises: [
      {
        exerciseId: squat.id,
        order: 0,
        targetSets: 3,
        restSeconds: 120,
        notes: "Pause at the bottom",
      },
      { exerciseId: plank.id, order: 1, targetSets: 2, restSeconds: 60, notes: null },
    ],
  });
  const onSessionStarted = vi.fn();
  /** Re-renders the library as the app switches between screens. */
  const render = async (isActive = true) => {
    await act(async () => {
      root.render(
        <WorkoutTemplateLibrary
          messages={messages}
          exerciseStore={exercises}
          templateRepository={plans}
          sessionRepository={sessions}
          onSessionStarted={onSessionStarted}
          isActive={isActive}
        />,
      );
    });
  };
  await render();
  await waitForScreen(() => expect(button("Add plan").disabled).toBe(false));
  return { exercises, plans, sessions, plan, squat, plank, onSessionStarted, render };
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  database = createLiftLogDatabase(`lift-log-plan-ui-${crypto.randomUUID()}`);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  await database.delete();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("plan library interactions", () => {
  it("saves the displayed exercise order without clearing notes", async () => {
    const { plans, plan, squat, plank } = await setupLibrary();
    await click("View plan: Full body");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Pause at the bottom");
    await click("Edit plan");
    await fillName("Full body A");
    await click("Move Plank earlier");
    await click("Save changes");
    await waitForScreen(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    const saved = await plans.getById(plan.id);
    expect(saved?.name).toBe("Full body A");
    expect(saved?.exercises.map((entry) => entry.exerciseId)).toEqual([plank.id, squat.id]);
    expect(saved?.exercises[1].notes).toBe("Pause at the bottom");
  });

  it("cancels exercise selection without changing the draft and returns focus to Add exercises", async () => {
    const { plans, plan } = await setupLibrary();
    await click("Actions for plan: Full body");
    await click("Edit plan");
    await click("Add exercises");
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      checkbox?.click();
    });
    await click("Cancel");
    await waitForScreen(() => expect(document.activeElement).toBe(button("Add exercises")));
    await click("Save changes");
    await waitForScreen(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect((await plans.getById(plan.id))?.exercises).toEqual(plan.exercises);
  });

  it("protects a changed draft on Escape and keeps it while another app view is active", async () => {
    const { render, plans, plan } = await setupLibrary();
    await click("View plan: Full body");
    await click("Edit plan");
    await fillName("Full body A");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      messages.discardTitle,
    );
    await click("Keep editing");
    await render(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await render(true);
    await click("Save changes");
    await waitForScreen(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect((await plans.getById(plan.id))?.name).toBe("Full body A");
  });

  it("guards repeated submissions and retains a failed save for retry", async () => {
    const { plans, plan } = await setupLibrary();
    await click("Actions for plan: Full body");
    await click("Duplicate plan");
    let rejectSave: (reason: Error) => void = () => {};
    const save = vi.spyOn(plans, "create").mockImplementationOnce(
      () =>
        new Promise<WorkoutTemplate>((_, reject) => {
          rejectSave = reject;
        }),
    );
    const form = document.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(button("Saving…").disabled).toBe(true);
    await act(async () => {
      rejectSave(new Error("Storage full"));
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(messages.saveError);
    await click("Save plan");
    await waitForScreen(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(await plans.list()).toHaveLength(2);
    expect((await plans.getById(plan.id))?.name).toBe("Full body");
  });

  it("keeps a failed delete open and returns focus to a surviving button after retry", async () => {
    const { plans } = await setupLibrary();
    vi.spyOn(plans, "deleteById").mockRejectedValueOnce(new Error("Storage unavailable"));
    await click("Actions for plan: Full body");
    await click("Delete plan");
    await click("Delete plan");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(messages.deleteError);
    await click("Delete plan");
    await waitForScreen(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
    await waitForScreen(() => expect(document.activeElement).toBe(button("Add plan")));
    expect(await plans.list()).toHaveLength(0);
  });

  it("shows Resume instead of creating a second active workout", async () => {
    const { sessions, plan, render, onSessionStarted } = await setupLibrary();
    await sessions.startFromTemplate(plan.id);
    await render(false);
    await render(true);
    await waitForScreen(() => expect(button("Resume workout")).toBeDefined());
    expect(button("Start workout plan: Full body").disabled).toBe(true);
    await click("Resume workout");
    expect(onSessionStarted).toHaveBeenCalledOnce();
  });
});
