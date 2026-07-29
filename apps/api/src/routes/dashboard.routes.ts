import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db, applicants, emailAccounts, proxyConfigs } from "@uber-automation/database";
import { authenticate } from "../middleware/auth";
import { getApplicantStatusDistribution } from "../services/applicants.service";

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

dashboardRouter.get("/stats", async (req, res, next) => {
  try {
    const companyId = req.user!.companyId;

    const [statusDistribution, [applicantTotal], [emailTotal], [proxyTotal]] = await Promise.all([
      getApplicantStatusDistribution(companyId),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(applicants)
        .where(eq(applicants.companyId, companyId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailAccounts)
        .where(eq(emailAccounts.companyId, companyId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(proxyConfigs)
        .where(eq(proxyConfigs.companyId, companyId)),
    ]);

    return res.json({
      success: true,
      data: {
        totalApplicants: applicantTotal?.count ?? 0,
        totalEmailAccounts: emailTotal?.count ?? 0,
        totalProxies: proxyTotal?.count ?? 0,
        statusDistribution,
      },
    });
  } catch (error) {
    return next(error);
  }
});
