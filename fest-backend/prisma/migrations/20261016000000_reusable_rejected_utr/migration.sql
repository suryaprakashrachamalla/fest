-- A rejected payment proof no longer holds its UTR: the team can resubmit the same UTR (e.g. with a
-- clearer screenshot) for a second review. UTRs stay unique among pending and verified proofs.
DROP INDEX "PaymentProof_utr_key";

CREATE UNIQUE INDEX "PaymentProof_utr_active_key"
ON "PaymentProof"("utr")
WHERE "status" <> 'REJECTED';
