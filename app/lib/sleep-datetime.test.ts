import { expect, test } from "vitest";
import { formatDateTimeLocal, parseZonedDateTime } from "@/lib/sleep";

test("a Singapore wall time round-trips through datetime-local", () => {
  const instant = parseZonedDateTime("2026-10-27T23:15:00", "Asia/Singapore");
  expect(instant?.toISOString()).toBe("2026-10-27T15:15:00.000Z");
  expect(formatDateTimeLocal(instant!, "Asia/Singapore")).toBe(
    "2026-10-27T23:15:00",
  );
});

test("a datetime-local value may omit seconds", () => {
  const instant = parseZonedDateTime("2026-10-28T01:05", "Asia/Singapore");
  expect(instant?.toISOString()).toBe("2026-10-27T17:05:00.000Z");
});
