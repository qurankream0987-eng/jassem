import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronUp,
  ChevronDown,
  Search,
  ArrowUpDown,
} from "lucide-react";

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  searchable?: boolean;
  searchKeys?: string[];
  searchPlaceholder?: string;
  rowKey: (row: T) => string | number;
  maxHeight?: string;
  emptyMessage?: string;
}

type SortDir = "asc" | "desc" | null;

export default function DataTable<T>({
  columns,
  data,
  searchable = true,
  searchKeys,
  searchPlaceholder = "بحث...",
  rowKey,
  maxHeight = "300px",
  emptyMessage = "لا توجد بيانات",
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const handleSort = (key: string) => {
    if (sortCol === key) {
      setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
      if (sortDir === "desc") setSortCol(null);
    } else {
      setSortCol(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    let result = [...data];

    if (searchable && search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((row) => {
        if (searchKeys) {
          return searchKeys.some((k) => {
            const val = (row as Record<string, unknown>)[k];
            return String(val).toLowerCase().includes(q);
          });
        }
        return Object.values(row as Record<string, unknown>).some((val) =>
          String(val).toLowerCase().includes(q)
        );
      });
    }

    if (sortCol && sortDir) {
      result.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sortCol];
        const bVal = (b as Record<string, unknown>)[sortCol];
        const comparison = String(aVal).localeCompare(String(bVal), "ar");
        return sortDir === "asc" ? comparison : -comparison;
      });
    }

    return result;
  }, [data, search, sortCol, sortDir, searchable, searchKeys]);

  return (
    <div className="w-full" style={{ direction: "rtl" }}>
      {searchable && (
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text2)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className={cn(
              "w-full h-9 pl-10 pr-4 rounded-xl",
              "bg-white/5 border border-white/10",
              "text-[var(--text)] text-xs placeholder:text-[var(--text2)]/40",
              "focus:outline-none focus:border-[var(--cyan)]/40"
            )}
          />
        </div>
      )}

      <div
        className="overflow-y-auto overflow-x-auto rounded-xl border border-white/[0.08]"
        style={{ maxHeight }}
      >
        <table className="w-full text-right">
          <thead className="sticky top-0 z-10">
            <tr className="bg-white/[0.05]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-3 py-2.5 text-[10px] font-medium text-[var(--text2)]",
                    col.sortable && "cursor-pointer select-none hover:text-[var(--text)]"
                  )}
                  style={{ width: col.width }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      <span className="inline-flex">
                        {sortCol === col.key ? (
                          sortDir === "asc" ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-30" />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, idx) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  "border-t border-white/[0.05] transition-colors hover:bg-white/[0.02]",
                  idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.01]"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="px-3 py-2.5 text-[11px] text-[var(--text)] whitespace-nowrap"
                  >
                    {col.render
                      ? col.render(row)
                      : String(
                          (row as Record<string, unknown>)[col.key] ?? ""
                        )}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-[11px] text-[var(--text2)]"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
