import { Router } from "express";
import { updateCompanySettingsSchema } from "@uber-automation/shared";
import { authenticate, requireRole } from "../middleware/auth";
import { logAudit } from "../services/auditLog.service";
import { getCompanySettings, updateCompanySettings } from "../services/companySettings.service";

export const settingsRouter = Router();

settingsRouter.use(authenticate);

settingsRouter.get("/", requireRole("admin", "operator", "viewer"), async (req, res, next) => {
  try {
    const data = await getCompanySettings(req.user!.companyId);
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.put("/", requireRole("admin", "operator"), async (req, res, next) => {
  try {
    const input = updateCompanySettingsSchema.parse(req.body);
    const { previous, current } = await updateCompanySettings(req.user!.companyId, input);

    await logAudit({
      companyId: req.user!.companyId,
      operatorId: req.user!.operatorId,
      action: "company_settings_updated",
      metadata: {
        previousPhoneBase: previous.placeholderPhoneBase,
        nextPhoneBase: current.placeholderPhoneBase,
        previousEarnCity: previous.earnCity,
        nextEarnCity: current.earnCity,
        previousSignupDomain: previous.signupEmailDomain,
        nextSignupDomain: current.signupEmailDomain,
        previousCatchallInbox: previous.catchallInboxEmail,
        nextCatchallInbox: current.catchallInboxEmail,
        previousCatchallDomains: previous.catchallDomains,
        nextCatchallDomains: current.catchallDomains,
        catchallPasswordUpdated: Boolean(
          typeof input.catchallPassword === "string" && input.catchallPassword.trim(),
        ),
        previousSource: previous.source,
      },
    });

    return res.json({ success: true, data: current });
  } catch (error) {
    return next(error);
  }
});
