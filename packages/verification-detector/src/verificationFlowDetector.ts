import { classifySignals } from "./classifier";
import {
  classifyPageType,
  isCaptchaPage,
  isDriverLicensePage,
  isProfilePhotoPage,
  isSecurityBlockPage,
  isTwoFactorPage,
  isVerificationPage,
} from "./pageType";
import { collectSignals } from "./signals";
import type {
  DriverLicenseVerificationResult,
  IVerificationFlowDetector,
  PageType,
  ProfilePhotoVerificationResult,
  VerificationDetectionContext,
} from "./types";

/**
 * Modulo exclusivamente informativo: identifica qual provedor de
 * verificacao de identidade esta sendo apresentado ao motorista (Socure,
 * outro provedor, ou desconhecido) a partir de sinais normalmente
 * disponiveis na pagina (URL, dominio, titulo, texto, atributos, scripts,
 * recursos carregados).
 *
 * NUNCA tenta contornar, resolver, alterar ou influenciar a verificacao -
 * apenas observa e classifica. Nao interage com CAPTCHA/2FA, nao envia
 * documentos/selfies, nao decide qual provedor a plataforma deve usar.
 */
export class VerificationFlowDetector implements IVerificationFlowDetector {
  async detectProfilePhotoProvider(
    context: VerificationDetectionContext,
  ): Promise<ProfilePhotoVerificationResult> {
    const signals = collectSignals(context);
    const classification = classifySignals(signals);
    return { type: "PROFILE_PHOTO_VERIFICATION", ...classification };
  }

  async detectDriverLicenseProvider(
    context: VerificationDetectionContext,
  ): Promise<DriverLicenseVerificationResult> {
    const signals = collectSignals(context);
    const classification = classifySignals(signals);
    return { type: "DRIVER_LICENSE_VERIFICATION", ...classification };
  }

  isVerificationPage(html: string): boolean {
    return isVerificationPage(html);
  }

  isProfilePhotoPage(html: string): boolean {
    return isProfilePhotoPage(html);
  }

  isDriverLicensePage(html: string): boolean {
    return isDriverLicensePage(html);
  }

  isCaptchaPage(html: string): boolean {
    return isCaptchaPage(html);
  }

  isTwoFactorPage(html: string): boolean {
    return isTwoFactorPage(html);
  }

  isSecurityBlockPage(html: string): boolean {
    return isSecurityBlockPage(html);
  }

  /** Classificacao agregada do tipo de pagina - ver `PageType`. */
  classifyPageType(html: string): PageType {
    return classifyPageType(html);
  }
}
