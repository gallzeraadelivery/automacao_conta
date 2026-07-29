"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/applicants", label: "Motoristas" },
  { href: "/dashboard/emails", label: "E-mails" },
  { href: "/dashboard/proxies", label: "Proxies" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { operator, logout } = useAuth();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-5">
        <p className="text-sm font-semibold text-slate-900">Uber Automation</p>
        <p className="text-xs text-slate-500">Painel Administrativo</p>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 px-4 py-4">
        <p className="truncate text-sm font-medium text-slate-900">{operator?.name}</p>
        <p className="truncate text-xs text-slate-500">{operator?.email}</p>
        <button
          onClick={() => logout()}
          className="mt-3 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Sair
        </button>
      </div>
    </aside>
  );
}
