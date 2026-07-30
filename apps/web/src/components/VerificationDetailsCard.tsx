const PROVIDER_LABELS: Record<string, string> = {
  SOCURE: "Socure",
  NOT_SOCURE: "Outro provedor (não Socure)",
  OTHER_PROVIDER: "Outro provedor (genérico)",
  UBER_INTERNAL: "Uber (interno)",
  UNKNOWN: "Desconhecido",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  HIGH: "bg-emerald-50 text-emerald-700 border-emerald-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-orange-50 text-orange-700 border-orange-200",
  UNKNOWN: "bg-slate-100 text-slate-600 border-slate-200",
};

export function VerificationDetailsCard({
  type,
  provider,
  confidence,
  detectedAt,
}: {
  type: "PROFILE_PHOTO" | "DRIVER_LICENSE";
  provider: string | null;
  confidence: string | null;
  detectedAt?: string | null;
}) {
  if (!provider) return null;

  const confidenceKey = confidence ?? "UNKNOWN";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {type === "PROFILE_PHOTO" ? "Foto de perfil" : "Carteira de motorista (CNH)"}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-900">
        {PROVIDER_LABELS[provider] ?? provider}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full border px-2 py-0.5 font-medium ${
            CONFIDENCE_STYLES[confidenceKey] ?? CONFIDENCE_STYLES.UNKNOWN
          }`}
        >
          Confiança: {confidenceKey}
        </span>
        {detectedAt && (
          <span className="text-slate-500">
            Detectado em {new Date(detectedAt).toLocaleString("pt-BR")}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Deteção puramente informativa (VerificationFlowDetector, Fase 4) - nunca usada para decidir
        prosseguir automaticamente.
      </p>
    </div>
  );
}
