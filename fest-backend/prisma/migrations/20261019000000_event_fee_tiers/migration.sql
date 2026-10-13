-- Fixed ticket options per event (e.g. Single / Group of 5). Additive only.
ALTER TABLE "Event" ADD COLUMN "feeTiers" JSONB;
