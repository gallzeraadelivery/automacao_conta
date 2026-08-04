import type { Page, Request } from "playwright";
import type { ProviderClassification } from "@uber-automation/verification-detector";
import { toTechnicalError } from "../../errorMapping";
import { AutomationPauseSignal } from "../../../types";
import type { RealStepContext } from "../realStepContext";
import { softGoto } from "./HubSessionSteps";

const PRIMARY_NEXT_OR_START =
  /^(continuar|continue|next|pr[oó]ximo|get started|start|begin)(\s*→)?$/i;

const TAKE_PHOTO_RE = /take (a )?photo|tirar foto|capture|scan/i;

type DocKind = "DRIVER_LICENSE" | "PROFILE_PHOTO";
type ProbeLabel = "VERIFF" | "SOCURE" | "UNKNOWN";

interface ProbeResult {
  kind: DocKind;
  provider: ProviderClassification;
  confidence: string;
  url: string;
  label: ProbeLabel;
}

/** Só o link (URL): hostname com veriff ou socure. */
function classifyUrl(url: string): ProbeLabel | null {
  if (!url || url === "about:blank") return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("veriff")) return "VERIFF";
    if (host.includes("socure")) return "SOCURE";
  } catch {
    // ignore
  }
  return null;
}

function isUberStepUrl(url: string): boolean {
  return /bonjour\.uber\.com\/step\//i.test(url);
}

function labelToProvider(label: ProbeLabel): ProviderClassification {
  if (label === "SOCURE") return "SOCURE";
  if (label === "VERIFF") return "NOT_SOCURE";
  return "UNKNOWN";
}

async function collectCandidateUrls(page: Page): Promise<string[]> {
  const urls = [page.url()];
  try {
    for (const frame of page.frames()) {
      const u = frame.url();
      if (u && u !== "about:blank") urls.push(u);
    }
  } catch {
    // ignore
  }
  try {
    const fromDom = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("iframe[src], a[href]"))) {
        const v =
          (el as HTMLIFrameElement).src || (el as HTMLAnchorElement).href || "";
        if (v) out.push(v);
      }
      return out;
    });
    urls.push(...fromDom);
  } catch {
    // ignore
  }
  return [...new Set(urls.filter(Boolean))];
}

function findProviderIn(urls: string[]): { label: ProbeLabel; url: string } | null {
  for (const u of urls) {
    const label = classifyUrl(u);
    if (label) return { label, url: u };
  }
  return null;
}

async function ensureDocumentsTab(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  await softGoto(page, config.profileUrl, Math.max(config.timeouts.pageLoad, 45_000));
  const documentsTab = page.getByRole("tab", { name: /^documents$/i }).or(page.getByText(/^documents$/i));
  if ((await documentsTab.count().catch(() => 0)) > 0) {
    await documentsTab.first().click({ timeout: config.timeouts.elementWait }).catch(() => undefined);
  }
  await page
    .getByText(/driver requirements|documents/i)
    .first()
    .waitFor({ state: "visible", timeout: config.timeouts.pageLoad })
    .catch(() => undefined);
}

async function clickDocEntry(page: Page, kind: DocKind, timeout: number): Promise<void> {
  const nameRe =
    kind === "DRIVER_LICENSE"
      ? /driver'?s? license|cnh|carteira de motorista/i
      : /profile (photo|picture)|foto de perfil|profile picture/i;

  const entry = page
    .getByRole("button", { name: nameRe })
    .or(page.getByRole("link", { name: nameRe }))
    .or(page.getByText(nameRe));

  await entry.first().waitFor({ state: "visible", timeout });
  await entry.first().click({ timeout });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(1_500);
}

/**
 * Espera a tela Uber `bonjour.../step/...` com botão Take Photo
 * (é nessa tela que se clica Take Photo).
 */
async function waitForUberTakePhotoScreen(page: Page, timeoutMs: number): Promise<void> {
  const takePhoto = page
    .getByRole("button", { name: TAKE_PHOTO_RE })
    .or(page.getByRole("link", { name: TAKE_PHOTO_RE }))
    .or(page.getByText(TAKE_PHOTO_RE));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    const takeVisible = await takePhoto.first().isVisible({ timeout: 400 }).catch(() => false);
    if (takeVisible && (isUberStepUrl(url) || /bonjour\.uber\.com/i.test(url))) {
      return;
    }
    if (takeVisible) return;

    const cont = page.getByRole("button", { name: PRIMARY_NEXT_OR_START });
    if (await cont.first().isVisible({ timeout: 300 }).catch(() => false)) {
      await cont.first().click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      continue;
    }
    await page.waitForTimeout(500);
  }

  await takePhoto.first().waitFor({ state: "visible", timeout: 5_000 });
}

