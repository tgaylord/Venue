import { Html, Body, Container, Heading, Text, Link, Hr } from "@react-email/components";

export type WalkthroughReminderEmailProps = {
  renterName: string;
  startsAtLabel: string;
  bookingUrl: string;
};

export default function WalkthroughReminder(p: WalkthroughReminderEmailProps) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#0b0c0f", color: "#e9eaee" }}>
        <Container style={{ padding: 24, maxWidth: 520 }}>
          <Heading style={{ fontSize: 20 }}>Pre-event walkthrough reminder</Heading>
          <Text style={{ color: "#9a9ca8", marginTop: 0 }}>
            Your event with {p.renterName} starts at {p.startsAtLabel}.
          </Text>
          <Hr style={{ borderColor: "#26272e" }} />
          <Text style={{ lineHeight: 1.8 }}>
            Run the pre-event walkthrough to capture timestamped documentation of the space.
          </Text>
          <Link
            href={p.bookingUrl}
            style={{ display: "inline-block", background: "#7a86ff", color: "#0d0e14", fontWeight: 700, padding: "10px 18px", borderRadius: 8, textDecoration: "none" }}
          >
            Open booking
          </Link>
        </Container>
      </Body>
    </Html>
  );
}
