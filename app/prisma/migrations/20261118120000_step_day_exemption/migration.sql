-- One calendar day with no step target and no charge.
CREATE TABLE "StepExemption" (
    "id" TEXT NOT NULL,
    "groupMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepExemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StepExemption_groupMemberId_date_key" ON "StepExemption"("groupMemberId", "date");

ALTER TABLE "StepExemption" ADD CONSTRAINT "StepExemption_groupMemberId_fkey" FOREIGN KEY ("groupMemberId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
