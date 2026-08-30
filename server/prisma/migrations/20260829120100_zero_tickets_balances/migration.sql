-- Zeroes out every existing TICKETS balance now that TICKETS is retired
-- (GC-only economy, 2026-08-29 founder direction). No conversion, no
-- compensation - founder-confirmed explicitly; only testers ever held any.
--
-- Writes one balancing `transactions` row per affected user (a debit of
-- exactly their current balance, type TICKETS_RETIRED) rather than a silent
-- UPDATE, so the ledger stays honest: every balance change is still exactly
-- one audited row, same rule as every other transaction in this table.
-- Must run AFTER 20260829120000_gc_only_economy (which adds the
-- TICKETS_RETIRED enum value this depends on) as its own separate
-- migration/transaction - see that migration's comment for why.
--
-- `stake_coins` is the physical column backing the Prisma `tickets` field
-- (see schema.prisma's header comment).

INSERT INTO transactions (id, user_id, currency, type, amount, balance_after, meta, created_at)
SELECT
  gen_random_uuid(),
  user_id,
  'TICKETS',
  'TICKETS_RETIRED',
  -stake_coins,
  0,
  jsonb_build_object('reason', 'tickets_retired_gc_only_economy'),
  now()
FROM balances
WHERE stake_coins <> 0;

UPDATE balances SET stake_coins = 0 WHERE stake_coins <> 0;
