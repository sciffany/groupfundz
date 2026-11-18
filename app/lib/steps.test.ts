import { describe, expect, test } from "vitest";
import { assessStepDay, stepExemptionNote } from "@/lib/steps";

const TARGET = 2000;
const PENALTY = "1";

describe("assessStepDay", () => {
  test("charges each 500-step block below the covering target", () => {
    expect(
      assessStepDay({
        steps: 1200,
        targetSteps: TARGET,
        penaltyAmount: PENALTY,
        exempt: false,
      }),
    ).toEqual({
      steps: 1200,
      exempt: false,
      below: true,
      cents: 200,
    });
  });

  test("an exempt day owes nothing when steps are below the target", () => {
    expect(
      assessStepDay({
        steps: 0,
        targetSteps: TARGET,
        penaltyAmount: PENALTY,
        exempt: true,
      }),
    ).toEqual({
      steps: 0,
      exempt: true,
      below: false,
      cents: 0,
    });
  });

  test("an exempt day with no recorded steps owes nothing", () => {
    expect(
      assessStepDay({
        steps: undefined,
        targetSteps: TARGET,
        penaltyAmount: PENALTY,
        exempt: true,
      }),
    ).toEqual({
      steps: null,
      exempt: true,
      below: false,
      cents: 0,
    });
  });

  test("the next day uses the standing target", () => {
    const exempt = assessStepDay({
      steps: 500,
      targetSteps: TARGET,
      penaltyAmount: PENALTY,
      exempt: true,
    });
    const nextDay = assessStepDay({
      steps: 500,
      targetSteps: TARGET,
      penaltyAmount: PENALTY,
      exempt: false,
    });

    expect(exempt.cents).toBe(0);
    expect(nextDay).toMatchObject({ exempt: false, below: true, cents: 300 });
  });
});

test("an exemption note names the reason", () => {
  expect(stepExemptionNote(null)).toBe("Exempt");
  expect(stepExemptionNote("  sick day  ")).toBe("Exempt · sick day");
});
