import { Html, Body, Container, Heading, Text, Link } from "@react-email/components";

export type ContractReadyEmailProps = { studioName: string; when: string; contractUrl?: string };

export default function ContractReadyRenter(p: ContractReadyEmailProps) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f7f5f0", color: "#211f1a" }}>
        <Container style={{ padding: 24, maxWidth: 520 }}>
          <Heading style={{ fontSize: 22, fontFamily: "Georgia, serif" }}>Your rental agreement is ready</Heading>
          <Text style={{ lineHeight: 1.7 }}>
            {p.studioName} has approved your booking and prepared the rental agreement.
            Download your copy below to review it. Your host will arrange signing.
          </Text>
          <Text style={{ color: "#8a867c" }}>Your event: {p.when}</Text>
          {p.contractUrl ? (
            <Link
              href={p.contractUrl}
              style={{ display: "inline-block", background: "#211f1a", color: "#f7f5f0", fontWeight: 700, padding: "12px 20px", borderRadius: 10, textDecoration: "none" }}
            >
              Download your rental agreement (PDF)
            </Link>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
