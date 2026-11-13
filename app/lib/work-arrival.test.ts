import { expect, test } from "vitest";
import { localDateTime } from "@/lib/sleep";
import {
  arrivalTargetChangeNote,
  arrivalTargetStartNote,
  arrivalTimeZoneForDate,
  chargeWorkArrivalMonth,
  defaultWorkdays,
  distanceMeters,
  checkInFeedback,
  earlierCheckIn,
  formatLatitude,
  instantOnWorkDay,
  isInsideRadius,
  parseLatitude,
  workDayForArrival,
  type ActiveWorkArrivalTarget,
  type WorkArrivalPenaltyForCharge,
  type WorkArrivalTargetForCharge,
} from "@/lib/work-arrival";

const PLACE = { latitude: 1.3, longitude: 103.8, radiusMeters: 100 };
const DAY = "2026-10-27";

function target(
  days = defaultWorkdays(),
  arrivalMinutes = 9 * 60,
): ActiveWorkArrivalTarget {
  return {
    effectiveFrom: "2026-01-01",
    timezone: "Asia/Singapore",
    exempt: false,
    arrivalMinutes,
    days,
    ...PLACE,
  };
}

function penalty(
  overrides: Partial<WorkArrivalPenaltyForCharge> = {},
): WorkArrivalPenaltyForCharge {
  return {
    effectiveFrom: "2026-01-01",
    amount: "1.50",
    unit: "MONEY",
    unitLabel: null,
    blockMinutes: 10,
    cap: "5.00",
    ...overrides,
  };
}

function at(minutes: number, extraMs = 0): Date {
  return new Date(
    localDateTime(DAY, minutes, "Asia/Singapore").getTime() + extraMs,
  );
}

function charge(input: {
  date?: string;
  targets?: WorkArrivalTargetForCharge[];
  overrides?: WorkArrivalOverrideForCharge[];
  penalties?: WorkArrivalPenaltyForCharge[];
  checkIn?: { arrivedAt: Date; latitude: number; longitude: number } | null;
}) {
  return chargeWorkArrivalMonth({
    dates: [input.date ?? DAY],
    targets: input.targets ?? [target()],
    overrides: input.overrides ?? [],
    penalties: input.penalties ?? [penalty()],
    checkInByWorkDay: new Map([[input.date ?? DAY, input.checkIn ?? null]]),
  });
}

test("an unchecked weekday owes nothing, including when nobody checks in", () => {
  const sunday = "2026-10-25";
  const result = charge({ date: sunday, checkIn: null });
  expect(result.cells[sunday]).toEqual({
    time: null,
    miss: false,
    late: false,
    charge: null,
    exempt: false,
  });
  expect(result.totalCharge).toBe("$0.00");
});

test("a missing check-in on a counted day owes the cap", () => {
  const result = charge({ checkIn: null });
  expect(result.cells[DAY]).toEqual({
    time: null,
    miss: true,
    late: false,
    charge: "$5.00",
    exempt: false,
  });
});

test("a counted day after today owes nothing until it arrives", () => {
  const tomorrow = "2026-10-28";
  const result = chargeWorkArrivalMonth({
    dates: [DAY, tomorrow],
    targets: [target()],
    overrides: [],
    penalties: [penalty()],
    checkInByWorkDay: new Map([
      [DAY, null],
      [tomorrow, null],
    ]),
    today: DAY,
  });
  expect(result.cells[DAY]).toMatchObject({ miss: true, charge: "$5.00" });
  expect(result.cells[tomorrow]).toEqual({
    time: null,
    miss: false,
    late: false,
    charge: null,
    exempt: false,
  });
  expect(result.totalCharge).toBe("$5.00");
});

test("a check-in inside the radius and on time owes nothing", () => {
  const result = charge({
    checkIn: { arrivedAt: at(9 * 60), ...PLACE },
  });
  expect(result.cells[DAY]).toMatchObject({
    time: "9:00 AM",
    miss: false,
    late: false,
    charge: null,
  });
});

test("ten minutes late is one block", () => {
  const result = charge({
    checkIn: { arrivedAt: at(9 * 60 + 10), ...PLACE },
  });
  expect(result.cells[DAY]).toMatchObject({
    late: true,
    miss: false,
    charge: "$1.50",
  });
});

test("a partial block rounds up", () => {
  const result = charge({
    checkIn: { arrivedAt: at(9 * 60 + 10, 1), ...PLACE },
  });
  expect(result.cells[DAY].charge).toBe("$3.00");
});

