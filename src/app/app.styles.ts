import { css, cva } from "styled-system/css";

export const styles = {
  shell: cva({
    base: {
      boxSizing: "border-box",
      minBlockSize: "100svh",
      backgroundColor: "bg",
    },
    variants: {
      focusedWorkout: {
        true: { paddingBlockEnd: "0" },
        false: {
          paddingBlockEnd: { base: "calc(84px + env(safe-area-inset-bottom))", md: "16px" },
        },
      },
    },
    defaultVariants: { focusedWorkout: false },
  }),
  globalActions: css({
    position: "fixed",
    insetBlockStart: { base: "16px", md: "28px" },
    insetInlineEnd: {
      base: "16px",
      md: "max(24px, calc((100vi - 960px) / 2 + 24px))",
    },
    zIndex: "25",
  }),
  navigation: css({
    position: { base: "fixed", md: "sticky" },
    insetBlockStart: { md: "0" },
    insetBlockEnd: { base: "0", md: "auto" },
    insetInline: { base: "0", md: "auto" },
    zIndex: "20",
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "4px",
    inlineSize: { base: "100%", md: "min(100%, 640px)" },
    maxInlineSize: { base: "none", md: "640px" },
    marginInline: "auto",
    paddingBlockStart: "10px",
    paddingBlockEnd: { base: "calc(10px + env(safe-area-inset-bottom))", md: "10px" },
    paddingInline: { base: "14px", sm: "20px" },
    backgroundColor: "rgba(13, 17, 23, 0.94)",
    borderBlockStartWidth: { base: "1px", md: "0" },
    borderBlockEndWidth: { base: "0", md: "1px" },
    borderInlineWidth: "0",
    borderStyle: "solid",
    borderColor: "lineMuted",
    boxShadow: { base: "0 -18px 40px rgba(0, 0, 0, 0.36)", md: "0 18px 60px rgba(0, 0, 0, 0.18)" },
    backdropFilter: "blur(14px)",
  }),
  navigationButton: cva({
    base: {
      minBlockSize: "54px",
      display: "inline-flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "4px",
      paddingBlock: "7px",
      paddingInline: "4px",
      borderBlockWidth: "0",
      borderInlineWidth: "0",
      borderStyle: "solid",
      borderStartStartRadius: "8px",
      borderStartEndRadius: "8px",
      borderEndStartRadius: "8px",
      borderEndEndRadius: "8px",
      cursor: "pointer",
      fontSize: "11px",
      fontWeight: "800",
      lineHeight: "1",
      transition: "background-color 120ms ease, border-color 120ms ease, color 120ms ease",
    },
    variants: {
      selected: {
        true: {
          backgroundColor: "transparent",
          borderColor: "transparent",
          color: "accent",
        },
        false: {
          backgroundColor: "transparent",
          borderColor: "transparent",
          color: "fgMuted",
          _hover: {
            backgroundColor: "cardElevated",
            color: "fg",
          },
        },
      },
    },
    defaultVariants: {
      selected: false,
    },
  }),
  navigationIcon: css({
    inlineSize: "18px",
    blockSize: "18px",
    flexShrink: "0",
  }),
};
