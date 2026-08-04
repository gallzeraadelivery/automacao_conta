/**
 * Ações de auditoria que representam progresso do job → valor gravado em
 * `applicants.current_step` para o painel mostrar a etapa fina ao vivo.
 * Ações ruidosas (decrypt, cookies) ficam de fora de propósito.
 */
export const AUDIT_ACTION_TO_LIVE_STEP: Readonly<Record<string, string>> = {
  automation_start_requested: "QUEUED",
  automation_job_delayed: "QUEUED",
  automation_job_attempt_started: "STARTING",
  browser_profile_loaded: "BROWSER",
  uber_real_signup_portal_opened: "PORTAL",
  uber_real_signup_identifier_submitted: "IDENTIFIER",
  email_login_succeeded: "EMAIL_IMAP",
  email_imap_reconnect: "EMAIL_IMAP",
  email_verification_code_requested: "EMAIL_CODE_WAIT",
  email_verification_code_located: "EMAIL_CODE_FOUND",
  uber_real_signup_code_retrieved: "EMAIL_CODE_FOUND",
  uber_real_signup_email_verified: "EMAIL_VERIFIED",
  uber_real_signup_phone_submitted: "PHONE",
  browser_session_restored: "BROWSER",
  browser_profile_uber_cookies_save_skipped: "BROWSER",
  browser_session_rotated: "SESSION_ROTATE",
  uber_real_signup_phone_sms_rejected_retry: "PHONE_SMS_RETRY",
  uber_real_signup_password_submitted: "PASSWORD",
  uber_real_signup_name_submitted: "NAME",
  uber_real_signup_terms_accepted: "TERMS",
  uber_real_signup_account_created: "ACCOUNT_CREATED",
  uber_real_signup_hub_session_resumed: "HUB",
  uber_real_signup_hub_opened: "HUB",
  uber_real_signup_hub_resume_failed: "HUB",
  uber_real_signup_hub_resume_blocked_sms: "HUB",
  uber_real_signup_gender_submitted: "GENDER",
  uber_real_signup_earning_location_confirmed: "LOCATION",
  uber_real_signup_service_type_submitted: "SERVICE",
  uber_real_signup_background_check_skipped: "PROFILE",
  uber_real_signup_driver_requirements_reached: "DRIVER_REQUIREMENTS",
  automation_job_attempt_succeeded: "COMPLETED",
  automation_job_attempt_failed: "FAILED_ATTEMPT",
  automation_job_failed_final: "FAILED",
};

export function liveStepFromAuditAction(action: string): string | null {
  return AUDIT_ACTION_TO_LIVE_STEP[action] ?? null;
}
