import { ImportPanel } from "@/components/ImportPanel";
import { EmailListImportPanel } from "@/components/EmailListImportPanel";
import { ApplicantsList } from "@/components/ApplicantsList";

export default function ApplicantsImportPage() {
  return (
    <div className="space-y-6">
      <EmailListImportPanel />
      <ImportPanel
        title="Importar motoristas (planilha completa)"
        description="Envie um arquivo CSV ou XLSX com os dados administrativos dos motoristas."
        basePath="/api/applicants"
        templateColumns={[
          "external_id",
          "full_name",
          "email",
          "phone",
          "city",
          "state",
          "postal_code",
          "vehicle_type",
          "proxy_id (opcional)",
        ]}
      />
      <ApplicantsList />
    </div>
  );
}
