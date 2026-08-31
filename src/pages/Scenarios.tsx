import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ScenarioResultCard } from "@/components/ScenarioResultCard";
import { toast } from "sonner";

export default function Scenarios() {
  const [params] = useSearchParams();
  const deferred = params.get("deferred") === "true";
  const urlStatus = params.get("status") || "all";
  const urlCriticality = params.get("criticality") || "all";
  const urlWs = params.get("workstream_id") || "all";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(urlStatus);
  const [criticality, setCriticality] = useState(urlCriticality);
  const [wsId, setWsId] = useState(urlWs);

  const { data: workstreams } = useQuery({
    queryKey: ["ws-list"],
    queryFn: async () => (await supabase.from("workstreams").select("id, name")).data ?? [],
  });

  const { data, refetch } = useQuery({
    queryKey: ["scenarios-pivot", deferred],
    queryFn: async () => {
      const scenarios =
        (await supabase
          .from("scenarios")
          .select("id, title, type, criticality, status, deferred, report_id, reports(id, name, workstream_id, workstreams(id, name))")
          .eq("deferred", deferred)
          .order("created_at", { ascending: false })
          .limit(2000)).data ?? [];
      const results =
        (await supabase
          .from("test_results")
          .select(
            "id, scenario_id, run_id, status, criticality, severity, analysis, expected, actual, diff, healing_status, healing_proposal, screenshot_url, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(5000)).data ?? [];
      const latest = new Map<string, any>();
      for (const r of results) if (!latest.has(r.scenario_id as string)) latest.set(r.scenario_id as string, r);
      return scenarios.map((s: any) => ({ scenario: s, latest: latest.get(s.id) || null }));
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (data || []).filter((row: any) => {
      const s = row.scenario;
      if (wsId !== "all" && s.reports?.workstream_id !== wsId) return false;
      if (status !== "all") {
        const st = row.latest?.status || "pending";
        if (st !== status) return false;
      }
      if (criticality !== "all") {
        const c = (row.latest?.criticality || s.criticality || "medium").toLowerCase();
        if (c !== criticality) return false;
      }
      if (!q) return true;
      return (
        s.title?.toLowerCase().includes(q) ||
        s.reports?.name?.toLowerCase().includes(q) ||
        s.reports?.workstreams?.name?.toLowerCase().includes(q) ||
        row.latest?.analysis?.toLowerCase().includes(q)
      );
    });
  }, [data, search, status, wsId, criticality]);

  const restore = async (id: string) => {
    await supabase.from("scenarios").update({ deferred: false }).eq("id", id);
    toast.success("Restored");
    refetch();
  };

  return (
    <AppLayout>
      <div className="p-8 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {deferred ? "Deferred scenarios" : "Tests execution status"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Latest execution per scenario, with RCA and proposed fixes.
            </p>
          </div>
          <Link
            to={`/scenarios?deferred=${deferred ? "false" : "true"}`}
            className="text-xs text-accent"
          >
            Show {deferred ? "active" : "deferred"} →
          </Link>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <Input
            placeholder="Search title, report, workstream, analysis…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Select value={wsId} onValueChange={setWsId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reports</SelectItem>
              {(workstreams || []).map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pass">Pass</SelectItem>
              <SelectItem value="fail">Fail</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          <Select value={criticality} onValueChange={setCriticality}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All criticality</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground mono ml-auto">{filtered.length} scenarios</div>
        </div>

        <Card>
          <CardContent className="p-2 space-y-1">
            {filtered.map((row: any) => {
              const s = row.scenario;
              const meta = `${s.reports?.workstreams?.name || "—"} / ${s.reports?.name || "—"} · ${s.type || "—"} · ${s.criticality}`;
              return (
                <ScenarioResultCard
                  key={s.id}
                  scenarioId={s.id}
                  scenarioTitle={s.title}
                  scenarioMeta={meta}
                  result={row.latest}
                  onChanged={refetch}
                  rightSlot={
                    deferred ? (
                      <Button size="sm" variant="outline" onClick={() => restore(s.id)}>Restore</Button>
                    ) : undefined
                  }
                />
              );
            })}
            {!filtered.length && (
              <div className="text-sm text-muted-foreground p-4 text-center">No scenarios match.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
