import { ImportPanel } from "@/components/ImportPanel";

export default function EmailsImportPage() {
  return (
    <ImportPanel
      title="Importar e-mails"
      description="Envie um arquivo CSV ou XLSX associando cada motorista (por external_id) ao e-mail usado no cadastro. A senha nunca é exibida de volta na tela."
      basePath="/api/email-accounts"
      templateColumns={[
        "applicant_external_id",
        "email_address",
        "password",
        "provider (opcional)",
      ]}
    />
  );
}
