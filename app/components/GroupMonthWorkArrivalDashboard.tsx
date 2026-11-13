"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ConfirmForm } from "@/components/ConfirmForm";
import {
  DashboardMetricCell,
  DashboardMonthTable,
  DashboardSection,
} from "@/components/dashboard";
import type { ActionState } from "@/lib/actions/profile";
import {
  deleteWorkArrivalCheckIn,
  recordWorkArrivalCheckIn,
  updateWorkArrivalCheckInTime,
} from "@/lib/actions/work-arrival";
import { formatLatitude, formatLongitude } from "@/lib/work-arrival";
import { weekdayShort, type YearMonth } from "@/lib/month";

export type WorkArrivalDashboardCell = {
  time: string | null;
  miss: boolean;
  late: boolean;
  penaltyLabel: string | null;
  exempt: boolean;
  /** `datetime-local` value in this day's arrival timezone. Null when there is no check-in. */
  timeValue?: string | null;
  timeZone?: string | null;
};

export type WorkArrivalDashboardMember = {
  id: string;
  displayName: string;
  editable?: boolean;
  cells: Record<string, WorkArrivalDashboardCell>;
  totalPenalty: string;
};

const CONFETTI_COLORS = ["#f59e0b", "#10b981", "#38bdf8", "#f43f5e", "#a78bfa", "#facc15"];

function confettiPieces(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    left: (index * 37) % 100,
    delay: (index % 8) * 0.05,
    duration: 1.45 + (index % 5) * 0.16,
    drift: (index % 2 === 0 ? 1 : -1) * (24 + (index % 7) * 14),
    spin: (index % 2 === 0 ? 1 : -1) * (200 + (index % 5) * 80),
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    size: 7 + (index % 4) * 3,
    round: index % 3 === 0,
  }));
}

function CheckInCelebration({ burst }: { burst: number }) {
  const [visible, setVisible] = useState(false);
  const pieces = useRef(confettiPieces(42)).current;

  useEffect(() => {
    if (!burst) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 2200);
    return () => window.clearTimeout(timer);
  }, [burst]);

  if (!visible || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      aria-live="polite"
    >
      <style>{`
        @keyframes checkin-confetti-fall {
          0% { transform: translate3d(0, -12vh, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate3d(var(--drift), 108vh, 0) rotate(var(--spin)); opacity: 0; }
        }
        @keyframes checkin-congrats {
          0% { transform: translateY(8px) scale(0.86); opacity: 0; }
          18% { transform: translateY(0) scale(1.06); opacity: 1; }
          72% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-6px) scale(1); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .checkin-confetti-piece { display: none; }
          .checkin-congrats { animation: none; opacity: 1; }
        }
      `}</style>
      {pieces.map((piece, index) => (
        <span
          key={index}
          className="checkin-confetti-piece absolute top-0 block"
          style={{
            left: `${piece.left}%`,
            width: piece.size,
            height: piece.round ? piece.size : piece.size * 1.6,
            background: piece.color,
            borderRadius: piece.round ? 999 : 2,
            animation: `checkin-confetti-fall ${piece.duration}s ${piece.delay}s ease-in both`,
            ["--drift" as string]: `${piece.drift}px`,
            ["--spin" as string]: `${piece.spin}deg`,
          }}
        />
      ))}
      <p
        className="checkin-congrats absolute top-[22%] left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-5 py-2 text-lg font-semibold tracking-tight text-white shadow-lg"
        style={{ animation: "checkin-congrats 2s ease both" }}
      >
        Nice!
      </p>
    </div>,
    document.body,
  );
}

function FieldMessage({ state }: { state: ActionState }) {
  if (state.error) return <p className="text-sm text-red-700">{state.error}</p>;
  if (state.warning) return <p className="text-sm text-amber-800">{state.warning}</p>;
  if (state.success) return <p className="text-sm text-green-700">{state.success}</p>;
  return null;
}

