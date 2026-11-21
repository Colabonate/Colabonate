-- ADR-240 D1/D2: self-serve non-custodial Lightning Address.
-- Adds the public handle we serve (`<handle>@<LNURLP_DOMAIN>`) and the
-- resolver mode. The router only proxies/mints on the user's own rail; the
-- platform never holds funds.

CREATE TYPE "LnAddressMode" AS ENUM ('EXTERNAL', 'NWC', 'CASHU');

ALTER TABLE "User" ADD COLUMN "lnAddressHandle" TEXT;
ALTER TABLE "User" ADD COLUMN "lnAddressMode" "LnAddressMode";

CREATE UNIQUE INDEX "User_lnAddressHandle_key" ON "User"("lnAddressHandle");
