"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  DashboardMetricCell,
  DashboardMonthTable,
  DashboardSection,
} from "@/components/dashboard";
import { RefreshStepsButton } from "@/components/RefreshStepsButton";
import { setMemberDaySteps, setStepDayExemption } from "@/lib/actions/steps";
import { weekdayShort, type YearMonth } from "@/lib/month";
import { MAX_TARGET_STEPS } from "@/lib/steps";

export type StepsDashboardCell = {
  steps: number | null;
  below: boolean;
  penaltyLabel: string | null;
  edited?: boolean;
  exempt?: boolean;
};

export type StepsDashboardMember = {
  id: string;
  displayName: string;
  editable?: boolean;
  cells: Record<string, StepsDashboardCell>;
  totalPenalty: string;
};

function formatSteps(steps: number): string {
  return steps.toLocaleString("en-US");
}

function StepDayDialog({
  groupId,
  memberId,
  memberName,
  date,
  steps,
  exempt: initialExempt,
  onClose,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
  date: string;
  steps: number | null;
  exempt: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(steps === null ? "" : String(steps));
  const [exempt, setExempt] = useState(initialExempt);
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
      const trimmed = value.trim();
      const stepsText = steps === null ? "" : String(steps);
      const stepsChanged = trimmed !== stepsText;
      if (stepsChanged) {
        if (trimmed === "") {
          setError(
            `Enter a whole number of steps from 0 to ${MAX_TARGET_STEPS.toLocaleString("en-US")}.`,
          );
          return;
        }
        const result = await setMemberDaySteps(groupId, memberId, date, trimmed);
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      if (!stepsChanged && exempt === initialExempt) {
        onClose();
        return;
      }
      const exemption = await setStepDayExemption(groupId, memberId, date, exempt);
      if (!exemption.ok) {
        setError(exemption.error);
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
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="block text-sm text-neutral-700">
            Steps
            <input
              type="number"
              min={0}
              max={MAX_TARGET_STEPS}
              step={1}
              inputMode="numeric"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={exempt}
              onChange={(event) => setExempt(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              No step target this day
              <span className="mt-1 block text-xs text-neutral-500">
                Only this day. The daily target applies again the next day.
              </span>
            </span>
          </label>
          <p className="text-xs text-neutral-500">
            This total stays until you change it again. Phone and sheet
            imports won’t replace it.
          </p>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function GroupMonthStepsDashboard({
  groupId,
  month,
  members,
  today,
  dateNotes,
}: {
  groupId: string;
  month: YearMonth;
  members: StepsDashboardMember[];
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
      title="Daily steps"
      description={
        canEdit
          ? "Total steps for each day. Highlighted cells missed the target. An exempt day has no target. Click a cell to set that day’s steps."
          : "Total steps for each day. Highlighted cells missed the target. An exempt day has no target."
      }
      actions={<RefreshStepsButton groupId={groupId} />}
    >
      <DashboardMonthTable
        month={month}
        members={members}
        today={today}
        footerValues={members.map((member) => member.totalPenalty)}
        dateNotes={dateNotes}
        renderCell={(memberId, date) => {
          const member = memberById.get(memberId);
          const cell = member?.cells[date];
          const steps = cell?.steps;
          const exempt = Boolean(cell?.exempt);
          const hasSteps = steps !== null && steps !== undefined;
          const value = hasSteps ? formatSteps(steps) : exempt ? "Exempt" : null;
          const caption = [
            exempt && hasSteps ? "exempt" : null,
            cell?.edited ? "edited" : null,
          ]
            .filter((part) => part !== null)
            .join(" · ");
          const cellView = (
            <DashboardMetricCell
              value={value}
              flagged={cell?.below ?? false}
              penaltyLabel={cell?.penaltyLabel ?? null}
              caption={caption || null}
              className={
                exempt && !cell?.below
                  ? "bg-neutral-100"
                  : cell?.below
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
              aria-label={`Edit steps for ${label}`}
              onClick={() => setSelection({ memberId, date })}
            >
              {cellView}
            </button>
          );
        }}
      />
      {selection && selectedMember?.editable ? (
        <StepDayDialog
          key={`${selection.memberId}:${selection.date}`}
          groupId={groupId}
          memberId={selection.memberId}
          memberName={selectedMember.displayName}
          date={selection.date}
          steps={selectedMember.cells[selection.date]?.steps ?? null}
          exempt={selectedMember.cells[selection.date]?.exempt ?? false}
          onClose={() => setSelection(null)}
        />
      ) : null}
    </DashboardSection>
  );
}
