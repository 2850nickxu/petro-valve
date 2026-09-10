import { Box, Flex, Panel, Text } from "@bigcommerce/big-design";
import { theme } from "@bigcommerce/big-design-theme";
import { Simulator } from "@/components/simulator";
import { PageHead } from "@/app/staff/ui";
import { LinkButton } from "@/components/ui/link-button";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  return (
    <Flex flexDirection="column" backgroundColor="secondary10" style={{ minHeight: "100vh" }}>
      <Flex
        as="header"
        alignItems="center"
        backgroundColor="white"
        padding="medium"
        style={{ borderBottom: `1px solid ${theme.colors.secondary20}` }}
      >
        <Text bold marginBottom="none">
          PO Agent
        </Text>
      </Flex>

      <Box style={{ maxWidth: 1060, margin: "0 auto", width: "100%" }} padding="large">
        <PageHead
          title="PO Agent — Live Demo"
          sub={
            <>
              Buyers email a purchase order — PDF, spreadsheet, or plain text. This agent identifies the buyer,
              extracts the PO, enforces the same B2B controls the storefront would, and decides: place an order,
              send a quote, ask a clarifying question, or escalate. Paste a PO below and watch the pipeline run —{" "}
              <strong>nothing is submitted</strong>.
            </>
          }
        />

        <Simulator />

        <Panel marginTop="large">
          <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" style={{ gap: 12 }}>
            <Box>
              <Text bold marginBottom="none">
                Ready to connect your BigCommerce store?
              </Text>
              <Text color="secondary60" marginBottom="none" marginTop="xxSmall">
                This is a live demo running against a read-only simulation. The admin console lets you connect a
                real store, configure rules, and monitor live PO traffic.
              </Text>
            </Box>
            <LinkButton href="/staff" variant="primary">Go to Admin →</LinkButton>
          </Flex>
        </Panel>
      </Box>
    </Flex>
  );
}
