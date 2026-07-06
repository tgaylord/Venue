import { Html, Body, Container, Heading, Text, Link } from "@react-email/components";

export type ContractReadyEmailProps = { studioName: string; when: string; statusUrl?: string };

export default function ContractReadyRenter(p: ContractReadyEmailProps) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f7f5f0", color: "#211f1a" }}>
        <Container style={{ padding: 24, maxWidth: 520 }}>
          <Heading style={{ fontSize: 22, fontFamily: "Georgia, serif" }}>Your rental agreement is ready</Heading>
          <Text style={{ lineHeight: 1.7 }}>
            {p.studioName} has prepared the rental agreement for your event. You&apos;ll receive a separate
            request to sign it electronically — keep an eye on your inbox. You can review a copy anytime from your status page (bookmark the link from your first confirmation email).
          </Text>
          <Text style={{ color: "#8a867c" }}>Your event: {p.when}</Text>
          {p.statusUrl ? (
            <Link
              href={p.statusUrl}
              style={{ display: "inline-block", background: "#211f1a", color: "#f7f5f0", fontWeight: 700, padding: "12px 20px", borderRadius: 10, textDecoration: "none" }}
            >
              View your booking &amp; agreement
            </Link>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
