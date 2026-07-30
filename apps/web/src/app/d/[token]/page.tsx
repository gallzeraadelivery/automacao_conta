"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/apiClient";

interface DeliveryView {
  applicantFirstName: string | null;
  status: "VALID" | "EXPIRED" | "REVOKED" | "NOT_FOUND";
  expiresAt: string | null;
}

const STATUS_MESSAGES: Record<DeliveryView["status"], { title: string; body: string }> = {
  VALID: {
    title: "",
    body: "",
  },
  EXPIRED: {
    title: "Este link expirou",
    body: "Peça ao operador responsável pelo seu cadastro para gerar um novo link.",
  },
  REVOKED: {
    title: "Este link não está mais disponível",
    body: "Entre em contato com o operador responsável pelo seu cadastro.",
  },
  NOT_FOUND: {
    title: "Link inválido",
    body: "Verifique se o endereço foi copiado corretamente, ou peça um novo link ao operador.",
  },
};

export default function DriverDeliveryPage({ params }: { params: { token: string } }) {
  const [view, setView] = useState<DeliveryView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiRequest<DeliveryView>(`/api/deliveries/${params.token}`, { skipAuth: true }).then(
      (result) => {
        if (cancelled) return;
        if (result.success) setView(result.data);
        else setError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [params.token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        {!view && !error && <p className="text-center text-sm text-slate-500">Carregando...</p>}

        {error && (
          <p className="text-center text-sm text-red-600">
            Não foi possível verificar este link agora. Tente novamente em instantes.
          </p>
        )}

        {view && view.status !== "VALID" && (
          <>
            <h1 className="text-lg font-semibold text-slate-900">
              {STATUS_MESSAGES[view.status].title}
            </h1>
            <p className="mt-2 text-sm text-slate-600">{STATUS_MESSAGES[view.status].body}</p>
          </>
        )}

        {view && view.status === "VALID" && (
          <>
            <h1 className="text-lg font-semibold text-slate-900">
              Olá{view.applicantFirstName ? `, ${view.applicantFirstName}` : ""}!
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Sua verificação de identidade precisa ser concluída{" "}
              <strong>por você, pessoalmente</strong>, diretamente no aplicativo ou site oficial da
              Uber. Por segurança, nenhuma automação envia fotos, documentos ou resolve verificações
              em seu nome.
            </p>
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>
                Abra o aplicativo Motorista da Uber (ou partners.uber.com) no seu celular ou
                computador.
              </li>
              <li>Faça login com sua conta.</li>
              <li>Siga as instruções da própria Uber para concluir a etapa pendente.</li>
            </ol>
            <a
              href="https://www.uber.com/br/pt-br/drive/"
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-block rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Abrir site oficial da Uber
            </a>
            {view.expiresAt && (
              <p className="mt-4 text-xs text-slate-400">
                Este link expira em {new Date(view.expiresAt).toLocaleString("pt-BR")}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