test("late blocks stop at the cap", () => {
  const result = charge({
    checkIn: { arrivedAt: at(12 * 60), ...PLACE },
  });
  expect(result.cells[DAY]).toMatchObject({
    late: true,
    charge: "$5.00",
  });
});

test("a check-in outside the radius owes the cap", () => {
  const result = charge({
    checkIn: {
      arrivedAt: at(8 * 60),
      latitude: 1.31,
      longitude: 103.8,
    },
  });
  expect(result.cells[DAY]).toMatchObject({
    miss: true,
    late: false,
    charge: "$5.00",
  });
});

test("the radius boundary counts as inside", () => {
  expect(distanceMeters(PLACE, PLACE)).toBe(0);
  expect(isInsideRadius(PLACE, { ...PLACE, radiusMeters: 0 })).toBe(true);
  expect(
    isInsideRadius(
      { latitude: 1.31, longitude: 103.8 },
      { ...PLACE, radiusMeters: 0 },
    ),
  ).toBe(false);
});

test("an override makes an unchecked day count and replaces the clock time", () => {
  const sunday = "2026-10-25";
  const arrivedAt = localDateTime(sunday, 10 * 60, "Asia/Singapore");
  const result = charge({
    date: sunday,
    overrides: [
      {
        date: sunday,
        timezone: "Asia/Singapore",
        arrivalMinutes: 11 * 60,
      },
    ],
    checkIn: {
      arrivedAt,
      latitude: PLACE.latitude,
      longitude: PLACE.longitude,
    },
  });
  expect(result.cells[sunday]).toMatchObject({
    time: "10:00 AM",
    miss: false,
    late: false,
    charge: null,
  });
});

test("an exempt override owes nothing, including a missing check-in", () => {
  const result = charge({
    overrides: [
      {
        date: DAY,
        timezone: "Asia/Singapore",
        arrivalMinutes: 9 * 60,
        exempt: true,
      },
    ],
    checkIn: null,
  });
  expect(result.cells[DAY]).toEqual({
    time: null,
    miss: false,
    late: false,
    charge: null,
    exempt: true,
  });
  expect(result.totalCharge).toBe("$0.00");
});

test("a check-in on an exempt day is recorded and not charged", () => {
  const result = charge({
    overrides: [
      {
        date: DAY,
        timezone: "Asia/Singapore",
        arrivalMinutes: 9 * 60,
        exempt: true,
      },
    ],
    checkIn: { arrivedAt: at(11 * 60), ...PLACE },
  });
  expect(result.cells[DAY]).toEqual({
    time: "11:00 AM",
    miss: false,
    late: false,
    charge: null,
    exempt: true,
  });
  expect(result.totalCharge).toBe("$0.00");
});

test("clearing exempt makes the day count again", () => {
  const exempt = charge({
    overrides: [
      {
        date: DAY,
        timezone: "Asia/Singapore",
        arrivalMinutes: 9 * 60,
        exempt: true,
      },
    ],
    checkIn: null,
  });
  const counted = charge({
    overrides: [
      {
        date: DAY,
        timezone: "Asia/Singapore",
        arrivalMinutes: 9 * 60,
        exempt: false,
      },
    ],
    checkIn: null,
  });
  expect(exempt.cells[DAY].charge).toBeNull();
  expect(counted.cells[DAY]).toMatchObject({
    miss: true,
    charge: "$5.00",
    exempt: false,
  });
});

test("an exempt day is left out of the monthly penalty total", () => {
  const next = "2026-10-28";
  const result = chargeWorkArrivalMonth({
    dates: [DAY, next],
    targets: [target()],
    overrides: [
      {
        date: DAY,
        timezone: "Asia/Singapore",
        arrivalMinutes: 9 * 60,
        exempt: true,
      },
    ],
    penalties: [penalty()],
    checkInByWorkDay: new Map([
      [DAY, null],
      [next, null],
    ]),
  });
  expect(result.cells[DAY].exempt).toBe(true);
  expect(result.cells[DAY].charge).toBeNull();
  expect(result.cells[next]).toMatchObject({
    miss: true,
    charge: "$5.00",
    exempt: false,
  });
  expect(result.totalCharge).toBe("$5.00");
});

test("an exempt override on a weekend still does not count", () => {
  const sunday = "2026-10-25";
  const result = charge({
    date: sunday,
    overrides: [
      {
        date: sunday,
        timezone: "Asia/Singapore",
        arrivalMinutes: 9 * 60,
        exempt: true,
      },
    ],
    checkIn: null,
  });
  expect(result.cells[sunday]).toMatchObject({
    miss: false,
    charge: null,
    exempt: true,
  });
  expect(result.totalCharge).toBe("$0.00");
});

