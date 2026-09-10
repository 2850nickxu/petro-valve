import Link from "next/link";
import type { ComponentProps } from "react";
import styled, { css } from "styled-components";
import { addValues, theme } from "@bigcommerce/big-design-theme";

// A single, valid <a> that LOOKS like a Big Design `Button` — replaces the
// `<Link><Button/></Link>` nesting the migration introduced (invalid HTML5: an
// interactive element inside an interactive element, and a double tab stop). The old,
// pre-migration code used a single anchor styled as a button (`<Link className="btn ...">`);
// this restores that shape on top of Big Design's visual language.
//
// Big Design has no button-styled-anchor primitive, so the styles below reproduce the
// relevant parts of its `Button` token-for-token — see
// node_modules/@bigcommerce/big-design/dist/es/components/Button/{styled,private}.js.
// Like every other bespoke styled-component in this app, it imports `theme` directly
// rather than reading `props.theme` (undefined at SSR here).

export type LinkButtonVariant = "primary" | "secondary" | "subtle";

const VARIANT_STYLES = {
  primary: css`
    background-color: ${theme.colors.primary};
    border-color: ${theme.colors.primary};
    color: ${theme.colors.white};
    font-weight: ${theme.typography.fontWeight.semiBold};

    &:hover {
      background-color: ${theme.colors.primary50};
    }

    &:active {
      background-color: ${theme.colors.primary60};
    }
  `,
  secondary: css`
    background-color: transparent;
    border-color: ${theme.colors.primary};
    color: ${theme.colors.primary};

    &:hover {
      background-color: ${theme.colors.primary10};
    }

    &:active {
      background-color: ${theme.colors.primary20};
    }
  `,
  subtle: css`
    background-color: transparent;
    border-color: transparent;
    color: ${theme.colors.primary};

    &:hover {
      background-color: ${theme.colors.primary10};
    }

    &:active {
      background-color: ${theme.colors.primary20};
    }
  `,
} satisfies Record<LinkButtonVariant, ReturnType<typeof css>>;

const StyledLinkButton = styled(Link)<{ $variant: LinkButtonVariant }>`
  align-items: center;
  appearance: none;
  border: 1px solid ${theme.colors.secondary30};
  border-radius: ${theme.borderRadius.normal};
  cursor: pointer;
  display: inline-flex;
  font-size: ${theme.typography.fontSize.medium};
  font-weight: ${theme.typography.fontWeight.regular};
  height: ${addValues(theme.spacing.xxLarge, theme.spacing.xxSmall)};
  justify-content: center;
  line-height: ${theme.lineHeight.xLarge};
  padding: 0 ${theme.spacing.medium};
  position: relative;
  text-align: center;
  text-decoration: none;
  transition: all 150ms ease-out;
  transition-property: background-color, border-color, box-shadow, color;
  user-select: none;
  vertical-align: middle;
  white-space: nowrap;
  width: 100%;

  ${theme.breakpoints.tablet} {
    width: auto;
  }

  &:focus {
    outline: none;
  }

  /* Big Design's Button shows its ring on every :focus; anchors get a mouse click too,
     so this uses :focus-visible instead — same ring, but only for keyboard/AT focus. */
  &:focus-visible {
    box-shadow: 0 0 0 ${theme.spacing.xxSmall} ${theme.colors.primary20};
  }

  ${({ $variant }) => VARIANT_STYLES[$variant]}
`;

export type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: LinkButtonVariant;
};

/** Navigation styled as a Big Design `Button` — one real, focusable `<a>`. */
export function LinkButton({ variant = "primary", ...props }: LinkButtonProps) {
  return <StyledLinkButton $variant={variant} {...props} />;
}
