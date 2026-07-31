import { ImportPanel } from "@/components/ImportPanel";
import { ImapTestPanel } from "@/components/ImapTestPanel";

export default function EmailsImportPage() {
  return (
    <div className="space-y-6">
      <ImapTestPanel />
      <ImportPanel
        title="Importar e-mails"
        description="Envie um arquivo CSV ou XLSX associando cada motorista (por external_id) ao e-mail usado no cadastro. A senha nunca é exibida de volta na tela."
        basePath="/api/email-accounts"
        templateColumns={[
          "applicant_external_id",
          "email_address",
          "password",
          "provider (opcional: gmail, spacemail, outlook, yahoo)",
        ]}
      />
    </div>
  );
}