async function clickTakePhoto(page: Page, timeout: number): Promise<void> {
  const takePhoto = page
    .getByRole("button", { name: TAKE_PHOTO_RE })
    .or(page.getByRole("link", { name: TAKE_PHOTO_RE }))
    .or(page.getByText(TAKE_PHOTO_RE));

  await takePhoto.first().waitFor({ state: "visible", timeout });
  await takePhoto.first().click({ timeout });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

/**
 * Depois do Take Photo: espera a PRÓXIMA tela cujo link tenha veriff ou socure.
 * Não classifica enquanto o link for só bonjour.uber.com/step/...
 */
async function waitForProviderLinkAfterTakePhoto(
  page: Page,
  timeoutMs: number,
): Promise<{ label: ProbeLabel; url: string }> {
  const networkHits: string[] = [];
  const onRequest = (req: Request) => {
    const u = req.url();
    if (classifyUrl(u)) networkHits.push(u);
  };
  page.on("request", onRequest);

  const deadline = Date.now() + timeoutMs;
  let lastTakeClick = 0;

  try {
    while (Date.now() < deadline) {
      const fromNet = findProviderIn(networkHits);
      if (fromNet) return fromNet;

      const fromPage = findProviderIn(await collectCandidateUrls(page));
      if (fromPage) return fromPage;

      // Ainda em /step/: pode precisar Continue ou outro Take Photo.
      if (isUberStepUrl(page.url())) {
        const cont = page.getByRole("button", { name: PRIMARY_NEXT_OR_START });
        if (await cont.first().isVisible({ timeout: 300 }).catch(() => false)) {
          await cont.first().click({ timeout: 5_000 }).catch(() => undefined);
          await page.waitForTimeout(1_000);
          continue;
        }

        const takePhoto = page
          .getByRole("button", { name: TAKE_PHOTO_RE })
          .or(page.getByRole("link", { name: TAKE_PHOTO_RE }));
        if (
          Date.now() - lastTakeClick > 8_000 &&
          (await takePhoto.first().isVisible({ timeout: 300 }).catch(() => false))
        ) {
          lastTakeClick = Date.now();
          await takePhoto.first().click({ timeout: 5_000 }).catch(() => undefined);
          await page.waitForTimeout(1_200);
          continue;
        }
      }

      await page.waitForTimeout(700);
    }
  } finally {
    page.off("request", onRequest);
  }

  const late = findProviderIn(networkHits) ?? findProviderIn(await collectCandidateUrls(page));
  if (late) return late;
  return { label: "UNKNOWN", url: page.url() };
}

async function probeOneDoc(page: Page, kind: DocKind, timeout: number): Promise<ProbeResult> {
  await clickDocEntry(page, kind, timeout);
  await waitForUberTakePhotoScreen(page, Math.max(timeout, 30_000));

  // Listener já ativo durante o clique — captura redirect imediato.
  const networkHits: string[] = [];
  const onRequest = (req: Request) => {
    if (classifyUrl(req.url())) networkHits.push(req.url());
  };
  page.on("request", onRequest);

  try {
    await clickTakePhoto(page, timeout);
    // Reusa hits já capturados no wait (mesmo page.on — anexamos outro; ok).
    const signal = await waitForProviderLinkAfterTakePhoto(page, 90_000);
    // Preferir hit de rede se o wait devolveu UNKNOWN mas a rede viu veriff.
    const fromNet = findProviderIn(networkHits);
    const final = signal.label !== "UNKNOWN" ? signal : fromNet ?? signal;

    return {
      kind,
      provider: labelToProvider(final.label),
      confidence: final.label === "UNKNOWN" ? "LOW" : "HIGH",
      url: final.url,
      label: final.label,
    };
  } finally {
    page.off("request", onRequest);
  }
}

/**
 * Probe: Documents → doc → tela /step/ → Take Photo → ler link (veriff|socure) → voltar.
 */
export async function probeVerificationProvidersStep(ctx: RealStepContext): Promise<never> {
  const { page, config } = ctx;
  const timeout = config.timeouts.elementWait;
  const probes: ProbeResult[] = [];

  try {
    await ensureDocumentsTab(ctx);
    await ctx.recordStep("DRIVER_REQUIREMENTS_REACHED", { url: page.url() });

    const license = await probeOneDoc(page, "DRIVER_LICENSE", timeout);
    probes.push(license);
    await ctx.recordStep("VERIFICATION_PROVIDER_PROBED", {
      verificationType: "DRIVER_LICENSE",
      provider: license.provider,
      label: license.label,
      confidence: license.confidence,
      url: license.url,
    });

    await softGoto(page, config.profileUrl, Math.max(config.timeouts.pageLoad, 45_000));
    await ensureDocumentsTab(ctx);

    const photo = await probeOneDoc(page, "PROFILE_PHOTO", timeout);
    probes.push(photo);
    await ctx.recordStep("VERIFICATION_PROVIDER_PROBED", {
      verificationType: "PROFILE_PHOTO",
      provider: photo.provider,
      label: photo.label,
      confidence: photo.confidence,
      url: photo.url,
    });

    await softGoto(page, config.profileUrl, Math.max(config.timeouts.pageLoad, 45_000));
  } catch (error) {
    throw toTechnicalError(
      error,
      "VERIFICATION_PROBE_FAILED",
      "Falha ao sondar provedor de verificação (Take Photo)",
    );
  }

  const license = probes.find((p) => p.kind === "DRIVER_LICENSE");
  const photo = probes.find((p) => p.kind === "PROFILE_PHOTO");
  const licenseLabel = license?.label ?? "UNKNOWN";
  const photoLabel = photo?.label ?? "UNKNOWN";
  const anySocure = probes.some((p) => p.label === "SOCURE");

  throw new AutomationPauseSignal(anySocure ? "IDENTITY_VERIFICATION_REQUIRED" : "NON_SOCURE_PROVIDER", {
    type: "DRIVER_LICENSE",
    provider: anySocure ? "SOCURE" : license?.provider ?? photo?.provider ?? "UNKNOWN",
    confidence: probes.every((p) => p.label !== "UNKNOWN") ? "HIGH" : "LOW",
    driverLicenseProvider: licenseLabel,
    driverLicenseConfidence: license?.confidence,
    profilePhotoProvider: photoLabel,
    profilePhotoConfidence: photo?.confidence,
  });
}
