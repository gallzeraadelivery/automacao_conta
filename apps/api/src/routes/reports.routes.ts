import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth";
import {
  buildAutomationReport,
  buildAuditReport,
  buildSocureProxyGeoReport,
  listVerificationReport,
  type ReportPeriod,
  type VerificationProviderFilter,
} from "../services/reports.service";
import { exportUberCookiesZip } from "../services/applicants.service";
import { logAudit } from "../services/auditLog.service";
import { toCsv } from "../lib/csv";
import { renderReportPdf } from "../lib/pdf";

export const reportsRouter = Router();

reportsRouter.use(authenticate);

const periodQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const DEFAULT_PERIOD_DAYS = 30;

function resolvePeriod(query: { from?: Date; to?: Date }): ReportPeriod {
  // `to` é documentado como `format: date` (openapi.yaml), não date-time - um
  // valor explícito (ex: "2026-07-30") deve incluir o dia inteiro, não parar
  // à meia-noite do início dele (senão "até hoje" excluiria tudo que
  // aconteceu hoje).
  const to = query.to ? endOfDay(query.to) : new Date();
  const from = query.from ?? new Date(to.getTime() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return { from, to };
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

reportsRouter.get("/automation", async (req, res, next) => {
  try {
    const period = resolvePeriod(periodQuerySchema.parse(req.query));
    const report = await buildAutomationReport(req.user!.companyId, period);
    return res.json({ success: true, data: report });
  } catch (error) {
    return next(error);
  }
});

reportsRouter.get("/audit", async (req, res, next) => {
  try {
    const period = resolvePeriod(periodQuerySchema.parse(req.query));
    const report = await buildAuditReport(req.user!.companyId, period);
    return res.json({ success: true, data: report });
  } catch (error) {
    return next(error);
  }
});

const verificationQuerySchema = z.object({
  provider: z.enum(["socure", "veriff", "all"]).default("socure"),
});

/**
 * BI de verificação: lista motoristas com foto/CNH detectados.
 * Filtro padrão = socure (foto ou CNH). Inclui ids para download de cookies.
 */
reportsRouter.get("/verification", async (req, res, next) => {
  try {
    const { provider } = verificationQuerySchema.parse(req.query);
    const report = await listVerificationReport(
      req.user!.companyId,
      provider as VerificationProviderFilter,
    );
    return res.json({ success: true, data: report });
  } catch (error) {
    return next(error);
  }
});

/**
 * ZIP com cookies AdsPower dos motoristas selecionados (relatório Socure).
 * Marca como baixados os que entraram no arquivo.
 */
reportsRouter.post(
  "/verification/cookies-zip",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          applicantIds: z.array(z.string().uuid()).min(1),
        })
        .parse(req.body);
      const result = await exportUberCookiesZip(req.user!.companyId, body.applicantIds);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        action: "download_uber_cookies_zip",
        metadata: {
          included: result.included.length,
          skipped: result.skipped.length,
          applicantIds: result.included.map((r) => r.id),
        },
      });

      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="socure-cookies-${stamp}.zip"`,
      );
      res.setHeader("X-Cookies-Included", String(result.included.length));
      res.setHeader("X-Cookies-Skipped", String(result.skipped.length));
      return res.status(200).send(result.zip);
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * BI Socure × cidade do proxy: ranking de Socure (provider) e Veriff (pause).
 */
reportsRouter.get("/socure-proxy-geo", async (req, res, next) => {
  try {
    const report = await buildSocureProxyGeoReport(req.user!.companyId);
    return res.json({ success: true, data: report });
  } catch (error) {
    return next(error);
  }
});

const exportQuerySchema = periodQuerySchema.extend({
  format: z.enum(["csv", "pdf"]).default("csv"),
});

reportsRouter.get("/automation/export", async (req, res, next) => {
  try {
    const { format, ...periodQuery } = exportQuerySchema.parse(req.query);
    const period = resolvePeriod(periodQuery);
    const report = await buildAutomationReport(req.user!.companyId, period);

    if (format === "csv") {
      const summaryCsv = toCsv(
        [
          { metric: "totalProcessed", value: report.totalProcessed },
          { metric: "successfulCount", value: report.successfulCount },
          { metric: "failedCount", value: report.failedCount },
          { metric: "pausedCount", value: report.pausedCount },
          { metric: "successRate", value: report.successRate },
          { metric: "averageTimeToCompleteSeconds", value: report.averageTimeToCompleteSeconds },
          { metric: "provider_socure", value: report.providerDistribution.socure },
          { metric: "provider_other", value: report.providerDistribution.other },
          { metric: "provider_unknown", value: report.providerDistribution.unknown },
          ...Object.entries(report.errorDistribution).map(([code, count]) => ({
            metric: `error_${code}`,
            value: count,
          })),
        ],
        ["metric", "value"],
      );
      const geoCsv = toCsv(
        report.proxyGeoRows.map((row) => ({
          externalId: row.externalId,
          fullName: row.fullName,
          status: row.status,
          proxyExternalIp: row.proxyExternalIp ?? "",
          proxyGeoCity: row.proxyGeoCity ?? "",
          proxyGeoRegion: row.proxyGeoRegion ?? "",
        })),
        ["externalId", "fullName", "status", "proxyExternalIp", "proxyGeoCity", "proxyGeoRegion"],
      );
      const csv = `${summaryCsv}\n\n# proxy_geo\n${geoCsv}`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="automation-report.csv"');
      return res.send(csv);
    }

    const pdf = await renderReportPdf({
      title: "Relatório de Automação",
      subtitle: `Período: ${period.from.toISOString()} a ${period.to.toISOString()}`,
      sections: [
        {
          heading: "Resumo",
          rows: [
            { label: "Total processado", value: String(report.totalProcessed) },
            { label: "Sucesso", value: String(report.successfulCount) },
            { label: "Falhas", value: String(report.failedCount) },
            { label: "Pausados (aguardando ação humana)", value: String(report.pausedCount) },
            { label: "Taxa de sucesso", value: `${(report.successRate * 100).toFixed(1)}%` },
            {
              label: "Tempo médio até conclusão",
              value: `${report.averageTimeToCompleteSeconds}s`,
            },
          ],
        },
        {
          heading: "Distribuição de provedor",
          rows: [
            { label: "Socure", value: String(report.providerDistribution.socure) },
            { label: "Outro provedor", value: String(report.providerDistribution.other) },
            { label: "Desconhecido", value: String(report.providerDistribution.unknown) },
          ],
        },
      ],
      tables: [
        {
          heading: "Principais erros",
          headers: ["Código", "Ocorrências", "Mensagem"],
          rows: report.topErrors.map((error) => [error.code, String(error.count), error.message]),
        },
        {
          heading: "Cidade do proxy (IP)",
          headers: ["Motorista", "Status", "IP", "Cidade", "Região"],
          rows: report.proxyGeoRows.map((row) => [
            row.fullName,
            row.status,
            row.proxyExternalIp ?? "-",
            row.proxyGeoCity ?? "-",
            row.proxyGeoRegion ?? "-",
          ]),
        },
      ],
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="automation-report.pdf"');
    return res.send(pdf);
  } catch (error) {
    return next(error);
  }
});

