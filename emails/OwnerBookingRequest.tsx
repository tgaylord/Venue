import { Html, Body, Container, Heading, Text, Link, Hr } from "@react-email/components";

export type OwnerBookingEmailProps = {
  studioName: string; renterName: string; eventType: string; when: string;
  headcount: number; byob: boolean; outsideVendors: boolean; notes: string | null; dashboardUrl: string;
};

export default function OwnerBookingRequest(p: OwnerBookingEmailProps) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#0b0c0f", color: "#e9eaee" }}>
        <Container style={{ padding: 24, maxWidth: 520 }}>
          <Heading style={{ fontSize: 20 }}>New booking request</Heading>
          <Text style={{ color: "#9a9ca8", marginTop: 0 }}>
            {p.renterName} wants to book {p.studioName}.
          </Text>
          <Hr style={{ borderColor: "#26272e" }} />
          <Text style={{ lineHeight: 1.8 }}>
            <strong>{p.when}</strong><br />
            {p.eventType} · {p.headcount} guests<br />
            BYOB: {p.byob ? "yes" : "no"} · Outside vendors: {p.outsideVendors ? "yes" : "no"}
          </Text>
          {p.notes ? <Text style={{ color: "#9a9ca8" }}>&quot;{p.notes}&quot;</Text> : null}
          <Link
            href={p.dashboardUrl}
            style={{ display: "inline-block", background: "#7a86ff", color: "#0d0e14", fontWeight: 700, padding: "10px 18px", borderRadius: 8, textDecoration: "none" }}
          >
            Open your dashboard
          </Link>
        </Container>
      </Body>
    </Html>
  );
}
