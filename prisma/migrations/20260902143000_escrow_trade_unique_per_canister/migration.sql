-- ADR-362 review fix (2026-09-02): `EscrowTrade.canisterTradeId` was globally
-- unique, but the canister allocates trade ids from a per-instance counter
-- (`NEXT_TRADE_ID`) that restarts at 0 on every fresh install. Make uniqueness
-- composite on (canisterId, canisterTradeId) so a second canister principal
-- (or a reinstall) can never collide with stale mirror rows in the same DB.
-- `canisterId` is non-null, so the composite behaves like the old index for
-- every existing row.

DROP INDEX "EscrowTrade_canisterTradeId_key";

CREATE UNIQUE INDEX "EscrowTrade_canisterId_canisterTradeId_key"
  ON "EscrowTrade"("canisterId", "canisterTradeId");
