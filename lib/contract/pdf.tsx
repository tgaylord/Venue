import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ContractDoc } from "./types";

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 54, fontSize: 10, lineHeight: 1.5, fontFamily: "Times-Roman", color: "#1a1a1a" },
  title: { fontSize: 18, fontFamily: "Times-Bold", marginBottom: 8 },
  disclaimer: { fontSize: 8.5, fontStyle: "italic", color: "#555", marginBottom: 16, padding: 8, borderWidth: 1, borderColor: "#bbb", borderStyle: "solid" },
  heading: { fontSize: 11, fontFamily: "Times-Bold", marginTop: 12, marginBottom: 3 },
  plain: { fontSize: 8.5, fontStyle: "italic", color: "#4a5", marginBottom: 3 },
  body: { marginBottom: 3 },
});

export function ContractDocument({ doc }: { doc: ContractDoc }) {
  return (
    <Document title={doc.title}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>{doc.title}</Text>
        <Text style={s.disclaimer}>{doc.disclaimer}</Text>
        {doc.sections.map((sec, i) => (
          <View key={i} wrap={false}>
            <Text style={s.heading}>{sec.heading}</Text>
            {sec.plainEnglish ? <Text style={s.plain}>In plain English: {sec.plainEnglish}</Text> : null}
            {sec.body.map((p, j) => (
              <Text key={j} style={s.body}>{p}</Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function renderContractPdf(doc: ContractDoc): Promise<Buffer> {
  return renderToBuffer(<ContractDocument doc={doc} />);
}
