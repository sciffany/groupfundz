-- AlterTable
ALTER TABLE "StepNight" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkArrivalTarget" ADD COLUMN "exempt" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "WorkArrivalTarget" ALTER COLUMN "arrivalMinutes" DROP NOT NULL;
ALTER TABLE "WorkArrivalTarget" ALTER COLUMN "days" DROP NOT NULL;
ALTER TABLE "WorkArrivalTarget" ALTER COLUMN "latitude" DROP NOT NULL;
ALTER TABLE "WorkArrivalTarget" ALTER COLUMN "longitude" DROP NOT NULL;
ALTER TABLE "WorkArrivalTarget" ALTER COLUMN "radiusMeters" DROP NOT NULL;

ALTER TABLE "WorkArrivalTarget" ADD CONSTRAINT "WorkArrivalTarget_exempt_shape_check" CHECK (
    (
        "exempt" = true
        AND "arrivalMinutes" IS NULL
        AND "days" IS NULL
        AND "latitude" IS NULL
        AND "longitude" IS NULL
        AND "radiusMeters" IS NULL
    )
    OR (
        "exempt" = false
        AND "arrivalMinutes" IS NOT NULL
        AND "days" IS NOT NULL
        AND "latitude" IS NOT NULL
        AND "longitude" IS NOT NULL
        AND "radiusMeters" IS NOT NULL
    )
);
