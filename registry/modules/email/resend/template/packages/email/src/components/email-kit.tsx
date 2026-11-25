import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { branding } from "{{SCOPE}}/config";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const styles = {
  body: {
    backgroundColor: branding.backgroundColor,
    margin: 0,
    padding: "40px 0",
    fontFamily: FONT,
    color: "#171717",
  },
  container: { maxWidth: "480px", margin: "0 auto", padding: "0 32px" },
  brand: { margin: "0 0 32px", fontSize: "18px", fontWeight: 600, color: branding.themeColor },
  heading: { margin: "0 0 16px", fontSize: "24px", lineHeight: "32px", fontWeight: 600 },
  text: { margin: "0 0 16px", fontSize: "14px", lineHeight: "24px" },
  button: {
    backgroundColor: branding.themeColor,
    borderRadius: "8px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 500,
    padding: "12px 24px",
    textDecoration: "none",
  },
  divider: { margin: "32px 0 16px", borderColor: "#e5e5e5" },
  footer: { margin: 0, fontSize: "12px", lineHeight: "20px", color: "#737373" },
  link: { color: branding.themeColor },
} satisfies Record<string, CSSProperties>;

/**
 * The frame every email shares: the brand's name on top, the content, then the support address.
 * The brand comes from `branding` (`displayName`, `themeColor`, `supportEmail`), so a project
 * restyles its emails by editing `branding.json` and nothing here.
 */
export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang={branding.lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.brand}>{branding.displayName}</Text>
          {children}
          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            {`${branding.displayName} · Questions? `}
            <Link href={`mailto:${branding.supportEmail}`} style={styles.link}>
              {branding.supportEmail}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function EmailHeading({ children }: { children: ReactNode }) {
  return <Heading style={styles.heading}>{children}</Heading>;
}

export function EmailText({ children }: { children: ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}

/** A call to action in the brand's colour; the text part of the email keeps its link too. */
export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button href={href} style={styles.button}>
      {children}
    </Button>
  );
}
