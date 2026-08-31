import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/functions";
import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Play, Wand2, Plus, Trash2, ArrowLeft, History, RotateCcw, Sparkles, Check, X, Pencil, ExternalLink, Save, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

const canonFilters = (f: Record<string, string>) => {
  const keys = Object.keys(f || {}).map((k) => k.trim()).filter(Boolean).sort();
  return JSON.stringify(keys.map((k) => [k, String((f as any)[k] ?? "").trim()]));
};

export default function ScenarioDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { data: scenario } = useQuery({
    queryKey: ["scenario", id],
    queryFn: async () => (await supabase.from("scenarios").select("*, reports(id,name,url,reference_url,warehouse_connector_id,credential_profile_id,reference_credential_profile_id,default_sql_template_id)").eq("id", id!).maybeSingle()).data,
  });
  const { data: connectors } = useQuery({
    queryKey: ["wh-connectors"],
    queryFn: async () => (await supabase.from("warehouse_connectors").select("id,name,kind").order("created_at", { ascending: false })).data ?? [],
  });
  const bindConnector = async (value: string) => {
    const reportId = (scenario as any)?.reports?.id;
    if (!reportId) return;
    const v = value === "__none__" ? null : value;
    const { error } = await supabase.from("reports").update({ warehouse_connector_id: v }).eq("id", reportId);
    if (error) { toast.error(error.message); return; }
    toast.success("Warehouse bound");
    qc.invalidateQueries({ queryKey: ["scenario", id] });
  };
  const { data: script } = useQuery({
    queryKey: ["script", id],
    queryFn: async () => (await supabase.from("scripts").select("*").eq("scenario_id", id!).maybeSingle()).data,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    gcTime: 0,
  });
  const { data: templates, isFetching: templatesFetching } = useQuery({
    queryKey: ["sql-templates-bind"],
    queryFn: async () => (await supabase.from("sql_templates").select("id,name,scope,report_id,sql_text")).data ?? [],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    placeholderData: undefined,
    gcTime: 0,
  });

  const [code, setCode] = useState("");
  const [refCode, setRefCode] = useState("");
  const [spec, setSpec] = useState("{}");
  const [tplId, setTplId] = useState("");
  const [credId, setCredId] = useState("");
  const [refCredId, setRefCredId] = useState("");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<any>(null);
  const [running, setRunning] = useState<null | "headed" | "headless">(null);
  const [healing, setHealing] = useState(false);
  const [healProposal, setHealProposal] = useState<{ patched_playwright_code?: string; rationale?: string; changes?: string[] } | null>(null);
  const [maxRetries, setMaxRetries] = useState(10);
  const [autoHealing, setAutoHealing] = useState(false);
  const [autoHealLog, setAutoHealLog] = useState<string[]>([]);

  // Reference-script runtime (separate state from main runtime)
  const [refLiveUrl, setRefLiveUrl] = useState<string | null>(null);
  const [refRunError, setRefRunError] = useState<string | null>(null);
  const [refRunResult, setRefRunResult] = useState<any>(null);
  const [refRunning, setRefRunning] = useState<null | "headed" | "headless">(null);

  // SQL runner
  const [sqlResult, setSqlResult] = useState<any>(null);
  const [sqlRunning, setSqlRunning] = useState(false);
  const [editedSqlText, setEditedSqlText] = useState("");
  const [savingSqlText, setSavingSqlText] = useState(false);
  const [newTplOpen, setNewTplOpen] = useState(false);
  const [editingSql, setEditingSql] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [comboResults, setComboResults] = useState<Record<string, any>>({});
  const [comboRunning, setComboRunning] = useState<string | null>(null);
  const [allCombosRunning, setAllCombosRunning] = useState(false);
  const [kpiTolerances, setKpiTolerances] = useState<Record<string, Tolerance>>({});
  const [savingTolerances, setSavingTolerances] = useState(false);
  const [updatingRunResult, setUpdatingRunResult] = useState(false);
  const [kpiEditorOpen, setKpiEditorOpen] = useState(false);
  const [kpiDraft, setKpiDraft] = useState<string[]>([]);
  const [kpiNew, setKpiNew] = useState("");

  const scenarioType: string = (scenario as any)?.type || "warehouse_match";
  const isReferenceMatch = scenarioType === "reference_match";
  const referenceUrl: string = (scenario as any)?.reports?.reference_url || "";
  const primaryReportUrl: string = (scenario as any)?.reports?.url || "";
  const reportId = (scenario as any)?.reports?.id;
  const [refUrlDialogOpen, setRefUrlDialogOpen] = useState(false);
  const [refUrlDraft, setRefUrlDraft] = useState("");
  const [pendingSyncCode, setPendingSyncCode] = useState<string | null>(null);

  // Rewrite the main script so ALL references to the primary report URL point at
  // the reference URL. The auto-injected auth preamble hard-codes the report URL
  // in a `__reportUrl = "..."` literal AND calls `page.goto(__reportUrl, ...)`
  // multiple times, so a single first-occurrence swap on `page.goto` isn't
  // enough — we must replace every occurrence of the report URL literal.
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const swapGotoUrl = (src: string, newUrl: string): string => {
    if (!src) return src;
    let out = src;
    // 1) Replace every literal occurrence of the primary report URL with the reference URL.
    if (primaryReportUrl && newUrl && primaryReportUrl !== newUrl) {
      out = out.replace(new RegExp(escapeRegex(primaryReportUrl), "g"), newUrl);
    }
    // 2) Fallback: also swap the first `page.goto('...')` target in case the URL literal
    //    isn't the primary report URL (older/hand-edited scripts).
    const re = /(page\s*\.\s*goto\s*\(\s*)(['"`])([^'"`]*)\2/;
    if (re.test(out) && !out.includes(newUrl)) {
      out = out.replace(re, (_m, p1, q) => `${p1}${q}${newUrl}${q}`);
    }
    return out;
  };

  const syncRefFromMain = (sourceCode?: string) => {
    const src = sourceCode ?? code;
    if (!src) { toast.error("Generate the main script first"); return; }
    if (!referenceUrl) {
      setPendingSyncCode(src);
      setRefUrlDraft("");
      setRefUrlDialogOpen(true);
      return;
    }
    const swapped = swapGotoUrl(src, referenceUrl);
    setRefCode(swapped);
    toast.success("Reference script populated from main script");
  };

  const saveReferenceUrl = async () => {
    const url = refUrlDraft.trim();
    if (!url) { toast.error("Enter a reference URL"); return; }
    if (!reportId) { toast.error("No report bound"); return; }
    const { error } = await supabase.from("reports").update({ reference_url: url }).eq("id", reportId);
    if (error) { toast.error(error.message); return; }
    toast.success("Reference URL saved");
    qc.invalidateQueries({ queryKey: ["scenario", id] });
    const src = pendingSyncCode ?? code;
    if (src) setRefCode(swapGotoUrl(src, url));
    setPendingSyncCode(null);
    setRefUrlDialogOpen(false);
  };


  useEffect(() => {
    const reportDefaults: any = (scenario as any)?.reports || {};
    if (script) {
      setCode(script.playwright_code || "");
      const as: any = script.assertion_spec || {};
      setRefCode(as.__reference_playwright_code || "");
      setSpec(JSON.stringify(as, null, 2));
      setTplId(script.sql_template_id || reportDefaults.default_sql_template_id || "");
      setCredId((script as any).credential_profile_id || reportDefaults.credential_profile_id || "");
      setRefCredId((script as any).reference_credential_profile_id || reportDefaults.reference_credential_profile_id || "");
      setKpiTolerances(normalizeTolerances(as.kpi_tolerances));
    } else if (scenario) {
      setTplId((prev) => prev || reportDefaults.default_sql_template_id || "");
      setCredId((prev) => prev || reportDefaults.credential_profile_id || "");
      setRefCredId((prev) => prev || reportDefaults.reference_credential_profile_id || "");
    }
  }, [script, scenario]);

  const saveKpiTolerances = async (next: Record<string, Tolerance>) => {
    setKpiTolerances(next);
    if (!script) return;
    setSavingTolerances(true);
    try {
      const as: any = script.assertion_spec || {};
      const updated = { ...as, kpi_tolerances: next };
      await supabase.from("scripts").update({ assertion_spec: updated }).eq("id", script.id);
      setSpec(JSON.stringify(updated, null, 2));
      qc.invalidateQueries({ queryKey: ["script", id] });
    } finally {
      setSavingTolerances(false);
    }
  };

  const { data: credProfiles } = useQuery({
    queryKey: ["cred-profiles"],
    queryFn: async () => (await supabase.from("credential_profiles").select("id,name,login_url,username").order("name")).data ?? [],
  });

  // Persist a credential field to the script row immediately on selection.
  // If no script exists yet, keep it in local state only (it will be saved when
  // the script is first created / generated).
  const persistCredField = async (
    field: "credential_profile_id" | "reference_credential_profile_id",
    value: string | null,
  ) => {
    if (!script?.id) return;
    const { error } = await supabase.from("scripts").update({ [field]: value } as any).eq("id", script.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["script", id] });
    toast.success("Credentials updated");
  };

  const genScript = useMutation({
    mutationFn: async () => (await invokeFunction("agent-scripts", { scenario_id: id })).data,
    onSuccess: async () => {
      toast.success(script ? "Script regenerated" : "Script generated");
      qc.invalidateQueries({ queryKey: ["script", id] });
    },
    onError: (e: any) => toast.error(e?.message || "Generation failed"),
  });

  const genReferenceScript = useMutation({
    mutationFn: async () => {
      const { data, error } = await invokeFunction("agent-scripts", { scenario_id: id, target: "reference" });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: async (data: any) => {
      const genCode = data?.script?.assertion_spec?.__reference_playwright_code || "";
      if (genCode) setRefCode(genCode);
      toast.success("Reference script generated from description");
      qc.invalidateQueries({ queryKey: ["script", id] });
    },
    onError: (e: any) => toast.error(e?.message || "Reference script generation failed"),
  });


  const saveScript = async () => {
    let parsedSpec: any = {};
    try { parsedSpec = JSON.parse(spec); } catch { return toast.error("Assertion spec is not valid JSON"); }
    parsedSpec.__reference_playwright_code = refCode || undefined;
    const payload: any = { scenario_id: id, playwright_code: code, assertion_spec: parsedSpec, sql_template_id: tplId || null, credential_profile_id: credId || null, reference_credential_profile_id: refCredId || null };
    if (script) await supabase.from("scripts").update(payload).eq("id", script.id);
    else await supabase.from("scripts").insert(payload);
    toast.success("Script saved");
    qc.invalidateQueries({ queryKey: ["script", id] });
  };

  const runMode = async (mode: "headed" | "headless") => {
    setRunError(null); setRunResult(null); setLiveUrl(null); setRunning(mode);
    try {
      const { data, error } = await invokeFunction("playwright-runtime", { mode, scenario_id: id, code });
      const errorMessage = data?.message || error?.message || (data?.ok === false ? data?.error : null) || (!data ? "Run failed" : null);
      if (errorMessage) { setRunError(errorMessage); toast.error(errorMessage); return; }
      if (mode === "headed") {
        if (data?.live_url) setLiveUrl(data.live_url);
        else if (data?.requested_mode === "headed" && data?.mode === "headless") {
          setRunResult(data);
          toast.info(data.fallback_reason || "Live debug is unavailable; ran headless instead.");
        }
        else setRunError("Runtime did not return a live_url");
      } else {
        setRunResult(data);
        if (data?.extracted) toast.success(`Extracted ${Object.keys(data.extracted).length} KPIs`);
      }
    } catch (e: any) {
      setRunError(String(e?.message || e));
    } finally {
      setRunning(null);
    }
  };

  const healScript = async () => {
    setHealing(true); setHealProposal(null);
    try {
      const screenshot_b64 =
        runResult?.screenshot_b64 ||
        runResult?.extracted?.screenshot ||
        (runResult?.screenshot_url ? null : null);
      const { data, error } = await invokeFunction("agent-heal-script", {
        scenario_id: id,
        code,
        error: runError || (runResult?.ok === false ? runResult?.error : "") || "Script ran without an explicit error — improve robustness and KPI extraction.",
        run_result: runResult,
        screenshot_b64,
        screenshot_url: runResult?.screenshot_url || null,
      });
      if (error) throw error;
      if (!data?.proposal?.patched_playwright_code) throw new Error("No proposal returned");
      setHealProposal(data.proposal);
      toast.success("Healing proposal ready — review below");
    } catch (e: any) {
      toast.error(e?.message || "Healing failed");
    } finally {
      setHealing(false);
    }
  };

  const approveHeal = async () => {
    if (!healProposal?.patched_playwright_code) return;
    const newCode = healProposal.patched_playwright_code;
    setCode(newCode);
    const payload: any = { scenario_id: id, playwright_code: newCode, assertion_spec: (() => { try { return JSON.parse(spec); } catch { return {}; } })(), sql_template_id: tplId || null, credential_profile_id: credId || null, reference_credential_profile_id: refCredId || null };
    if (script) await supabase.from("scripts").update(payload).eq("id", script.id);
    else await supabase.from("scripts").insert(payload);
    setHealProposal(null); setRunError(null);
    toast.success("Script updated with healed version");
    qc.invalidateQueries({ queryKey: ["script", id] });
  };

  const autoHeal = async () => {
    if (autoHealing) return;
    setAutoHealing(true);
    setAutoHealLog([]);
    setHealProposal(null);
    const log = (m: string) => setAutoHealLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${m}`]);
    let currentCode = code;
    let lastResult: any = runResult;
    let lastError: string | null = runError;
    // Accumulated history of attempts so the heal agent learns from past errors
    const priorAttempts: Array<{ attempt: number; error: string | null; rationale?: string; changes?: string[]; run_result_excerpt?: any }> = [];
    const max = Math.max(1, Math.min(50, Number(maxRetries) || 10));
    try {
      for (let attempt = 1; attempt <= max; attempt++) {
        // 1. Run
        log(`Attempt ${attempt}/${max}: running headless…`);
        setRunning("headless"); setRunError(null); setLiveUrl(null);
        const { data: runData, error: runErr } = await invokeFunction("playwright-runtime", { mode: "headless", scenario_id: id, code: currentCode });
        setRunning(null);
        const errMsg = runData?.message || runErr?.message || (runData?.ok === false ? runData?.error : null);
        setRunResult(runData || null);
        lastResult = runData;
        lastError = errMsg || null;
        if (runData?.ok && !errMsg) {
          log(`✓ Script succeeded on attempt ${attempt}.`);
          toast.success(`Auto-heal converged after ${attempt} attempt(s)`);
          setRunError(null);
          return;
        }
        setRunError(errMsg || "Run failed");
        log(`✗ Failed: ${(errMsg || "unknown").slice(0, 200)}`);
        priorAttempts.push({
          attempt,
          error: lastError,
          run_result_excerpt: lastResult ? { ok: lastResult.ok, error: lastResult.error, extracted: lastResult.extracted } : null,
        });
        if (attempt === max) {
          log(`Reached max retries (${max}).`);
          toast.error(`Auto-heal exhausted ${max} attempts`);
          return;
        }
        // 2. Heal — pass full history so the agent learns from past failures
        log(`Requesting heal proposal (with ${priorAttempts.length} prior error(s))…`);
        const { data: healData, error: healErr } = await invokeFunction("agent-heal-script", {
          scenario_id: id,
          code: currentCode,
          error: lastError || "Improve robustness and KPI extraction.",
          run_result: lastResult,
          screenshot_b64: lastResult?.screenshot_b64 || lastResult?.extracted?.screenshot || null,
          screenshot_url: lastResult?.screenshot_url || null,
          playwright_version: "1.47.0",
          prior_attempts: priorAttempts,
        });
        if (healErr || !healData?.proposal?.patched_playwright_code) {
          log(`Heal failed: ${healErr?.message || "no proposal"}`);
          toast.error("Healing agent returned no proposal");
          return;
        }
        currentCode = healData.proposal.patched_playwright_code;
        setCode(currentCode);
        setHealProposal(healData.proposal);
        // Annotate the just-recorded attempt with what the agent tried
        const lastEntry = priorAttempts[priorAttempts.length - 1];
        if (lastEntry) {
          lastEntry.rationale = healData.proposal.rationale;
          lastEntry.changes = healData.proposal.changes;
        }
        // 3. Save
        const payload: any = { scenario_id: id, playwright_code: currentCode, assertion_spec: (() => { try { return JSON.parse(spec); } catch { return {}; } })(), sql_template_id: tplId || null, credential_profile_id: credId || null, reference_credential_profile_id: refCredId || null };
        if (script) await supabase.from("scripts").update(payload).eq("id", script.id);
        else await supabase.from("scripts").insert(payload);
        log(`Applied heal v${attempt}: ${(healData.proposal.rationale || "").slice(0, 120)}`);
      }
    } catch (e: any) {
      log(`Error: ${e?.message || e}`);
      toast.error(e?.message || "Auto-heal failed");
    } finally {
      setAutoHealing(false);
      qc.invalidateQueries({ queryKey: ["script", id] });
    }
  };

  const runRefMode = async (mode: "headed" | "headless") => {
    setRefRunError(null); setRefRunResult(null); setRefLiveUrl(null); setRefRunning(mode);
    try {
      const { data, error } = await invokeFunction("playwright-runtime", { mode, scenario_id: id, code: refCode, target: "reference" });
      const errorMessage = data?.message || error?.message || (data?.ok === false ? data?.error : null) || (!data ? "Run failed" : null);
      if (errorMessage) { setRefRunError(errorMessage); toast.error(errorMessage); return; }
      if (mode === "headed") {
        if (data?.live_url) setRefLiveUrl(data.live_url);
        else if (data?.requested_mode === "headed" && data?.mode === "headless") {
          setRefRunResult(data);
          toast.info(data.fallback_reason || "Live debug is unavailable; ran headless instead.");
        } else setRefRunError("Runtime did not return a live_url");
      } else {
        setRefRunResult(data);
        if (data?.extracted) toast.success(`Reference: extracted ${Object.keys(data.extracted).length} KPIs`);
      }
    } catch (e: any) {
      setRefRunError(String(e?.message || e));
    } finally {
      setRefRunning(null);
    }
  };

  const runSql = async () => {
    setSqlRunning(true); setSqlResult(null);
    try {
      const { data, error } = await invokeFunction("run-warehouse-sql", { sql_template_id: tplId || null, scenario_id: id, limit: 5 });
      if (error) throw error;
      setSqlResult(data);
      if (data?.ok) toast.success(`${data.source === "snowflake" ? "Snowflake" : "Mock"}: ${data.row_count} row(s)`);
      else toast.error(data?.error || "SQL failed");
    } catch (e: any) {
      setSqlResult({ ok: false, error: e?.message || "SQL run failed" });
      toast.error(e?.message || "SQL run failed");
    } finally {
      setSqlRunning(false);
    }
  };

  // Filter combinations + FE↔BE key map (cached; shared with FilterCombinations component)
  const { data: combos } = useQuery({
    queryKey: ["scenario-filter-matrix", id],
    queryFn: async () =>
      ((await supabase
        .from("scenario_filter_matrix")
        .select("id,label,filters")
        .eq("scenario_id", id!)
        .order("created_at", { ascending: true })).data ?? []) as any[],
  });
  const reportIdForMap = (scenario as any)?.reports?.id as string | undefined;
  const { data: keyMap } = useQuery({
    queryKey: ["report-filter-key-map", reportIdForMap],
    enabled: !!reportIdForMap,
    queryFn: async () =>
      ((await supabase
        .from("scenario_filter_key_map")
        .select("id,fe_label,be_column")
        .eq("report_id", reportIdForMap!)
        .order("created_at", { ascending: true })).data ?? []) as any[],
  });

  const buildWhereForCombo = (combo: any): { where: string; pairs: { fe: string; be: string; value: string }[]; missing: string[] } => {
    const map = new Map<string, string>((keyMap ?? []).map((k: any) => [k.fe_label, k.be_column] as [string, string]));
    const pairs: { fe: string; be: string; value: string }[] = [];
    const missing: string[] = [];
    for (const [fe, v] of Object.entries(combo?.filters || {})) {
      const val = String(v ?? "");
      // "Total" is a UI-only sentinel — apply it on the page for Playwright, but skip in SQL WHERE.
      if (val.trim().toLowerCase() === "total") continue;
      const be = map.get(fe);
      if (!be) { missing.push(fe); continue; }
      pairs.push({ fe, be, value: val });
    }
    const esc = (s: string) => s.replace(/'/g, "''");
    const where = pairs.map((p) => `"${p.be}" = '${esc(p.value)}'`).join(" AND ");
    return { where, pairs, missing };
  };

  const runComboSql = async (combo: any) => {
    if (!tplId) { toast.error("Select a SQL template first"); return; }
    const { where, pairs, missing } = buildWhereForCombo(combo);
    if (!where) {
      const msg = missing.length
        ? `No FE→BE mapping for: ${missing.join(", ")}. Add mappings via "FE ↔ BE key mapping".`
        : "This combination has no filters to apply.";
      setComboResults((prev) => ({ ...prev, [combo.id]: { ok: false, error: msg } }));
      toast.error(msg);
      return;
    }
    setComboRunning(combo.id);
    try {
      const { data, error } = await invokeFunction("run-warehouse-sql", {
        sql_template_id: tplId,
        scenario_id: id,
        where_clause: where,
        filter_pairs: pairs.map((p) => ({ be: p.be, value: p.value })),
        limit: 5,
      });
      if (error) throw error;
      setComboResults((prev) => ({ ...prev, [combo.id]: { ...data, where_clause: where, pairs, missing } }));
      if (data?.ok) toast.success(`${combo.label || "Combination"}: ${data.row_count} row(s)`);
      else toast.error(data?.error || "SQL failed");
    } catch (e: any) {
      setComboResults((prev) => ({ ...prev, [combo.id]: { ok: false, error: e?.message || "SQL failed", where_clause: where } }));
      toast.error(e?.message || "SQL failed");
    } finally {
      setComboRunning(null);
    }
  };

  const runAllCombos = async () => {
    if (!combos?.length) { toast.error("No filter combinations defined"); return; }
    if (!tplId) { toast.error("Select a SQL template first"); return; }
    setAllCombosRunning(true);
    try {
      for (const c of combos) {
        await runComboSql(c);
      }
    } finally {
      setAllCombosRunning(false);
    }
  };


  const { data: latestResults } = useQuery({
    queryKey: ["scenario-results", id],
    queryFn: async () =>
      (await supabase
        .from("test_results")
        .select("id, run_id, status, expected, actual, diff, analysis, screenshot_url, created_at")
        .eq("scenario_id", id!)
        .order("created_at", { ascending: false })
        .limit(25)).data ?? [],
  });
  const latest = latestResults?.[0];
  const selectedTpl = (templates || []).find((t: any) => t.id === tplId);
  useEffect(() => {
    setEditedSqlText((selectedTpl as any)?.sql_text || "");
    setEditingSql(false);
  }, [tplId, (selectedTpl as any)?.sql_text]);
  const sqlDirty = !!selectedTpl && editedSqlText !== ((selectedTpl as any)?.sql_text || "");
  const saveSqlText = async (): Promise<boolean> => {
    if (!selectedTpl) return false;
    setSavingSqlText(true);
    const { error } = await supabase.from("sql_templates").update({ sql_text: editedSqlText }).eq("id", (selectedTpl as any).id);
    setSavingSqlText(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return false; }
    toast.success("SQL template updated");
    qc.invalidateQueries({ queryKey: ["sql-templates-bind"] });
    qc.invalidateQueries({ queryKey: ["sql-templates"] });
    return true;
  };
  const saveAndRunSql = async () => {
    if (sqlDirty) {
      const ok = await saveSqlText();
      if (!ok) return;
    }
    setEditingSql(false);
    await runSql();
  };
  const cancelEditSql = () => {
    if (sqlDirty) { setDiscardOpen(true); return; }
    setEditingSql(false);
  };
  const confirmDiscard = () => {
    setEditedSqlText(((selectedTpl as any)?.sql_text) || "");
    setEditingSql(false);
    setDiscardOpen(false);
  };


  // Build "manual" latest from in-memory run results: Test Script (Run headless/headed)
  // populates the Actual column; Warehouse SQL (Run) populates the Expected column
  // (or the Reference Script output when this is a reference_match scenario).
  const extractKpisFromRun = (rr: any): Record<string, any> | null => {
    const candidates = [
      rr?.extracted?.extracted,
      rr?.extracted?.result?.extracted,
      rr?.result?.extracted,
      rr?.extracted?.result,
      rr?.result,
      rr?.extracted,
    ];
    for (const ex of candidates) {
      if (!ex || typeof ex !== "object") continue;
      const out: Record<string, any> = {};
      if (ex.kpis && typeof ex.kpis === "object" && !Array.isArray(ex.kpis)) {
        for (const [k, v] of Object.entries(ex.kpis)) {
          if (v === null || typeof v === "object" || typeof v === "boolean") continue;
          out[k] = v;
        }
      }
      for (const [k, v] of Object.entries(ex)) {
        if (k.startsWith("__")) continue;
        if (["screenshot", "screenshot_b64", "screenshot_url", "title", "note", "url", "ok", "error", "result", "extracted", "kpis", "raw_values", "debug", "page_snapshot", "report_url", "filters_applied"].includes(k)) continue;
        if (v === null || typeof v === "object" || typeof v === "boolean") continue;
        if (out[k] !== undefined) continue;
        out[k] = v;
      }
      if (Object.keys(out).length) return out;
    }
    return null;
  };
  const manualActual = extractKpisFromRun(runResult);
  const manualReference = isReferenceMatch ? extractKpisFromRun(refRunResult) : null;
  const manualExpected = (() => {
    if (isReferenceMatch) return manualReference;
    if (!sqlResult?.ok) return null;
    if (sqlResult.scalar !== undefined && sqlResult.scalar !== null) {
      const col = sqlResult.columns?.[0] || "value";
      return { [col]: sqlResult.scalar };
    }
    const row = sqlResult.rows?.[0];
    if (row && typeof row === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        if (v === null || typeof v === "object") continue;
        out[k] = v;
      }
      return Object.keys(out).length ? out : null;
    }
    return null;
  })();
  const hasComboData = !!runResult || Object.keys(comboResults).length > 0 || !!refRunResult;
  const hasManual = !!(manualActual || manualExpected) || (!!combos?.length && hasComboData);
  // Suite-stored test_results wrap KPI maps under `.values` (alongside filter / filters_applied / source).
  // Unwrap so KpiRowsTable receives a flat KPI map, matching the live (manual) shape.
  const unwrapSuiteKpis = (block: any): any => {
    if (!block || typeof block !== "object") return block;
    if (block.values && typeof block.values === "object" && !Array.isArray(block.values)) return block.values;
    return block;
  };
  const displayActual = hasManual ? (manualActual ?? {}) : unwrapSuiteKpis(latest?.actual);
  const displayExpected = hasManual ? (manualExpected ?? {}) : unwrapSuiteKpis(latest?.expected);
  const displayDiff = hasManual ? null : latest?.diff;

  // When there's no live manual run, hydrate FilterComparisonTable from the latest suite run's
  // test_results rows so the per-combo Actual / Expected / Filter cells render with stored values.
  const suiteRunData = (() => {
    if (hasManual) return null;
    if (!combos?.length) return null;
    if (!latest?.run_id || !latestResults?.length) return null;
    const rows = latestResults.filter((r: any) => r.run_id === latest.run_id);
    if (!rows.length) return null;
    const pwResult: Record<string, any> = {};
    const refResult: Record<string, any> = {};
    const comboMap: Record<string, any> = {};
    for (const r of rows as any[]) {
      const label = r.actual?.filter || r.expected?.filter;
      if (!label) continue;
      const actualValues = (r.actual && typeof r.actual === "object" && r.actual.values && typeof r.actual.values === "object") ? r.actual.values : null;
      const expectedValues = (r.expected && typeof r.expected === "object" && r.expected.values && typeof r.expected.values === "object") ? r.expected.values : null;
      const filtersApplied = r.actual?.filters_applied || null;
      if (actualValues) pwResult[label] = { ...actualValues, filters_applied: filtersApplied };
      const combo = combos.find((c: any) => c.label === label);
      if (expectedValues) {
        if (isReferenceMatch) {
          refResult[label] = { ...expectedValues };
        } else if (combo) {
          const cols = Object.keys(expectedValues);
          comboMap[combo.id] = { ok: true, rows: [expectedValues], columns: cols };
        }
      }
    }
    return {
      runResult: Object.keys(pwResult).length ? { result: pwResult } : null,
      refRunResult: Object.keys(refResult).length ? { result: refResult } : null,
      comboResults: comboMap,
    };
  })();
  const effectiveRunResult = runResult || suiteRunData?.runResult || null;
  const effectiveRefRunResult = refRunResult || suiteRunData?.refRunResult || null;
  const effectiveComboResults = (Object.keys(comboResults).length ? comboResults : (suiteRunData?.comboResults || {}));

  // ----- Compute displayed overall status (drives "Update run suite result" button) -----
  const _rootOf = (rr: any) => rr?.result || rr?.extracted?.result || rr?.extracted?.extracted || rr?.extracted || null;
  const _blockFor = (root: any, label: string, idx: number, comboId?: string) =>
    (root && (root[label] || root[`Filter #${idx + 1}`] || root[`combo_${idx + 1}`] || root[`combo${idx + 1}`] || (comboId && root[comboId]))) || null;
  const _normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const _lookupKpi = (obj: any, k: string): any => {
    if (!obj || typeof obj !== "object") return null;
    if (obj[k] !== undefined) return obj[k];
    const t = _normKey(k);
    const f = Object.keys(obj).find((rk) => _normKey(rk) === t);
    return f ? obj[f] : null;
  };

  const manualPerCombo = (() => {
    if (!combos?.length) return null;
    const pwRoot = _rootOf(runResult);
    const refRoot = _rootOf(refRunResult);
    return combos.map((c: any, idx: number) => {
      const label = c.label || `Filter #${idx + 1}`;
      const pwBlock = _blockFor(pwRoot, label, idx, c.id);
      const refBlock = _blockFor(refRoot, label, idx, c.id);
      const actualMap = extractKpisFromBlock(pwBlock);
      const refKpis = refBlock ? extractKpisFromBlock(refBlock) : null;
      const sqlRes = comboResults[c.id] || (sqlResult?.ok ? sqlResult : null);
      const expectedMap: Record<string, any> = {};
      const passes: (boolean | null)[] = [];
      for (const [k, v] of Object.entries(actualMap)) {
        const exp = isReferenceMatch
          ? (_lookupKpi(refKpis, k) ?? _lookupKpi(manualReference, k))
          : expectedForKpi(sqlRes, k);
        expectedMap[k] = exp;
        passes.push(evalPass(v, exp, getTol(kpiTolerances, k)));
      }
      const valid = passes.filter((p) => p !== null);
      const status: "pass" | "fail" | "pending" =
        valid.length === 0 ? "pending" : valid.every(Boolean) ? "pass" : "fail";
      return { combo: c, label, actualMap, expectedMap, status, filters: c.filters || {} };
    });
  })();

  const displayedStatus: "pass" | "fail" | "pending" = (() => {
    if (manualPerCombo && manualPerCombo.length) {
      if (manualPerCombo.every((p) => p.status === "pass")) return "pass";
      if (manualPerCombo.some((p) => p.status === "fail")) return "fail";
      return "pending";
    }
    const kpis = displayActual && typeof displayActual === "object" ? displayActual : {};
    const keys = Object.keys(kpis).filter((k) => !k.startsWith("__"));
    if (!keys.length) return "pending";
    const passes = keys.map((k) => {
      let exp = sqlResult?.ok ? expectedForKpi(sqlResult, k) : null;
      if ((exp === null || exp === undefined) && displayExpected && typeof displayExpected === "object") {
        exp = (displayExpected as any)[k] ?? null;
      }
      return evalPass(kpis[k], exp, getTol(kpiTolerances, k));
    }).filter((p) => p !== null);
    if (!passes.length) return "pending";
    return passes.every(Boolean) ? "pass" : "fail";
  })();

  // Tolerances that were stored alongside the latest run (per-run snapshot).
  // Used both to detect "has the user changed tolerances since the last run?"
  // and to enable the Reset button so the user can revert to the last run's values.
  const lastRunTolerances: Record<string, Tolerance> = (() => {
    if (!latest?.run_id || !latestResults?.length) return {};
    const rows = (latestResults as any[]).filter((r) => r.run_id === latest.run_id);
    const merged: Record<string, any> = {};
    for (const r of rows) {
      const snap = r?.actual?.tolerances_snapshot;
      if (snap && typeof snap === "object") {
        for (const [k, v] of Object.entries(snap)) if (!(k in merged)) merged[k] = v;
      }
      const d = r?.diff;
      if (d && typeof d === "object") {
        for (const [k, v] of Object.entries(d as any)) {
          if (!(k in merged) && v && typeof v === "object" && (v as any).tolerance) merged[k] = (v as any).tolerance;
        }
      }
    }
    return normalizeTolerances(merged);
  })();

  const tolerancesChanged = (() => {
    const keys = new Set<string>([...Object.keys(kpiTolerances || {}), ...Object.keys(lastRunTolerances || {})]);
    for (const k of keys) {
      const a = kpiTolerances[k] || { value: 0, unit: "pct", op: "eq" };
      const b = lastRunTolerances[k] || { value: 0, unit: "pct", op: "eq" };
      if (Number(a.value || 0) !== Number(b.value || 0)) return true;
      if ((a.unit || "pct") !== (b.unit || "pct")) return true;
      if ((a.op || "eq") !== (b.op || "eq")) return true;
    }
    return false;
  })();

  const canUpdateRunResult =
    !!latest?.run_id &&
    (
      tolerancesChanged ||
      hasManual ||
      (displayedStatus !== "pending" && displayedStatus !== latest?.status)
    );

  const resetTolerancesToLastRun = () => {
    if (!Object.keys(lastRunTolerances).length) {
      toast.info("No previous run tolerances to reset to");
      return;
    }
    saveKpiTolerances(lastRunTolerances);
    toast.success("Tolerances reset to last run");
  };

  const updateRunResult = async () => {
    if (!latest?.run_id || !canUpdateRunResult) return;
    setUpdatingRunResult(true);
    try {
      // Build a serializable snapshot of the tolerances the user just committed.
      const snapshot: Record<string, any> = {};
      for (const [k, v] of Object.entries(kpiTolerances || {})) {
        snapshot[k] = { value: Number(v?.value) || 0, unit: v?.unit === "abs" ? "abs" : "pct", op: isValidOp(v?.op) ? v.op : "eq" };
      }
      const hasKpiValues = (map: any) =>
        !!map && typeof map === "object" && Object.values(map).some((v) => v !== null && v !== undefined);
      const mergeKpiValues = (prev: Record<string, any>, next: Record<string, any>) => {
        const merged = { ...(prev || {}) };
        for (const [k, v] of Object.entries(next || {})) {
          if (v !== null && v !== undefined) merged[k] = v;
        }
        return merged;
      };
      const valuesFromStoredBlock = (block: any): Record<string, any> => {
        if (!block || typeof block !== "object") return {};
        if (block.values && typeof block.values === "object" && !Array.isArray(block.values)) return block.values;
        return extractKpisFromBlock(block);
      };
      const statusForValues = (actualValues: Record<string, any>, expectedValues: Record<string, any>): "pass" | "fail" | "pending" => {
        const passes = Object.keys(actualValues || {})
          .map((k) => evalPass(actualValues[k], _lookupKpi(expectedValues, k), getTol(kpiTolerances, k)))
          .filter((p) => p !== null);
        if (!passes.length) return "pending";
        return passes.every(Boolean) ? "pass" : "fail";
      };
      // Always fetch existing rows so we can MERGE tolerances_snapshot without
      // wiping the recorded actual/expected values from that run.
      const { data: runRows } = await supabase
        .from("test_results")
        .select("id, actual, expected, status")
        .eq("scenario_id", id!)
        .eq("run_id", latest.run_id);

      const hasLiveManualPerCombo = !!manualPerCombo?.some((p) => hasKpiValues(p.actualMap) || hasKpiValues(p.expectedMap));
      if (manualPerCombo && hasLiveManualPerCombo) {
        const byLabel = new Map<string, any>();
        (runRows || []).forEach((r: any) => {
          const lbl = r.actual?.filter || r.expected?.filter || r.actual?.filters_applied?.__label;
          if (lbl) byLabel.set(String(lbl), r);
        });
        // If the stored rows for this run don't carry combo labels (typical for
        // synthetic error rows written by the orchestrator when script generation
        // failed), we can't match them to the current filter combos. Wipe those
        // rows and insert one fresh row per combo so Sync actually replaces the
        // failure with the manual results.
        const noLabelledRows = byLabel.size === 0 && (runRows || []).length > 0;
        if (noLabelledRows) {
          const idsToDelete = (runRows || []).map((r: any) => r.id);
          if (idsToDelete.length) {
            await supabase.from("test_results").delete().in("id", idsToDelete);
          }
          for (const p of manualPerCombo) {
            const nextActualValues = hasKpiValues(p.actualMap) ? mergeKpiValues({}, p.actualMap) : {};
            const nextExpectedValues = hasKpiValues(p.expectedMap) ? mergeKpiValues({}, p.expectedMap) : {};
            await supabase.from("test_results").insert({
              run_id: latest.run_id,
              scenario_id: id!,
              status: statusForValues(nextActualValues, nextExpectedValues),
              actual: { filter: p.label, values: nextActualValues, filters_applied: p.filters ?? null, tolerances_snapshot: snapshot },
              expected: { filter: p.label, values: nextExpectedValues },
              diff: null,
              analysis: "Updated from manual scenario run",
            });
          }
        } else {
          for (const p of manualPerCombo) {
            const existing = byLabel.get(p.label);
            if (!existing) continue;
            const prevActual = (existing.actual && typeof existing.actual === "object") ? existing.actual : {};
            const prevExpected = (existing.expected && typeof existing.expected === "object") ? existing.expected : {};
            const prevActualValues = valuesFromStoredBlock(prevActual);
            const prevExpectedValues = valuesFromStoredBlock(prevExpected);
            const nextActualValues = hasKpiValues(p.actualMap) ? mergeKpiValues(prevActualValues, p.actualMap) : prevActualValues;
            const nextExpectedValues = hasKpiValues(p.expectedMap) ? mergeKpiValues(prevExpectedValues, p.expectedMap) : prevExpectedValues;
            await supabase.from("test_results").update({
              status: statusForValues(nextActualValues, nextExpectedValues),
              actual: { ...prevActual, filter: p.label, values: nextActualValues, filters_applied: p.filters ?? prevActual.filters_applied ?? null, tolerances_snapshot: snapshot },
              expected: { ...prevExpected, filter: p.label, values: nextExpectedValues },
              diff: null,
              analysis: "Updated from manual scenario run",
            }).eq("id", existing.id);
          }
        }
      } else {
        // No combos: merge live manual run values (test/reference script output) into the
        // stored row so a fresh manual run updates the recorded actual/expected/status,
        // not just the tolerance snapshot.
        const liveActual = (manualActual && typeof manualActual === "object") ? manualActual : {};
        const liveExpected = (manualExpected && typeof manualExpected === "object") ? manualExpected : {};
        for (const row of (runRows || [])) {
          const prevActual = (row.actual && typeof row.actual === "object") ? row.actual : {};
          const prevExpected = (row.expected && typeof row.expected === "object") ? row.expected : {};
          const prevActualValues = valuesFromStoredBlock(prevActual);
          const prevExpectedValues = valuesFromStoredBlock(prevExpected);
          const nextActualValues = hasKpiValues(liveActual) ? mergeKpiValues(prevActualValues, liveActual) : prevActualValues;
          const nextExpectedValues = hasKpiValues(liveExpected) ? mergeKpiValues(prevExpectedValues, liveExpected) : prevExpectedValues;
          const nextActual: any = { ...prevActual, tolerances_snapshot: snapshot };
          const nextExpected: any = { ...prevExpected };
          if (hasKpiValues(liveActual) || prevActual.values) nextActual.values = nextActualValues;
          if (hasKpiValues(liveExpected) || prevExpected.values) nextExpected.values = nextExpectedValues;
          await supabase.from("test_results").update({
            status: statusForValues(nextActualValues, nextExpectedValues),
            actual: nextActual,
            expected: nextExpected,
            diff: null,
            analysis: hasKpiValues(liveActual) || hasKpiValues(liveExpected) ? "Updated from manual scenario run" : (row as any).analysis ?? null,
          }).eq("id", row.id);
        }
      }
      // Roll up to the run row so the Runs list/badge reflect the corrected status.
      const { data: allRows } = await supabase.from("test_results").select("status").eq("run_id", latest.run_id);
      const pass = (allRows || []).filter((r: any) => r.status === "pass").length;
      const fail = (allRows || []).filter((r: any) => r.status === "fail").length;
      await supabase.from("runs").update({ summary: { pass, fail, total: (allRows || []).length } }).eq("id", latest.run_id);
      toast.success("Synced to last run");
      qc.invalidateQueries({ queryKey: ["scenario-results", id] });
      qc.invalidateQueries({ queryKey: ["run", latest.run_id] });
      qc.invalidateQueries({ queryKey: ["runs"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to update");
    } finally {
      setUpdatingRunResult(false);
    }
  };


  if (!scenario) return <AppLayout><div className="p-8">Loading…</div></AppLayout>;

  return (
    <AppLayout>
      <div className="p-8 space-y-4">
        <Link to={`/reports/${(scenario as any).reports?.id}`} className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> {(scenario as any).reports?.name}
        </Link>
        <ScenarioMeta s={scenario} />

        {(() => {
          const extracted = new Set<string>();
          for (const k of Object.keys(kpiTolerances || {})) extracted.add(k);
          for (const k of Object.keys(displayActual || {})) if (!k.startsWith("__")) extracted.add(k);
          for (const k of Object.keys(displayExpected || {})) if (!k.startsWith("__")) extracted.add(k);
          const scriptKpis = (script as any)?.assertion_spec?.kpis;
          if (Array.isArray(scriptKpis)) {
            for (const k of scriptKpis) if (typeof k === "string" && k.trim()) extracted.add(k);
          } else if (scriptKpis && typeof scriptKpis === "object") {
            for (const k of Object.keys(scriptKpis)) extracted.add(k);
          }
          const kpiKeys = Array.from(extracted).sort();
          return (
            <TolerancesEditor
              kpiKeys={kpiKeys}
              tolerances={kpiTolerances}
              onChange={saveKpiTolerances}
              saving={savingTolerances}
              showOperator={isReferenceMatch}
              onReset={resetTolerancesToLastRun}
              canReset={tolerancesChanged && Object.keys(lastRunTolerances).length > 0}
              onAddRemove={() => {
                setKpiDraft(kpiKeys);
                setKpiNew("");
                setKpiEditorOpen(true);
              }}
            />
          );
        })()}

        <Dialog open={kpiEditorOpen} onOpenChange={setKpiEditorOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add / Remove KPIs</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-xs">
              <div className="text-muted-foreground">
                KPIs listed here appear in the tolerances table. Pass/fail is evaluated using the tolerance value, unit (% or absolute) and condition set for each KPI.
              </div>
              <div className="space-y-1 max-h-72 overflow-auto">
                {kpiDraft.length === 0 && (
                  <div className="text-muted-foreground text-[11px] py-1">No KPIs yet — add one below.</div>
                )}
                {kpiDraft.map((k, i) => (
                  <div key={`${k}-${i}`} className="flex items-center gap-2">
                    <Input
                      value={k}
                      onChange={(e) => {
                        const next = [...kpiDraft];
                        next[i] = e.target.value;
                        setKpiDraft(next);
                      }}
                      className="h-7 text-xs mono flex-1"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive"
                      onClick={() => setKpiDraft(kpiDraft.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 border-t border-border pt-2">
                <Input
                  placeholder="New KPI name (e.g. impressions)"
                  value={kpiNew}
                  onChange={(e) => setKpiNew(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = kpiNew.trim();
                      if (v && !kpiDraft.includes(v)) setKpiDraft([...kpiDraft, v]);
                      setKpiNew("");
                    }
                  }}
                  className="h-7 text-xs mono flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    const v = kpiNew.trim();
                    if (v && !kpiDraft.includes(v)) setKpiDraft([...kpiDraft, v]);
                    setKpiNew("");
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />Add
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setKpiEditorOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                onClick={async () => {
                  const cleaned = Array.from(new Set(kpiDraft.map((s) => s.trim()).filter(Boolean)));
                  const globalOp = getGlobalOp(kpiTolerances);
                  const next: Record<string, Tolerance> = {};
                  for (const k of cleaned) {
                    next[k] = kpiTolerances[k] ?? { value: 0, unit: "pct", op: globalOp };
                  }
                  await saveKpiTolerances(next);
                  setKpiEditorOpen(false);
                  toast.success("KPIs updated");
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <FilterCombinations scenarioId={id!} reportId={(scenario as any).reports?.id} />

        <Tabs defaultValue="script">
          <TabsList>
            <TabsTrigger value="script">Test script</TabsTrigger>
            {isReferenceMatch && <TabsTrigger value="ref">Reference script</TabsTrigger>}
            {!isReferenceMatch && <TabsTrigger value="sql">Warehouse SQL</TabsTrigger>}
            <TabsTrigger value="result">Latest result</TabsTrigger>
          </TabsList>

          {/* TAB 1 — Test script + embedded runtime */}
          <TabsContent value="script" className="space-y-3 mt-4">
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between">
                <CardTitle className="text-sm">Playwright code · {((script as any)?.assertion_spec?.__main_uses_reference_source) ? "reference report" : "main report"}</CardTitle>
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-muted-foreground">Credentials:</span>
                  <Select value={credId || "__none__"} onOpenChange={(o) => { if (o) qc.invalidateQueries({ queryKey: ["cred-profiles"] }); }} onValueChange={(v) => {
                    if (v === "__add_new__") {
                      const reportUrl = (scenario as any)?.reports?.url || "";
                      const qs = reportUrl ? `&loginUrl=${encodeURIComponent(reportUrl)}` : "";
                      window.open(`/settings?tab=creds${qs}`, "_blank");
                      return;
                    }
                    setCredId(v === "__none__" ? "" : v);
                    persistCredField("credential_profile_id", v === "__none__" ? null : v);
                  }}>
                    <SelectTrigger className="h-9 w-56 text-xs">
                      <SelectValue placeholder="— Use report default —">
                        {credId ? ((credProfiles || []).find((c: any) => c.id === credId)?.name ?? "—") : "— Use report default —"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Use report default —</SelectItem>
                      {(credProfiles || []).map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}{c.username ? ` · ${c.username}` : ""}</SelectItem>
                      ))}
                      <SelectItem value="__add_new__" className="text-primary">
                        <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" />Add New Credentials<ExternalLink className="h-3 w-3 ml-1" /></span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <ScriptHistory scenarioId={id!} scriptId={script?.id} onRestore={(v) => { setCode(v.playwright_code || ""); setSpec(JSON.stringify(v.assertion_spec || {}, null, 2)); setTplId(v.sql_template_id || ""); toast.success(`Loaded v${v.version} — click Save to apply`); }} />
                  <Button size="sm" variant="outline" disabled={genScript.isPending} onClick={() => genScript.mutate()}>
                    {script ? <RotateCcw className="h-3 w-3 mr-1" /> : <Wand2 className="h-3 w-3 mr-1" />}
                    {genScript.isPending ? (script ? "Regenerating…" : "Generating…") : (script ? "Regenerate" : "Generate")}
                  </Button>
                  <Button size="sm" onClick={saveScript}>Save</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea className="mono text-xs min-h-[260px]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="// Playwright code…" />
              </CardContent>
            </Card>
            <RuntimeBlock
              title="Runtime · main"
              running={running}
              onRun={runMode}
              liveUrl={liveUrl}
              runError={runError}
              runResult={runResult}
              extra={
                <>
                  <div className="flex items-center gap-1 ml-2 border border-border rounded px-2 py-1">
                    <span className="text-[10px] uppercase text-muted-foreground">Max retries</span>
                    <Input type="number" min={1} max={50} value={maxRetries} onChange={(e) => setMaxRetries(Number(e.target.value) || 1)} className="h-7 w-16 text-xs" disabled={autoHealing} />
                    <Button size="sm" disabled={autoHealing || !!running} onClick={autoHeal}>
                      <Sparkles className="h-3 w-3 mr-1" />{autoHealing ? "Auto-healing…" : "Auto-heal"}
                    </Button>
                  </div>
                </>
              }
              footer={
                <>
                  {autoHealLog.length > 0 && (
                    <div className="rounded border border-border bg-secondary/30 text-[11px] p-2 mono max-h-48 overflow-auto">
                      <div className="font-semibold mb-1 text-foreground">Auto-heal log</div>
                      {autoHealLog.map((l, i) => <div key={i} className="text-muted-foreground whitespace-pre-wrap">{l}</div>)}
                    </div>
                  )}
                  {healProposal && (
                    <div className="rounded border border-primary/40 bg-primary/5 text-xs p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-foreground">Healing proposal</div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setHealProposal(null)}><X className="h-3 w-3 mr-1" />Reject</Button>
                          <Button size="sm" onClick={approveHeal}><Check className="h-3 w-3 mr-1" />Approve & save</Button>
                        </div>
                      </div>
                      {healProposal.rationale && <div className="text-muted-foreground whitespace-pre-wrap">{healProposal.rationale}</div>}
                      {!!healProposal.changes?.length && (
                        <ul className="list-disc pl-5 text-muted-foreground">{healProposal.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
                      )}
                      <pre className="mono text-[10px] p-2 rounded bg-secondary/40 overflow-auto max-h-80 border border-border">{healProposal.patched_playwright_code}</pre>
                    </div>
                  )}
                </>
              }
            />
          </TabsContent>

          {/* TAB 2 — Reference script + embedded runtime */}
          {isReferenceMatch && (
            <TabsContent value="ref" className="space-y-3 mt-4">
              <Card>
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-sm">Playwright code · reference report</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => genReferenceScript.mutate()}
                      disabled={genReferenceScript.isPending || !(scenario as any)?.description?.trim()}
                      title={!(scenario as any)?.description?.trim() ? "Add a scenario description first" : "Generate a dedicated reference script from the scenario description (use for two-screen comparisons)"}
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      {genReferenceScript.isPending ? "Generating…" : (refCode ? "Regenerate from description" : "Generate reference script")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => syncRefFromMain()}
                      disabled={!code}
                      title="Copy the main script and swap the report URL to the reference URL (use for same-screen / different-env comparisons)"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />Sync from main (swap URL)
                    </Button>
                    <Button size="sm" onClick={saveScript}>Save</Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">
                      Reference URL: <span className="mono">{referenceUrl || <em className="text-amber-600 dark:text-amber-400">not set (will use primary report URL)</em>}</span>
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => { setRefUrlDraft(referenceUrl); setPendingSyncCode(null); setRefUrlDialogOpen(true); }}>
                      <Pencil className="h-3 w-3 mr-1" />{referenceUrl ? "Edit" : "Set"} reference URL
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-muted-foreground whitespace-nowrap">Reference login credentials:</span>
                    <Select
                      value={refCredId || "__none__"}
                      onOpenChange={(o) => { if (o) qc.invalidateQueries({ queryKey: ["cred-profiles"] }); }}
                      onValueChange={(v) => {
                        if (v === "__add_new__") { window.open(`/settings?tab=creds`, "_blank"); return; }
                        setRefCredId(v === "__none__" ? "" : v);
                        persistCredField("reference_credential_profile_id", v === "__none__" ? null : v);
                      }}
                    >
                      <SelectTrigger className="h-8 flex-1"><SelectValue placeholder="— Select credentials —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {(credProfiles || []).map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}{c.username ? ` · ${c.username}` : ""}</SelectItem>
                        ))}
                        <SelectItem value="__add_new__" className="text-primary">
                          <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" />Add New Credentials<ExternalLink className="h-3 w-3 ml-1" /></span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea className="mono text-xs min-h-[260px]" value={refCode} onChange={(e) => setRefCode(e.target.value)} placeholder="// Playwright code for reference report…" />
                  <div className="text-[11px] text-muted-foreground">
                    Two ways to populate this reference script: <b>Generate</b> uses the scenario description to build a dedicated script that scrapes the <em>second</em> screen of a two-screen comparison (same report URL, different tab/view). <b>Sync from main (swap URL)</b> copies the main script and only swaps the report URL to the reference URL — use it when comparing the same screen across two environments. The reference script logs in with the credentials selected above (falling back to the report's reference credentials, then the main login). Use the same KPI keys so values can be compared in the Latest result tab.
                  </div>
                </CardContent>
              </Card>

              <RuntimeBlock
                title="Runtime · reference"
                running={refRunning}
                onRun={runRefMode}
                liveUrl={refLiveUrl}
                runError={refRunError}
                runResult={refRunResult}
              />
            </TabsContent>
          )}

          {/* TAB 3 — Warehouse SQL */}
          <TabsContent value="sql" className="space-y-3 mt-4">
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between">
                <CardTitle className="text-sm">Bound SQL template</CardTitle>
                <div className="flex gap-2 items-center flex-wrap justify-end">
                  <span className="text-xs text-muted-foreground">Warehouse:</span>
                  <Select
                    value={(scenario as any)?.reports?.warehouse_connector_id || "__none__"}
                    onOpenChange={(o) => { if (o) qc.invalidateQueries({ queryKey: ["wh-connectors"] }); }}
                    onValueChange={(v) => {
                      if (v === "__add_new__") {
                        window.open(`/settings?tab=warehouse`, "_blank");
                        return;
                      }
                      bindConnector(v);
                    }}
                  >
                    <SelectTrigger className="w-52"><SelectValue placeholder="— No warehouse —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— No warehouse —</SelectItem>
                      {(connectors || []).map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.name} · {c.kind}</SelectItem>
                      ))}
                      <SelectItem value="__add_new__" className="text-primary">
                        <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" />Add New Warehouse<ExternalLink className="h-3 w-3 ml-1" /></span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">SQL Template:</span>
                  <Select
                    value={tplId || "__none"}
                    onValueChange={(v) => {
                      if (v === "__new") { setNewTplOpen(true); return; }
                      setTplId(v === "__none" ? "" : v);
                    }}
                    disabled={templatesFetching && !templates}
                  >
                    <SelectTrigger className="w-64">
                      {templatesFetching && !templates
                        ? <span className="text-xs text-muted-foreground">Loading templates…</span>
                        : <SelectValue placeholder="(none)" />}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">(none)</SelectItem>
                      {(templates || []).map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.name} · {t.scope}</SelectItem>
                      ))}
                      <SelectItem value="__new">+ Add New Template</SelectItem>
                    </SelectContent>
                  </Select>
                  <NewSqlTemplateInline
                    open={newTplOpen}
                    onOpenChange={setNewTplOpen}
                    reportId={(scenario as any).reports?.id}
                    onCreated={(newId) => { setTplId(newId); qc.invalidateQueries({ queryKey: ["sql-templates-bind"] }); }}
                  />
                  <Button size="sm" onClick={saveScript} variant="outline">Save binding</Button>
                  <Button size="sm" disabled={!tplId || sqlRunning} onClick={runSql}>
                    <Play className="h-3 w-3 mr-1" />{sqlRunning ? "Running…" : "Run SQL"}
                  </Button>
                </div>

              </CardHeader>
              <CardContent className="space-y-3">
                {!tplId && <div className="text-xs text-muted-foreground">No SQL template bound. Select or create one above.</div>}
                {selectedTpl && (
                  <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                    <div className="text-sm font-semibold mono">{(selectedTpl as any).name}</div>
                    <Button size="sm" variant="outline" onClick={() => { setEditedSqlText(((selectedTpl as any)?.sql_text) || ""); setEditingSql(true); }} title="Edit template">
                      <Pencil className="h-3 w-3 mr-1" />Edit template
                    </Button>
                  </div>
                )}
                <Dialog open={editingSql} onOpenChange={(o) => { if (!o) cancelEditSql(); else setEditingSql(true); }}>
                  <DialogContent className="max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Edit SQL template{selectedTpl ? `: ${(selectedTpl as any).name}` : ""}</DialogTitle>
                    </DialogHeader>
                    <Textarea
                      className="mono text-xs min-h-[280px]"
                      value={editedSqlText}
                      onChange={(e) => setEditedSqlText(e.target.value)}
                    />
                    <DialogFooter>
                      <Button size="sm" variant="outline" onClick={cancelEditSql}>
                        <X className="h-3 w-3 mr-1" />Cancel
                      </Button>
                      <Button size="sm" onClick={saveAndRunSql} disabled={savingSqlText || sqlRunning}>
                        <Play className="h-3 w-3 mr-1" />{savingSqlText ? "Saving…" : sqlRunning ? "Running…" : "Save & Run SQL"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
                      <AlertDialogDescription>
                        You have unsaved edits to this SQL template. Do you want to discard them?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>No</AlertDialogCancel>
                      <AlertDialogAction onClick={confirmDiscard}>Yes, discard</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                {sqlResult && (
                  <div className="space-y-2 text-xs">
                    {!sqlResult.ok && (
                      <div className="rounded border border-destructive/40 bg-destructive/10 text-destructive p-2 mono whitespace-pre-wrap">
                        Error{sqlResult.source ? ` (${sqlResult.source})` : ""}: {sqlResult.error}
                      </div>
                    )}
                    {sqlResult.ok && (
                      <div className="mono text-muted-foreground">
                        {sqlResult.source === "snowflake" ? `Snowflake · ${sqlResult.connector || ""}` : "Mock warehouse"} · {sqlResult.row_count} row(s){sqlResult.scalar != null ? ` · scalar = ${JSON.stringify(sqlResult.scalar)}` : ""} · showing top {Math.min(5, sqlResult.rows?.length || 0)}
                      </div>
                    )}
                    {sqlResult.resolved_sql && (
                      <pre className="mono text-[10px] p-2 rounded bg-secondary/40 border border-border whitespace-pre-wrap">{sqlResult.resolved_sql}</pre>
                    )}
                    {!!sqlResult.rows?.length && (
                      <div className="overflow-auto border border-border rounded">
                        <table className="w-full text-[11px] mono">
                          <thead className="bg-secondary/40">
                            <tr>
                              {(sqlResult.columns || Object.keys(sqlResult.rows[0])).map((c: string) => (
                                <th key={c} className="text-left px-2 py-1 border-b border-border">{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sqlResult.rows.slice(0, 5).map((r: any, i: number) => (
                              <tr key={i} className="border-b border-border/40">
                                {(sqlResult.columns || Object.keys(sqlResult.rows[0])).map((c: string) => (
                                  <td key={c} className="px-2 py-1 align-top">{r[c] == null ? <span className="text-muted-foreground">null</span> : typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c])}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {!!combos?.length && (
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-foreground">Results per filter combination</div>
                      <Button size="sm" variant="secondary" disabled={!tplId || !combos?.length || allCombosRunning || !!comboRunning} onClick={runAllCombos}>
                        <Play className="h-3 w-3 mr-1" />{allCombosRunning ? "Running all…" : "Run per combination"}
                      </Button>
                    </div>
                    {combos.map((c: any, idx: number) => {
                      const res = comboResults[c.id];
                      const { where, missing } = buildWhereForCombo(c);
                      return (
                        <div key={c.id} className="rounded-md border border-border bg-card p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs">
                              <span className="font-semibold">Filter #{idx + 1}{c.label ? ` · ${c.label}` : ""}</span>
                              <div className="mono text-[11px] text-muted-foreground mt-0.5">
                                {Object.entries(c.filters || {}).map(([k, v]) => `${k}=${v}`).join(" · ")}
                              </div>
                            </div>
                            <Button size="sm" variant="outline" disabled={!tplId || comboRunning === c.id} onClick={() => runComboSql(c)}>
                              <Play className="h-3 w-3 mr-1" />{comboRunning === c.id ? "Running…" : "Run"}
                            </Button>
                          </div>
                          {!!missing.length && (
                            <div className="text-[11px] text-amber-600 dark:text-amber-400">
                              Missing FE→BE mapping for: {missing.join(", ")}
                            </div>
                          )}
                          {where && (
                            <div className="mono text-[11px]">
                              <span className="text-muted-foreground">WHERE</span> {where}
                            </div>
                          )}
                          {res && (
                            <div className="space-y-2 text-xs">
                              {!res.ok && (
                                <div className="rounded border border-destructive/40 bg-destructive/10 text-destructive p-2 mono whitespace-pre-wrap">
                                  Error{res.source ? ` (${res.source})` : ""}: {res.error}
                                </div>
                              )}
                              {res.ok && (
                                <div className="mono text-muted-foreground">
                                  {res.source === "snowflake" ? `Snowflake · ${res.connector || ""}` : "Mock warehouse"} · {res.row_count} row(s){res.scalar != null ? ` · scalar = ${JSON.stringify(res.scalar)}` : ""} · showing top {Math.min(5, res.rows?.length || 0)}
                                </div>
                              )}
                              {res.resolved_sql && (
                                <pre className="mono text-[10px] p-2 rounded bg-secondary/40 border border-border whitespace-pre-wrap">{res.resolved_sql}</pre>
                              )}
                              {!!res.rows?.length && (
                                <div className="overflow-auto border border-border rounded">
                                  <table className="w-full text-[11px] mono">
                                    <thead className="bg-secondary/40">
                                      <tr>
                                        {(res.columns || Object.keys(res.rows[0])).map((col: string) => (
                                          <th key={col} className="text-left px-2 py-1 border-b border-border">{col}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {res.rows.slice(0, 5).map((r: any, i: number) => (
                                        <tr key={i} className="border-b border-border/40">
                                          {(res.columns || Object.keys(res.rows[0])).map((col: string) => (
                                            <td key={col} className="px-2 py-1 align-top">{r[col] == null ? <span className="text-muted-foreground">null</span> : typeof r[col] === "object" ? JSON.stringify(r[col]) : String(r[col])}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>



          {/* TAB 5 — Latest test execution result */}
          <TabsContent value="result" className="space-y-3 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">
                    Latest execution result
                    {hasManual
                      ? <span className="text-xs text-muted-foreground font-normal"> · live (this session)</span>
                      : latest?.created_at && <span className="text-xs text-muted-foreground font-normal"> · {new Date(latest.created_at).toLocaleString()}</span>}
                  </CardTitle>
                  {latest?.run_id && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canUpdateRunResult || updatingRunResult}
                              onClick={updateRunResult}
                            >
                              <Save className="h-3 w-3 mr-1" />
                              {updatingRunResult ? "Saving…" : "Sync to last run"}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {!canUpdateRunResult && (
                          <TooltipContent>
                            Run the scenario manually or update KPI Tolerances first.
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {!latest && !hasManual && <div className="text-muted-foreground">No executions recorded yet. Run the Test Script (headless/headed) and {isReferenceMatch ? "Reference Script" : "Warehouse SQL"} to populate this view.</div>}
                {(latest || hasManual) && (
                  <>
                    <div className="flex gap-4 items-center">
                      <div><span className="text-muted-foreground">Source:</span> <span className="mono font-semibold">{hasManual ? `${manualActual ? "Test script" : "—"} + ${manualExpected ? (isReferenceMatch ? "Reference script" : "Warehouse SQL") : "—"}` : latest?.status}</span></div>
                      <div><span className="text-muted-foreground">Check:</span> <span className="mono">{isReferenceMatch ? "main vs reference report" : `main vs ${scenarioType.replace("_match","")}`}</span></div>
                      {!hasManual && latest?.run_id && <Link to={`/runs/${latest.run_id}`} className="text-accent hover:underline ml-auto">open run →</Link>}
                    </div>
                    {!!combos?.length ? (
                      <FilterComparisonTable
                        combos={combos}
                        comboResults={effectiveComboResults}
                        runResult={effectiveRunResult}
                        tolerances={kpiTolerances}
                        onTolerancesChange={saveKpiTolerances}
                        savingTolerances={savingTolerances}
                        isReferenceMatch={isReferenceMatch}
                        referenceKpis={manualReference}
                        refRunResult={effectiveRefRunResult}
                        globalSqlResult={sqlResult}
                        onResetTolerances={resetTolerancesToLastRun}
                        canResetTolerances={tolerancesChanged && Object.keys(lastRunTolerances).length > 0}
                      />
                    ) : (
                      <KpiRowsTable
                        actual={displayActual}
                        sqlRes={isReferenceMatch ? null : sqlResult}
                        fallbackExpected={displayExpected}
                        tolerances={kpiTolerances}
                        onTolerancesChange={saveKpiTolerances}
                        savingTolerances={savingTolerances}
                        isReferenceMatch={isReferenceMatch}
                        onResetTolerances={resetTolerancesToLastRun}
                        canResetTolerances={tolerancesChanged && Object.keys(lastRunTolerances).length > 0}
                      />
                    )}
                    {/* Stale RCA/analysis from prior runs intentionally hidden — only manual Test Script + Warehouse SQL output should drive Latest Result. */}
                    {hasManual && !combos?.length && (!manualActual || !manualExpected) && (
                      <div className="text-muted-foreground text-[11px] border-t border-border pt-2">
                        {!manualActual && "↳ Run the Test Script (headless or headed) to populate Actual. "}
                        {!manualExpected && (isReferenceMatch ? "↳ Run the Reference Script to populate Reference URL." : "↳ Run the Warehouse SQL to populate Expected.")}
                      </div>
                    )}
                  </>
                )}

              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Bottom — execution history log */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Execution history</CardTitle></CardHeader>
          <CardContent>
            {!latestResults?.length && <div className="text-xs text-muted-foreground">No previous executions.</div>}
            <div className="divide-y divide-border">
              {(latestResults || []).map((r: any) => (
                <Link key={r.id} to={r.run_id ? `/runs/${r.run_id}` : "#"} className="flex items-center gap-3 py-2 text-xs hover:bg-secondary/30 px-2 rounded">
                  <span className={`mono uppercase text-[10px] px-1.5 py-0.5 rounded ${r.status === "pass" ? "bg-emerald-500/15 text-emerald-500" : r.status === "fail" ? "bg-destructive/15 text-destructive" : "bg-secondary text-muted-foreground"}`}>{r.status}</span>
                  <span className="mono text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                  <span className="flex-1 truncate text-muted-foreground">{r.analysis || (r.actual ? JSON.stringify(r.actual).slice(0, 120) : "—")}</span>
                  {r.run_id && <span className="mono text-muted-foreground">run {r.run_id.slice(0, 8)}</span>}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Dialog open={refUrlDialogOpen} onOpenChange={(o) => { if (!o) { setRefUrlDialogOpen(false); setPendingSyncCode(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reference report URL</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                This URL is used by the Reference Script (it replaces <span className="mono">page.goto(...)</span> in the main script).
              </p>
              <Input
                autoFocus
                placeholder="https://…"
                value={refUrlDraft}
                onChange={(e) => setRefUrlDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveReferenceUrl(); } }}
              />
            </div>
            <DialogFooter>
              <Button size="sm" variant="outline" onClick={() => { setRefUrlDialogOpen(false); setPendingSyncCode(null); }}>Cancel</Button>
              <Button size="sm" onClick={saveReferenceUrl}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}


function RuntimeBlock({
  title, running, onRun, liveUrl, runError, runResult, extra, footer,
}: {
  title: string;
  running: null | "headed" | "headless";
  onRun: (m: "headed" | "headless") => void;
  liveUrl: string | null;
  runError: string | null;
  runResult: any;
  extra?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          <Button disabled={!!running} onClick={() => onRun("headless")}><Play className="h-3 w-3 mr-1" />{running === "headless" ? "Running…" : "Run headless"}</Button>
          {extra}
        </div>
        <p className="text-xs text-muted-foreground">
          Headed / live browser is not available on self-hosted Browserless OSS. Scripts run headless via /chromium/function and return screenshots.
        </p>
        {footer}
        {runError && (
          <div className="rounded border border-destructive/40 bg-destructive/10 text-destructive text-xs p-3 whitespace-pre-wrap mono">
            <div className="font-semibold mb-1">Runtime error</div>{runError}
          </div>
        )}
        {liveUrl && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase text-muted-foreground">Live browser · {liveUrl}</div>
            <iframe src={liveUrl} className="w-full h-[640px] rounded border border-border bg-secondary/40" />
          </div>
        )}
        {runResult && !runError && (
          <div className="space-y-2">
            {(runResult.screenshot_url || runResult.screenshot_b64 || runResult.extracted?.screenshot) && (
              <img src={runResult.screenshot_url || `data:image/png;base64,${runResult.screenshot_b64 || runResult.extracted?.screenshot}`} alt="Final screenshot" className="w-full rounded border border-border" />
            )}
            {runResult.extracted && (
              <pre className="mono text-xs p-3 rounded border border-border bg-secondary/40 overflow-auto">{JSON.stringify(runResult.extracted, null, 2)}</pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function deriveMetricFromTitle(title?: string): string {
  if (!title) return "Primary KPI";
  const cleaned = title.replace(/^\s*Compare\s+/i, "").trim();
  const m = cleaned.match(/^(.+?)\s+(?:under|in|on|from|vs|against|by|for)\b/i);
  if (m) return m[1].trim();
  const v = cleaned.split(/\s+vs\s+/i)[0].trim();
  return v || title;
}

function pickPrimary(obj: any): { key: string | null; value: any } {
  if (!obj || typeof obj !== "object") return { key: null, value: obj ?? null };
  const entries = Object.entries(obj).filter(([k]) => !k.startsWith("__"));
  // prefer numeric
  for (const [k, v] of entries) {
    if (typeof v === "number") return { key: k, value: v };
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(String(v).replace(/[,\s]/g, "")))) return { key: k, value: v };
  }
  if (entries.length) return { key: entries[0][0], value: entries[0][1] };
  return { key: null, value: null };
}

function fmt(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function ComparisonTable({ expected, actual, diff, leftLabel, rightLabel, scenarioTitle }: { expected: any; actual: any; diff: any; leftLabel: string; rightLabel: string; scenarioTitle?: string }) {
  const metricLabel = deriveMetricFromTitle(scenarioTitle);
  const primaryActual = pickPrimary(actual);
  const primaryExpected = pickPrimary(expected);
  const hasPrimary = primaryActual.value !== null || primaryExpected.value !== null;
  const aNum = Number(String(primaryActual.value ?? "").replace(/[,\s]/g, ""));
  const eNum = Number(String(primaryExpected.value ?? "").replace(/[,\s]/g, ""));
  const bothNumeric = Number.isFinite(aNum) && Number.isFinite(eNum);
  const deltaAbs = bothNumeric ? aNum - eNum : null;
  const deltaPct = bothNumeric && eNum !== 0 ? (deltaAbs! / Math.abs(eNum)) * 100 : null;
  const mismatch = bothNumeric
    ? aNum !== eNum
    : JSON.stringify(primaryActual.value) !== JSON.stringify(primaryExpected.value);

  const keys = Array.from(new Set([...Object.keys(actual || {}), ...Object.keys(expected || {})])).filter((k) => !k.startsWith("__"));

  return (
    <div className="space-y-3">
      {hasPrimary && (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr>
                <th className="text-left p-2">KPI</th>
                <th className="text-left p-2">{leftLabel}</th>
                <th className="text-left p-2">{rightLabel}</th>
                <th className="text-left p-2">Diff</th>
              </tr>
            </thead>
            <tbody>
              <tr className={`border-t border-border ${mismatch ? "bg-destructive/5" : ""}`}>
                <td className="p-2">
                  <div className="font-semibold">{metricLabel}</div>
                  <div className="text-[10px] text-muted-foreground mono">
                    {primaryActual.key || "—"} ↔ {primaryExpected.key || "—"}
                  </div>
                </td>
                <td className="p-2 mono font-semibold">{fmt(primaryActual.value)}</td>
                <td className="p-2 mono font-semibold">{fmt(primaryExpected.value)}</td>
                <td className="p-2 mono">
                  {deltaAbs !== null ? (
                    <span className={mismatch ? "text-destructive" : "text-muted-foreground"}>
                      {deltaAbs > 0 ? "+" : ""}{fmt(deltaAbs)}
                      {deltaPct !== null && (
                        <span className="text-muted-foreground ml-1">
                          ({deltaPct > 0 ? "+" : ""}{deltaPct.toFixed(2)}%)
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{mismatch ? "≠" : "="}</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {keys.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Raw extracted values ({keys.length})
          </summary>
          <div className="border border-border rounded overflow-hidden mt-2">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40 text-muted-foreground">
                <tr><th className="text-left p-2">Key</th><th className="text-left p-2">{leftLabel}</th><th className="text-left p-2">{rightLabel}</th><th className="text-left p-2">Diff</th></tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const a = (actual || {})[k];
                  const e = (expected || {})[k];
                  const d = (diff || {})[k];
                  const mm = JSON.stringify(a) !== JSON.stringify(e);
                  return (
                    <tr key={k} className={`border-t border-border ${mm ? "bg-destructive/5" : ""}`}>
                      <td className="p-2 mono">{k}</td>
                      <td className="p-2 mono">{JSON.stringify(a)}</td>
                      <td className="p-2 mono">{JSON.stringify(e)}</td>
                      <td className="p-2 mono text-muted-foreground">{d != null ? JSON.stringify(d) : (mm ? "≠" : "=")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {!hasPrimary && keys.length === 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div><div className="text-[10px] uppercase text-muted-foreground mb-1">{leftLabel}</div><pre className="mono text-[11px] p-2 rounded border border-border bg-secondary/40 overflow-auto max-h-64">{JSON.stringify(actual ?? null, null, 2)}</pre></div>
          <div><div className="text-[10px] uppercase text-muted-foreground mb-1">{rightLabel}</div><pre className="mono text-[11px] p-2 rounded border border-border bg-secondary/40 overflow-auto max-h-64">{JSON.stringify(expected ?? null, null, 2)}</pre></div>
        </div>
      )}
    </div>
  );
}

const KPI_SKIP_KEYS = new Set([
  "filters_applied", "nbrx_elements_found", "extraction_error", "raw_value", "raw_extraction",
  "screenshot", "screenshot_b64", "screenshot_url", "error", "ok", "note",
  "title", "url", "result", "extracted", "report_url", "debug", "page_snapshot",
]);

function extractKpisFromBlock(block: any): Record<string, any> {
  if (!block || typeof block !== "object") return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(block)) {
    if (k.startsWith("__")) continue;
    if (KPI_SKIP_KEYS.has(k)) continue;
    if (v === null || v === undefined || typeof v === "boolean") continue;
    if (typeof v === "object") {
      // Unwrap common shapes: { value, raw_value, ... } or { metric, value }
      const anyV: any = v;
      if (Array.isArray(anyV)) continue;
      if (anyV.value !== undefined && (typeof anyV.value !== "object" || anyV.value === null)) {
        out[k] = anyV.value;
      }
      continue;
    }
    out[k] = v;
  }
  return out;
}

function toNum(v: any): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  return Number(String(v).replace(/[,\s%$]/g, ""));
}

function expectedForKpi(sqlRes: any, kpiKey: string): any {
  if (!sqlRes?.ok) return null;
  const cols: string[] = sqlRes.columns || (sqlRes.rows?.[0] ? Object.keys(sqlRes.rows[0]) : []);
  const row = sqlRes.rows?.[0];
  if (row && typeof row === "object") {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const target = norm(kpiKey);
    // exact / case-insensitive / normalized match on column
    const col =
      cols.find((c) => c === kpiKey) ||
      cols.find((c) => c.toLowerCase() === kpiKey.toLowerCase()) ||
      cols.find((c) => norm(c) === target) ||
      cols.find((c) => norm(c).includes(target) || target.includes(norm(c)));
    if (col && row[col] !== undefined) return row[col];
  }
  // Only fall back to a single scalar when the SQL returned exactly ONE numeric
  // value AND the KPI list has just one entry (single-KPI scenarios). Otherwise
  // returning the scalar for every KPI causes all rows to show the same number
  // (e.g. "58.00000000" repeated across every KPI).
  if (
    cols.length <= 1 &&
    sqlRes.scalar !== undefined &&
    sqlRes.scalar !== null
  ) {
    return sqlRes.scalar;
  }
  return null;
}

type CompareOp = "eq" | "lte" | "gte" | "gt" | "lt";
type Tolerance = { value: number; unit: "pct" | "abs"; op?: CompareOp };

const VALID_OPS: CompareOp[] = ["eq","lte","gte","gt","lt"];
const isValidOp = (o: any): o is CompareOp => VALID_OPS.includes(o);

function normalizeTolerances(raw: any): Record<string, Tolerance> {
  const out: Record<string, Tolerance> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number") {
      out[k] = { value: v, unit: "pct", op: "eq" };
    } else if (v && typeof v === "object" && "value" in (v as any)) {
      const o = v as any;
      const value = Number(o.value);
      const op: CompareOp = isValidOp(o.op) ? o.op : "eq";
      out[k] = { value: Number.isFinite(value) ? value : 0, unit: o.unit === "abs" ? "abs" : "pct", op };
    }
  }
  return out;
}

function getGlobalOp(tolerances: Record<string, Tolerance>): CompareOp {
  for (const v of Object.values(tolerances || {})) {
    if (v && isValidOp(v.op as any)) return v.op as CompareOp;
  }
  return "eq";
}

function getTol(tolerances: Record<string, Tolerance>, k: string): Tolerance {
  const globalOp = getGlobalOp(tolerances);
  const base = tolerances[k] ?? { value: 0, unit: "pct" as const };
  return { value: base.value, unit: base.unit ?? "pct", op: globalOp };
}

function evalPass(actual: any, expected: any, tol: Tolerance): boolean | null {
  if (expected === null || expected === undefined || actual === null || actual === undefined) return null;
  const a = toNum(actual);
  const e = toNum(expected);
  const both = Number.isFinite(a) && Number.isFinite(e);
  const t = Number.isFinite(tol?.value) ? Math.abs(tol.value) : 0;
  const op: CompareOp = tol?.op ?? "eq";
  if (both) {
    const allowance = tol?.unit === "abs" ? t : (e === 0 ? t : Math.abs(e) * t / 100);
    if (op === "lte") return a <= e + allowance;
    if (op === "gte") return a >= e - allowance;
    if (op === "gt") return a > e + allowance;
    if (op === "lt") return a < e - allowance;
    return Math.abs(a - e) <= allowance;
  }
  return String(actual) === String(expected);
}

function TolerancesEditor({
  kpiKeys, tolerances, onChange, saving, showOperator, onReset, canReset, onAddRemove,
}: {
  kpiKeys: string[];
  tolerances: Record<string, Tolerance>;
  onChange: (next: Record<string, Tolerance>) => void;
  saving?: boolean;
  showOperator?: boolean;
  onReset?: () => void;
  canReset?: boolean;
  onAddRemove?: () => void;
}) {
  if (!kpiKeys.length && !onAddRemove) return null;

  const commit = (k: string, rawVal: string, nextUnit?: "pct" | "abs") => {
    const cur = getTol(tolerances, k);
    const v = parseFloat(rawVal);
    const next = {
      ...tolerances,
      [k]: { value: Number.isFinite(v) ? v : 0, unit: nextUnit ?? cur.unit ?? "pct", op: cur.op ?? "eq" },
    };
    onChange(next);
  };

  const setUnitFor = (k: string, val: "pct" | "abs") => {
    const cur = getTol(tolerances, k);
    onChange({ ...tolerances, [k]: { value: cur.value, unit: val, op: cur.op ?? "eq" } });
  };

  const setGlobalOp = (op: CompareOp) => {
    const next: Record<string, Tolerance> = { ...tolerances };
    const keys = new Set<string>([...kpiKeys, ...Object.keys(tolerances || {})]);
    keys.forEach((k) => {
      const cur = tolerances[k] ?? { value: 0, unit: "pct" as const };
      next[k] = { value: cur.value ?? 0, unit: cur.unit ?? "pct", op };
    });
    onChange(next);
  };

  const globalOp = getGlobalOp(tolerances);

  return (
    <div className="border border-border rounded p-2 bg-secondary/20 text-xs">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">KPI tolerances</div>
          {onReset && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!canReset} onClick={onReset} title="Reset KPI tolerance values and condition to those of the last run">
              <RotateCcw className="h-3 w-3 mr-1" />Reset to last run
            </Button>
          )}
          {onAddRemove && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onAddRemove}>
              <Plus className="h-3 w-3 mr-1" />Add/Remove KPIs
            </Button>
          )}
          {saving && <div className="text-xs text-muted-foreground mono">Saving…</div>}
        </div>
        {showOperator && (
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground">Condition (all KPIs):</div>
            <Select value={globalOp} onValueChange={(v) => setGlobalOp(v as CompareOp)}>
              <SelectTrigger className="h-8 w-[200px] text-xs mono px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lte" className="text-xs mono">actual ≤ reference</SelectItem>
                <SelectItem value="lt" className="text-xs mono">actual &lt; reference</SelectItem>
                <SelectItem value="eq" className="text-xs mono">actual = reference</SelectItem>
                <SelectItem value="gte" className="text-xs mono">actual ≥ reference</SelectItem>
                <SelectItem value="gt" className="text-xs mono">actual &gt; reference</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {kpiKeys.length === 0 ? (
        <div className="text-muted-foreground text-[11px] py-1">No KPIs configured yet. Use "Add/Remove KPIs" to define them.</div>
      ) : (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {kpiKeys.map((k) => {
          const cur = getTol(tolerances, k);
          const unit = (cur.unit ?? "pct") as "pct" | "abs";
          return (
            <div key={k} className="flex items-center gap-2">
              <label className="mono text-xs truncate flex-1" title={k}>{k}</label>
              <div className="relative w-28">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={cur.value}
                  key={`${k}-${unit}-${cur.value}`}
                  onBlur={(e) => commit(k, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commit(k, (e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="h-7 pr-14 text-xs"
                />
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={unit}
                  onValueChange={(v) => v && setUnitFor(k, v as "pct" | "abs")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 gap-0 border border-border rounded-sm overflow-hidden bg-background"
                >
                  <ToggleGroupItem
                    value="pct"
                    className="h-5 w-5 p-0 text-[10px] mono rounded-none data-[state=on]:bg-accent"
                  >
                    %
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="abs"
                    className="h-5 w-5 p-0 text-[10px] mono rounded-none data-[state=on]:bg-accent"
                  >
                    #
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}


function FilterComparisonTable({
  combos, comboResults, runResult, tolerances, onTolerancesChange, savingTolerances,
  isReferenceMatch, referenceKpis, refRunResult, globalSqlResult, onResetTolerances, canResetTolerances,
}: {
  combos: any[];
  comboResults: Record<string, any>;
  runResult: any;
  tolerances: Record<string, Tolerance>;
  onTolerancesChange: (next: Record<string, Tolerance>) => void;
  savingTolerances?: boolean;
  isReferenceMatch?: boolean;
  referenceKpis?: Record<string, any> | null;
  refRunResult?: any;
  globalSqlResult?: any;
  onResetTolerances?: () => void;
  canResetTolerances?: boolean;
}) {
  const [openCombo, setOpenCombo] = useState<any>(null);

  const rootOf = (rr: any) =>
    rr?.result ||
    rr?.extracted?.result ||
    rr?.extracted?.extracted ||
    rr?.extracted ||
    null;

  const pwRoot = rootOf(runResult);
  const refRoot = rootOf(refRunResult);

  const blockFor = (root: any, label: string, idx: number, comboId?: string) =>
    (root && (
      root[label] ||
      root[`Filter #${idx + 1}`] ||
      root[`combo_${idx + 1}`] ||
      root[`combo${idx + 1}`] ||
      (comboId && root[comboId])
    )) || null;

  type Row = {
    combo: any; comboIdx: number; kpi: string; actual: any; expected: any;
    diff: number | null; deltaPct: number | null; pass: boolean | null;
  };

  const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const lookupKpi = (obj: any, k: string): any => {
    if (!obj || typeof obj !== "object") return null;
    if (obj[k] !== undefined) return obj[k];
    const target = normKey(k);
    const found = Object.keys(obj).find((rk) => normKey(rk) === target);
    return found ? obj[found] : null;
  };

  const perCombo = combos.map((c, idx) => {
    const label = c.label || `Filter #${idx + 1}`;
    const pwBlock = blockFor(pwRoot, label, idx, c.id);
    const refBlock = blockFor(refRoot, label, idx, c.id);
    const kpis = extractKpisFromBlock(pwBlock);
    const refKpis = refBlock ? extractKpisFromBlock(refBlock) : null;
    const sqlRes = comboResults[c.id] || (globalSqlResult?.ok ? globalSqlResult : null);
    const rows: Row[] = Object.entries(kpis).map(([k, v]) => {
      const exp = isReferenceMatch
        ? (lookupKpi(refKpis, k) ?? lookupKpi(referenceKpis, k))
        : expectedForKpi(sqlRes, k);
      const a = toNum(v);
      const e = toNum(exp);
      const both = Number.isFinite(a) && Number.isFinite(e);
      const diff = both ? a - e : null;
      const deltaPct = both && e !== 0 ? (diff! / Math.abs(e)) * 100 : null;
      const pass = evalPass(v, exp, getTol(tolerances, k));
      return { combo: c, comboIdx: idx, kpi: k, actual: v, expected: exp, diff, deltaPct, pass };
    });
    if (!rows.length) {
      const sqlRow = sqlRes?.ok ? (sqlRes.rows?.[0] || null) : null;
      const sqlCols: string[] = sqlRes?.ok ? (sqlRes.columns || (sqlRow ? Object.keys(sqlRow) : [])) : [];
      if (sqlRow && sqlCols.length) {
        for (const col of sqlCols) {
          rows.push({
            combo: c, comboIdx: idx, kpi: col,
            actual: undefined, expected: sqlRow[col],
            diff: null, deltaPct: null, pass: null,
          });
        }
      } else {
        rows.push({
          combo: c, comboIdx: idx, kpi: "—",
          actual: pwBlock ? null : undefined,
          expected: isReferenceMatch ? null : (sqlRes?.ok ? (sqlRes.scalar ?? null) : null),
          diff: null, deltaPct: null, pass: null,
        });
      }
    }
    const passes = rows.filter((r) => r.pass !== null).map((r) => r.pass);
    const overall: "pass" | "fail" | "pending" =
      passes.length === 0 ? "pending" : passes.every(Boolean) ? "pass" : "fail";
    return { combo: c, idx, label, rows, overall };
  });


  const overallStatus: "pass" | "fail" | "pending" =
    perCombo.every((p) => p.overall === "pass") ? "pass"
    : perCombo.some((p) => p.overall === "fail") ? "fail"
    : "pending";

  const badge = (s: "pass" | "fail" | "pending") => {
    const cls = s === "pass"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
      : s === "fail"
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : "bg-secondary text-muted-foreground border-border";
    return <span className={`mono uppercase text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{s}</span>;
  };

  

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Overall Status:</span>
        {badge(overallStatus)}
      </div>
      <div className="border border-border rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="text-left p-2">Filter</th>
              <th className="text-left p-2">KPI</th>
              <th className="text-left p-2">Actual (UI main report)</th>
              <th className="text-left p-2">{isReferenceMatch ? "Reference URL" : "Expected (BE / SQL)"}</th>
              <th className="text-left p-2">Diff</th>
              <th className="text-left p-2">Result</th>
              <th className="text-left p-2">Overall Result</th>
            </tr>
          </thead>
          <tbody>
            {perCombo.flatMap(({ combo, label, rows, overall }) =>
              rows.map((r, i) => (
                <tr key={`${combo.id}-${i}`} className={`border-t border-border ${r.pass === false ? "bg-destructive/5" : ""}`}>
                  {i === 0 && (
                    <td className="p-2 align-top" rowSpan={rows.length}>
                      <button className="text-accent hover:underline font-semibold text-left" onClick={() => setOpenCombo(combo)}>
                        {label}
                      </button>
                    </td>
                  )}
                  <td className="p-2 mono">{r.kpi}</td>
                  <td className="p-2 mono font-semibold">{fmt(r.actual)}</td>
                  <td className="p-2 mono font-semibold">{fmt(r.expected)}</td>
                  <td className="p-2 mono">
                    {r.diff !== null ? (
                      <span className={r.pass === false ? "text-destructive" : "text-muted-foreground"}>
                        {r.diff > 0 ? "+" : ""}{fmt(r.diff)}
                        {r.deltaPct !== null && (
                          <span className="text-muted-foreground ml-1">({r.deltaPct > 0 ? "+" : ""}{r.deltaPct.toFixed(2)}%)</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{r.pass === false ? "≠" : r.pass === true ? "=" : "—"}</span>
                    )}
                  </td>
                  <td className="p-2">{r.pass === null ? badge("pending") : r.pass ? badge("pass") : badge("fail")}</td>
                  {i === 0 && (
                    <td className="p-2 align-top" rowSpan={rows.length}>{badge(overall)}</td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      

      <Dialog open={!!openCombo} onOpenChange={(o) => !o && setOpenCombo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {openCombo?.label || `Filter #${(combos.findIndex((c) => c.id === openCombo?.id)) + 1}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-xs">
            {openCombo && Object.entries(openCombo.filters || {}).map(([k, v]) => (
              <div key={k} className="flex items-start gap-2 border-b border-border pb-1">
                <div className="font-semibold w-40 mono">{k}</div>
                <div className="mono text-muted-foreground flex-1">{String(v)}</div>
              </div>
            ))}
            {openCombo && !Object.keys(openCombo.filters || {}).length && (
              <div className="text-muted-foreground">No filter values defined.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiRowsTable({
  actual, sqlRes, fallbackExpected, tolerances, onTolerancesChange, savingTolerances, isReferenceMatch, onResetTolerances, canResetTolerances,
}: {
  actual: any;
  sqlRes: any;
  fallbackExpected: any;
  tolerances: Record<string, Tolerance>;
  onTolerancesChange: (next: Record<string, Tolerance>) => void;
  savingTolerances?: boolean;
  isReferenceMatch?: boolean;
  onResetTolerances?: () => void;
  canResetTolerances?: boolean;
}) {
  const badge = (s: "pass" | "fail" | "pending") => {
    const cls = s === "pass"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
      : s === "fail"
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : "bg-secondary text-muted-foreground border-border";
    return <span className={`mono uppercase text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{s}</span>;
  };

  const kpis = actual && typeof actual === "object" ? actual : {};
  const keys = Object.keys(kpis).filter((k) => !k.startsWith("__"));

  const rows = keys.map((k) => {
    const a = kpis[k];
    let exp: any = null;
    if (sqlRes?.ok) exp = expectedForKpi(sqlRes, k);
    if ((exp === null || exp === undefined) && fallbackExpected && typeof fallbackExpected === "object") {
      exp = fallbackExpected[k] ?? null;
    }
    const aN = toNum(a);
    const eN = toNum(exp);
    const both = Number.isFinite(aN) && Number.isFinite(eN);
    const diff = both ? aN - eN : null;
    const deltaPct = both && eN !== 0 ? (diff! / Math.abs(eN)) * 100 : null;
    const pass = evalPass(a, exp, getTol(tolerances, k));
    return { k, a, exp, diff, deltaPct, pass };
  });

  const passes = rows.filter((r) => r.pass !== null).map((r) => r.pass);
  const overall: "pass" | "fail" | "pending" =
    passes.length === 0 ? "pending" : passes.every(Boolean) ? "pass" : "fail";

  if (!keys.length) {
    return <div className="text-muted-foreground text-xs">No KPI values extracted yet.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Overall Status:</span>
        {badge(overall)}
      </div>
      <div className="border border-border rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="text-left p-2">KPI</th>
              <th className="text-left p-2">Actual (UI main report)</th>
              <th className="text-left p-2">{isReferenceMatch ? "Reference URL" : "Expected (BE / SQL)"}</th>
              <th className="text-left p-2">Diff</th>
              <th className="text-left p-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k} className={`border-t border-border ${r.pass === false ? "bg-destructive/5" : ""}`}>
                <td className="p-2 mono">{r.k}</td>
                <td className="p-2 mono font-semibold">{fmt(r.a)}</td>
                <td className="p-2 mono font-semibold">{fmt(r.exp)}</td>
                <td className="p-2 mono">
                  {r.diff !== null ? (
                    <span className={r.pass === false ? "text-destructive" : "text-muted-foreground"}>
                      {r.diff > 0 ? "+" : ""}{fmt(r.diff)}
                      {r.deltaPct !== null && (
                        <span className="text-muted-foreground ml-1">({r.deltaPct > 0 ? "+" : ""}{r.deltaPct.toFixed(2)}%)</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{r.pass === false ? "≠" : r.pass === true ? "=" : "—"}</span>
                  )}
                </td>
                <td className="p-2">{r.pass === null ? badge("pending") : r.pass ? badge("pass") : badge("fail")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
    </div>
  );
}




function ScenarioMeta({ s }: { s: any }) {
  const qc = useQueryClient();
  const update = async (patch: any) => {
    await supabase.from("scenarios").update(patch).eq("id", s.id);
    qc.invalidateQueries({ queryKey: ["scenario", s.id] });
  };
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 space-y-2 min-w-0">
        <Input className="text-xl font-semibold" defaultValue={s.title} onBlur={(e) => update({ title: e.target.value })} />
        <Textarea className="text-sm min-h-[120px]" defaultValue={s.description || ""} onBlur={(e) => update({ description: e.target.value })} placeholder="Description…" />
      </div>
      <div className="space-y-2 w-44">
        <div>
          <div className="text-[10px] text-muted-foreground mb-1 uppercase">Type</div>
          <Select value={s.type} onValueChange={(v) => update({ type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[
              {v:"warehouse_match",l:"Warehouse"},
              {v:"reference_match",l:"Reference"},
              {v:"trend",l:"Trend"},
              {v:"range_check",l:"Range"},
              {v:"functional",l:"Functional"},
            ].map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-1 uppercase">Criticality</div>
          <Select defaultValue={s.criticality} onValueChange={(v) => update({ criticality: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["low","medium","high","critical"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => update({ deferred: !s.deferred })}>
          {s.deferred ? "Restore" : "Defer"}
        </Button>
        <ScenarioHistory scenarioId={s.id} onRestore={(v) => update({ title: v.title, description: v.description, criticality: v.criticality, type: v.type, status: v.status, deferred: v.deferred })} />
      </div>
    </div>
  );
}

function ScenarioHistory({ scenarioId, onRestore }: { scenarioId: string; onRestore: (v: any) => void }) {
  const [open, setOpen] = useState(false);
  const { data: versions } = useQuery({
    queryKey: ["scenario-versions", scenarioId, open],
    queryFn: async () => (await supabase.from("scenario_versions").select("*").eq("scenario_id", scenarioId).order("version", { ascending: false })).data ?? [],
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full"><History className="h-3 w-3 mr-1" /> History</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Scenario version history</DialogTitle></DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-2">
            {(versions || []).map((v: any) => (
              <div key={v.id} className="border border-border rounded p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">v{v.version} <span className="text-muted-foreground font-normal">· {new Date(v.created_at).toLocaleString()}</span></div>
                  <Button size="sm" variant="ghost" onClick={() => { onRestore(v); setOpen(false); toast.success(`Restored v${v.version}`); }}>Restore</Button>
                </div>
                <div className="font-medium">{v.title}</div>
                {v.description && <div className="text-muted-foreground line-clamp-2">{v.description}</div>}
                <div className="text-[10px] text-muted-foreground">criticality: {v.criticality} · status: {v.status} · deferred: {String(v.deferred)}</div>
              </div>
            ))}
            {!versions?.length && <div className="text-xs text-muted-foreground p-4 text-center">No history yet.</div>}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ScriptHistory({ scenarioId, scriptId, onRestore }: { scenarioId: string; scriptId?: string; onRestore: (v: any) => void }) {
  const [open, setOpen] = useState(false);
  const { data: versions } = useQuery({
    queryKey: ["script-versions", scenarioId, scriptId, open],
    queryFn: async () => {
      const q = supabase.from("script_versions").select("*").eq("scenario_id", scenarioId).order("version", { ascending: false });
      return (await q).data ?? [];
    },
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><History className="h-3 w-3 mr-1" /> History</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Script version history</DialogTitle></DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-2">
            {(versions || []).map((v: any) => (
              <div key={v.id} className="border border-border rounded p-3 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">v{v.version} <span className="text-muted-foreground font-normal">· {new Date(v.created_at).toLocaleString()}</span></div>
                  <Button size="sm" variant="ghost" onClick={() => { onRestore(v); setOpen(false); }}>Load</Button>
                </div>
                <pre className="mono text-[10px] p-2 rounded bg-secondary/40 overflow-auto max-h-40">{v.playwright_code || "(empty)"}</pre>
              </div>
            ))}
            {!versions?.length && <div className="text-xs text-muted-foreground p-4 text-center">No history yet — save the script to create a version.</div>}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}


function NewSqlTemplateInline({ reportId, onCreated, open: openProp, onOpenChange }: { reportId?: string; onCreated: (id: string) => void; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [openInner, setOpenInner] = useState(false);
  const open = openProp ?? openInner;
  const setOpen = (o: boolean) => { onOpenChange ? onOpenChange(o) : setOpenInner(o); };
  const [name, setName] = useState("");
  const [sql, setSql] = useState("");
  const [scope, setScope] = useState<"project" | "report">("report");
  const save = async () => {
    if (!name || !sql) return toast.error("Name and SQL required");
    const { data, error } = await supabase.from("sql_templates").insert({
      name, sql_text: sql, scope, report_id: scope === "report" ? reportId : null,
    }).select().single();
    if (error) return toast.error(error.message);
    toast.success("Template created");
    setName(""); setSql(""); setOpen(false);
    if (data?.id) onCreated(data.id);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>New SQL template</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Input placeholder="kpi_total_sales" value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={scope} onValueChange={(v: any) => setScope(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="report">This report</SelectItem>
              <SelectItem value="project">Project (global)</SelectItem>
            </SelectContent>
          </Select>
          <Textarea className="mono text-xs min-h-[160px]" placeholder="SELECT ..." value={sql} onChange={(e) => setSql(e.target.value)} />
          <Button onClick={save} className="w-full">Create & bind</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type FilterPair = { label: string; value: string };
type FilterCombo = { id: string; label: string | null; filters: Record<string, string> };
type KeyMap = { id: string; fe_label: string; be_column: string };

function FilterCombinations({ scenarioId, reportId }: { scenarioId: string; reportId?: string }) {
  const qc = useQueryClient();
  const { data: combos } = useQuery({
    queryKey: ["scenario-filter-matrix", scenarioId],
    queryFn: async () =>
      ((await supabase
        .from("scenario_filter_matrix")
        .select("id,label,filters")
        .eq("scenario_id", scenarioId)
        .order("created_at", { ascending: true })).data ?? []) as FilterCombo[],
  });

  const { data: keyMap } = useQuery({
    queryKey: ["report-filter-key-map", reportId],
    enabled: !!reportId,
    queryFn: async () =>
      ((await supabase
        .from("scenario_filter_key_map")
        .select("id,fe_label,be_column")
        .eq("report_id", reportId!)
        .order("created_at", { ascending: true })).data ?? []) as KeyMap[],
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [pairs, setPairs] = useState<FilterPair[]>([{ label: "", value: "" }]);
  const [mapOpen, setMapOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const reset = () => {
    setEditingId(null);
    setLabel("");
    setPairs([{ label: "", value: "" }]);
  };

  const openNew = () => {
    reset();
    setDialogOpen(true);
  };

  const openEdit = (c: FilterCombo) => {
    setEditingId(c.id);
    setLabel(c.label ?? "");
    const entries = Object.entries(c.filters || {});
    setPairs(entries.length ? entries.map(([k, v]) => ({ label: k, value: String(v) })) : [{ label: "", value: "" }]);
    setDialogOpen(true);
  };

  const addPair = () => setPairs((p) => [...p, { label: "", value: "" }]);
  const updPair = (i: number, key: keyof FilterPair, v: string) =>
    setPairs((p) => p.map((x, idx) => (idx === i ? { ...x, [key]: v } : x)));
  const rmPair = (i: number) => setPairs((p) => p.filter((_, idx) => idx !== i));

  const saveCombo = async () => {
    const filters: Record<string, string> = {};
    for (const p of pairs) {
      const k = p.label.trim();
      const v = p.value.trim();
      if (!k) continue;
      filters[k] = v;
    }
    if (!Object.keys(filters).length) {
      toast.error("Add at least one filter label and value");
      return;
    }
    const canon = canonFilters(filters);
    const dupe = (combos ?? []).find((c) => c.id !== editingId && canonFilters(c.filters || {}) === canon);
    if (dupe) {
      toast.error("This exact filter combination already exists");
      return;
    }
    if (editingId) {
      const { error } = await supabase
        .from("scenario_filter_matrix")
        .update({ label: label.trim() || null, filters })
        .eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success("Filter combination updated");
    } else {
      const { error } = await supabase.from("scenario_filter_matrix").insert({
        scenario_id: scenarioId,
        label: label.trim() || null,
        filters,
      });
      if (error) return toast.error(error.message);
      toast.success("Filter combination added");
    }
    reset();
    setDialogOpen(false);
    qc.invalidateQueries({ queryKey: ["scenario-filter-matrix", scenarioId] });
  };

  const deleteCombo = async (cid: string) => {
    const { error } = await supabase.from("scenario_filter_matrix").delete().eq("id", cid);
    if (error) return toast.error(error.message);
    toast.success("Removed");
    qc.invalidateQueries({ queryKey: ["scenario-filter-matrix", scenarioId] });
  };

  const feLabels = (keyMap ?? []).map((k) => k.fe_label);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Filter combinations</CardTitle>
            <div className="text-xs text-muted-foreground">
              The generated Playwright script will run once per combination and return expected values for each.
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setMapOpen(true)}>
            FE ↔ BE key mapping
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!!combos?.length && (
          <div className="space-y-2">
            {combos.map((c) => (
              <div key={c.id} className="flex items-start gap-2 border border-border rounded-md p-2">
                <div className="flex-1 min-w-0 space-y-1">
                  {c.label && <div className="text-xs font-medium">{c.label}</div>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mono">
                    {Object.entries(c.filters || {}).map(([k, v]) => (
                      <span key={k}>
                        <span className="text-muted-foreground">{k}:</span> {String(v)}
                      </span>
                    ))}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => openEdit(c)} aria-label="Edit combination">
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteCombo(c.id)} aria-label="Delete combination">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={openNew}>
            <Plus className="h-3 w-3 mr-1" /> New filter combination
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPasteOpen(true)}>
            Paste rows
          </Button>
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={(o) => {
            setDialogOpen(o);
            if (!o) reset();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit filter combination" : "New filter combination"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Combination label (optional, e.g. AB / St. Louis / YTD)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="h-9 text-sm"
              />
              {feLabels.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No FE labels defined yet. Add them in{" "}
                  <button type="button" className="underline" onClick={() => setMapOpen(true)}>
                    FE ↔ BE key mapping
                  </button>{" "}
                  to populate the Filter label dropdown.
                </div>
              )}
              <div className="space-y-2">
                {pairs.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    {feLabels.length > 0 ? (
                      <Select value={p.label || undefined} onValueChange={(v) => updPair(i, "label", v)}>
                        <SelectTrigger className="h-9 text-sm flex-1">
                          <SelectValue placeholder="Filter label" />
                        </SelectTrigger>
                        <SelectContent>
                          {feLabels.map((lbl) => (
                            <SelectItem key={lbl} value={lbl}>{lbl}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder="Filter label (e.g. Area)"
                        value={p.label}
                        onChange={(e) => updPair(i, "label", e.target.value)}
                        className="h-9 text-sm flex-1"
                      />
                    )}
                    <Input
                      placeholder="Filter value (e.g. AB - Central)"
                      value={p.value}
                      onChange={(e) => updPair(i, "value", e.target.value)}
                      className="h-9 text-sm flex-1"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => rmPair(i)}
                      disabled={pairs.length === 1}
                      aria-label="Remove pair"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-2">
                <Button size="sm" variant="outline" onClick={addPair}>
                  <Plus className="h-3 w-3 mr-1" /> Add filter
                </Button>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setDialogOpen(false); reset(); }}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveCombo}>
                    <Check className="h-3 w-3 mr-1" /> {editingId ? "Update" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <KeyMapDialog
          open={mapOpen}
          onOpenChange={setMapOpen}
          reportId={reportId}
          rows={keyMap ?? []}
        />

        <PasteCombosDialog
          open={pasteOpen}
          onOpenChange={setPasteOpen}
          scenarioId={scenarioId}
          reportId={reportId}
          feLabels={feLabels}
          onImported={() => qc.invalidateQueries({ queryKey: ["scenario-filter-matrix", scenarioId] })}
        />
      </CardContent>
    </Card>
  );
}

function PasteCombosDialog({
  open,
  onOpenChange,
  scenarioId,
  reportId,
  feLabels,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scenarioId: string;
  reportId?: string;
  feLabels: string[];
  onImported: () => void;
}) {
  const [text, setText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<string[]>([]); // per-column FE label ("" = skip)
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setText(""); setHeaders([]); setRows([]); setMapping([]);
    }
  }, [open]);

  const parse = (raw: string) => {
    const lines = raw.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
    if (!lines.length) return { headers: [], rows: [] };
    // Auto-detect delimiter from first line: prefer tab, then pipe, then comma
    const first = lines[0];
    const delim = first.includes("\t") ? "\t" : first.includes("|") ? "|" : ",";
    const split = (l: string) => l.split(delim).map((c) => c.trim());
    const headers = split(lines[0]);
    const rows = lines.slice(1).map(split);
    return { headers, rows };
  };

  const autoMap = (hdrs: string[]): string[] => {
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
    const feNorm = new Map(feLabels.map((l) => [norm(l), l]));
    return hdrs.map((h) => feNorm.get(norm(h)) ?? "");
  };

  const handlePreview = () => {
    const { headers: h, rows: r } = parse(text);
    if (!h.length) { toast.error("Nothing to parse"); return; }
    setHeaders(h);
    setRows(r);
    setMapping(autoMap(h));
  };

  const buildPayload = () => {
    return rows.map((r) => {
      const filters: Record<string, string> = {};
      const labelParts: string[] = [];
      mapping.forEach((feLabel, colIdx) => {
        if (!feLabel) return;
        const v = (r[colIdx] ?? "").trim();
        if (!v) return;
        // Keep "Total" in filters — Playwright applies it on the UI; SQL WHERE builder skips it.
        filters[feLabel] = v;
        labelParts.push(v);
      });
      return { label: labelParts.join(" / ") || null, filters };
    }).filter((p) => Object.keys(p.filters).length > 0);
  };

  const doImport = async (scope: "scenario" | "report") => {
    if (!rows.length) { toast.error("Preview the paste first"); return; }
    const base = buildPayload();
    if (!base.length) { toast.error("No mapped values found in rows"); return; }

    // Dedup within the paste itself first
    const seen = new Set<string>();
    const uniqueBase = base.filter((p) => {
      const k = canonFilters(p.filters);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    setBusy(true);
    try {
      let targetScenarioIds: string[] = [scenarioId];
      if (scope === "report") {
        if (!reportId) { toast.error("Report id missing"); setBusy(false); return; }
        const { data: sc, error: scErr } = await supabase
          .from("scenarios")
          .select("id")
          .eq("report_id", reportId);
        if (scErr) { toast.error(scErr.message); setBusy(false); return; }
        targetScenarioIds = (sc ?? []).map((s: any) => s.id);
        if (!targetScenarioIds.length) { toast.error("No scenarios in this report"); setBusy(false); return; }
      }

      // Fetch existing combos across all target scenarios to skip duplicates
      const { data: existing, error: exErr } = await supabase
        .from("scenario_filter_matrix")
        .select("scenario_id,filters")
        .in("scenario_id", targetScenarioIds);
      if (exErr) { toast.error(exErr.message); setBusy(false); return; }
      const existingBySid = new Map<string, Set<string>>();
      for (const e of (existing ?? []) as any[]) {
        const set = existingBySid.get(e.scenario_id) ?? new Set<string>();
        set.add(canonFilters(e.filters || {}));
        existingBySid.set(e.scenario_id, set);
      }

      const payload: any[] = [];
      let skipped = 0;
      for (const sid of targetScenarioIds) {
        const existSet = existingBySid.get(sid) ?? new Set<string>();
        for (const p of uniqueBase) {
          const k = canonFilters(p.filters);
          if (existSet.has(k)) { skipped++; continue; }
          existSet.add(k);
          payload.push({ scenario_id: sid, label: p.label, filters: p.filters });
        }
      }

      if (!payload.length) {
        toast.error(`All ${uniqueBase.length} row${uniqueBase.length === 1 ? "" : "s"} already exist — nothing to import`);
        setBusy(false);
        return;
      }

      const { error } = await supabase.from("scenario_filter_matrix").insert(payload);
      if (error) { toast.error(error.message); setBusy(false); return; }
      const scopeMsg = scope === "report" ? ` across ${targetScenarioIds.length} scenarios` : "";
      toast.success(
        `Imported ${payload.length} combination${payload.length === 1 ? "" : "s"}${scopeMsg}` +
          (skipped ? ` · ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped` : "")
      );
      onImported();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Paste filter combinations</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Paste rows from Excel or a CSV. First row must be headers (Area, Region, Territory, Time Bucket, …).
            Delimiters supported: tab, comma, or pipe (auto-detected). Cells with value <span className="mono">Total</span> are still applied on the UI by Playwright but excluded from the SQL WHERE clause.
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Area\tRegion\tTerritory\tTime Bucket\nAA - East\tTotal\tTotal\tR12M\nTotal\tTotal\t147A - Miami Central, FL\tR12M"}
            className="mono text-xs min-h-[140px]"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handlePreview}>Preview</Button>
            {rows.length > 0 && (
              <div className="text-xs text-muted-foreground self-center">
                {rows.length} row{rows.length === 1 ? "" : "s"} detected
              </div>
            )}
          </div>

          {headers.length > 0 && (
            <div className="border border-border rounded-md p-2 space-y-2">
              <div className="text-xs font-medium">Map columns to filter labels</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="text-xs mono flex-1 truncate" title={h}>{h}</div>
                    <Select
                      value={mapping[i] || "__skip__"}
                      onValueChange={(v) => setMapping((m) => m.map((x, idx) => (idx === i ? (v === "__skip__" ? "" : v) : x)))}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Select filter" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">— Skip —</SelectItem>
                        {feLabels.map((l) => (
                          <SelectItem key={l} value={l}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {feLabels.length === 0 && (
                <div className="text-xs text-destructive">
                  No FE labels defined. Add them in "FE ↔ BE key mapping" first.
                </div>
              )}
              <div className="max-h-40 overflow-auto border-t border-border pt-2">
                <table className="w-full text-[11px] mono">
                  <thead>
                    <tr className="text-muted-foreground">
                      {headers.map((h, i) => (
                        <th key={i} className="text-left pr-2 pb-1">{mapping[i] || `(skip) ${h}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 20).map((r, ri) => (
                      <tr key={ri}>
                        {headers.map((_, ci) => {
                          const v = (r[ci] ?? "").trim();
                          const unmapped = !mapping[ci] || !v;
                          const sqlSkip = !unmapped && v.toLowerCase() === "total";
                          const cls = unmapped ? "text-muted-foreground line-through" : sqlSkip ? "text-muted-foreground italic" : "";
                          return (
                            <td key={ci} className={`pr-2 py-0.5 ${cls}`} title={sqlSkip ? "Applied on UI, skipped in SQL WHERE" : undefined}>
                              {v || "\u00a0"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 20 && <div className="text-xs text-muted-foreground mt-1">…{rows.length - 20} more rows</div>}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <div className="inline-flex">
            <Button
              size="sm"
              onClick={() => doImport("scenario")}
              disabled={busy || rows.length === 0 || feLabels.length === 0}
              className="rounded-r-none"
            >
              {busy ? "Importing…" : `Import ${rows.length || ""} row${rows.length === 1 ? "" : "s"}`}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  disabled={busy || rows.length === 0 || feLabels.length === 0}
                  className="rounded-l-none border-l border-primary-foreground/20 px-2"
                  aria-label="More import options"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => doImport("scenario")}>
                  Import to this scenario
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => doImport("report")} disabled={!reportId}>
                  Import to all scenarios of this report
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KeyMapDialog({
  open,
  onOpenChange,
  reportId,
  rows,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reportId?: string;
  rows: KeyMap[];
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Record<string, { fe_label: string; be_column: string }>>({});
  const [newFe, setNewFe] = useState("");
  const [newBe, setNewBe] = useState("");

  useEffect(() => {
    if (open) {
      const map: Record<string, { fe_label: string; be_column: string }> = {};
      for (const r of rows) map[r.id] = { fe_label: r.fe_label, be_column: r.be_column };
      setEditing(map);
      setNewFe("");
      setNewBe("");
    }
  }, [open, rows]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["report-filter-key-map", reportId] });

  const addRow = async () => {
    const fe = newFe.trim();
    const be = newBe.trim();
    if (!fe || !be) {
      toast.error("Enter both FE label and BE column");
      return;
    }
    if (!reportId) {
      toast.error("Report not loaded");
      return;
    }
    const { error } = await supabase.from("scenario_filter_key_map").insert({
      report_id: reportId,
      fe_label: fe,
      be_column: be,
    });
    if (error) return toast.error(error.message);
    toast.success("Mapping added");
    setNewFe("");
    setNewBe("");
    invalidate();
  };

  const saveRow = async (id: string) => {
    const v = editing[id];
    if (!v?.fe_label.trim() || !v?.be_column.trim()) {
      toast.error("Both fields are required");
      return;
    }
    const { error } = await supabase
      .from("scenario_filter_key_map")
      .update({ fe_label: v.fe_label.trim(), be_column: v.be_column.trim() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Mapping updated");
    invalidate();
  };

  const deleteRow = async (id: string) => {
    const { error } = await supabase.from("scenario_filter_key_map").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removed");
    invalidate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>FE ↔ BE key mapping</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Map frontend filter labels (used in Filter combinations) to backend warehouse table column names (used when generating the final SQL query).
          </div>

          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
            <div>FE Filter label</div>
            <div>BE column name</div>
            <div className="w-20 text-right">Actions</div>
          </div>

          <div className="space-y-2 max-h-[40vh] overflow-auto">
            {rows.map((r) => (
              <div key={r.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <Input
                  value={editing[r.id]?.fe_label ?? ""}
                  onChange={(e) =>
                    setEditing((s) => ({ ...s, [r.id]: { ...s[r.id], fe_label: e.target.value } }))
                  }
                  className="h-9 text-sm"
                />
                <Input
                  value={editing[r.id]?.be_column ?? ""}
                  onChange={(e) =>
                    setEditing((s) => ({ ...s, [r.id]: { ...s[r.id], be_column: e.target.value } }))
                  }
                  className="h-9 text-sm mono"
                />
                <div className="flex gap-1 justify-end w-20">
                  <Button size="sm" variant="ghost" onClick={() => saveRow(r.id)} aria-label="Save">
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteRow(r.id)} aria-label="Delete">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="text-xs text-muted-foreground italic px-1">No mappings yet.</div>
            )}
          </div>

          <div className="border-t pt-3 space-y-2">
            <div className="text-xs font-medium">Add new mapping</div>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <Input
                placeholder="FE label (e.g. Area)"
                value={newFe}
                onChange={(e) => setNewFe(e.target.value)}
                className="h-9 text-sm"
              />
              <Input
                placeholder="BE column (e.g. area_code)"
                value={newBe}
                onChange={(e) => setNewBe(e.target.value)}
                className="h-9 text-sm mono"
              />
              <Button size="sm" onClick={addRow} className="w-20">
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


