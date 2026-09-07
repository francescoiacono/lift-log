import { css } from "styled-system/css";

export const styles = {
  filters: css({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }),
  list: css({ display: "grid", listStyle: "none", paddingInlineStart: "0", gap: "8px" }),
  row: css({
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minBlockSize: "64px",
    paddingBlock: "12px",
    paddingInline: "12px",
    borderBlockWidth: "1px",
    borderInlineWidth: "1px",
    borderStyle: "solid",
    borderColor: "lineMuted",
    borderStartStartRadius: "10px",
    borderStartEndRadius: "10px",
    borderEndStartRadius: "10px",
    borderEndEndRadius: "10px",
    cursor: "pointer",
    "&:has(input:checked)": { backgroundColor: "accentSoft", borderColor: "accent" },
  }),
  checkbox: css({
    inlineSize: "22px",
    blockSize: "22px",
    flexShrink: "0",
    accentColor: "token(colors.accent)",
  }),
  summary: css({ display: "grid", gap: "4px", minInlineSize: "0" }),
  name: css({ fontSize: "15px", fontWeight: "750", overflowWrap: "anywhere" }),
  count: css({ marginInlineEnd: "auto", color: "fgMuted", fontSize: "14px" }),
};
