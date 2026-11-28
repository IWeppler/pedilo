-- RLS sin políticas, como el resto de las tablas (0004): bloquea la Data API de Supabase.
-- courier_locations (0017) se creó sin activarlo.
ALTER TABLE "courier_locations" ENABLE ROW LEVEL SECURITY;
