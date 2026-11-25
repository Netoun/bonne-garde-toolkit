import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EMAIL_LOCALES, type EmailLocale } from "./messages";
import { renderEmailTemplate, type EmailTemplate } from "./render";
import { invitationPreviewProps, InvitationEmail } from "./templates/invitation.template";
import { resetPasswordPreviewProps, ResetPasswordEmail } from "./templates/reset-password.template";
import { verifyEmailPreviewProps, VerifyEmailEmail } from "./templates/verify-email.template";
import { welcomePreviewProps, WelcomeTemplate } from "./templates/welcome.template";
import type { EmailTemplateProps } from "./types";

type PreviewEntry = {
  name: string;
  render: (locale: EmailLocale) => ReturnType<typeof renderEmailTemplate>;
};

function entry<P extends EmailTemplateProps & { locale?: EmailLocale }>(
  name: string,
  template: EmailTemplate<P>,
  props: P,
): PreviewEntry {
  return { name, render: (locale) => renderEmailTemplate(template, { ...props, locale }) };
}

/** The templates the preview renders. A new template is previewed by adding one line here. */
const PREVIEWS: PreviewEntry[] = [
  entry("verify-email", VerifyEmailEmail, verifyEmailPreviewProps),
  entry("reset-password", ResetPasswordEmail, resetPasswordPreviewProps),
  entry("invitation", InvitationEmail, invitationPreviewProps),
  entry("welcome", WelcomeTemplate, welcomePreviewProps),
];

const DEFAULT_OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../.preview");

function indexHtml(files: Record<string, EmailLocale[]>): string {
  const items = Object.entries(files)
    .map(([name, locales]) => {
      const links = locales
        .map(
          (locale) =>
            `${locale}: <a href="${name}.${locale}.html">html</a> · <a href="${name}.${locale}.txt">text</a>`,
        )
        .join(" | ");
      return `    <li><strong>${name}</strong> — ${links}</li>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Email previews</title></head>
  <body>
    <h1>Email previews</h1>
    <ul>
${items}
    </ul>
  </body>
</html>
`;
}

/**
 * Renders every registered template in every locale, with its sample props, to
 * `<template>.<locale>.html` and `.txt` in `outDir`, plus an `index.html` linking them.
 * Returns the paths written.
 */
export async function writePreviews(outDir: string = DEFAULT_OUT_DIR): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  const write = async (file: string, content: string) => {
    const path = join(outDir, file);
    await writeFile(path, content);
    written.push(path);
  };

  for (const { name, render } of PREVIEWS) {
    for (const locale of EMAIL_LOCALES) {
      const { html, text } = await render(locale);
      await write(`${name}.${locale}.html`, html);
      await write(`${name}.${locale}.txt`, text);
    }
  }
  await write(
    "index.html",
    indexHtml(Object.fromEntries(PREVIEWS.map(({ name }) => [name, [...EMAIL_LOCALES]]))),
  );
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const written = await writePreviews();
  console.log(`Wrote ${written.length} files. Open ${join(DEFAULT_OUT_DIR, "index.html")}`);
}
