import { supabase } from "@/integrations/supabase/client";

/** PostgREST caps a single request at 1000 rows. Fetch latest-per-scenario in chunks. */
export async function fetchLatestTestResultsByScenarioIds(
  scenarioIds: string[],
  columns: string,
): Promise<Map<string, any>> {
  const latest = new Map<string, any>();
  const chunkSize = 80;
  for (let i = 0; i < scenarioIds.length; i += chunkSize) {
    const chunk = scenarioIds.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const { data } = await supabase
      .from("test_results")
      .select(columns)
      .in("scenario_id", chunk)
      .order("created_at", { ascending: false })
      .limit(1000);
    for (const r of data || []) {
      const sid = (r as any).scenario_id as string;
      if (sid && !latest.has(sid)) latest.set(sid, r);
    }
  }
  return latest;
}
