import type { Metadata } from "next";
import { DocList, DocPage, DocSection } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "India features — UDYOG POS",
  description: "GST, HSN/SAC, FSSAI, UPI and INR support in UDYOG POS.",
};

export default function ComplianceIndiaPage() {
  return (
    <DocPage title="India features" updated="9 November 2026">
      <DocSection heading="What UDYOG POS supports today">
        <p>These features are active when a branch&rsquo;s tax regime is set to India &mdash; GST under Settings.</p>
        <DocList
          items={[
            "GST on bills: a tax rate per menu item, tax-inclusive or tax-exclusive menu prices, and the branch GSTIN printed on every bill.",
            "CGST and SGST: the tax on a bill is shown as two equal halves for sales within the branch's state.",
            "IGST: when a place of supply in another state is entered at checkout, the tax is shown as one IGST line instead. A customer GSTIN can be added to the bill and fills in the place of supply automatically.",
            "HSN/SAC: an optional code per menu item, with a branch default, printed under each line of the bill.",
            "FSSAI: the branch FSSAI licence number is printed on bills and on the table QR menu when set.",
            "UPI QR: checkout shows a UPI QR code with the amount filled in, for the restaurant's own UPI id.",
            "INR: amounts are shown and printed in Indian rupees (₹).",
          ]}
        />
        <p>Which details your bills need depends on your registration; check with your chartered accountant.</p>
      </DocSection>
    </DocPage>
  );
}
