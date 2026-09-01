"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiRequest } from "@/lib/apiClient";

export interface LicenseStatusView {
  enabled: boolean;
  configured: boolean;
  ok: boolean;
  status: string;
  message: string;
  licenseKeyMasked: string | null;
  machineId: string | null;
}

const LICENSE_EXEMPT_PREFIXES = ["/ativar-licenca", "/d/"];

export function LicenseGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (LICENSE_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      setReady(true);
      return;
    }

    let cancelled = false;
    apiRequest<LicenseStatusView>("/api/license/status", { skipAuth: true }).then((result) => {
      if (cancelled) return;
      if (result.success && result.data.enabled && !result.data.ok) {
        router.replace("/ativar-licenca");
        return;
      }
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Carregando...
      </div>
    );
  }

  return <>{children}</>;
}
