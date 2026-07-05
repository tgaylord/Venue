import { Html, Body, Container, Heading, Text } from "@react-email/components";

export default function TestEmail({ name }: { name: string }) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f7f5f0" }}>
        <Container style={{ padding: 24 }}>
          <Heading>VenueDash</Heading>
          <Text>Hello {name} — email wiring works (phase 0).</Text>
        </Container>
      </Body>
    </Html>
  );
}
