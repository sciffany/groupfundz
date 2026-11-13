"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { ActionState } from "@/lib/actions/profile";
import {
  parsePenaltyAmount,
  parsePenaltyUnit,
  parsePenaltyUnitLabel,
} from "@/lib/penalty";
import { hasPendingInvite } from "@/lib/pending-members";
import {
  coveringEntry,
  formatDateOnly,
  isValidTimeZone,
  parseDateOnly,
  parseZonedDateTime,
} from "@/lib/sleep";
import { requireOnboardedUser } from "@/lib/session";
import {
  DEFAULT_ARRIVAL_MINUTES,
  arrivalTimeZoneForDate,
  checkInFeedback,
  checklistFromWeekdays,
  earlierCheckIn,
  instantOnWorkDay,
  isInsideRadius,
  parseArrivalMinutes,
  parseBlockMinutes,
  parseLatitude,
  parseLongitude,
  parseRadiusMeters,
  weekdayChecklistToJson,
  workDayForArrival,
} from "@/lib/work-arrival";

async function requireOwnedGroup(userId: string, groupId: string) {
  if (!groupId) return null;
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group || group.ownerId !== userId) return null;
  return group;
}

function revalidateGroup(groupId: string) {
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/settings`);
}

function uniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(7));
}

function arrivalTargetFields(
  formData: FormData,
  effectiveFrom: Date,
  timezone: string,
) {
  const arrivalMinutes = parseArrivalMinutes(formData.get("arrivalTime"));
  if (arrivalMinutes === null) return { error: "Enter an arrival time." };

  const latitude = parseLatitude(formData.get("latitude"));
  if (latitude === null) return { error: "Enter a latitude from -90 to 90." };
  const longitude = parseLongitude(formData.get("longitude"));
  if (longitude === null) return { error: "Enter a longitude from -180 to 180." };
  const radiusMeters = parseRadiusMeters(formData.get("radiusMeters"));
  if (radiusMeters === null) {
    return { error: "Enter a radius in meters between 1 and 1,000,000." };
  }

  return {
    effectiveFrom,
    timezone,
    exempt: false as const,
    arrivalMinutes,
    days: weekdayChecklistToJson(
      checklistFromWeekdays(formData.getAll("day").map(String)),
    ),
    latitude: decimal(latitude),
    longitude: decimal(longitude),
    radiusMeters,
  };
}

async function recordedWorkDay(groupMemberId: string, instant: Date) {
  const targets = await prisma.workArrivalTarget.findMany({
    where: { groupMemberId },
    select: { effectiveFrom: true, timezone: true },
  });
  const resolved = workDayForArrival(
    targets.map((target) => ({
      effectiveFrom: formatDateOnly(target.effectiveFrom),
      timezone: target.timezone,
    })),
    instant,
  );
  return parseDateOnly(resolved.workDay);
}

export async function saveWorkArrivalTarget(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOnboardedUser();
  const groupId = String(formData.get("groupId") ?? "");
  const groupMemberId = String(formData.get("groupMemberId") ?? "");
  const targetId = String(formData.get("targetId") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();

  const group = await requireOwnedGroup(user.id, groupId);
  if (!group) return { error: "You can’t edit this group." };

  const member = await prisma.groupMember.findUnique({
    where: { id: groupMemberId },
  });
  if (!member || member.groupId !== groupId) {
    return { error: "That member isn’t in this group." };
  }

  const effectiveFrom = parseDateOnly(String(formData.get("effectiveFrom") ?? ""));
  if (!effectiveFrom) return { error: "Enter a valid starting date." };
  if (!isValidTimeZone(timezone)) return { error: "Choose a valid timezone." };

  const exempt = String(formData.get("kind") ?? "") === "none";
  const data = exempt
    ? {
        effectiveFrom,
        timezone,
        exempt: true,
        arrivalMinutes: null,
        days: Prisma.DbNull,
        latitude: null,
        longitude: null,
        radiusMeters: null,
      }
    : arrivalTargetFields(formData, effectiveFrom, timezone);
  if ("error" in data) return data;

  try {
    if (targetId) {
      const existing = await prisma.workArrivalTarget.findUnique({
        where: { id: targetId },
      });
      if (!existing || existing.groupMemberId !== groupMemberId) {
        return { error: "That target wasn’t found." };
      }
      await prisma.workArrivalTarget.update({ where: { id: targetId }, data });
    } else {
      await prisma.workArrivalTarget.create({
        data: { groupMemberId, ...data },
      });
    }
  } catch (error) {
    if (uniqueConstraintError(error)) {
      return { error: "This member already has a target starting on that date." };
    }
    throw error;
  }

  revalidateGroup(groupId);
  if (exempt) return { success: targetId ? "No target saved." : "No target added." };
  return { success: targetId ? "Target saved." : "Target added." };
}

export async function deleteWorkArrivalTarget(formData: FormData) {
  const user = await requireOnboardedUser();
  const groupId = String(formData.get("groupId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const group = await requireOwnedGroup(user.id, groupId);
  if (!group) return;

  const existing = await prisma.workArrivalTarget.findUnique({
    where: { id: targetId },
    include: { groupMember: { select: { groupId: true } } },
  });
  if (!existing || existing.groupMember.groupId !== groupId) return;

  await prisma.workArrivalTarget.delete({ where: { id: targetId } });
  revalidateGroup(groupId);
}

export async function saveWorkArrivalOverride(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOnboardedUser();
  const groupId = String(formData.get("groupId") ?? "");
  const groupMemberId = String(formData.get("groupMemberId") ?? "");
  const overrideId = String(formData.get("overrideId") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  const exempt = formData.get("exempt") === "true";

  const group = await requireOwnedGroup(user.id, groupId);
  if (!group) return { error: "You can’t edit this group." };

  const member = await prisma.groupMember.findUnique({
    where: { id: groupMemberId },
  });
  if (!member || member.groupId !== groupId) {
    return { error: "That member isn’t in this group." };
  }

  const date = parseDateOnly(String(formData.get("date") ?? ""));
  if (!date) return { error: "Enter a valid work day." };
  if (!isValidTimeZone(timezone)) return { error: "Choose a valid timezone." };

  let arrivalMinutes: number;
  if (exempt) {
    arrivalMinutes = DEFAULT_ARRIVAL_MINUTES;
  } else {
    const parsed = parseArrivalMinutes(formData.get("arrivalTime"));
    if (parsed === null) return { error: "Enter an arrival time." };
    arrivalMinutes = parsed;
  }

  const data = { date, timezone, arrivalMinutes, note, exempt };

  try {
    if (overrideId) {
      const existing = await prisma.workArrivalOverride.findUnique({
        where: { id: overrideId },
      });
      if (!existing || existing.groupMemberId !== groupMemberId) {
        return { error: "That override wasn’t found." };
      }
      await prisma.workArrivalOverride.update({ where: { id: overrideId }, data });
    } else {
      await prisma.workArrivalOverride.create({
        data: { groupMemberId, ...data },
      });
    }
  } catch (error) {
    if (uniqueConstraintError(error)) {
      return { error: "This member already has an override on that date." };
    }
    throw error;
  }

  revalidateGroup(groupId);
  const success = exempt
    ? overrideId
      ? "Exemption saved."
      : "Exemption added."
    : overrideId
      ? "Override saved."
      : "Override added.";
  return { success };
}

export async function deleteWorkArrivalOverride(formData: FormData) {
  const user = await requireOnboardedUser();
  const groupId = String(formData.get("groupId") ?? "");
  const overrideId = String(formData.get("overrideId") ?? "");
  const group = await requireOwnedGroup(user.id, groupId);
  if (!group) return;

  const existing = await prisma.workArrivalOverride.findUnique({
    where: { id: overrideId },
    include: { groupMember: { select: { groupId: true } } },
  });
  if (!existing || existing.groupMember.groupId !== groupId) return;

  await prisma.workArrivalOverride.delete({ where: { id: overrideId } });
  revalidateGroup(groupId);
}

export async function saveWorkArrivalPenalty(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOnboardedUser();
  const groupId = String(formData.get("groupId") ?? "");
  const groupMemberId = String(formData.get("groupMemberId") ?? "");
  const penaltyId = String(formData.get("penaltyId") ?? "").trim();

  const group = await requireOwnedGroup(user.id, groupId);
  if (!group) return { error: "You can’t edit this group." };

  const member = await prisma.groupMember.findUnique({
    where: { id: groupMemberId },
  });
  if (!member || member.groupId !== groupId) {
    return { error: "That member isn’t in this group." };
  }

  const effectiveFrom = parseDateOnly(String(formData.get("effectiveFrom") ?? ""));
  if (!effectiveFrom) return { error: "Enter a valid starting date." };

  const amount = parsePenaltyAmount(formData.get("amount"));
  if (amount === null) {
    return { error: "Enter a non-negative amount with at most two decimal places." };
  }
  const cap = parsePenaltyAmount(formData.get("cap"));
  if (cap === null) {
    return { error: "Enter a payment cap with at most two decimal places." };
  }

  const unit = parsePenaltyUnit(formData.get("unit"));
  if (!unit) return { error: "Choose a penalty unit." };

  const { label: unitLabel, error: unitLabelError } = parsePenaltyUnitLabel(
    unit,
    formData.get("unitLabel"),
  );
  if (unitLabelError) return { error: unitLabelError };

  const blockMinutes = parseBlockMinutes(formData.get("blockMinutes"));
  if (blockMinutes === null) {
    return { error: "Enter a block size in minutes from 1 to 1440." };
  }

  const data = { effectiveFrom, amount, unit, unitLabel, blockMinutes, cap };

  try {
    if (penaltyId) {
      const existing = await prisma.workArrivalPenalty.findUnique({
        where: { id: penaltyId },
      });
      if (!existing || existing.groupMemberId !== groupMemberId) {
        return { error: "That penalty wasn’t found." };
      }
      await prisma.workArrivalPenalty.update({ where: { id: penaltyId }, data });
    } else {
      await prisma.workArrivalPenalty.create({
        data: { groupMemberId, ...data },
      });
    }
  } catch (error) {
    if (uniqueConstraintError(error)) {
      return { error: "This member already has a penalty starting on that date." };
    }
    throw error;
  }

  revalidateGroup(groupId);
  return { success: penaltyId ? "Penalty saved." : "Penalty added." };
}

export async function deleteWorkArrivalPenalty(formData: FormData) {
  const user = await requireOnboardedUser();
  const groupId = String(formData.get("groupId") ?? "");
  const penaltyId = String(formData.get("penaltyId") ?? "");
  const group = await requireOwnedGroup(user.id, groupId);
  if (!group) return;

  const existing = await prisma.workArrivalPenalty.findUnique({
    where: { id: penaltyId },
    include: { groupMember: { select: { groupId: true } } },
  });
  if (!existing || existing.groupMember.groupId !== groupId) return;

  await prisma.workArrivalPenalty.delete({ where: { id: penaltyId } });
  revalidateGroup(groupId);
}

export async function recordWorkArrivalCheckIn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOnboardedUser();
  const groupId = String(formData.get("groupId") ?? "");

  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
    include: { group: { select: { trackingKinds: true } } },
  });
  if (!membership) return { error: "You aren’t in this group." };
  if (!membership.group.trackingKinds.includes("WORK_ARRIVAL_TIME")) {
    return { error: "Work arrival tracking is off for this group." };
  }

  const arrivedAt = new Date();
  const workDay = await recordedWorkDay(membership.id, arrivedAt);
  if (!workDay) return { error: "Could not record the work day." };

  const latitude = parseLatitude(formData.get("latitude"));
  if (latitude === null) return { error: "Share a location to check in." };
  const longitude = parseLongitude(formData.get("longitude"));
  if (longitude === null) return { error: "Share a location to check in." };

  const incoming = { arrivedAt, latitude, longitude };

  const existing = await prisma.workArrivalDay.findUnique({
    where: { userId_workDay: { userId: user.id, workDay } },
  });
  let keptEarlier = false;
  let point = { latitude: incoming.latitude, longitude: incoming.longitude };
  if (
    existing?.arrivedAt &&
    existing.latitude !== null &&
    existing.longitude !== null
  ) {
    const stored = {
      arrivedAt: existing.arrivedAt,
      latitude: Number(existing.latitude),
      longitude: Number(existing.longitude),
    };
    const kept = earlierCheckIn(stored, incoming);
    if (kept.arrivedAt.getTime() === stored.arrivedAt.getTime()) {
      keptEarlier = true;
      point = stored;
    }
  }

  if (!keptEarlier) {
    await prisma.workArrivalDay.upsert({
      where: { userId_workDay: { userId: user.id, workDay } },
      create: {
        userId: user.id,
        workDay,
        arrivedAt: incoming.arrivedAt,
        latitude: decimal(incoming.latitude),
        longitude: decimal(incoming.longitude),
      },
      update: {
        arrivedAt: incoming.arrivedAt,
        latitude: decimal(incoming.latitude),
        longitude: decimal(incoming.longitude),
      },
    });
    revalidateGroup(groupId);
  }

  const targets = await prisma.workArrivalTarget.findMany({
    where: { groupMemberId: membership.id },
    select: {
      effectiveFrom: true,
      exempt: true,
      latitude: true,
      longitude: true,
      radiusMeters: true,
    },
  });
  const places: (
    | { effectiveFrom: string; exempt: true }
    | {
        effectiveFrom: string;
        exempt: false;
        latitude: number;
        longitude: number;
        radiusMeters: number;
      }
  )[] = [];
  for (const target of targets) {
    const effectiveFrom = formatDateOnly(target.effectiveFrom);
    if (target.exempt) {
      places.push({ effectiveFrom, exempt: true });
      continue;
    }
    if (
      target.latitude === null ||
      target.longitude === null ||
      target.radiusMeters === null
    ) {
      continue;
    }
    places.push({
      effectiveFrom,
      exempt: false,
      latitude: Number(target.latitude),
      longitude: Number(target.longitude),
      radiusMeters: target.radiusMeters,
    });
  }
  const covering = coveringEntry(places, formatDateOnly(workDay));
  const insidePlace =
    covering && !covering.exempt ? isInsideRadius(point, covering) : null;
  return checkInFeedback({ keptEarlier, insidePlace });
}

export type UpdateWorkArrivalCheckInTimeResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateWorkArrivalCheckInTime(
  groupId: string,
  groupMemberId: string,
  workDayRaw: string,
  arrivedAtRaw: string,
): Promise<UpdateWorkArrivalCheckInTimeResult> {
  const user = await requireOnboardedUser();
  const group = await requireOwnedGroup(user.id, groupId);
  if (!group) return { ok: false, error: "You can’t edit this group." };

  const workDay = parseDateOnly(workDayRaw);
  if (!workDay) return { ok: false, error: "Enter a valid work day." };
  const workDayKey = formatDateOnly(workDay);

  const member = await prisma.groupMember.findUnique({
    where: { id: groupMemberId },
    include: {
      workArrivalTargets: {
        select: { effectiveFrom: true, timezone: true },
      },
      workArrivalOverrides: {
        select: { date: true, timezone: true },
      },
    },
  });
  if (!member || member.groupId !== groupId) {
    return { ok: false, error: "That member isn’t in this group." };
  }
  if (await hasPendingInvite(groupId, member.userId)) {
    return { ok: false, error: "They haven’t joined this group yet." };
  }

  const existing = await prisma.workArrivalDay.findUnique({
    where: { userId_workDay: { userId: member.userId, workDay } },
  });
  if (!existing?.arrivedAt) {
    return { ok: false, error: "There’s no check-in for this day." };
  }

  const timeZone = arrivalTimeZoneForDate(
    workDayKey,
    member.workArrivalTargets.map((target) => ({
      effectiveFrom: formatDateOnly(target.effectiveFrom),
      timezone: target.timezone,
    })),
    member.workArrivalOverrides.map((override) => ({
      date: formatDateOnly(override.date),
      timezone: override.timezone,
    })),
  );
  const arrivedAt = parseZonedDateTime(arrivedAtRaw, timeZone);
  if (!arrivedAt) return { ok: false, error: "Enter a valid check-in time." };
  if (!instantOnWorkDay(arrivedAt, workDayKey, timeZone)) {
    return { ok: false, error: "Enter a time on this work day." };
  }

  await prisma.workArrivalDay.update({
    where: { id: existing.id },
    data: { arrivedAt },
  });
  revalidateGroup(groupId);
  return { ok: true };
}

export async function deleteWorkArrivalCheckIn(formData: FormData) {
  const user = await requireOnboardedUser();
  const groupId = String(formData.get("groupId") ?? "");

  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  });
  if (!membership) return;

  const workDay = await recordedWorkDay(membership.id, new Date());
  if (!workDay) return;

  await prisma.workArrivalDay.deleteMany({
    where: { userId: user.id, workDay },
  });
  revalidateGroup(groupId);
}
