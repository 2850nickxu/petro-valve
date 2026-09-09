import type { ReactNode } from "react";
import { Box, Flex, Text } from "@bigcommerce/big-design";
import { colors, type Colors } from "@bigcommerce/big-design-theme";

const TONE: Record<string, { border: keyof Colors; bg: keyof Colors }> = {
  info: { border: "primary40", bg: "primary10" },
  warn: { border: "warning40", bg: "warning10" },
  error: { border: "danger40", bg: "danger10" },
  ok: { border: "success40", bg: "success10" },
};

// A left-ruled callout that can hold arbitrary JSX (bold, code, lists, links) — Big
// Design's Message component only accepts plain-text messages, so rich banners use this
// themed Box instead. Colors come from the Big Design theme's color scale.
export function Banner({
  kind,
  title,
  children,
}: {
  kind: "info" | "warn" | "error" | "ok";
  title?: ReactNode;
  children: ReactNode;
}) {
  const tone = TONE[kind] ?? TONE.info;
  return (
    <Box
      backgroundColor={tone.bg}
      border="box"
      borderRadius="normal"
      padding="medium"
      role={kind === "error" ? "alert" : undefined}
      style={{ borderLeftWidth: 4, borderLeftColor: colors[tone.border] }}
    >
      {title ? (
        <Text bold marginBottom="xSmall">
          {title}
        </Text>
      ) : null}
      <Flex flexDirection="column">{children}</Flex>
    </Box>
  );
}
