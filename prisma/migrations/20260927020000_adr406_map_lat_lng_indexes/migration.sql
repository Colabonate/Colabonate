-- ADR-406 D6 (FU-913): composite indexes backing the viewport (bbox) marker
-- queries of GET /api/map/markers. Coordinates are stored as nullable floats
-- (Offer.lat/lng, Company.lat/lng, ADR-199), so the partial rows without
-- coordinates simply don't appear in the index.

CREATE INDEX "Offer_lat_lng_idx" ON "Offer"("lat", "lng");

CREATE INDEX "Company_lat_lng_idx" ON "Company"("lat", "lng");