test("an override still uses the target place", () => {
  const result = charge({
    overrides: [
      { date: DAY, timezone: "Asia/Singapore", arrivalMinutes: 9 * 60 },
    ],
    checkIn: {
      arrivedAt: at(8 * 60),
      latitude: 1.31,
      longitude: 103.8,
    },
  });
  expect(result.cells[DAY].miss).toBe(true);
  expect(result.cells[DAY].charge).toBe("$5.00");
});

test("a counted day with no geofence is a miss", () => {
  const result = charge({
    date: DAY,
    targets: [],
    overrides: [
      { date: DAY, timezone: "Asia/Singapore", arrivalMinutes: 9 * 60 },
    ],
    checkIn: { arrivedAt: at(8 * 60), ...PLACE },
  });
  expect(result.cells[DAY]).toMatchObject({ miss: true, charge: "$5.00" });
});

test("an exemption owes nothing, including a missing check-in", () => {
  const result = charge({
    targets: [
      {
        effectiveFrom: "2026-01-01",
        timezone: "Asia/Singapore",
        exempt: true,
      },
    ],
    checkIn: null,
  });
  expect(result.cells[DAY]).toEqual({
    time: null,
    miss: false,
    late: false,
    charge: null,
  });
  expect(result.totalCharge).toBe("$0.00");
});

test("an exemption starts on its date and the next target ends it", () => {
  const exempt = {
    effectiveFrom: "2026-10-01",
    timezone: "Asia/Singapore",
    exempt: true as const,
  };
  const resumed = target();
  resumed.effectiveFrom = "2026-10-28";
  const targets = [target(), exempt, resumed];

  const before = charge({ date: "2026-09-30", targets, checkIn: null });
  expect(before.cells["2026-09-30"].miss).toBe(true);

  const during = charge({ date: DAY, targets, checkIn: null });
  expect(during.cells[DAY]).toMatchObject({ miss: false, charge: null });

  const after = charge({ date: "2026-10-28", targets, checkIn: null });
  expect(after.cells["2026-10-28"].miss).toBe(true);
});

test("the latest target on or before the day covers it", () => {
  const later = target();
  later.effectiveFrom = "2026-10-28";
  later.latitude = 10;
  const result = charge({
    targets: [later, target()],
    checkIn: { arrivedAt: at(9 * 60), ...PLACE },
  });
  expect(result.cells[DAY].miss).toBe(false);
  expect(result.cells[DAY].charge).toBeNull();
});

test("an arrival clock uses the override, then the covering target", () => {
  const targets = [{ effectiveFrom: "2026-01-01", timezone: "Asia/Singapore" }];
  expect(arrivalTimeZoneForDate(DAY, targets, [])).toBe("Asia/Singapore");
  expect(
    arrivalTimeZoneForDate(DAY, targets, [
      { date: DAY, timezone: "America/New_York" },
    ]),
  ).toBe("America/New_York");
  expect(arrivalTimeZoneForDate(DAY, [], [])).toBe("Asia/Singapore");
  expect(
    arrivalTimeZoneForDate(DAY, [{ effectiveFrom: "2026-01-01", timezone: "Mars/Base" }], []),
  ).toBe("Asia/Singapore");
});

test("a check-in time edit stays on that work day", () => {
  const morning = new Date("2026-10-27T01:30:00.000Z");
  expect(instantOnWorkDay(morning, DAY, "Asia/Singapore")).toBe(true);
  expect(instantOnWorkDay(morning, "2026-10-26", "Asia/Singapore")).toBe(false);
  expect(instantOnWorkDay(morning, DAY, "Not/AZone")).toBe(false);
});

test("a check-in work day follows the covering target timezone", () => {
  const instant = new Date("2026-10-27T16:30:00.000Z");
  expect(
    workDayForArrival(
      [{ effectiveFrom: "2026-01-01", timezone: "America/New_York" }],
      instant,
    ),
  ).toEqual({ workDay: "2026-10-27", timezone: "America/New_York" });
  expect(
    workDayForArrival(
      [{ effectiveFrom: "2026-01-01", timezone: "Asia/Singapore" }],
      instant,
    ),
  ).toEqual({ workDay: "2026-10-28", timezone: "Asia/Singapore" });
});

