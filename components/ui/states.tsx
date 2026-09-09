import type { ReactNode } from "react";
import { Flex, Text } from "@bigcommerce/big-design";
import { Banner as RichBanner } from "@/components/ui/banner";

// Server-safe presentational states. Banner distinguishes "backend is down" from an
// ordinary empty list; EmptyState/ErrorState give lists a consistent, non-alarming look.

export function Banner({
  kind = "info",
  title,
  children,
}: {
  kind?: "info" | "warn" | "error" | "ok";
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <RichBanner kind={kind} title={title}>
      {children}
    </RichBanner>
  );
}

export function EmptyState({ icon = "○", title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <Flex flexDirection="column" alignItems="center" padding="large" style={{ textAlign: "center" }}>
      <Text color="secondary60" marginBottom="none" style={{ fontSize: 20, opacity: 0.55 }}>
        {icon}
      </Text>
      <Text bold color="secondary70" marginTop="xSmall" marginBottom="none">
        {title}
      </Text>
      {children ? (
        <Text color="secondary60" marginTop="xxSmall" marginBottom="none">
          {children}
        </Text>
      ) : null}
    </Flex>
  );
}

export function ErrorState({ title = "Something went wrong", children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <Flex flexDirection="column" alignItems="center" padding="large" style={{ textAlign: "center" }}>
      <Text bold color="danger" marginBottom="none" style={{ fontSize: 20 }}>
        !
      </Text>
      <Text bold color="secondary70" marginTop="xSmall" marginBottom="none">
        {title}
      </Text>
      {children ? (
        <Text color="secondary60" marginTop="xxSmall" marginBottom="none">
          {children}
        </Text>
      ) : null}
    </Flex>
  );
}
