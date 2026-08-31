import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/StatusChip";
import { KpiSummary, KpiInlineDelta } from "@/components/KpiSummary";
import { ChevronDown, ChevronRight, Wrench, Pencil, Clock, Save, History } from "lucide-react";
import { toast } from "sonner";

type Props = {
  scenarioId: string;
  scenarioTitle: string;
  scenarioMeta?: string; // e.g. "Workstream / Report · type · criticality"
  result: any | null;
  defaultOpen?: boolean;
  showRunLink?: boolean;
  rightSlot?: React.ReactNode;
  onChanged?: () => void;
};

export function ScenarioResultCard({
  scenarioId,
  scenarioTitle,
  scenarioMeta,
  result: l,
  defaultOpen = false,
  showRunLink = true,
  rightSlot,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const { data: scriptInfo } = useQuery({
    queryKey: ["scenario-script-tolerance", scenarioId],
    enabled: open,
    queryFn: async () =>
      (await supabase
        .from("scripts")
        .select("assertion_spec")
        .eq("scenario_id", scenarioId)
        .limit(1)
        .maybeSingle()).data,
  });
  const tolerance =
    scriptInfo?.assertion_spec && typeof (scriptInfo.assertion_spec as any).tolerance === "number"
      ? ((scriptInfo.assertion_spec as any).tolerance as number)
      : null;

  const proposeFix = async (trId: string) => {
    toast.loading("Generating proposal…", { id: trId });
    try {
      const { error } = await invokeFunction("agent-heal", { test_result_id: trId });
      if (error) throw error;
      toast.success("Healing proposal ready", { id: trId });
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message || "Failed", { id: trId });
    }
  };

  const defer = async () => {
    await supabase.from("scenarios").update({ deferred: true }).eq("id", scenarioId);
    await supabase.from("note_memory").insert({
      scenario_id: scenarioId,
      signature: "ignore_future",
      decision: "ignore_future",
      reason: "Deferred from results view",
      weight: 2,
    });
    toast.success("Deferred — agent will skip in future runs");
    onChanged?.();
  };

  const saveRca = async (trId: string, body: string) => {
    if (!body.trim()) return;
    await supabase.from("test_results").update({ analysis: body }).eq("id", trId);
    await supabase.from("operator_notes").insert({
      test_result_id: trId,
      scenario_id: scenarioId,
      note_type: "rca_update",
      body,
    });
    toast.success("RCA updated");
    onChanged?.();
  };

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={() => setOpen(!open)}
          className="text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <StatusChip status={l?.status || "pending"} />
        {(l?.criticality || l?.severity) && <StatusChip status={l.criticality || l.severity} />}
        <div className="flex-1 min-w-0">
          <Link to={`/scenarios/${scenarioId}`} className="text-sm font-medium hover:text-accent block truncate">
            {scenarioTitle}
          </Link>
          {scenarioMeta && (
            <div className="text-xs text-muted-foreground mono truncate">{scenarioMeta}</div>
          )}
        </div>
        {l && (
          <KpiInlineDelta
            expected={l.expected}
            actual={l.actual}
            diff={l.diff}
            status={l.status}
          />
        )}
        <div className="text-xs text-muted-foreground mono whitespace-nowrap">
          {l?.created_at ? new Date(l.created_at).toLocaleString() : "never run"}
        </div>
        {showRunLink && l?.run_id && (
          <Link to={`/runs/${l.run_id}`} className="text-xs text-accent hover:underline">
            run →
          </Link>
        )}
        {rightSlot}
      </div>
      {open && (
        <div className="border-t border-border bg-secondary/20 p-3 space-y-3 text-xs">
          {!l && <div className="text-muted-foreground">No execution recorded yet.</div>}
          {l && (
            <>
              <KpiSummary
                expected={l.expected}
                actual={l.actual}
                diff={l.diff}
                status={l.status}
                tolerance={tolerance}
              />
              {l.analysis && (
                <div>
                  <span className="text-muted-foreground mono">RCA: </span>
                  <span>{l.analysis}</span>
                </div>
              )}
              {l.healing_proposal && (
                <div className="border border-border rounded-md p-2 bg-background/40">
                  <div className="text-muted-foreground mono mb-1">
                    Proposed fix · status: {l.healing_status || "proposed"}
                  </div>
                  {l.healing_proposal.rationale && <div>{l.healing_proposal.rationale}</div>}
                  {l.healing_proposal.patched_playwright_code && (
                    <pre className="mono text-[10px] mt-1 whitespace-pre-wrap">
                      {l.healing_proposal.patched_playwright_code}
                    </pre>
                  )}
                </div>
              )}
              {l.screenshot_url && (
                <a href={l.screenshot_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  View screenshot →
                </a>
              )}
              <RcaEditor trId={l.id} initial={l.analysis || ""} onSave={saveRca} />
            </>
          )}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            {l && (
              <Button size="sm" variant="outline" onClick={() => proposeFix(l.id)}>
                <Wrench className="h-3 w-3 mr-1" /> Propose fix
              </Button>
            )}
            <Link to={`/scenarios/${scenarioId}`}>
              <Button size="sm" variant="outline">
                <Pencil className="h-3 w-3 mr-1" /> Update test scenario
              </Button>
            </Link>
            <Button size="sm" variant="outline" onClick={defer}>
              <Clock className="h-3 w-3 mr-1" /> Defer for future
            </Button>
            <HistoryToggle scenarioId={scenarioId} currentRunId={l?.run_id} />
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryToggle({ scenarioId, currentRunId }: { scenarioId: string; currentRunId?: string }) {
  const [show, setShow] = useState(false);
  const { data } = useQuery({
    queryKey: ["scenario-history", scenarioId, show],
    enabled: show,
    queryFn: async () =>
      (await supabase
        .from("test_results")
        .select("id, run_id, status, criticality, severity, analysis, created_at")
        .eq("scenario_id", scenarioId)
        .order("created_at", { ascending: false })
        .limit(50)).data ?? [],
  });
  return (
    <div className="w-full">
      <Button size="sm" variant="ghost" onClick={() => setShow(!show)}>
        <History className="h-3 w-3 mr-1" /> {show ? "Hide history" : "View history"}
      </Button>
      {show && (
        <div className="mt-2 border border-border rounded-md divide-y divide-border">
          {(data || []).map((h: any) => (
            <Link
              key={h.id}
              to={`/runs/${h.run_id}`}
              className={`flex items-center gap-3 px-3 py-2 text-xs hover:bg-secondary/40 ${h.run_id === currentRunId ? "bg-accent/5" : ""}`}
            >
              <StatusChip status={h.status} />
              {(h.criticality || h.severity) && <StatusChip status={h.criticality || h.severity} />}
              <span className="mono text-muted-foreground">{new Date(h.created_at).toLocaleString()}</span>
              <span className="flex-1 min-w-0 truncate">{h.analysis || "—"}</span>
              <span className="mono text-muted-foreground">run {h.run_id?.slice(0, 8)}</span>
            </Link>
          ))}
          {!data?.length && <div className="px-3 py-2 text-xs text-muted-foreground">No history.</div>}
        </div>
      )}
    </div>
  );
}

function RcaEditor({
  trId,
  initial,
  onSave,
}: {
  trId: string;
  initial: string;
  onSave: (trId: string, body: string) => void | Promise<void>;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div className="flex gap-2 items-start pt-2 border-t border-border">
      <Textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Update RCA / analysis…"
        className="min-h-[60px] flex-1 text-xs"
      />
      <Button size="sm" variant="outline" onClick={() => onSave(trId, val)}>
        <Save className="h-3 w-3 mr-1" /> Save RCA
      </Button>
    </div>
  );
}
