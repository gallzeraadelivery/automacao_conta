import { ImportPanel } from "@/components/ImportPanel";

export default function ApplicantsImportPage() {
  return (
    <ImportPanel
      title="Importar motoristas"
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
  );
}
