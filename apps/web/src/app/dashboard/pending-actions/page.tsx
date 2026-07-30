import { PendingActionsTable } from "@/components/PendingActionsTable";

export default function PendingActionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Central de Pendências</h1>
        <p className="text-sm text-slate-500">
          Motoristas cuja automação parou e aguarda ação humana (foto de perfil, CNH, CAPTCHA, 2FA
          ou bloqueio de segurança).
        </p>
      </div>
      <PendingActionsTable />
    </div>
  );
}
