import { supabase } from "@/integrations/supabase/client";

function copyTitle(title: string): string {
  const t = String(title || "Untitled").trim() || "Untitled";
  if (/\(copy\)\s*$/i.test(t)) return t.replace(/\(copy\)\s*$/i, "").trim() + " (copy)";
  return `${t} (copy)`;
}

/** Duplicate a scenario under the same report: scenario + script + filter matrix. */
export async function duplicateScenario(scenarioId: string): Promise<{ id: string; title: string }> {
  const { data: src, error: sErr } = await supabase
    .from("scenarios")
    .select("*")
    .eq("id", scenarioId)
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  if (!src) throw new Error("Scenario not found");

  const newTitle = copyTitle(src.title);
  const { data: created, error: cErr } = await supabase
    .from("scenarios")
    .insert({
      report_id: src.report_id,
      title: newTitle,
      description: src.description,
      type: src.type,
      criticality: src.criticality,
      status: src.status || "active",
      prerun_id: src.prerun_id,
      reference_url: (src as any).reference_url ?? null,
      deferred: false,
    })
    .select("id, title")
    .single();
  if (cErr || !created) throw new Error(cErr?.message || "Failed to create scenario copy");

  const { data: script } = await supabase
    .from("scripts")
    .select("*")
    .eq("scenario_id", scenarioId)
    .maybeSingle();

  if (script) {
    const { error: scrErr } = await supabase.from("scripts").insert({
      scenario_id: created.id,
      playwright_code: script.playwright_code || "",
      assertion_spec: script.assertion_spec || {},
      sql_template_id: script.sql_template_id,
      sql_filters: script.sql_filters,
      credential_profile_id: (script as any).credential_profile_id ?? null,
      reference_credential_profile_id: (script as any).reference_credential_profile_id ?? null,
      debug_status: "draft",
    } as any);
    if (scrErr) throw new Error(scrErr.message);
  }

  const { data: matrix } = await supabase
    .from("scenario_filter_matrix")
    .select("label, filters")
    .eq("scenario_id", scenarioId)
    .order("created_at", { ascending: true });

  if (matrix?.length) {
    const rows = matrix.map((m) => ({
      scenario_id: created.id,
      label: m.label,
      filters: m.filters,
    }));
    const { error: mErr } = await supabase.from("scenario_filter_matrix").insert(rows);
    if (mErr) throw new Error(mErr.message);
  }

  return { id: created.id, title: created.title };
}

/** Duplicate a screen (report) and all of its scenarios (with scripts + filters). */
export async function duplicateReport(reportId: string): Promise<{ id: string; name: string }> {
  const { data: src, error: rErr } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (!src) throw new Error("Screen not found");

  const newName = copyTitle(src.name);
  const insertReport: any = {
    name: newName,
    url: src.url,
    workstream_id: src.workstream_id,
    brand_id: src.brand_id,
    credential_profile_id: src.credential_profile_id,
    reference_credential_profile_id: (src as any).reference_credential_profile_id ?? null,
    warehouse_connector_id: src.warehouse_connector_id,
    default_sql_template_id: src.default_sql_template_id,
    kpi_config: src.kpi_config,
    reference_url: (src as any).reference_url ?? null,
  };
  // Do not copy schedule_cron onto the duplicate.
  const { data: created, error: cErr } = await supabase
    .from("reports")
    .insert(insertReport)
    .select("id, name")
    .single();
  if (cErr || !created) throw new Error(cErr?.message || "Failed to create screen copy");

  const { data: preruns } = await supabase
    .from("prerun_scripts")
    .select("name, playwright_code")
    .eq("report_id", reportId);
  if (preruns?.length) {
    await supabase.from("prerun_scripts").insert(
      preruns.map((p) => ({
        report_id: created.id,
        name: p.name,
        playwright_code: p.playwright_code,
      })),
    );
  }

  const { data: scenarios } = await supabase
    .from("scenarios")
    .select("id")
    .eq("report_id", reportId)
    .order("created_at", { ascending: true });

  for (const s of scenarios || []) {
    const { data: full } = await supabase.from("scenarios").select("*").eq("id", s.id).maybeSingle();
    if (!full) continue;
    const { data: newSc } = await supabase
      .from("scenarios")
      .insert({
        report_id: created.id,
        title: full.title,
        description: full.description,
        type: full.type,
        criticality: full.criticality,
        status: full.status || "active",
        reference_url: (full as any).reference_url ?? null,
        deferred: !!full.deferred,
      })
      .select("id")
      .single();
    if (!newSc) continue;

    const { data: script } = await supabase.from("scripts").select("*").eq("scenario_id", s.id).maybeSingle();
    if (script) {
      await supabase.from("scripts").insert({
        scenario_id: newSc.id,
        playwright_code: script.playwright_code || "",
        assertion_spec: script.assertion_spec || {},
        sql_template_id: script.sql_template_id,
        sql_filters: script.sql_filters,
        credential_profile_id: (script as any).credential_profile_id ?? null,
        reference_credential_profile_id: (script as any).reference_credential_profile_id ?? null,
        debug_status: "draft",
      } as any);
    }

    const { data: matrix } = await supabase
      .from("scenario_filter_matrix")
      .select("label, filters")
      .eq("scenario_id", s.id);
    if (matrix?.length) {
      await supabase.from("scenario_filter_matrix").insert(
        matrix.map((m) => ({
          scenario_id: newSc.id,
          label: m.label,
          filters: m.filters,
        })),
      );
    }
  }

  return { id: created.id, name: created.name };
}
