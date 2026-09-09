import Link from "next/link";
import { Box, Button, Flex, Grid, H3, Panel, Text } from "@bigcommerce/big-design";
import { theme } from "@bigcommerce/big-design-theme";
import { PageHead } from "@/app/staff/ui";

export default function Home() {
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
          title="Offline PO Agent"
          sub="Email-first purchase-order processing for BigCommerce B2B Edition. Buyers email a PO; the agent identifies the buyer, parses it, enforces B2B controls, and submits an order (pay-on-account) or a quote with a checkout link."
        />

        <Grid gridColumns={{ mobile: "1fr", desktop: "1.2fr 1fr" }} gridGap="16px">
          <Panel>
            <H3 marginBottom="xSmall">Admin console</H3>
            <Text color="secondary60">Dashboard, review queue, sessions, simulator, and settings.</Text>
            <Link href="/staff">
              <Button variant="primary">Open admin</Button>
            </Link>
          </Panel>
          <Panel>
            <H3 marginBottom="xSmall">Public demo</H3>
            <Text color="secondary60">Paste a PO and watch the pipeline run — no credentials needed.</Text>
            <Link href="/demo">
              <Button>Open demo</Button>
            </Link>
          </Panel>
        </Grid>
      </Box>
    </Flex>
  );
}
