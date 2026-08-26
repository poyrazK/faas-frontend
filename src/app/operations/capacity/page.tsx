"use client";

import React from "react";
import { getObsCapacity, type ObsCapacityNode } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { PageHeader } from "@/components/ui/bits";
import { SectionCard, StatTile } from "@/components/ui/Panels";
import { Icon } from "@/components/ui/Icons";

const formatMB = (mb: number) => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toLocaleString()} MB`;
};

const formatPct = (used: number, capacity: number) => {
  if (capacity <= 0) return "—";
  return `${Math.min(999, (used / capacity) * 100).toFixed(1)}%`;
};

export default function CapacityPage() {
  const { data, loading, error, reload } = useAsync(getObsCapacity, [], 30000);

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--color-ink-muted)]">
        Loading fleet capacity…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-subtle)] text-[var(--color-danger)]">
          <Icon name="shield" size={24} />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Operator Access Required</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {error.message ||
            "Could not load fleet capacity. Admin permissions and MFA step-up are required."}
        </p>
        <button onClick={reload} className="btn btn-secondary btn-sm mt-4">
          <Icon name="refresh" size={14} />
          Retry Request
        </button>
      </div>
    );
  }

  const summary = data?.summary;
  const snapshotTime = data?.generated_at
    ? new Date(data.generated_at).toLocaleTimeString()
    : "";

  return (
    <div>
      <PageHeader
        title="Capacity Planning"
        subtitle={`Fleet headroom, placement pressure, and node-level utilization (Snapshot at ${snapshotTime})`}
        actions={
          <button onClick={reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh Capacity
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Active Nodes"
          value={summary?.active_nodes ?? 0}
          sub={`${summary?.inactive_nodes ?? 0} inactive · ${summary?.total_nodes ?? 0} total`}
          color="var(--color-brand-bright)"
        />
        <StatTile
          label="RAM Utilization"
          value={formatPct(
            summary?.ram_used_mb ?? 0,
            summary?.total_admission_ceiling_mb ?? 0,
          )}
          sub={`${formatMB(summary?.ram_used_mb ?? 0)} used of ${formatMB(summary?.total_admission_ceiling_mb ?? 0)}`}
        />
        <StatTile
          label="Live MicroVMs"
          value={summary?.instances_live ?? 0}
          sub={`${summary?.instances_running ?? 0} running · ${summary?.instances_waking ?? 0} waking`}
          color="var(--color-brand-bright)"
        />
        <StatTile
          label="Placement Pressure"
          value={summary?.unplaced_apps ?? 0}
          sub={`${summary?.apps_total ?? 0} apps · ${summary?.tenants_total ?? 0} tenants`}
          color={
            summary?.unplaced_apps
              ? "var(--color-warning)"
              : "var(--color-chart)"
          }
        />
      </div>

      <SectionCard
        title="Node Capacity and Placement"
        action={
          <span className="text-xs text-[var(--color-ink-muted)]">
            {summary?.admission_margin_mb != null
              ? `${formatMB(summary.admission_margin_mb)} fleet headroom`
              : ""}
          </span>
        }
        className="mt-6"
      >
        {!data?.nodes?.length ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            No compute nodes registered in the control plane.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">Node</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">RAM / Ceiling</th>
                  <th className="px-4 py-3">vCPU Budget</th>
                  <th className="px-4 py-3">Workloads</th>
                  <th className="px-4 py-3">Placement</th>
                  <th className="px-4 py-3">Headroom</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {data.nodes.map((node: ObsCapacityNode) => (
                  <tr
                    key={node.id}
                    className="hover:bg-[var(--color-surface-subtle)]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">{node.name}</div>
                      <div className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">
                        {node.vpcpus} physical vCPU · {formatMB(node.mem_mb)}{" "}
                        memory
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`badge ${node.active ? "badge-success" : "badge-neutral"}`}
                      >
                        {node.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">
                        {formatMB(node.ram_used_mb)}
                      </div>
                      <div className="text-[11px] text-[var(--color-ink-muted)]">
                        of {formatMB(node.admission_ceiling_mb)} ·{" "}
                        {formatPct(node.ram_used_mb, node.admission_ceiling_mb)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">
                        {node.vcpu_budget || node.vpcpus}
                      </span>
                      <span className="text-[var(--color-ink-muted)]">
                        {" "}
                        slots
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">
                        {node.instances_live} live
                      </div>
                      <div className="text-[11px] text-[var(--color-ink-muted)]">
                        {node.instances_running} running ·{" "}
                        {node.instances_waking} waking ·{" "}
                        {node.instances_cold_booting} cold
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">
                        {node.apps_count} apps
                      </div>
                      <div className="text-[11px] text-[var(--color-ink-muted)]">
                        {node.tenants_count} tenants
                      </div>
                    </td>
                    <td
                      className={`px-4 py-3 font-semibold ${node.admission_margin_mb < 0 ? "text-[var(--color-danger)]" : ""}`}
                    >
                      {formatMB(node.admission_margin_mb)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
