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

const LICENSE_EXEMPT_PREFIXES = ["/licenca", "/ativar-licenca", "/d/"];

function shouldBlock(status: LicenseStatusView): boolean {
  return status.enabled && !status.ok;
}

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

    async function checkLicense() {
      const result = await apiRequest<LicenseStatusView>("/api/license/status", { skipAuth: true });
      if (cancelled) return;

      if (result.success && shouldBlock(result.data)) {
        router.replace("/licenca");
        return;
      }

      setReady(true);
    }

    void checkLicense();
    const timer = window.setInterval(() => {
      void checkLicense();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pathname, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Verificando licenca...
      </div>
    );
  }

  return <>{children}</>;
}
