import type { ReactNode } from "react";
import { Box, Text } from "@bigcommerce/big-design";
import { theme } from "@bigcommerce/big-design-theme";

export const dynamic = "force-dynamic";

// Compact layout for the control-panel PANEL iframe (no admin nav). A slim branded header
// keeps it visually part of the same product inside the BigCommerce control panel.
export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <Box>
      <Box
        backgroundColor="white"
        style={{ padding: "10px 16px", borderBottom: `1px solid ${theme.colors.secondary20}` }}
      >
        <Text bold marginBottom="none" style={{ fontSize: 13 }}>
          PO Agent
        </Text>
      </Box>
      <Box style={{ padding: 16, maxWidth: 560 }}>{children}</Box>
    </Box>
  );
}
