import { Html, Body, Container, Heading, Text, Link } from "@react-email/components";

export type RenterReceivedEmailProps = { studioName: string; when: string; statusUrl: string };

export default function RenterRequestReceived(p: RenterReceivedEmailProps) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f7f5f0", color: "#211f1a" }}>
        <Container style={{ padding: 24, maxWidth: 520 }}>
          <Heading style={{ fontSize: 22, fontFamily: "Georgia, serif" }}>Request sent</Heading>
          <Text style={{ lineHeight: 1.7 }}>
            Thanks — {p.studioName} usually responds within 24 hours. We&apos;ll email you the moment they do; no account needed.
          </Text>
          <Text style={{ color: "#8a867c" }}>Your event: {p.when}</Text>
          <Link
            href={p.statusUrl}
            style={{ display: "inline-block", background: "#211f1a", color: "#f7f5f0", fontWeight: 700, padding: "12px 20px", borderRadius: 10, textDecoration: "none" }}
          >
            View your request status
          </Link>
        </Container>
      </Body>
    </Html>
  );
}
