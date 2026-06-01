// Task #159: Annual budget targets admin screen.
//
// Lets managers and board members set per-category budget targets for a
// fiscal year. Reads/writes flow through the new /budgets REST endpoints
// and changes are mirrored on the Reports "Spend by category" view by
// invalidating the spend-report query on every successful mutation.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  useListBudgets,
  useCreateBudget,
  useUpdateBudget,
  useDeleteBudget,
  getListBudgetsQueryKey,
} from "@workspace/api-client-react";
import { Pencil, Trash2, Plus, X, Check, Loader2 } from "lucide-react";

const CURRENT_YEAR = new Date().getFullYear();

function fmtUsd(n: number): string {
  return `$${Number(n || 0).toLocaleString()}`;
}

export default function Budgets() {
  const [fiscalYear, setFiscalYear] = useState<number>(CURRENT_YEAR);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState<string>("");
  const [editCategory, setEditCategory] = useState<string>("");
  const [newCategory, setNewCategory] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useListBudgets({ fiscalYear });

  const rows = useMemo(
    () => (data ?? []).slice().sort((a, b) => a.category.localeCompare(b.category)),
    [data],
  );
  const total = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows],
  );

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListBudgetsQueryKey() }),
      // Reports' "Spend by category" reads from the same budgets table —
      // bust every spend-report cache entry so the chart refreshes too.
      queryClient.invalidateQueries({ predicate: (q) => {
        const k = q.queryKey;
        return Array.isArray(k) && typeof k[0] === "string" && k[0].includes("/reports/spend");
      } }),
    ]);
  };

  const createMut = useCreateBudget();
  const updateMut = useUpdateBudget();
  const deleteMut = useDeleteBudget();

  const handleCreate = async () => {
    setError(null);
    const cat = newCategory.trim();
    const amt = Number(newAmount);
    if (!cat) { setError("Category is required"); return; }
    if (!Number.isFinite(amt) || amt < 0) { setError("Amount must be a non-negative number"); return; }
    try {
      await createMut.mutateAsync({ data: { category: cat, fiscalYear, amount: Math.round(amt) } });
      setNewCategory("");
      setNewAmount("");
      await invalidateAll();
      await refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create budget";
      setError(msg.includes("409") ? "A budget for that category already exists for this year" : msg);
    }
  };

  const startEdit = (id: number, category: string, amount: number) => {
    setEditingId(id);
    setEditCategory(category);
    setEditAmount(String(amount));
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditCategory("");
    setEditAmount("");
  };

  const saveEdit = async (id: number) => {
    setError(null);
    const amt = Number(editAmount);
    const cat = editCategory.trim();
    if (!cat) { setError("Category is required"); return; }
    if (!Number.isFinite(amt) || amt < 0) { setError("Amount must be a non-negative number"); return; }
    try {
      await updateMut.mutateAsync({ id, data: { category: cat, amount: Math.round(amt) } });
      cancelEdit();
      await invalidateAll();
      await refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update budget";
      setError(msg.includes("409") ? "Another budget already uses that category for this year" : msg);
    }
  };

  const handleDelete = async (id: number, category: string) => {
    setError(null);
    if (!window.confirm(`Delete the FY${fiscalYear} budget for "${category}"? This cannot be undone.`)) return;
    try {
      await deleteMut.mutateAsync({ id });
      await invalidateAll();
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete budget");
    }
  };

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = CURRENT_YEAR + 1; y >= CURRENT_YEAR - 4; y--) years.push(y);
    return years;
  }, []);

  return (
    <Layout title="Budgets" subtitle="Per-category annual spend targets">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <label className="text-[13px]" style={{ color: c.inkSoft, fontWeight: 600 }}>
          Fiscal year
        </label>
        <select
          value={fiscalYear}
          onChange={(e) => setFiscalYear(Number(e.target.value))}
          className="border rounded-lg px-2 py-1 text-[13px]"
          style={{ borderColor: c.border, color: c.ink }}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {isLoading && (
          <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: c.inkMute }}>
            <Loader2 size={12} className="animate-spin" /> Loading…
          </span>
        )}
        <div className="ml-auto text-[13px]" style={{ color: c.inkSoft }}>
          Total budgeted: <span className="font-mono-num" style={{ fontWeight: 700, color: c.ink }}>{fmtUsd(total)}</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border p-3 text-[13px]" style={{ borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b" }}>
          {error}
        </div>
      )}

      <section className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
        <div className="p-5 border-b" style={{ borderColor: c.borderSoft }}>
          <h3 className="text-[15px] mb-3" style={{ fontWeight: 700 }}>Add a category</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[11px] mb-1 uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
                Category
              </label>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. landscaping"
                className="w-full border rounded-lg px-3 py-2 text-[13px]"
                style={{ borderColor: c.border, color: c.ink }}
              />
            </div>
            <div className="w-44">
              <label className="block text-[11px] mb-1 uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
                Annual amount ($)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="0"
                className="w-full border rounded-lg px-3 py-2 text-[13px] font-mono-num"
                style={{ borderColor: c.border, color: c.ink }}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={createMut.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold border disabled:opacity-50"
              style={{ background: c.cobalt, color: "white", borderColor: c.cobalt }}
            >
              <Plus size={14} /> Add
            </button>
          </div>
        </div>

        <div className="p-5">
          {rows.length === 0 ? (
            <div className="text-[13px]" style={{ color: c.inkMute }}>
              No budgets set for FY{fiscalYear}. Add a category above to get started.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left" style={{ color: c.inkMute }}>
                  <th className="py-2 pr-3 text-[11px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Category</th>
                  <th className="py-2 pr-3 text-[11px] uppercase tracking-wider text-right" style={{ fontWeight: 700 }}>Annual amount</th>
                  <th className="py-2 pl-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isEditing = editingId === r.id;
                  return (
                    <tr key={r.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                      <td className="py-2 pr-3" style={{ color: c.ink, fontWeight: 500 }}>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            className="w-full border rounded px-2 py-1 text-[13px]"
                            style={{ borderColor: c.border, color: c.ink }}
                          />
                        ) : (
                          r.category
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono-num" style={{ color: c.ink, fontWeight: 700 }}>
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            className="w-32 border rounded px-2 py-1 text-[13px] text-right font-mono-num"
                            style={{ borderColor: c.border, color: c.ink }}
                          />
                        ) : (
                          fmtUsd(r.amount)
                        )}
                      </td>
                      <td className="py-2 pl-3">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => saveEdit(r.id)}
                              disabled={updateMut.isPending}
                              className="p-1.5 rounded border disabled:opacity-50"
                              style={{ background: c.cobalt, color: "white", borderColor: c.cobalt }}
                              title="Save"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1.5 rounded border"
                              style={{ background: "white", color: c.inkSoft, borderColor: c.border }}
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => startEdit(r.id, r.category, r.amount)}
                              className="p-1.5 rounded border"
                              style={{ background: "white", color: c.inkSoft, borderColor: c.border }}
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(r.id, r.category)}
                              disabled={deleteMut.isPending}
                              className="p-1.5 rounded border disabled:opacity-50"
                              style={{ background: "white", color: "#b91c1c", borderColor: c.border }}
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <p className="mt-4 text-[12px]" style={{ color: c.inkMute }}>
        Targets here drive the "Spend by category" comparison on the Reports page for FY{fiscalYear}.
      </p>
    </Layout>
  );
}
