-- Durable provider-identity binding on payment intents: once set, only the
-- bound provider's authoritative readback may establish payment truth.
ALTER TABLE "payment_intents" ADD COLUMN "providerRef" varchar(96);
