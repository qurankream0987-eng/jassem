-- ONE ANSWER TO «WHAT IS CURRENT», ENFORCED BY THE DATABASE.
--
-- `bindReference` supersedes the previous binding and inserts a new one, but
-- two concurrent presses each read «nothing is current yet» in their own
-- snapshot and both inserted. The result was two rows with supersededAt NULL
-- for one key, so «the current order» had two answers.
--
--   CURRENT_ORDER_HAS_TWO_ACTIVE_BINDINGS = 0
--
-- The transaction now takes an advisory lock per (conversation, key), and this
-- index is the invariant itself: a writer that forgets the lock is refused by
-- the database rather than quietly producing a second truth.
CREATE UNIQUE INDEX IF NOT EXISTS reference_bindings_one_active_idx
  ON reference_bindings ("conversationId", "referenceKey")
  WHERE "supersededAt" IS NULL;