test("an exemption is noted as no target", () => {
  expect(
    arrivalTargetStartNote({
      exempt: true,
    }),
  ).toBe("No target");
  expect(arrivalTargetChangeNote(target(), { exempt: true })).toBe("No target");
  expect(
    arrivalTargetChangeNote({ exempt: true }, { exempt: true }),
  ).toBeNull();
});

test("a target after an exemption states the new rule", () => {
  expect(arrivalTargetChangeNote({ exempt: true }, target())).toBe(
    "Arrive by 9:00 AM · Mon, Tue, Wed, Thu, Fri · Place · 100 m",
  );
});

test("a target that has not started does not set the work day", () => {
  const instant = new Date("2026-10-27T04:00:00.000Z");
  expect(
    workDayForArrival(
      [{ effectiveFrom: "2026-11-01", timezone: "America/New_York" }],
      instant,
    ),
  ).toEqual({ workDay: "2026-10-27", timezone: "Asia/Singapore" });
});

test("the newest covering target sets the work day", () => {
  const instant = new Date("2026-10-27T16:30:00.000Z");
  expect(
    workDayForArrival(
      [
        { effectiveFrom: "2026-01-01", timezone: "Asia/Singapore" },
        { effectiveFrom: "2026-06-01", timezone: "America/New_York" },
      ],
      instant,
    ).timezone,
  ).toBe("America/New_York");
});

test("the first arrival target states the starting rule", () => {
  expect(arrivalTargetStartNote(target())).toBe(
    "Arrive by 9:00 AM · Mon, Tue, Wed, Thu, Fri · Place · 100 m",
  );
});

test("an identical arrival target is not a date note", () => {
  const first = target();
  expect(arrivalTargetChangeNote(first, { ...first })).toBeNull();
});

test("a later arrival time is noted like a bedtime change", () => {
  expect(
    arrivalTargetChangeNote(target(), target(defaultWorkdays(), 9 * 60 + 30)),
  ).toBe("Arrive by 9:30 AM");
});

test("a changed weekday set is noted with the new days", () => {
  const days = defaultWorkdays();
  days[1] = false;
  expect(arrivalTargetChangeNote(target(), target(days))).toBe(
    "Arrive by 9:00 AM · Tue, Wed, Thu, Fri",
  );
});

test("a moved place is noted on its own", () => {
  const next = target();
  next.latitude = 1.4;
  expect(arrivalTargetChangeNote(target(), next)).toBe("Place");
});

test("a radius change is noted in meters", () => {
  const next = target();
  next.radiusMeters = 250;
  expect(arrivalTargetChangeNote(target(), next)).toBe("Radius 250 m");
});

test("a moved place with a new radius includes both", () => {
  const next = target();
  next.longitude = 104;
  next.radiusMeters = 1500;
  expect(arrivalTargetChangeNote(target(), next)).toBe("Place · 1,500 m");
});

test("a device coordinate round-trips into a stored latitude", () => {
  expect(parseLatitude(formatLatitude(1.35208337))).toBe(1.3520834);
});

test("a new check-in at the place is worth a celebration", () => {
  expect(checkInFeedback({ keptEarlier: false, insidePlace: true })).toEqual({
    success: "Checked in.",
    celebrate: true,
  });
});

test("a new check-in outside the place says so", () => {
  expect(checkInFeedback({ keptEarlier: false, insidePlace: false })).toEqual({
    warning: "Checked in outside the place.",
  });
});

test("a new check-in with no place stays a plain success", () => {
  expect(checkInFeedback({ keptEarlier: false, insidePlace: null })).toEqual({
    success: "Checked in.",
  });
});

test("an earlier check-in outside the place is called out", () => {
  expect(checkInFeedback({ keptEarlier: true, insidePlace: false })).toEqual({
    warning:
      "An earlier check-in is already saved for that day, outside the place.",
  });
});

test("an earlier check-in at the place does not celebrate again", () => {
  expect(checkInFeedback({ keptEarlier: true, insidePlace: true })).toEqual({
    success: "An earlier check-in is already saved for that day.",
  });
});

test("an earlier check-in sticks", () => {
  const first = { arrivedAt: at(9 * 60), ...PLACE };
  const later = { arrivedAt: at(10 * 60), latitude: 1.31, longitude: 103.8 };
  expect(earlierCheckIn(first, later)).toBe(first);
  expect(earlierCheckIn(later, first)).toEqual(first);
  expect(earlierCheckIn(null, first)).toBe(first);
});