reportsRouter.get("/audit/export", async (req, res, next) => {
  try {
    const { format, ...periodQuery } = exportQuerySchema.parse(req.query);
    const period = resolvePeriod(periodQuery);
    const report = await buildAuditReport(req.user!.companyId, period);

    if (format === "csv") {
      const csv = toCsv(
        report.securityEvents.map((event) => ({
          timestamp: event.timestamp,
          event: event.event,
          severity: event.severity,
        })),
        ["timestamp", "event", "severity"],
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="audit-report.csv"');
      return res.send(csv || "timestamp,event,severity");
    }

    const pdf = await renderReportPdf({
      title: "Relatório de Auditoria",
      subtitle: `Período: ${period.from.toISOString()} a ${period.to.toISOString()}`,
      sections: [
        {
          heading: "Resumo",
          rows: [
            { label: "Total de ações", value: String(report.totalActions) },
            ...Object.entries(report.actionsByType).map(([action, count]) => ({
              label: action,
              value: String(count),
            })),
          ],
        },
      ],
      tables: [
        {
          heading: "Ações por operador",
          headers: ["Operador", "Ações"],
          rows: report.actionsByOperator.map((row) => [row.operator, String(row.count)]),
        },
        {
          heading: "Eventos de segurança",
          headers: ["Data/hora", "Evento", "Severidade"],
          rows: report.securityEvents.map((event) => [
            event.timestamp.toISOString(),
            event.event,
            event.severity,
          ]),
        },
      ],
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="audit-report.pdf"');
    return res.send(pdf);
  } catch (error) {
    return next(error);
  }
});
