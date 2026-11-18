import { stepPenaltyCents } from "@/lib/penalty";

export const STEP_BLOCK = 500;
export const DEFAULT_TARGET_STEPS = 2000;
export const MAX_TARGET_STEPS = 1_000_000;
export const MAX_STEP_EXEMPTION_NOTE_LENGTH = 200;

export function parseTargetSteps(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > MAX_TARGET_STEPS) {
    return null;
  }
  return value;
}

/** A step day total an owner can set. Zero is allowed. */
export function parseRecordedSteps(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0 || value > MAX_TARGET_STEPS) {
    return null;
  }
  return value;
}

/** 500-step blocks below target. Partial blocks round up. */
export function stepShortfallUnits(steps: number, target: number): number {
  if (steps >= target) return 0;
  return Math.ceil((target - steps) / STEP_BLOCK);
}

export function stepExemptionNote(note: string | null | undefined): string {
  const text = note?.trim();
  return text ? `Exempt · ${text}` : "Exempt";
}

export type StepDayAssessment = {
  steps: number | null;
  exempt: boolean;
  below: boolean;
  cents: number;
};

/** A one-day exemption drops that step day's target and charge. */
export function assessStepDay(input: {
  steps: number | null | undefined;
  targetSteps: number | undefined;
  penaltyAmount?: string | number;
  exempt: boolean;
}): StepDayAssessment {
  const steps = input.steps ?? null;
  if (input.exempt) {
    return { steps, exempt: true, below: false, cents: 0 };
  }
  if (steps === null || input.targetSteps === undefined) {
    return { steps, exempt: false, below: false, cents: 0 };
  }
  const units = stepShortfallUnits(steps, input.targetSteps);
  const cents =
    units > 0 && input.penaltyAmount !== undefined
      ? stepPenaltyCents(units, input.penaltyAmount)
      : 0;
  return { steps, exempt: false, below: units > 0, cents };
}
