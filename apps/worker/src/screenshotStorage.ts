import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { env } from "./env";

/**
 * Salva um buffer de screenshot best-effort em `AUTOMATION_SCREENSHOTS_PATH`
 * - mesma pasta usada por captureDebugScreenshot em uberAutomationRunner.ts,
 * só que a partir de um Buffer já pronto (não de um `Page` direto), porque
 * quem chama aqui (emailVerificationWorkerFactory.ts) recebe a screenshot
 * através de IGmailClient.screenshot(), do outro lado da fronteira do
 * pacote @uber-automation/email-service.
 */
export async function saveDebugScreenshot(
  buffer: Buffer,
  applicantId: string,
  tag: string,
): Promise<string | undefined> {
  try {
    await mkdir(env.AUTOMATION_SCREENSHOTS_PATH, { recursive: true });
    const fileName = `${applicantId}-${tag}-${Date.now()}.png`;
    const filePath = path.join(env.AUTOMATION_SCREENSHOTS_PATH, fileName);
    await writeFile(filePath, buffer);
    return filePath;
  } catch {
    return undefined;
  }
}