function CheckInForm({ groupId }: { groupId: string }) {
  const [state, action, pending] = useActionState(recordWorkArrivalCheckIn, {});
  const [locating, setLocating] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const latitudeRef = useRef<HTMLInputElement>(null);
  const longitudeRef = useRef<HTMLInputElement>(null);
  const celebrated = useRef<ActionState | null>(null);

  useEffect(() => {
    if (!state.celebrate || celebrated.current === state) return;
    celebrated.current = state;
    setBurst((count) => count + 1);
  }, [state]);

  function checkIn() {
    if (!navigator.geolocation) {
      setClientError("This browser can’t share your location.");
      return;
    }
    setLocating(true);
    setClientError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = formatLatitude(position.coords.latitude);
        const longitude = formatLongitude(position.coords.longitude);
        if (
          !latitude ||
          !longitude ||
          !latitudeRef.current ||
          !longitudeRef.current
        ) {
          setLocating(false);
          setClientError("This location can’t be used.");
          return;
        }
        latitudeRef.current.value = latitude;
        longitudeRef.current.value = longitude;
        setLocating(false);
        formRef.current?.requestSubmit();
      },
      () => {
        setLocating(false);
        setClientError("Allow location access to check in.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="flex flex-wrap items-center gap-3 border-b border-neutral-200 px-3 py-3 sm:px-4"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input ref={latitudeRef} type="hidden" name="latitude" />
      <input ref={longitudeRef} type="hidden" name="longitude" />
      <button
        type="button"
        onClick={checkIn}
        disabled={pending || locating}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {pending ? "Saving…" : locating ? "Finding location…" : "Check in"}
      </button>
      <p className="text-xs text-neutral-500">
        Records the server time and this device’s location.
      </p>
      {clientError ? (
        <p className="text-sm text-red-700">{clientError}</p>
      ) : (
        <FieldMessage state={state} />
      )}
      <CheckInCelebration burst={burst} />
    </form>
  );
}

function CheckInTimeDialog({
  groupId,
  memberId,
  memberName,
  date,
  timeValue,
  timeZone,
  onClose,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
  date: string;
  timeValue: string | null;
  timeZone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(timeValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateWorkArrivalCheckInTime(
        groupId,
        memberId,
        date,
        value,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-4 shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-neutral-900">
              {memberName}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {weekdayShort(date)} {date}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            Close
          </button>
        </div>
        {timeValue ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className="block text-sm text-neutral-700">
              Check-in time
              <input
                type="datetime-local"
                required
                step={1}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </label>
            <p className="text-xs text-neutral-500">
              Times use {timeZone}. The location stays as recorded.
            </p>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Save time"}
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-neutral-600">
            There’s no check-in for this day.
          </p>
        )}
      </div>
    </div>
  );
}

export function GroupMonthWorkArrivalDashboard({
  groupId,
  month,
  members,
  today,
  dateNotes,
}: {
  groupId: string;
  month: YearMonth;
  members: WorkArrivalDashboardMember[];
  today: string;
  dateNotes?: Record<string, string[]>;
}) {
  const memberById = new Map(members.map((member) => [member.id, member]));
  const canEdit = members.some((member) => member.editable);
  const [selection, setSelection] = useState<{
    memberId: string;
    date: string;
  } | null>(null);
  const selectedMember = selection
    ? memberById.get(selection.memberId)
    : undefined;

  return (
    <DashboardSection
      title="Work arrival"
      description={
        canEdit
          ? "One check-in per work day. Highlighted cells are late or outside the place. Click a cell to edit that day’s check-in time."
          : "One check-in per work day. The server records the time. Highlighted cells are late or outside the place."
      }
      actions={
        <ConfirmForm
          action={deleteWorkArrivalCheckIn}
          hidden={{ groupId }}
          confirmMessage="Delete your check-in for today?"
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          Remove today’s check-in
        </ConfirmForm>
      }
    >
      <CheckInForm groupId={groupId} />
      <DashboardMonthTable
        month={month}
        members={members}
        today={today}
        footerValues={members.map((member) => member.totalPenalty)}
        dateNotes={dateNotes}
        renderCell={(memberId, date) => {
          const member = memberById.get(memberId);
          const cell = member?.cells[date];
          const flagged = Boolean(cell?.miss || cell?.late);
          const exempt = Boolean(cell?.exempt);
          const value =
            cell?.time ?? (exempt ? "Exempt" : cell?.miss ? "Miss" : null);
          const cellView = (
            <DashboardMetricCell
              value={value}
              flagged={flagged}
              penaltyLabel={cell?.penaltyLabel ?? null}
              className={
                exempt && !flagged
                  ? "bg-neutral-100"
                  : flagged
                    ? "group-hover:bg-rose-100"
                    : member?.editable
                      ? "group-hover:bg-neutral-100"
                      : ""
              }
            />
          );
          if (!member?.editable) return cellView;
          const label = `${member.displayName}, ${weekdayShort(date)} ${date}`;
          return (
            <button
              type="button"
              className="group block h-full w-full cursor-pointer text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-400"
              aria-label={`Edit check-in time for ${label}`}
              onClick={() => setSelection({ memberId, date })}
            >
              {cellView}
            </button>
          );
        }}
      />
      {selection && selectedMember?.editable ? (
        <CheckInTimeDialog
          key={`${selection.memberId}:${selection.date}`}
          groupId={groupId}
          memberId={selection.memberId}
          memberName={selectedMember.displayName}
          date={selection.date}
          timeValue={selectedMember.cells[selection.date]?.timeValue ?? null}
          timeZone={selectedMember.cells[selection.date]?.timeZone ?? "Asia/Singapore"}
          onClose={() => setSelection(null)}
        />
      ) : null}
    </DashboardSection>
  );
}
